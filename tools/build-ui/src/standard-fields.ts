import type { Builder } from "./builder.js";
import type { CaseControl } from "./case-form.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import type { ConfigurationScalar, StandardFieldTarget } from "./configuration-targets.js";
import { waitFor } from "./common.js";

export type CandidateMatch =
  { by: "value"; value: ConfigurationScalar } | { by: "label"; label: string };
export interface TargetObservation {
  scopeReady: boolean;
  scopeComplete: boolean;
  matchCount: number | null;
  presence: "present" | "absent" | "undetermined";
  visible: boolean | null;
  readable: boolean;
  writable: boolean;
  control?: string;
  reason?: "not-ready" | "ambiguous" | "unsupported" | "incomplete-scope";
}
export interface CandidateObservation {
  target: TargetObservation;
  complete: boolean;
  items: Array<{ value?: ConfigurationScalar; label: string; disabled: boolean }>;
}
interface StandardObservation extends TargetObservation {
  value?: ConfigurationScalar;
  valueKind?: string;
  selector?: string;
  listOpen?: boolean;
  candidates?: Array<CandidateObservation["items"][number] & { selector?: string; index?: number }>;
  candidatesComplete?: boolean;
}
export interface ProbeExpected {
  presence?: "present" | "absent";
  visible?: boolean;
  readable?: boolean;
  writable?: boolean;
  control?: string;
}
export function assertTargetObservation(actual: TargetObservation, expected: ProbeExpected) {
  if (
    !actual.scopeReady ||
    actual.presence === "undetermined" ||
    actual.reason === "ambiguous" ||
    (expected.presence === "absent" && !actual.scopeComplete) ||
    (actual.reason === "unsupported" &&
      Object.keys(expected).some((key) => !["presence", "visible"].includes(key)))
  )
    throw new ConfigurationOperationError(
      "precondition",
      `目标观察不足以断言：${actual.reason ?? "not-ready"}`,
      "blocked",
    );
  if (
    Object.entries(expected).some(
      ([key, value]) => actual[key as keyof TargetObservation] !== value,
    )
  )
    throw new ConfigurationOperationError("assertion", "目标观察与预期不符", "failed");
  return { passed: true, observed: actual };
}
export function assertCandidateObservation(
  actual: CandidateObservation,
  match: CandidateMatch,
  expected: { present: boolean; disabled?: boolean },
) {
  if (
    !actual.complete ||
    !actual.target.scopeReady ||
    actual.target.presence !== "present" ||
    actual.target.visible !== true ||
    !actual.target.readable ||
    actual.target.matchCount !== 1
  )
    throw new ConfigurationOperationError(
      "precondition",
      "候选范围不完整或目标不可读取",
      "blocked",
    );
  const matches = matchCandidates(actual.items, match);
  if (matches.length > 1)
    throw new ConfigurationOperationError("precondition", "候选定位歧义", "blocked");
  if (
    !!matches.length !== expected.present ||
    (expected.disabled !== undefined && matches[0]?.disabled !== expected.disabled)
  )
    throw new ConfigurationOperationError("assertion", "候选观察与预期不符", "failed");
  return { passed: true, matchCount: matches.length };
}

/** Runs in the existing Builder document. Only bounded semantic locators enter this function. */
export function observeStandardField(
  document: Document,
  field: string,
  target: StandardFieldTarget,
): StandardObservation {
  const visible = (el: Element) =>
    (el as HTMLElement).getClientRects().length > 0 &&
    document.defaultView!.getComputedStyle(el).visibility !== "hidden";
  // Base UI keeps a non-interactive input beside the accessible trigger for form submission.
  // Do not treat an unrelated editable input as that proxy merely because a trigger exists.
  const proxyInput = (el: Element) => {
    if (el.tagName !== "INPUT") return false;
    const input = el as HTMLInputElement;
    if (input.type === "hidden") return true;
    if (el.getAttribute("aria-hidden") !== "true" || el.getAttribute("tabindex") !== "-1")
      return false;
    const style = document.defaultView!.getComputedStyle(el);
    const zeroClip =
      /^rect\(0(?:px)?,0(?:px)?,0(?:px)?,0(?:px)?\)$/.test(style.clip?.replace(/\s+/g, "") ?? "") ||
      style.clipPath?.replace(/\s+/g, "") === "inset(50%)";
    return (
      !el.getClientRects().length ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.pointerEvents === "none" ||
      zeroClip
    );
  };
  const empty: StandardObservation = {
    scopeReady: false,
    scopeComplete: false,
    matchCount: null,
    presence: "undetermined",
    visible: null,
    readable: false,
    writable: false,
    reason: "not-ready",
  };
  const closes = [...document.querySelectorAll('button[aria-label="Close"]')].filter(visible);
  if (closes.length !== 1)
    return {
      ...empty,
      matchCount: closes.length,
      reason: closes.length > 1 ? "ambiguous" : "not-ready",
    };
  const modal = closes[0].parentElement?.parentElement;
  if (!modal || !visible(modal)) return empty;
  const label = (row: Element) =>
    row.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ?? "";
  const path = (el: Element) => {
    const parts: string[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const siblings = node.parentElement
        ? [...node.parentElement.children].filter((n) => n.tagName === node!.tagName)
        : [node];
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    return parts.join(" > ");
  };
  let root: Element = modal;
  if (target.scope?.section) {
    const sections = [...modal.querySelectorAll("button[aria-expanded]")].filter(
      (el) => el.textContent?.trim() === target.scope!.section,
    );
    if (sections.length !== 1)
      return {
        ...empty,
        matchCount: sections.length,
        reason: sections.length > 1 ? "ambiguous" : "not-ready",
      };
    const section = sections[0];
    if (section.getAttribute("aria-expanded") !== "true") return empty;
    const content = section.getAttribute("aria-controls");
    const contents = content ? [...document.querySelectorAll(`[id="${CSS.escape(content)}"]`)] : [];
    if (contents.length !== 1 || !modal.contains(contents[0]))
      return { ...empty, reason: contents.length > 1 ? "ambiguous" : "unsupported" };
    root = contents[0];
  }
  const loading =
    [...modal.querySelectorAll('[aria-busy="true"], [data-loading="true"]')].some(visible) ||
    [...modal.querySelectorAll("div")].some(
      (el) =>
        !el.children.length &&
        visible(el) &&
        /^(正在加载选项…|加载参数中…|Loading options\.\.\.)$/.test(el.textContent?.trim() ?? ""),
    );
  const keyed = (key: string) => [
    ...root.querySelectorAll(`[data-option-key="${CSS.escape(key)}"]`),
  ];
  const standardReady = ["name", "buildPath"].every((key) =>
    [...modal.querySelectorAll(`[data-option-key="${key}"]`)].some(visible),
  );
  const ready = standardReady && !loading;
  if (!ready) return empty;
  const closedSection = [...root.querySelectorAll("button[aria-expanded]")].some(
    (el) =>
      visible(el) &&
      el.getAttribute("role") !== "combobox" &&
      el.getAttribute("aria-expanded") === "false",
  );
  const complete =
    !!target.scope &&
    !closedSection &&
    target.scope.readyKeys.every((key) => {
      const rows = keyed(key);
      return rows.length === 1 && visible(rows[0]);
    });
  const locator = target.locator ?? { kind: "option-key" as const, key: field };
  let rows: Element[];
  let direct = false;
  if (locator.kind === "option-key") rows = keyed(locator.key);
  else if (locator.kind === "label")
    rows = [...root.querySelectorAll('[data-slot="field"]')].filter(
      (row) => label(row) === locator.name,
    );
  else {
    const selectors = {
      textbox:
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="number"]),textarea,[role="textbox"]',
      spinbutton: 'input[type="number"],[role="spinbutton"]',
      checkbox: 'input[type="checkbox"],[role="checkbox"]',
      combobox: 'select,[role="combobox"]',
    };
    let unresolvedName = false;
    const name = (el: Element): string | undefined => {
      const explicit = el.getAttribute("aria-label");
      if (explicit !== null) return explicit;
      const references = el.getAttribute("aria-labelledby")?.trim().split(/\s+/);
      if (references?.length) {
        const names = references.map((id) => [
          ...document.querySelectorAll(`[id="${CSS.escape(id)}"]`),
        ]);
        if (names.every((matches) => matches.length === 1))
          return names.map((matches) => matches[0].textContent?.trim() ?? "").join(" ");
      } else {
        const labels = (el as HTMLInputElement).labels;
        if (labels?.length === 1) return labels[0].textContent?.trim() ?? "";
      }
      unresolvedName = true;
      return undefined;
    };
    rows = [...root.querySelectorAll(selectors[locator.role])]
      .filter((el) => !proxyInput(el))
      .filter((el) => name(el) === locator.name);
    if (unresolvedName) return { ...empty, scopeReady: true, reason: "unsupported" };
    direct = true;
  }
  const result: StandardObservation = {
    ...empty,
    scopeReady: true,
    scopeComplete: complete,
    matchCount: rows.length,
    reason: undefined,
  };
  if (!rows.length)
    return {
      ...result,
      presence: complete ? "absent" : "undetermined",
      reason: complete ? undefined : "incomplete-scope",
    };
  if (rows.length > 1) return { ...result, reason: "ambiguous" };
  const row = rows[0];
  result.presence = "present";
  result.visible = visible(row);
  if (!result.visible) return result;
  const owner = row.closest("[data-option-key]");
  if (
    /password|secret|token|appid|appkey|private|xxtea|encryptKey|context_signature|密码|密钥/i.test(
      (owner?.getAttribute("data-option-key") ?? "") + " " + label(row),
    )
  )
    return { ...result, reason: "unsupported" };
  const controls = direct
    ? rows
    : [
        ...row.querySelectorAll(
          'input:not([type="hidden"]),textarea,select,[role="checkbox"],[role="combobox"],[role="textbox"],[role="spinbutton"]',
        ),
      ]
        .filter(
          (el) => !row.hasAttribute("data-option-key") || el.closest("[data-option-key]") === row,
        )
        .filter(
          (el) =>
            !el.closest('[role="checkbox"],[role="combobox"]') ||
            el.matches('[role="checkbox"],[role="combobox"]'),
        )
        .filter((el) => !proxyInput(el));
  if (controls.length !== 1) return { ...result, reason: "unsupported" };
  const el = controls[0] as HTMLInputElement;
  const role = el.getAttribute("role");
  const kind =
    role === "checkbox" || el.type === "checkbox"
      ? "boolean"
      : role === "combobox" || el.tagName === "SELECT"
        ? "enum"
        : el.type === "number" || role === "spinbutton"
          ? "number"
          : el.tagName === "TEXTAREA" ||
              ["text", "url", "email", "search", "tel"].includes(el.type) ||
              role === "textbox"
            ? "text"
            : "unsupported";
  result.control = kind;
  if (kind !== target.control) return { ...result, reason: "unsupported" };
  const fieldRow = direct
    ? (row.closest('[data-slot="field"]') ?? row.closest("[data-option-key]") ?? row)
    : row;
  const proxies = [...fieldRow.querySelectorAll<HTMLInputElement>("input")].filter(
    (input) =>
      proxyInput(input) &&
      (!fieldRow.hasAttribute("data-option-key") ||
        input.closest("[data-option-key]") === fieldRow),
  );
  const scalar = (value: unknown): value is ConfigurationScalar =>
    ["string", "number", "boolean"].includes(typeof value) &&
    (typeof value !== "number" || Number.isFinite(value));
  const encoded = (element: Element) => {
    const raw = element.getAttribute("data-pink-enum-value");
    if (raw === null) return;
    try {
      const value: unknown = JSON.parse(raw);
      return scalar(value) ? value : undefined;
    } catch {
      return;
    }
  };
  const disabled = (element: Element) =>
    element.getAttribute("aria-disabled") === "true" ||
    element.hasAttribute("data-disabled") ||
    (element as HTMLInputElement).disabled === true ||
    (element as HTMLInputElement).readOnly === true ||
    element.matches(":disabled");
  if (
    kind === "boolean" &&
    role === "checkbox" &&
    !["true", "false"].includes(el.getAttribute("aria-checked") ?? "")
  )
    return { ...result, reason: "unsupported" };
  let value: unknown =
    kind === "boolean"
      ? role === "checkbox"
        ? el.getAttribute("aria-checked") === "true"
        : el.checked
      : kind === "number"
        ? el.value === ""
          ? ""
          : Number(el.value)
        : el.value;
  if (
    kind === "boolean" &&
    proxies.some((input) => input.type === "checkbox" && input.checked !== value)
  )
    return { ...result, reason: "unsupported" };
  if (kind === "enum") {
    if (el.tagName === "SELECT") {
      const select = el as unknown as HTMLSelectElement;
      const selected = select.selectedOptions[0];
      value = selected ? (encoded(selected) ?? selected.value) : select.value;
      result.candidates = [...select.options].map((option, index) => ({
        value: encoded(option) ?? option.value,
        label: option.label,
        disabled:
          option.disabled ||
          option.hidden ||
          !!option.closest("optgroup[disabled],optgroup[hidden]"),
        index,
      }));
      result.candidatesComplete = !select.hasAttribute("aria-busy");
    } else {
      const inputs = proxies.filter((input) => input.type !== "checkbox");
      if (inputs.length > 1) return { ...result, reason: "unsupported" };
      value = el.hasAttribute("data-pink-enum-value") ? encoded(el) : inputs[0]?.value;
      const listId = el.getAttribute("aria-controls");
      const lists = listId ? [...document.querySelectorAll(`[id="${CSS.escape(listId)}"]`)] : [];
      if (lists.length > 1) return { ...result, reason: "ambiguous" };
      const list = lists[0];
      result.listOpen = el.getAttribute("aria-expanded") === "true";
      if (result.listOpen && list && visible(list)) {
        const options = [...list.querySelectorAll('[role="option"]')];
        result.candidates = options.map((option) => ({
          value: encoded(option) ?? option.getAttribute("data-value") ?? undefined,
          label: option.textContent?.trim() ?? "",
          disabled:
            disabled(option) || !visible(option) || option.getAttribute("aria-hidden") === "true",
          selector: path(option),
        }));
        const sizes = options
          .map((option) => Number(option.getAttribute("aria-setsize")))
          .filter((n) => n > 0);
        result.candidatesComplete =
          list.getAttribute("aria-busy") !== "true" &&
          list.getAttribute("data-virtualized") !== "true" &&
          (!sizes.length || sizes.every((n) => n === options.length));
      }
    }
  }
  result.valueKind = typeof value;
  if (!scalar(value) || typeof value !== target.kind) return { ...result, reason: "unsupported" };
  result.value = value;
  result.selector = path(el);
  result.readable = true;
  result.writable = !disabled(el);
  return result;
}

export const publicTargetObservation = (value: TargetObservation): TargetObservation => {
  const {
    scopeReady,
    scopeComplete,
    matchCount,
    presence,
    visible,
    readable,
    writable,
    control,
    reason,
  } = value;
  return {
    scopeReady,
    scopeComplete,
    matchCount,
    presence,
    visible,
    readable,
    writable,
    control,
    reason,
  };
};
export function matchCandidates(items: CandidateObservation["items"], match: CandidateMatch) {
  return items.filter((item) =>
    match.by === "value" ? item.value === match.value : item.label === match.label,
  );
}

/** Reuses Builder's real input functions; this adapter adds no new browser/session mechanism. */
export class StandardFields {
  constructor(
    private readonly builder: Builder,
    private readonly signal: AbortSignal,
    private readonly verify?: () => Promise<void>,
  ) {}
  private async observe(field: string, target: StandardFieldTarget) {
    await this.verify?.();
    const value = await this.builder.caseDom(observeStandardField, field, target);
    await this.verify?.();
    return value;
  }
  async probe(field: string, target: StandardFieldTarget) {
    return publicTargetObservation(await this.observe(field, target));
  }
  async inspect(field: string, target: StandardFieldTarget): Promise<CaseControl | null> {
    const value = await this.observe(field, target);
    if (value.presence === "absent" || value.visible === false) return null;
    if (!value.readable || !value.selector) throw this.unreadable(value, target);
    return {
      value: value.value!,
      selector: value.selector,
      kind:
        value.control === "text"
          ? "string"
          : value.control === "boolean"
            ? "boolean"
            : value.control === "number"
              ? "number"
              : "enum",
      disabled: !value.writable,
    };
  }
  private block(reason: string) {
    return new ConfigurationOperationError(
      "precondition",
      `标准控件检查受阻：${reason}`,
      "blocked",
      { diagnostic: { phase: "standard-field", observations: { reason } } },
    );
  }
  private unreadable(value: StandardObservation, target: StandardFieldTarget) {
    return this.block(
      value.valueKind && value.valueKind !== target.kind
        ? `value-type: expected=${target.kind}, actual=${value.valueKind}`
        : (value.reason ?? "incomplete-scope"),
    );
  }
  private guard(
    field: string,
    target: StandardFieldTarget,
    before: StandardObservation,
    candidate?: CandidateMatch,
  ) {
    return async () => {
      const current = await this.observe(field, target);
      if (
        !current.readable ||
        !current.writable ||
        current.matchCount !== 1 ||
        current.selector !== before.selector ||
        current.value !== before.value
      )
        throw new ConfigurationOperationError("snapshot", "输入前标准目标或原值已变化", "stop");
      if (candidate) {
        const matches = matchCandidates(current.candidates ?? [], candidate);
        if (!current.candidatesComplete || matches.length !== 1 || matches[0].disabled)
          throw new ConfigurationOperationError("snapshot", "输入前候选范围或匹配已变化", "stop");
      }
    };
  }
  private async withCandidates<T>(
    field: string,
    target: StandardFieldTarget,
    action: (view: StandardObservation) => Promise<T>,
  ): Promise<T> {
    let view = await this.observe(field, target);
    if (!view.readable || view.control !== "enum" || !view.selector)
      throw this.unreadable(view, target);
    const opened = view.candidates === undefined && !view.listOpen;
    if (opened && !view.writable) throw this.block("disabled");
    const selector = view.selector;
    let originalError: unknown;
    try {
      if (opened)
        await this.builder.click("case-control", selector, undefined, undefined, this.verify);
      view = await waitFor(
        "标准候选范围就绪",
        async () => {
          const current = await this.observe(field, target);
          if (current.reason) throw this.block(current.reason);
          return current.candidates ? current : undefined;
        },
        15_000,
        this.signal,
      );
      if (!view.candidatesComplete) throw this.block("incomplete-scope");
      return await action(view);
    } catch (error) {
      originalError = error;
      throw error;
    } finally {
      if (opened) {
        try {
          const current = await this.observe(field, target);
          if (current.listOpen) {
            if (current.selector !== selector) throw new Error("原下拉目标已变化");
            await this.builder.click("case-control", selector, undefined, undefined, async () => {
              if ((await this.observe(field, target)).selector !== selector)
                throw new Error("原下拉目标已失效");
            });
          }
          const closed = await this.observe(field, target);
          if (closed.listOpen) throw new Error("候选弹层仍打开");
        } catch (cause) {
          throw new ConfigurationOperationError("context", "候选弹层无法安全清理", "stop", {
            cause: originalError ?? cause,
            diagnostic: {
              phase: "standard-enum.dismiss",
              observations: { cleanup: cause instanceof Error ? cause.message : "unknown" },
            },
          });
        }
      }
    }
  }
  async candidates(field: string, target: StandardFieldTarget): Promise<CandidateObservation> {
    return this.withCandidates(field, target, async (view) => ({
      target: publicTargetObservation(view),
      complete: true,
      items: view.candidates!.map(({ value, label, disabled }) => ({ value, label, disabled })),
    }));
  }
  async select(field: string, target: StandardFieldTarget, match: CandidateMatch) {
    return this.withCandidates(field, target, async (view) => {
      const matches = matchCandidates(view.candidates!, match);
      if (
        matches.length !== 1 ||
        matches[0].disabled ||
        matches[0].value === undefined ||
        typeof matches[0].value !== target.kind
      )
        throw this.block(matches.length > 1 ? "ambiguous" : "unavailable-candidate");
      const candidate = view.candidates!.find((item) => item === matches[0])!;
      if (matchCandidates(view.candidates!, { by: "value", value: candidate.value! }).length !== 1)
        throw this.block("ambiguous");
      if (!view.writable) throw this.block("disabled");
      const changed = view.value !== candidate.value;
      if (changed) {
        const verify = this.guard(field, target, view, { by: "value", value: candidate.value! });
        if (candidate.index !== undefined)
          await this.builder.caseSelect(view.selector!, candidate.index, async () => {
            await verify();
            const current = await this.observe(field, target);
            if (current.candidates?.[candidate.index!]?.value !== candidate.value)
              throw new ConfigurationOperationError("snapshot", "原生候选顺序已变化", "stop");
          });
        else
          await this.builder.click(
            "case-control",
            candidate.selector!,
            undefined,
            undefined,
            async () => {
              await verify();
              const current = (await this.observe(field, target)).candidates?.find(
                (item) => item.value === candidate.value,
              );
              if (current?.label !== candidate.label || current.selector !== candidate.selector)
                throw new ConfigurationOperationError("snapshot", "候选标签已变化", "stop");
            },
          );
        await waitFor(
          "标准枚举回读",
          async () =>
            (await this.observe(field, target)).value === candidate.value ? true : undefined,
          15_000,
          this.signal,
        );
      }
      return { changed, selected: { value: candidate.value, label: candidate.label } };
    });
  }
  async set(
    field: string,
    target: StandardFieldTarget,
    value: ConfigurationScalar,
    input?: string,
  ) {
    if (target.control === "enum")
      return (await this.select(field, target, { by: "value", value })).changed;
    const before = await this.observe(field, target);
    if (!before.readable || !before.writable || !before.selector || typeof value !== target.kind)
      throw this.block(before.reason ?? "type-or-disabled");
    if (before.value === value && input === undefined) return false;
    const verify = this.guard(field, target, before);
    if (target.control === "boolean")
      await this.builder.click("case-control", before.selector, undefined, undefined, verify);
    else await this.builder.caseText(before.selector, input ?? String(value), verify);
    await waitFor(
      "标准字段回读",
      async () => ((await this.observe(field, target)).value === value ? true : undefined),
      15_000,
      this.signal,
    );
    return true;
  }
}

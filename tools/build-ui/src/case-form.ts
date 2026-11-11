import { cancelPinkFileDialog } from "./windows-file-dialog.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import { isDeepStrictEqual } from "node:util";
import type { Builder } from "./builder.js";
import { waitFor } from "./common.js";
import { existingFields } from "./existing-platforms.js";
import {
  baseCombinationPlatforms,
  platforms,
  specialFields,
  selectionLabel,
  type SpecialFieldContract,
} from "./profiles.js";
import type { CaseValue } from "./finalized-cases.js";
import { platformEntry, platformCatalog } from "./platform-catalog.js";
import type { ConfigurationTarget } from "./configuration-targets.js";
import { readStageUi, changeStageUi } from "./stage-ui.js";
import type { StageView } from "./configuration-stages.js";
import { configurationUiTitles } from "./builder-ui-labels.js";
import { StandardFields, type CandidateMatch } from "./standard-fields.js";
import { configurationFamilies } from "./configuration-operations.js";
import { supportedFieldTypes } from "./supported-field-types.js";
import type { StandardFieldTarget } from "./configuration-targets.js";
import type { BuildStep } from "./build-steps-contract.js";

export interface CaseControl {
  value: CaseValue;
  selector: string;
  kind: "boolean" | "number" | "string" | "enum" | "select" | "array" | "map";
  disabled: boolean;
  derivedFrom?: string;
  protocol?: "file" | "project";
  choices?: Array<{
    value: string;
    selector: string;
    disabled: boolean;
    checked?: boolean;
    protectedReason?: "initial-scene" | "bundle";
  }>;
}

/** Local adapters for the current form. All writes are real mouse/keyboard input. */
export class CaseForm {
  constructor(
    readonly builder: Builder,
    readonly platform: string,
    readonly signal: AbortSignal,
    private readonly beforeInput?: () => Promise<void>,
    private readonly verifySession?: () => Promise<void>,
    private readonly target?: ConfigurationTarget,
  ) {}

  private standard() {
    return new StandardFields(this.builder, this.signal, this.beforeInput);
  }

  /** Inspect adapters before writes; condition-dependent controls are checked when enabled. */
  async checkCapabilities(steps: readonly BuildStep[]) {
    const checks: Array<{ field: string; state: string; control?: string }> = [];
    const checked = new Set<string>();
    for (const [index, step] of steps.entries()) {
      if (step.op !== "set" && step.op !== "config.select") continue;
      const field = step.field;
      if (checked.has(field)) continue;
      checked.add(field);
      const prior = steps.slice(0, index);
      const dependent = this.fieldFamilies([field]).some(
        (family) =>
          family.children.includes(field) &&
          prior.some(
            (s) => (s.op === "set" || s.op === "config.prepare") && s.field === family.parent,
          ),
      );
      const prepared = prior.some(
        (s) => s.op === "config.expand" || (s.op === "config.prepare" && s.field === field),
      );
      let control: CaseControl | null;
      try {
        control = await this.inspect(field);
      } catch (cause) {
        if (cause instanceof Error && /^用例字段不唯一：/.test(cause.message))
          throw new ConfigurationOperationError("context", `配置控件不唯一：${field}`, "stop", {
            cause,
          });
        if (!(cause instanceof ConfigurationOperationError) || cause.disposition !== "blocked")
          throw cause;
        throw new ConfigurationOperationError(
          "precondition",
          `执行能力不足：不能读取配置控件 ${field}`,
          "blocked",
          {
            cause,
            diagnostic: {
              phase: "runtime-capability",
              observations: { kind: "execution-support", field },
            },
          },
        );
      }
      if (!control) {
        if (
          dependent ||
          prepared ||
          prior.some((s) => s.op === "set" || s.op === "config.select")
        ) {
          // Ordered writes may change the schema. Do not claim a hidden control is supported;
          // its existing adapter must still identify it before the later write can occur.
          checks.push({ field, state: "deferred-until-enabled" });
          continue;
        }
        throw new ConfigurationOperationError(
          "precondition",
          `执行能力不足：当前配置页没有可识别的控件 ${field}`,
          "blocked",
          {
            diagnostic: {
              phase: "runtime-capability",
              observations: { kind: "execution-support", field, reason: "missing-control" },
            },
          },
        );
      }
      const type = this.target?.fields[field] ?? supportedFieldTypes[field];
      const scalarKinds = type?.kind === "scalar" ? type.valueKinds : type ? [type.kind] : [];
      const compatible =
        (control.kind === "boolean" && scalarKinds?.includes("boolean")) ||
        (control.kind === "number" && scalarKinds?.includes("number")) ||
        (control.kind === "string" && scalarKinds?.includes("string")) ||
        ["enum", "select", "array", "map"].includes(control.kind);
      if (!compatible)
        throw new ConfigurationOperationError(
          "precondition",
          `执行能力不足：配置控件类型不匹配 ${field}`,
          "blocked",
          {
            diagnostic: {
              phase: "runtime-capability",
              observations: { kind: "execution-support", field, control: control.kind },
            },
          },
        );
      checks.push({
        field,
        state: control.disabled ? "present-disabled" : "supported",
        control: control.kind,
      });
    }
    if (steps.some((step) => step.op === "build.submit")) {
      // Use the existing stage adapter: a linked build/run group still has one build stage.
      const build = (await this.readStages()).buttons.filter((button) => button.stage === "build");
      if (build.length !== 1)
        throw new ConfigurationOperationError(
          "precondition",
          "执行能力不足：配置页没有唯一的构建按钮",
          "blocked",
          {
            diagnostic: {
              phase: "runtime-capability",
              observations: {
                kind: "execution-support",
                operation: "build.submit",
                matches: build.length,
              },
            },
          },
        );
    }
    return { kind: "runtime-capabilities", checks };
  }
  private description(key: string): StandardFieldTarget {
    const declared = this.target?.fields[key];
    if (declared) return declared;
    const registered = supportedFieldTypes[key];
    if (
      !registered ||
      !["string", "number", "boolean"].includes(registered.kind) ||
      registered.sensitive
    )
      throw new ConfigurationOperationError("precondition", "此目标缺少标准控件描述", "blocked");
    return {
      kind: registered.kind as StandardFieldTarget["kind"],
      control: registered.choices
        ? "enum"
        : registered.kind === "string"
          ? "text"
          : (registered.kind as "number" | "boolean"),
    };
  }
  fieldFamilies(fields: string[]) {
    return configurationFamilies(
      fields,
      this.target?.families?.map((family) => ({ ...family, requiresReadableOriginals: true })),
    );
  }
  probe(field: string) {
    return this.standard().probe(field, this.description(field));
  }
  candidates(field: string) {
    return this.standard().candidates(field, this.description(field));
  }
  selectCandidate(field: string, match: CandidateMatch) {
    return this.standard().select(field, this.description(field), match);
  }

  private click(kind: Parameters<Builder["click"]>[0], label: string): Promise<number> {
    return this.builder.click(kind, label, undefined, undefined, this.beforeInput);
  }

  private text(selector: string, value: string): Promise<void> {
    return this.builder.caseText(selector, value, this.beforeInput);
  }

  private select(selector: string, index: number): Promise<void> {
    return this.builder.caseSelect(selector, index, this.beforeInput);
  }

  private hint(key: string): Partial<SpecialFieldContract> {
    if (this.target && !platformCatalog.some((entry) => entry.id === this.platform)) return {};
    const p = baseCombinationPlatforms.find((p) => p.id === this.platform)!;
    const base = [
      ...(!platforms.some((entry) => entry.id === this.platform)
        ? existingFields(this.platform)
        : []),
      ...(platforms.some((entry) => entry.id === this.platform) ? specialFields(p) : []),
    ].find((f) => f.key === key);
    const name = key.split(".").at(-1)!;
    const labels: Record<string, string> = {
      customIcon: "自定义图标",
      customIconFile: "自定义图标",
      maxAspectRatio: "最大宽高比",
      resizeableActivity: "可调整大小的 Activity",
      useDebugKeystore: "使用调试密钥库",
      encrypted: "加密 JS",
      xxteaKey: "JS 加密密钥",
      compressZip: "Zip 压缩",
      appABIs: this.platform === "harmonyos-next" ? "支持的 ABI" : "APP ABI",
      useWebGPU: "WEBGPU",
      isSoFileCompressed: this.platform === "google-play" ? "Compress .so files" : "压缩 .so 文件",
      androidInstant: "Google Play Instant",
      googleBilling: "Built in Play Billing",
      remoteUrl: "Intent 过滤器",
      globalAdapter: "globalThis 全局变量适配",
      globalVariable: "全局变量",
      apiLevel: this.platform === "google-play" ? "Target API Level" : "API Level",
      JobSystem: this.platform === "windows" ? "Job System" : "任务调度系统",
      keystorePath: "密钥库路径",
      keystorePassword: "密钥库密码",
      keystoreAlias: "密钥库别名",
      keystoreAliasPassword: "密钥库别名密码",
    };
    if (this.platform === "vivo-mini-game") {
      Object.assign(labels, {
        package: "游戏包名",
        deviceOrientation: "屏幕方向",
        useDebugKey: "使用调试秘钥库",
        privatePemPath: "private.pem 路径",
        certificatePemPath: "certificate.pem 路径",
      });
    }
    if (key === "packages.google-play.orientation.upsideDown")
      return { uiLabel: "屏幕方向", choiceLabel: "倒竖屏" };
    if (key.includes("networkTimeout.")) return { uiLabel: `${name} 超时时间` };
    return {
      ...(key.startsWith(`packages.${this.platform}.`) && labels[name]
        ? { uiLabel: labels[name] }
        : {}),
      ...base,
    };
  }

  async inspect(key: string): Promise<CaseControl | null> {
    if (this.target?.fields[key]) return this.standard().inspect(key, this.target.fields[key]);
    if (key === "packages.openpaas.appid" && this.platform === "openpaas") {
      const game = await this.openpaasPage();
      return {
        kind: "select",
        value: game.id,
        selector: "",
        disabled: false,
        choices: game.ids.map((id) => ({ value: id, selector: "", disabled: false })),
      };
    }
    const hint = this.hint(key);
    const control = await this.builder.caseDom(
      (document, key, hint) => {
        const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
        const path = (el: Element): string => {
          const pieces: string[] = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const siblings = node.parentElement
              ? [...node.parentElement.children].filter((e) => e.tagName === node!.tagName)
              : [node];
            pieces.unshift(
              `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`,
            );
          }
          return pieces.join(" > ");
        };
        let rows = [
          ...document.querySelectorAll<HTMLElement>(`[data-option-key="${CSS.escape(key)}"]`),
        ];
        if (!rows.length && hint.uiLabel)
          rows = [...document.querySelectorAll<HTMLElement>('[data-slot="field"]')].filter(
            (r) =>
              r.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ===
              hint.uiLabel,
          );
        rows = rows.filter(visible);
        if (rows.length > 1) throw new Error(`用例字段不唯一：${key}`);
        let row = rows[0];
        if (!row && key === "md5CacheOptions.handleTemplateMd5Link")
          row = document.querySelector<HTMLElement>('[data-option-key="md5Cache"]')!;
        if (!row && key === "outputName")
          row = document.querySelector<HTMLElement>('[data-option-key="buildPath"]')!;
        if (!row) return null;
        if (hint.choiceLabel) {
          const choices = [...row.querySelectorAll("label")].filter(
            (l) => l.textContent?.trim() === hint.choiceLabel,
          );
          if (!choices.length && key === "packages.google-play.renderBackEnd.gles2") {
            const parent = [...row.querySelectorAll("label")]
              .find((label) => label.textContent?.trim() === "GLES 2/3")
              ?.querySelector<HTMLElement>('[role="checkbox"]');
            // The combined switch clears GLES2 when off, then hides its child control.
            if (parent?.getAttribute("aria-checked") === "false")
              return {
                kind: "boolean" as const,
                value: false,
                selector: path(parent),
                disabled: true,
                derivedFrom: "packages.google-play.renderBackEnd.gles3",
              };
          }
          if (choices.length !== 1) throw new Error(`用例子字段不唯一：${key}`);
          row = choices[0];
        }
        const disabled = (el: Element) =>
          el.getAttribute("aria-disabled") === "true" ||
          el.hasAttribute("data-disabled") ||
          document.defaultView!.getComputedStyle(el).pointerEvents === "none" ||
          ("disabled" in el && (el as HTMLInputElement).disabled);
        const inputs = [
          ...row.querySelectorAll<HTMLInputElement>(
            'input:not([type="hidden"]):not([type="checkbox"])',
          ),
        ];
        if (key === "scenes" || key === "bundleConfigs") {
          const items = [...row.querySelectorAll<HTMLElement>(".pk-list-item")];
          return {
            kind: "array" as const,
            selector: path(row),
            disabled: false,
            value: items
              .filter(
                (r) =>
                  r.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true",
              )
              .map((r) =>
                (
                  r.querySelector(".pk-list-item-sub")?.textContent?.trim() ||
                  r.querySelector(".pk-list-item-name")?.textContent?.trim() ||
                  ""
                ).replace(/^\(|\)$/g, ""),
              )
              .sort(),
            choices: items.map((r) => ({
              value: (
                r.querySelector(".pk-list-item-sub")?.textContent?.trim() ||
                r.querySelector(".pk-list-item-name")?.textContent?.trim() ||
                ""
              ).replace(/^\(|\)$/g, ""),
              selector: path(r.querySelector('[role="checkbox"]') ?? r),
              disabled: disabled(r.querySelector('[role="checkbox"]') ?? r),
              ...(key === "scenes" && disabled(r.querySelector('[role="checkbox"]') ?? r)
                ? {
                    protectedReason: (r.querySelector(".pk-list-badge")?.textContent?.trim() ===
                    "Bundle"
                      ? "bundle"
                      : "initial-scene") as "bundle" | "initial-scene",
                  }
                : {}),
              checked:
                r.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true",
            })),
          };
        }
        const checks = [...row.querySelectorAll<HTMLElement>('[role="checkbox"]')];
        if (key.endsWith(".targetLanguageMap") || key.endsWith(".appABIs")) {
          const choices = checks.map((el) => ({
            value: (el.closest("label") ?? el.parentElement)?.textContent?.trim() ?? "",
            selector: path(el),
            disabled: disabled(el),
            checked: el.getAttribute("aria-checked") === "true",
          }));
          if (!choices.length || choices.some((c) => !c.value)) return null;
          const value = key.endsWith(".targetLanguageMap")
            ? Object.fromEntries(
                choices.map((c) => [c.value, { locale: c.value, value: !!c.checked }]),
              )
            : choices
                .filter((c) => c.checked)
                .map((c) => c.value)
                .sort();
          return {
            kind: key.endsWith(".targetLanguageMap") ? ("map" as const) : ("array" as const),
            value,
            selector: path(row),
            choices,
            disabled: false,
          };
        }
        if (key === "packages.google-play.customIcon" && checks.length === 2) {
          const choices = checks.map((el, i) => ({
            value: i === 0 ? "default" : "custom",
            selector: path(el),
            disabled: disabled(el),
          }));
          return {
            kind: "enum" as const,
            value: checks[1].getAttribute("aria-checked") === "true" ? "custom" : "default",
            selector: path(row),
            disabled: false,
            choices,
          };
        }
        if (key === "packages.google-play.customIconFile") {
          const input = inputs[0];
          return input
            ? {
                kind: "string" as const,
                value: input.value,
                selector: path(input),
                disabled: disabled(input),
              }
            : null;
        }
        const checkbox = key === "md5CacheOptions.handleTemplateMd5Link" ? checks[1] : checks[0];
        if (checkbox)
          return {
            kind: "boolean" as const,
            value: checkbox.getAttribute("aria-checked") === "true",
            selector: path(checkbox),
            disabled: disabled(checkbox),
          };
        if (key === "buildPath" || key === "outputName") {
          const input = inputs[key === "buildPath" ? 0 : 1];
          if (!input) return null;
          const protocol = row
            .querySelector('[aria-label="Switch protocol"] span')
            ?.textContent?.trim();
          if (key === "buildPath" && protocol && !["file", "project"].includes(protocol))
            throw new Error("构建路径协议无法唯一识别");
          return {
            kind: "string" as const,
            value:
              key === "buildPath" && protocol === "project"
                ? `project://${input.value}`
                : input.value,
            ...(key === "buildPath"
              ? { protocol: (protocol || "file") as "file" | "project" }
              : {}),
            selector: path(input),
            disabled: disabled(input),
          };
        }
        const select = row.querySelector<HTMLSelectElement>("select");
        if (select) {
          if (key.endsWith(".maxAspectRatio") && select.value === "custom" && inputs.length)
            return {
              kind: "string" as const,
              value: inputs[0].value,
              selector: path(inputs[0]),
              disabled: disabled(inputs[0]),
            };
          return {
            kind: "select" as const,
            value: key.endsWith(".apiLevel") ? Number(select.value) : select.value,
            selector: path(select),
            disabled: disabled(select),
            choices: [...select.options].map((o) => ({
              value: o.value,
              selector: "",
              disabled: o.disabled,
            })),
          };
        }
        const combo = row.querySelector<HTMLElement>('[role="combobox"]');
        if (combo) {
          const hidden = row.querySelector<HTMLInputElement>('input:not([type="checkbox"])');
          return {
            kind: "enum" as const,
            value: hidden?.value ?? combo.textContent?.trim() ?? "",
            selector: path(combo),
            disabled: disabled(combo),
          };
        }
        const input = key === "outputName" ? inputs[1] : inputs[0];
        if (!input) return null;
        return {
          kind: input.type === "number" ? ("number" as const) : ("string" as const),
          value: input.type === "number" && input.value !== "" ? Number(input.value) : input.value,
          selector: path(input),
          disabled: disabled(input),
        };
      },
      key,
      hint,
    );
    return control;
  }

  async googleIcon(file: string): Promise<void> {
    const key = "packages.google-play.customIcon";
    await this.set(key, "custom");
    const control = await this.read(key + "File");
    await this.text(control.selector, file);
    await waitFor(
      "Google 图标 UI 应用",
      async () => {
        const field = await this.inspect(key + "File");
        return field && field.value && (await this.read(key)).value === "custom" ? true : undefined;
      },
      30_000,
      this.signal,
    );
    await this.builder.configurationPage();
  }

  async ready() {
    await this.builder.configurationPage();
  }
  async configurationPage() {
    return this.builder.configurationPage();
  }
  async expandSection(label: string) {
    await this.builder.expandSection(label, this.beforeInput);
  }
  async openpaasPage() {
    return this.builder.openpaasPage(this.beforeInput);
  }
  async selectOpenpaasGame(id: string) {
    await this.builder.selectOpenpaasGame(id, this.beforeInput);
  }

  async alerts(key: string): Promise<string[]> {
    const field = await this.read(key);
    return this.builder.caseDom((document, selector) => {
      const control = document.querySelector(selector);
      const field =
        control?.closest(".typed-field-wrapper") ?? control?.closest('[data-slot="field"]');
      const row = field?.parentElement;
      const optionRow = control?.closest("[data-option-key]");
      // Current native custom views render a styled sibling div, not role=alert.
      const errors = new Set<Element>([
        ...(field?.querySelectorAll('[role="alert"], .typed-field-validation') ?? []),
        ...(optionRow?.querySelectorAll(
          ':scope > [role="alert"], :scope > .typed-field-validation',
        ) ?? []),
        ...(row?.querySelectorAll(':scope > div[style*="--vscode-errorForeground"]') ?? []),
      ]);
      return [...errors]
        .filter((e) => (e as HTMLElement).getClientRects().length > 0)
        .filter(
          (e) =>
            e.getAttribute("data-type") !== "warn" &&
            !e.getAttribute("style")?.toLowerCase().includes("warning"),
        )
        .map((e) => e.textContent?.trim() ?? "")
        .filter(Boolean);
    }, field.selector);
  }

  async primaryBuildEnabled(): Promise<boolean> {
    return !(await this.readStages()).buttons.find((b) => b.stage === "build")!.disabled;
  }

  async readStages() {
    return this.builder.caseDom(readStageUi);
  }

  async changeStage(kind: "link" | "unlink", anchor: string, stage: string, before: StageView) {
    await changeStageUi(this.builder, this.signal, this.beforeInput, kind, anchor, stage, before);
  }

  async stageHint(control: "button" | "link" | "unlink", stage: string) {
    const view = await this.readStages();
    const candidates =
      control === "button" ? view.buttons : control === "link" ? view.links : view.unlinks;
    const targets = candidates.filter((item) => item.stage === stage);
    if (targets.length !== 1 || !targets[0].selector) throw new Error("阶段提示目标不唯一");
    const selector = targets[0].selector;
    await this.builder.caseHover(selector, this.beforeInput);
    return waitFor(
      "目标阶段提示",
      async () => {
        await this.beforeInput?.();
        return this.builder.caseDom((document, selector) => {
          const target = document.querySelector(selector);
          // Current Base UI exposes data-popup-open rather than aria-describedby.
          if (!target?.matches(":hover") || !target.hasAttribute("data-popup-open")) return;
          const messages = [
            ...document.querySelectorAll('[data-slot="tooltip-content"][data-open]'),
          ].filter((e) => !!e.getClientRects().length);
          if (messages.length > 1) throw new Error("多个阶段提示同时可见，无法唯一关联");
          return messages[0]?.textContent?.trim() || undefined;
        }, selector);
      },
      5000,
      this.signal,
    ).catch(async (cause) => {
      if (this.signal.aborted) throw cause;
      await this.beforeInput?.();
      const observed = await this.builder.caseDom((document, selector) => {
        const target = document.querySelector(selector);
        return {
          hovered: target?.matches(":hover"),
          popupOpen: target?.hasAttribute("data-popup-open"),
          visibleTooltips: [...document.querySelectorAll('[data-slot="tooltip-content"]')].filter(
            (e) => !!e.getClientRects().length,
          ).length,
        };
      }, selector);
      throw new ConfigurationOperationError(
        "assertion",
        "悬停目标阶段后未出现可唯一关联的提示",
        "failed",
        { cause, diagnostic: { phase: "stage-hint", observations: observed } },
      );
    });
  }

  async reopen(): Promise<void> {
    const platform = this.target ?? platformEntry(this.platform);
    await this.verifySession?.();
    await this.builder.closeConfiguration(this.verifySession);
    await this.verifySession?.();
    const view = await this.builder.openConfigurationPage(platform.label, this.verifySession);
    const titles = this.target
      ? [platform.configurationTitle!]
      : configurationUiTitles(this.platform, platform.configurationTitle!);
    if (!titles.includes(view.title)) throw new Error("重开后平台身份不一致");
  }

  async restoreControl(key: string, original: CaseControl): Promise<void> {
    // The custom ratio input and its native mode selector share the same field.
    // Restore the selected mode before verifying the original control kind.
    const current = await this.read(key);
    if (
      key.endsWith(".maxAspectRatio") &&
      original.kind === "select" &&
      current.kind === "string"
    ) {
      const selector = await this.builder.caseDom((document, selector) => {
        const control = document.querySelector(selector);
        const row =
          control?.closest(".typed-field-wrapper") ?? control?.closest('[data-slot="field"]');
        const select = row?.querySelector("select");
        if (!select) throw new Error("比例模式选择器不可用");
        const parts: string[] = [];
        for (let node: Element | null = select; node; node = node.parentElement) {
          const siblings = node.parentElement
            ? [...node.parentElement.children].filter((s) => s.tagName === node!.tagName)
            : [node];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
        }
        return parts.join(" > ");
      }, current.selector);
      const index =
        original.choices?.findIndex((choice) => choice.value === String(original.value)) ?? -1;
      if (index < 0) throw new Error("原比例模式不在已记录候选中");
      await this.select(selector, index);
      await waitFor(
        "恢复比例选择模式",
        async () => {
          const actual = await this.inspect(key);
          return actual?.kind === original.kind && actual.value === original.value
            ? true
            : undefined;
        },
        15_000,
        this.signal,
      );
    } else await this.set(key, original.value);
  }

  async cancelFileChoice(key: string): Promise<void> {
    const field = await this.read(key);
    const selector = await this.builder.caseDom((document, selector) => {
      const input = document.querySelector(selector);
      const picker = input?.closest('[data-slot="file-picker"]');
      const button = picker?.querySelector<HTMLButtonElement>('button[aria-label="Select file"]');
      if (!button || button.disabled) throw new Error("文件选择入口不存在或不可用");
      const parts: string[] = [];
      for (let el: Element | null = button; el; el = el.parentElement) {
        const siblings = el.parentElement
          ? [...el.parentElement.children].filter((s) => s.tagName === el!.tagName)
          : [el];
        parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`);
      }
      return parts.join(" > ");
    }, field.selector);
    await this.click("case-control", selector);
    await cancelPinkFileDialog();
    const after = await waitFor(
      "文件选择取消回读就绪",
      async () => {
        const ready = await this.builder.caseDom((document, selector) => {
          const button = document.querySelector<HTMLButtonElement>(selector);
          return button && !button.disabled;
        }, selector);
        if (!ready) return undefined;
        const control = await this.read(key);
        return control.disabled === field.disabled ? control : undefined;
      },
      10_000,
      this.signal,
    );
    // A native dialog can return keyboard focus to the editor behind the Webview.
    // Reopen through real UI before restoration; keyboard writes also verify both focus owners.
    await this.reopen();
    if (
      !isDeepStrictEqual(after.value, field.value) ||
      !isDeepStrictEqual((await this.read(key)).value, field.value)
    )
      throw new Error("取消文件选择改变了原路径");
  }

  private async pathProtocol(protocol: "file" | "project"): Promise<void> {
    const before = await this.read("buildPath");
    if (before.protocol === protocol) return;
    const selector = await this.builder.caseDom((document, selector) => {
      const row = document.querySelector(selector)?.closest('[data-option-key="buildPath"]');
      const button = row?.querySelector<HTMLButtonElement>('[aria-label="Switch protocol"]');
      if (!button || button.disabled) throw new Error("路径协议切换不可用");
      const parts: string[] = [];
      for (let el: Element | null = button; el; el = el.parentElement) {
        const siblings = el.parentElement
          ? [...el.parentElement.children].filter((s) => s.tagName === el!.tagName)
          : [el];
        parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el) + 1})`);
      }
      return parts.join(" > ");
    }, before.selector);
    await this.click("case-control", selector);
    const choice = await waitFor(
      "路径协议菜单就绪",
      () =>
        this.builder.caseDom((document, protocol) => {
          const matches = [
            ...document.querySelectorAll<HTMLElement>(
              '[role="menuitemradio"], [role="menuitem"], [role="option"]',
            ),
          ].filter((el) => el.getClientRects().length > 0 && el.textContent?.trim() === protocol);
          if (matches.length > 1) throw new Error("路径协议候选不唯一");
          const el = matches[0];
          if (!el) return undefined;
          if (el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled"))
            throw new Error("路径协议候选禁用");
          const parts: string[] = [];
          for (let node: Element | null = el; node; node = node.parentElement) {
            const siblings = node.parentElement
              ? [...node.parentElement.children].filter((s) => s.tagName === node!.tagName)
              : [node];
            parts.unshift(
              `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`,
            );
          }
          return parts.join(" > ");
        }, protocol),
      15_000,
      this.signal,
    );
    await this.click("case-control", choice);
    await waitFor(
      "路径协议回读",
      async () => ((await this.read("buildPath")).protocol === protocol ? true : undefined),
      15_000,
      this.signal,
    );
  }

  async clearAllScenes(): Promise<void> {
    const checkbox = async () => {
      const field = await this.read("scenes");
      return this.builder.caseDom((document, selector) => {
        const row = document.querySelector(selector);
        const checks = [...(row?.querySelectorAll<HTMLElement>('[role="checkbox"]') ?? [])].filter(
          (el) => el.getClientRects().length > 0 && !el.closest(".pk-list-item"),
        );
        if (checks.length !== 1) throw new Error("场景全选入口无法唯一识别");
        const el = checks[0];
        if (el.getAttribute("aria-disabled") === "true") throw new Error("场景全选不可用");
        const parts: string[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) {
          const siblings = node.parentElement
            ? [...node.parentElement.children].filter((s) => s.tagName === node!.tagName)
            : [node];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
        }
        return { selector: parts.join(" > "), checked: el.getAttribute("aria-checked") === "true" };
      }, field.selector);
    };
    if (!(await checkbox()).checked) {
      await this.click("case-control", (await checkbox()).selector);
      await waitFor(
        "场景全选回读",
        async () => ((await checkbox()).checked ? true : undefined),
        15_000,
        this.signal,
      );
    }
    await this.click("case-control", (await checkbox()).selector);
    await this.builder.configurationPage();
  }

  async read(key: string): Promise<CaseControl> {
    return waitFor(
      `用例字段就绪：${key}`,
      async () => (await this.inspect(key)) ?? undefined,
      30_000,
      this.signal,
    ).catch((cause) => {
      if (this.signal.aborted) throw cause;
      if (!(cause instanceof Error) || cause.message !== `等待超时：用例字段就绪：${key}`)
        throw cause;
      throw new ConfigurationOperationError(
        "precondition",
        `执行能力或页面条件不足：字段 ${key} 未就绪或不可识别`,
        "blocked",
        {
          cause,
          diagnostic: {
            phase: "runtime-capability",
            observations: {
              kind: "execution-support",
              field: key,
              reason: "missing-or-hidden-control",
            },
          },
        },
      );
    });
  }

  async set(key: string, target: CaseValue, input?: string, enumLabel?: string): Promise<boolean> {
    if (this.target?.fields[key])
      return this.standard().set(
        key,
        this.target.fields[key],
        target as string | number | boolean,
        input,
      );
    let current = await this.read(key);
    if (key === "packages.openpaas.appid" && this.platform === "openpaas") {
      if (current.value === target) return false;
      await this.selectOpenpaasGame(String(target));
      return true;
    }
    if (key === "buildPath") {
      if (
        typeof target !== "string" ||
        (/^[\w-]+:\/\//.test(target) && !target.startsWith("project://"))
      )
        throw new Error("构建路径须为 project URI 或 file 协议原始路径");
      await this.pathProtocol(target.startsWith("project://") ? "project" : "file");
      current = await this.read(key);
    }
    const matches = (actual: CaseValue) => {
      if (typeof target === "number" && typeof actual === "string")
        return Number(actual) === target;
      if (key === "sourceMaps") return actual === target || actual === String(target);
      if (
        key.endsWith(".targetLanguageMap") &&
        actual &&
        typeof actual === "object" &&
        !Array.isArray(actual) &&
        target &&
        typeof target === "object" &&
        !Array.isArray(target)
      ) {
        return (
          Object.entries(actual).every(([locale, item]) =>
            isDeepStrictEqual(item, target[locale] ?? { locale, value: false }),
          ) && Object.keys(target).every((locale) => locale in actual)
        );
      }
      if (Array.isArray(actual) && Array.isArray(target))
        return isDeepStrictEqual([...actual].sort(), [...target].sort());
      return isDeepStrictEqual(actual, target);
    };
    const initiallyMatched = matches(current.value);
    const commitApi =
      key.endsWith(".apiLevel") &&
      current.kind === "select" &&
      (current.choices?.filter((choice) => !choice.disabled).length ?? 0) > 1;
    // This control displays the project preset when the form has no explicit override.
    // The finalized cases require an explicit selection, including that displayed default.
    if (initiallyMatched && input === undefined && key !== "engineModulesConfigKey" && !commitApi)
      return false;
    if (current.disabled) throw new Error(`用例字段被禁用：${key}`);
    if (current.kind === "array" || current.kind === "map") {
      const desired =
        current.kind === "array"
          ? (target as string[])
          : (target as Record<string, { value: boolean }>);
      if (current.kind === "array" && !Array.isArray(desired))
        throw new Error(`数组目标无效：${key}`);
      for (const choice of current.choices ?? []) {
        const checked = Array.isArray(desired)
          ? desired.includes(choice.value)
          : desired[choice.value]?.value === true;
        if (checked !== choice.checked) {
          if (choice.disabled) throw new Error(`不可修改必选项：${key}/${choice.value}`);
          await this.click("case-control", choice.selector);
          current = await this.read(key);
        }
      }
    } else if (current.kind === "boolean") {
      if (typeof target !== "boolean") throw new Error(`布尔目标无效：${key}`);
      await this.click("case-control", current.selector);
    } else if (current.kind === "select") {
      let index = current.choices!.findIndex((o) => o.value === String(target) && !o.disabled);
      if (commitApi && initiallyMatched) {
        // A stale value absent from the options can display the first option without
        // updating the form. Commit an actual change before selecting the target.
        const alternate = current.choices!.findIndex(
          (o) => o.value !== String(target) && !o.disabled,
        );
        await this.select(current.selector, alternate);
        const alternateValue = Number(current.choices![alternate].value);
        await waitFor(
          `API 候选切换回读：${key}`,
          async () => (Number((await this.read(key)).value) === alternateValue ? true : undefined),
          15_000,
          this.signal,
        );
        current = await this.read(key);
      }
      if (index < 0 && key.endsWith(".maxAspectRatio")) {
        index = current.choices!.findIndex((o) => o.value === "custom");
        if (index >= 0) {
          await this.select(current.selector, index);
          current = await this.read(key);
          await this.text(current.selector, input ?? String(target));
        }
      } else {
        if (index < 0) throw new Error(`原生候选不存在：${key}`);
        await this.select(current.selector, index);
      }
    } else if (
      current.kind === "enum" &&
      key === "overwriteProjectSettings.includeModules.physics" &&
      target !== "inherit-project-setting"
    ) {
      await this.selectEnginePhysics(current, String(target));
    } else if (current.kind === "enum" && current.choices?.length) {
      const choice = current.choices.find((c) => c.value === String(target) && !c.disabled);
      if (!choice) throw new Error(`选项不可用：${key}`);
      await this.click("case-control", choice.selector);
    } else if (current.kind === "enum") {
      if (enumLabel === undefined) {
        const labels: Record<string, string> = {
          defaultConfig: "默认配置",
          "physics-cannon": "基于 cannon.js 的物理系统",
          "physics-2d-builtin": "内置 2D 物理系统",
          "physics-2d-box2d": "基于 Box2D 的 2D 物理系统",
          "inherit-project-setting": "继承项目设置",
          both: "Wasm + Asmjs",
          zip: "Zip",
        };
        try {
          enumLabel = selectionLabel(String(target));
        } catch {
          enumLabel = labels[String(target)] ?? String(target);
        }
      }
      try {
        await this.click("case-control", current.selector);
        const actual = key === "sourceMaps" && target !== "inline" ? target === "true" : target;
        const optionLabel = await waitFor(
          `下拉候选就绪：${key}/${String(target)}`,
          () =>
            this.builder.caseDom(
              (document, value, enumLabel) => {
                const all = [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(
                  (el) => el.getClientRects().length > 0,
                );
                const choices = all.filter(
                  (el) =>
                    el.getAttribute("data-pink-enum-value") === JSON.stringify(value) ||
                    el.getAttribute("data-value") === String(value) ||
                    (enumLabel !== undefined && el.textContent?.trim() === enumLabel),
                );
                if (choices.length > 1) throw new Error("下拉候选无法唯一对应目标");
                if (!choices.length) return undefined;
                const el = choices[0];
                if (el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled"))
                  throw new Error("目标下拉候选已禁用");
                return el.textContent?.trim() || undefined;
              },
              actual,
              enumLabel,
            ),
          15_000,
          this.signal,
        );
        await this.click("option", optionLabel);
      } catch (error) {
        if (error instanceof ConfigurationOperationError && error.disposition === "stop")
          throw error;
        try {
          await this.beforeInput?.();
          const expanded = await this.builder.caseDom((document, selector) => {
            const control = document.querySelector(selector);
            if (!control || control.getAttribute("role") !== "combobox")
              throw new Error("原下拉控件已失效，不能清理弹层");
            return control.getAttribute("aria-expanded") === "true";
          }, current.selector);
          // Close only this still-owned dropdown; never select a substitute value or retry input.
          if (expanded) await this.click("case-control", current.selector);
          await waitFor(
            "失败下拉弹层关闭",
            () =>
              this.builder.caseDom((document, selector) => {
                const control = document.querySelector(selector);
                const listId = control?.getAttribute("aria-controls");
                const list = listId ? document.getElementById(listId) : null;
                return control?.getAttribute("aria-expanded") === "false" &&
                  !list?.getClientRects().length
                  ? true
                  : undefined;
              }, current.selector),
            3000,
            this.signal,
          );
        } catch (cleanupError) {
          throw new ConfigurationOperationError(
            "context",
            "配置下拉失败且弹层未能安全关闭，停止后续操作",
            "stop",
            {
              cause: error,
              diagnostic: {
                phase: "enum.dismiss",
                observations: {
                  cleanupError:
                    cleanupError instanceof Error ? cleanupError.message : "未知清理错误",
                },
              },
            },
          );
        }
        throw error;
      }
    } else {
      if (key === "buildPath" && typeof target === "string" && target.startsWith("project://")) {
        if (!String(current.value).startsWith("project://"))
          throw new Error("构建路径当前不在 project 协议；不以输入文本伪造协议切换");
        await this.text(current.selector, target.slice("project://".length));
      } else await this.text(current.selector, input ?? String(target));
    }
    let matchedAt: number | undefined;
    await waitFor(
      `用例字段回读：${key}`,
      async () => {
        const c = await this.inspect(key);
        if (!c || !matches(c.value)) {
          matchedAt = undefined;
          return undefined;
        }
        matchedAt ??= Date.now();
        return Date.now() - matchedAt >= 600 ? true : undefined;
      },
      30_000,
      this.signal,
    );
    return !initiallyMatched || input !== undefined;
  }

  private async physicsCandidate(selector: string, value: string, label: string, listId?: string) {
    return this.builder.caseDom(
      (document, selector, value, label, expectedList) => {
        const controls = document.querySelectorAll<HTMLElement>(selector);
        const control = controls[0];
        if (
          controls.length !== 1 ||
          control.getAttribute("role") !== "combobox" ||
          control.closest("[data-option-key]")?.getAttribute("data-option-key") !==
            "overwriteProjectSettings.includeModules.physics"
        )
          throw new Error("原 3D 物理控件归属失效");
        const id = control.getAttribute("aria-controls");
        const open = control.getAttribute("aria-expanded") === "true";
        if (expectedList && id !== expectedList && (open || id !== null))
          throw new Error("原 3D 物理候选列表已替换");
        const lists = id ? document.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`) : [];
        const list = lists[0];
        if (lists.length > 1) throw new Error("3D 物理候选列表不唯一");
        if (!open || !list || !list.getClientRects().length) return { id, open, ready: false };
        if (list.getAttribute("role") !== "listbox") throw new Error("原 3D 物理候选容器类型不符");
        const all = [...list.querySelectorAll<HTMLElement>('[role="option"]')].filter(
          (el) => el.getClientRects().length > 0,
        );
        const candidates = all.filter((el) => {
          const typed = el.getAttribute("data-pink-enum-value"),
            raw = el.getAttribute("data-value");
          return typed !== null || raw !== null
            ? (typed === null || typed === JSON.stringify(value)) && (raw === null || raw === value)
            : el.textContent?.trim() === label;
        });
        if (candidates.length > 1) throw new Error("3D 物理候选无法唯一对应机器值");
        const choice = candidates[0];
        const parts: string[] = [];
        for (let node: Element | null = choice ?? null; node; node = node.parentElement) {
          const siblings = node.parentElement
            ? [...node.parentElement.children].filter((item) => item.tagName === node!.tagName)
            : [node];
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
        }
        return {
          id,
          open,
          ready: all.length > 0,
          selector: choice ? parts.join(" > ") : undefined,
          disabled:
            choice?.getAttribute("aria-disabled") === "true" ||
            choice?.hasAttribute("data-disabled"),
          labels: all.map((el) => el.textContent?.trim() ?? ""),
        };
      },
      selector,
      value,
      label,
      listId,
    );
  }

  private async selectEnginePhysics(current: CaseControl, target: string) {
    const field = "overwriteProjectSettings.includeModules.physics";
    const options = await this.builder.enginePhysicsOptions();
    if (!Object.hasOwn(options, target))
      throw new ConfigurationOperationError(
        "precondition",
        `SDK 3D 物理候选不包含机器值：${target}`,
        "blocked",
      );
    const label = options[target];
    let listId: string | undefined;
    try {
      await this.click("case-control", current.selector);
      const candidate = await waitFor(
        "原控件的 3D 物理候选列表",
        async () => {
          await this.beforeInput?.();
          const view = await this.physicsCandidate(current.selector, target, label, listId);
          if (view.id) listId ??= view.id;
          return view.ready ? view : undefined;
        },
        15_000,
        this.signal,
      );
      if (!candidate.selector || candidate.disabled)
        throw new ConfigurationOperationError(
          "precondition",
          `3D 物理候选缺失或禁用：${target}`,
          "blocked",
          {
            diagnostic: {
              phase: "engine-modules.candidate",
              observations: { field, target, label, listId, labels: candidate.labels },
            },
          },
        );
      await this.builder.click(
        "case-control",
        candidate.selector,
        undefined,
        undefined,
        async () => {
          await this.beforeInput?.();
          if (!isDeepStrictEqual(options, await this.builder.enginePhysicsOptions()))
            throw new Error("3D 物理候选元数据已变化");
          const fresh = await this.physicsCandidate(current.selector, target, label, listId);
          if (
            fresh.selector !== candidate.selector ||
            fresh.disabled ||
            (await this.read(field)).value !== current.value
          )
            throw new Error("输入前 3D 物理候选或原值已变化");
        },
      );
    } catch (cause) {
      try {
        await this.beforeInput?.();
        const before = await this.read(field);
        const view = await this.physicsCandidate(current.selector, target, label, listId);
        listId ??= view.id ?? undefined;
        if (view.open) {
          if (!listId) throw new Error("无法确认原 3D 物理候选弹层");
          await this.builder.caseDismissSelect(current.selector, listId, this.beforeInput);
        }
        await waitFor(
          "3D 物理失败弹层关闭且值未变化",
          async () => {
            await this.beforeInput?.();
            const state = await this.physicsCandidate(current.selector, target, label, listId);
            const unchanged = isDeepStrictEqual((await this.read(field)).value, before.value);
            if (!unchanged) throw new Error("关闭 3D 物理弹层改变了配置值");
            const hidden =
              !listId ||
              (await this.builder.caseDom((document, id) => {
                const list = document.getElementById(id);
                return (
                  !list ||
                  !list.getClientRects().length ||
                  document.defaultView!.getComputedStyle(list).visibility === "hidden"
                );
              }, listId));
            return !state.open && hidden ? true : undefined;
          },
          3000,
          this.signal,
        );
        if (!isDeepStrictEqual(before.value, current.value))
          throw new Error("失败选择的送达或配置变化无法确认");
      } catch (cleanupError) {
        throw new ConfigurationOperationError(
          "context",
          "3D 物理候选选择失败且弹层无法安全收尾",
          "stop",
          {
            cause,
            diagnostic: {
              phase: "engine-modules.dismiss",
              observations: {
                field,
                target,
                listId,
                cleanupError: cleanupError instanceof Error ? cleanupError.message : "unknown",
              },
            },
          },
        );
      }
      throw cause;
    }
  }
}

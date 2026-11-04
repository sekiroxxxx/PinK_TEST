import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { CaseForm } from "./case-form.js";
import { Builder } from "./builder.js";
import { ConfigurationOperations } from "./configuration-operations.js";
import { ExecutionContext, ConfigurationOperationError } from "./configuration-context.js";
import { BuilderConfiguration } from "./configuration-runtime.js";
import {
  StandardFields,
  observeStandardField,
  assertTargetObservation,
  assertCandidateObservation,
  type TargetObservation,
} from "./standard-fields.js";
import {
  validateConfigurationSteps,
  type LoadedConfigurationSteps,
} from "./configuration-steps-contract.js";
import { runConfigurationSteps } from "./configuration-steps.js";
import { valueHash } from "./plan-integrity.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";
import type { StandardFieldTarget } from "./configuration-targets.js";
import { configurationCheckDocument } from "./native-case-contract.js";
import { readBuilderHome, assertBuilderHome } from "./builder-checks.js";

/** External DOM fixture supplies selector responses and real input effects; no runner/adapter is mocked. */
class ElementFixture {
  children: ElementFixture[] = [];
  parentElement: ElementFixture | null = null;
  hidden = false;
  disabled = false;
  checked = false;
  value = "";
  type = "";
  options: ElementFixture[] = [];
  label = "";
  fixtureDocument?: Document;
  contentDocument: Document | null = null;
  computedStyle: Record<string, string> = {};
  get ownerDocument(): Document {
    return this.fixtureDocument ?? this.parentElement!.ownerDocument;
  }
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string> = {},
    public textContent = "",
  ) {}
  get selectedOptions() {
    return this.options.filter((option) => option.value === this.value);
  }
  add(child: ElementFixture) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  getAttribute(key: string) {
    return this.attrs[key] ?? null;
  }
  hasAttribute(key: string) {
    return key in this.attrs;
  }
  getClientRects(): unknown[] {
    return this.hidden || this.parentElement?.getClientRects().length === 0 ? [] : [{}];
  }
  descendants(): ElementFixture[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  contains(other: ElementFixture) {
    return this === other || this.descendants().includes(other);
  }
  matches(selector: string): boolean {
    return selector.split(",").some((part) => {
      const match = part.match(/^\[role="([^"]+)"\]$/);
      return !!match && this.attrs.role === match[1];
    });
  }
  closest(selector: string): ElementFixture | null {
    if (selector === "[data-option-key]" && this.hasAttribute("data-option-key")) return this;
    if (selector.includes("role=") && this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): ElementFixture[] {
    const all = this.descendants();
    if (selector.includes(":nth-of-type(")) {
      const parts = selector
        .split(" > ")
        .map((part) => part.match(/^([a-z]+):nth-of-type\((\d+)\)$/));
      if (parts.some((part) => !part)) return [];
      let node: ElementFixture | undefined = this;
      if (node.tagName.toLowerCase() !== parts[0]![1]) return [];
      for (const part of parts.slice(1))
        node = node?.children.filter((child) => child.tagName.toLowerCase() === part![1])[
          Number(part![2]) - 1
        ];
      return node ? [node] : [];
    }
    if (selector === 'button[aria-label="Close"]')
      return all.filter(
        (node) => node.tagName === "BUTTON" && node.attrs["aria-label"] === "Close",
      );
    if (selector === "button") return all.filter((node) => node.tagName === "BUTTON");
    if (selector === "iframe") return all.filter((node) => node.tagName === "IFRAME");
    if (selector === "input") return all.filter((node) => node.tagName === "INPUT");
    if (selector === ".platform-card,.pk-card")
      return all.filter((node) => node.attrs.class === "platform-card");
    if (selector === ".platform-card-title,.pk-card-foot")
      return all.filter((node) => node.attrs.class === "platform-card-title");
    const id = selector.match(/^\[id="(.+)"\]$/);
    if (id) return all.filter((node) => node.attrs.id === id[1]);
    if (selector === ':scope > [data-slot="field-label"]')
      return this.children.filter((node) => node.attrs["data-slot"] === "field-label");
    const keyed = selector.match(/^\[data-option-key="(.+)"\]$/);
    if (keyed) return all.filter((node) => node.attrs["data-option-key"] === keyed[1]);
    if (selector === '[data-slot="field"]')
      return all.filter((node) => node.attrs["data-slot"] === "field");
    if (selector === "div") return all.filter((node) => node.tagName === "DIV");
    if (selector === "button[aria-expanded]")
      return all.filter((node) => node.tagName === "BUTTON" && node.hasAttribute("aria-expanded"));
    if (selector.includes("aria-busy"))
      return all.filter(
        (node) => node.attrs["aria-busy"] === "true" || node.attrs["data-loading"] === "true",
      );
    if (selector === 'input[type="hidden"]')
      return all.filter((node) => node.tagName === "INPUT" && node.type === "hidden");
    if (selector.startsWith('input:not([type="hidden"])'))
      return all.filter(
        (node) =>
          (["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName) && node.type !== "hidden") ||
          node.matches('[role="checkbox"],[role="combobox"],[role="textbox"],[role="spinbutton"]'),
      );
    if (selector === '[role="option"]') return all.filter((node) => node.attrs.role === "option");
    if (selector === 'input[type="checkbox"],[role="checkbox"]')
      return all.filter((node) => node.type === "checkbox" || node.attrs.role === "checkbox");
    return [];
  }
  querySelector(selector: string): ElementFixture | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}
function domFixture() {
  const root = new ElementFixture("HTML"),
    body = root.add(new ElementFixture("BODY")),
    modal = body.add(new ElementFixture("DIV"));
  const close = modal
    .add(new ElementFixture("HEADER"))
    .add(new ElementFixture("BUTTON", { "aria-label": "Close" }));
  const rows: ElementFixture[] = [];
  const add = (key: string, label: string, control: ElementFixture) => {
    const row = modal.add(
      new ElementFixture("DIV", { "data-option-key": key, "data-slot": "field" }),
    );
    row.add(new ElementFixture("LABEL", { "data-slot": "field-label" }, label));
    row.add(control);
    rows.push(row);
    return row;
  };
  const name = new ElementFixture("INPUT");
  name.type = "text";
  name.value = "Original";
  add("name", "名称", name);
  add("buildPath", "构建路径", new ElementFixture("INPUT"));
  const toggle = new ElementFixture("INPUT");
  toggle.type = "checkbox";
  add("new-switch", "新增开关", toggle);
  const mode = new ElementFixture("SELECT");
  mode.value = "original";
  for (const [value, label] of [
    ["original", "原选项"],
    ["qa-added", "QA 新候选"],
  ]) {
    const option = new ElementFixture("OPTION");
    option.value = value;
    option.label = label;
    mode.options.push(option);
  }
  add("packages.qa-standard-platform.mode", "新模式", mode);
  let loading = false;
  const doc = {
    activeElement: null as ElementFixture | null,
    defaultView: {
      getComputedStyle: (element: ElementFixture) => ({
        visibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
        clip: "auto",
        clipPath: "none",
        ...element.computedStyle,
      }),
    },
    querySelector: (selector: string) =>
      selector === 'button[aria-label="Close"]' ? close : root.querySelector(selector),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    getElementById: (id: string) => root.descendants().find((node) => node.attrs.id === id) ?? null,
  };
  root.fixtureDocument = doc as unknown as Document;
  const originalQuery = modal.querySelectorAll.bind(modal);
  modal.querySelectorAll = (selector) =>
    selector.includes("aria-busy") && loading
      ? [new ElementFixture("DIV", { "aria-busy": "true" })]
      : originalQuery(selector);
  const selectors = new Map<string, ElementFixture>();
  const remember = (value: unknown) => {
    if (value && typeof value === "object" && "selector" in value) {
      const observed = value as { selector?: string; control?: string };
      if (observed.selector)
        selectors.set(
          observed.selector,
          observed.control === "enum" ? mode : observed.control === "boolean" ? toggle : name,
        );
    }
  };
  const inputs: string[] = [];
  const builder = {
    caseDom: async (fn: (document: Document, ...args: never[]) => unknown, ...args: never[]) => {
      const value = fn(doc as unknown as Document, ...args);
      remember(value);
      return value;
    },
    click: async (
      _kind: string,
      selector: string,
      _ui?: string,
      _choice?: string,
      verify?: () => Promise<void>,
    ) => {
      await verify?.();
      inputs.push("click");
      const control = selectors.get(selector)!;
      control.checked = !control.checked;
      return Date.now();
    },
    caseSelect: async (selector: string, index: number, verify?: () => Promise<void>) => {
      await verify?.();
      inputs.push("select");
      const control = selectors.get(selector)!;
      control.value = control.options[index].value;
    },
    caseText: async (selector: string, value: string, verify?: () => Promise<void>) => {
      await verify?.();
      inputs.push("text");
      selectors.get(selector)!.value = value;
    },
    configurationPage: async () => ({ state: "form" }),
  } as unknown as Builder;
  return {
    root,
    modal,
    doc: doc as unknown as Document,
    rows,
    toggle,
    mode,
    inputs,
    builder,
    loading: (value: boolean) => {
      loading = value;
    },
  };
}
const scope = { readyKeys: ["name", "buildPath"] };
test("OpenPaaS prerequisite checks preserve lost-page stops and classify an empty observed game list as blocked", async () => {
  let reads = 0;
  const observer = {
    signal: new AbortController().signal,
    configurationTimeoutMs: 1000,
    cdp: {
      dom: async () =>
        ++reads % 2
          ? { id: "", disabled: false, ids: [], createLabel: "创建游戏", codeVersion: "" }
          : [],
    },
  } as unknown as Builder;
  const lost = new ConfigurationOperationError("context", "配置页已失效", "stop");
  await assert.rejects(
    Builder.prototype.openpaasPage.call(observer, async () => {
      throw lost;
    }),
    (error: unknown) => error === lost,
  );
  assert.equal(reads, 0);
  await assert.rejects(
    Builder.prototype.openpaasPage.call(observer, async () => {}),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.disposition === "blocked" &&
      error.diagnostic?.phase === "platform-prerequisite",
  );
  assert.equal(reads, 2);
  Object.assign(observer, { configurationTimeoutMs: 1, cdp: { dom: async () => undefined } });
  await assert.rejects(
    Builder.prototype.openpaasPage.call(observer, async () => {}),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.disposition === "blocked" &&
      error.diagnostic?.phase === "runtime-capability",
  );
});
test("runtime capability checks inspect standard targets without writes and defer declared conditional children", async () => {
  const f = domFixture();
  const target = {
    id: "qa-standard-platform",
    label: "QA 平台",
    configurationTitle: "QA 平台",
    category: "X-Device" as const,
    fields: {
      name: { kind: "string" as const, control: "text" as const, scope },
      "new-switch": { kind: "boolean" as const, control: "boolean" as const, scope },
      "new-child": { kind: "string" as const, control: "text" as const, scope },
    },
    families: [{ parent: "new-switch", enabled: true, children: ["new-child"] }],
  };
  const form = new CaseForm(
    f.builder,
    target.id,
    new AbortController().signal,
    undefined,
    undefined,
    target,
  );
  const result = await form.checkCapabilities([
    { id: "name", op: "set", page: "page", field: "name", value: "QA" },
    { id: "enable", op: "set", page: "page", field: "new-switch", value: true },
    { id: "child", op: "set", page: "page", field: "new-child", value: "QA" },
  ]);
  assert.deepEqual(
    result.checks.map(({ field, state }) => ({ field, state })),
    [
      { field: "name", state: "supported" },
      { field: "new-switch", state: "supported" },
      { field: "new-child", state: "deferred-until-enabled" },
    ],
  );
  await assert.rejects(
    form.checkCapabilities([
      { id: "child", op: "set", page: "page", field: "new-child", value: "QA" },
    ]),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.disposition === "blocked" &&
      error.diagnostic?.phase === "runtime-capability",
  );
  assert.deepEqual(f.inputs, []);
  const transport = new Error("Builder 调试连接已断开");
  f.builder.caseDom = async () => {
    throw transport;
  };
  await assert.rejects(
    form.checkCapabilities([{ id: "name", op: "set", page: "page", field: "name", value: "QA" }]),
    (error: unknown) => error === transport,
  );
});
const absent: StandardFieldTarget = {
  kind: "string",
  control: "text",
  locator: { kind: "option-key", key: "removed" },
  scope,
};
// Browser CSS.escape is an external primitive; these fixture keys need no escaping.
Object.assign(globalThis, { CSS: { escape: (value: string) => value } });

test("public Builder observations read actual controls and distinguish hidden, duplicate and unready scopes", () => {
  const f = domFixture();
  f.modal.hidden = true;
  f.root.add(new ElementFixture("BUTTON", {}, "查看构建记录"));
  const build = f.root.add(new ElementFixture("BUTTON", {}, "全部构建"));
  build.disabled = true;
  const read = () => ({ category: "X-Device" as const, ...readBuilderHome(f.doc) });
  const home = read();
  assert.equal(home.ready, true);
  assert.deepEqual(home.buttons["build-all"], { visible: true, disabled: true, matchCount: 1 });
  assertBuilderHome(home, read(), { buttons: { "build-all": { visible: true, disabled: true } } });
  assert.throws(
    () => assertBuilderHome(home, read(), { buttons: { "build-all": { disabled: false } } }),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "failed",
  );
  build.hidden = true;
  assert.equal(read().buttons["build-all"].visible, false);
  assert.throws(
    () => assertBuilderHome(home, read(), { ready: true }),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "stop",
  );
  build.hidden = false;
  const duplicate = f.root.add(new ElementFixture("BUTTON", {}, "全部构建"));
  assert.throws(
    () => assertBuilderHome(read(), read(), { ready: true }),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "blocked",
  );
  duplicate.hidden = true;
  const busy = f.root.add(new ElementFixture("DIV", { "aria-busy": "true" }));
  assert.equal(read().ready, false);
  busy.hidden = true;
  assert.equal(read().ready, true);
  f.modal.hidden = false;
  assert.equal(read().ready, false);
  assert.deepEqual(f.inputs, []);
});

test("field absence, hidden state, loading, ambiguity and unsupported controls are separate actual observations", () => {
  const f = domFixture();
  assert.equal(observeStandardField(f.doc, "removed", absent).presence, "absent");
  const incomplete = observeStandardField(f.doc, "removed", { ...absent, scope: undefined });
  assert.equal(incomplete.presence, "undetermined");
  assert.throws(() => assertTargetObservation(incomplete, { presence: "absent" }), /不足/);
  f.loading(true);
  const loading = observeStandardField(f.doc, "removed", absent);
  assert.equal(loading.reason, "not-ready");
  assert.throws(() => assertTargetObservation(loading, { presence: "absent" }), /不足/);
  f.loading(false);
  f.rows[2].hidden = true;
  const target: StandardFieldTarget = {
    kind: "boolean",
    control: "boolean",
    locator: { kind: "label", name: "新增开关" },
    scope,
  };
  const hidden = observeStandardField(f.doc, "qaSwitch", target);
  assert.equal(hidden.presence, "present");
  assert.equal(hidden.visible, false);
  assert.throws(() => assertTargetObservation(hidden, { presence: "absent" }), /不符/);
  f.rows[2].hidden = false;
  const wrong = observeStandardField(f.doc, "qaSwitch", {
    ...target,
    kind: "string",
    control: "text",
  });
  assert.equal(wrong.presence, "present");
  assert.equal(wrong.reason, "unsupported");
  assert.equal(assertTargetObservation(wrong, { presence: "present" }).passed, true);
  assert.throws(() => assertTargetObservation(wrong, { writable: false }), /不足/);
  const role: StandardFieldTarget = {
    ...target,
    locator: { kind: "role", role: "checkbox", name: "新增开关" },
  };
  const unsupportedName = observeStandardField(f.doc, "qaSwitch", role);
  assert.equal(unsupportedName.reason, "unsupported");
  assert.throws(() => assertTargetObservation(unsupportedName, { presence: "absent" }), /不足/);
  f.toggle.attrs["aria-label"] = "新增开关";
  assert.equal(observeStandardField(f.doc, "qaSwitch", role).presence, "present");
  f.modal.add(f.rows[2]);
  const ambiguous = observeStandardField(f.doc, "qaSwitch", target);
  assert.equal(ambiguous.reason, "ambiguous");
  assert.throws(() => assertTargetObservation(ambiguous, { presence: "present" }), /不足/);
});

test("platform discovery requires declared ready cards before proving absence and rejects duplicate matches", async () => {
  const f = domFixture();
  f.modal.hidden = true;
  f.root.add(new ElementFixture("BUTTON", {}, "查看构建记录"));
  const addCard = (label: string) =>
    f.root
      .add(new ElementFixture("DIV", { class: "platform-card" }))
      .add(new ElementFixture("DIV", { class: "platform-card-title" }, label));
  const observer = { caseDom: f.builder.caseDom } as Builder;
  const probe = (label: string, ready: string[] = []) =>
    Builder.prototype.probePlatform.call(observer, label, ready);
  assert.equal((await probe("New platform")).presence, "undetermined");
  addCard("Known platform");
  assert.equal((await probe("New platform", ["Known platform"])).presence, "absent");
  addCard("New platform");
  assert.equal((await probe("New platform")).presence, "present");
  addCard("New platform");
  assert.equal((await probe("New platform")).reason, "ambiguous");
});

test("home probe finds one nested home document and blocks hidden, ambiguous or unreadable frame scopes", async () => {
  const host = domFixture(),
    outer = domFixture(),
    home = domFixture();
  for (const f of [host, outer, home]) f.modal.hidden = true;
  host.root.add(new ElementFixture("BUTTON", {}, "查看构建记录"));
  const first = host.root.add(new ElementFixture("IFRAME"));
  first.contentDocument = outer.doc;
  const second = outer.root.add(new ElementFixture("IFRAME"));
  second.contentDocument = home.doc;
  const card = home.root.add(new ElementFixture("DIV", { class: "platform-card" }));
  card.add(new ElementFixture("DIV", { class: "platform-card-title" }, "Web 桌面端"));
  const observer = { caseDom: host.builder.caseDom } as Builder;
  const probe = (label: string) =>
    Builder.prototype.probePlatform.call(observer, label, ["Web 桌面端"]);
  assert.equal((await probe("Web 桌面端")).presence, "present");
  assert.equal((await probe("Web 桌面端")).scopeComplete, true);
  assert.equal((await probe("Missing platform")).presence, "absent");
  first.hidden = true;
  assert.equal((await probe("Web 桌面端")).presence, "undetermined");
  first.hidden = false;
  const unreadable = host.root.add(new ElementFixture("IFRAME"));
  assert.equal((await probe("Web 桌面端")).reason, "incomplete-scope");
  unreadable.hidden = true;
  const other = outer.root.add(new ElementFixture("DIV", { class: "platform-card" }));
  other.add(new ElementFixture("DIV", { class: "platform-card-title" }, "Other platform"));
  assert.equal((await probe("Web 桌面端")).reason, "ambiguous");
});

test("standard checkbox uses its accessible control and hidden proxy, but rejects a second editable control", async () => {
  const f = domFixture(),
    row = f.rows[2];
  row.children = row.children.slice(0, 1);
  row.attrs["data-slot"] = "field";
  delete row.attrs["data-option-key"];
  row.children[0].textContent = "全部构建时构建此平台";
  const control = row.add(
    new ElementFixture("BUTTON", { role: "checkbox", "aria-checked": "true" }),
  );
  const proxy = row.add(new ElementFixture("INPUT", { "aria-hidden": "true", tabindex: "-1" }));
  proxy.type = "checkbox";
  proxy.checked = true;
  proxy.computedStyle.clipPath = "inset(50%)";
  const target: StandardFieldTarget = {
    kind: "boolean",
    control: "boolean",
    locator: { kind: "label", name: "全部构建时构建此平台" },
    scope,
  };
  const observed = observeStandardField(f.doc, "qaInclude", target);
  assert.equal(observed.readable, true);
  assert.equal(observed.value, true);
  f.builder.click = async (_kind, selector, _ui, _choice, verify) => {
    await verify?.();
    assert.equal(f.doc.querySelector(selector), control);
    const checked = control.attrs["aria-checked"] !== "true";
    control.attrs["aria-checked"] = String(checked);
    proxy.checked = checked;
    return Date.now();
  };
  const fields = new StandardFields(f.builder, new AbortController().signal);
  await fields.set("qaInclude", target, false);
  assert.equal((await fields.inspect("qaInclude", target))!.value, false);
  await fields.set("qaInclude", target, true);
  assert.equal(proxy.checked, true);
  proxy.checked = false;
  assert.equal((await fields.probe("qaInclude", target)).readable, false);
  proxy.checked = true;
  const extra = row.add(new ElementFixture("INPUT"));
  extra.type = "text";
  assert.equal((await fields.probe("qaInclude", target)).reason, "unsupported");
  extra.attrs["aria-hidden"] = "true";
  extra.attrs.tabindex = "-1";
  extra.computedStyle.clip = "rect(0px, 20px, 20px, 0px)";
  assert.equal((await fields.probe("qaInclude", target)).reason, "unsupported");
});

test("standard enum binds Base UI text proxy to its trigger and preserves typed candidate values through restore", async () => {
  const f = domFixture(),
    row = f.rows[3];
  row.children = row.children.slice(0, 1);
  row.attrs["data-option-key"] = "sourceMaps";
  const control = row.add(
    new ElementFixture(
      "BUTTON",
      {
        role: "combobox",
        "data-pink-enum-value": "false",
        "aria-controls": "choices",
        "aria-expanded": "false",
      },
      "关闭",
    ),
  );
  const proxy = row.add(new ElementFixture("INPUT", { "aria-hidden": "true", tabindex: "-1" }));
  proxy.type = "text";
  proxy.value = "false";
  proxy.computedStyle.clipPath = "inset(50%)";
  const list = f.root.add(new ElementFixture("DIV", { id: "choices", role: "listbox" }));
  list.hidden = true;
  const values = [false, true, "inline"];
  let dismissal: "normal" | "foreign-focus" | "stays-open" = "normal";
  for (const [index, value] of values.entries())
    list.add(
      new ElementFixture(
        "DIV",
        { role: "option", "data-pink-enum-value": JSON.stringify(value) },
        ["关闭", "开启", "内联 Source Map"][index],
      ),
    );
  f.builder.click = async (_kind, selector, _ui, _choice, verify) => {
    await verify?.();
    const selected = f.doc.querySelector(selector) as unknown as ElementFixture;
    if (selected === control) {
      if (!list.hidden) throw new Error("展开列表遮住触发按钮，不能点击清理");
      list.hidden = !list.hidden;
      control.attrs["aria-expanded"] = String(!list.hidden);
      (f.doc as unknown as { activeElement: ElementFixture }).activeElement =
        dismissal === "foreign-focus" ? f.root : list.children[0];
    } else {
      assert.ok(list.children.includes(selected));
      control.attrs["data-pink-enum-value"] = selected.attrs["data-pink-enum-value"];
      proxy.value = String(JSON.parse(selected.attrs["data-pink-enum-value"]));
      list.hidden = true;
      control.attrs["aria-expanded"] = "false";
    }
    return Date.now();
  };
  const keys: string[] = [];
  Object.setPrototypeOf(f.builder, Builder.prototype);
  Object.assign(f.builder, {
    cdp: { dom: f.builder.caseDom },
    hostName: "fixture",
    signal: new AbortController().signal,
    page: {
      evaluate: async () => true,
      keyboard: {
        press: async (key: string) => {
          keys.push(key);
          assert.equal(key, "Escape");
          if (dismissal === "stays-open") return;
          // External UI event: dismissal completes asynchronously and does not select a value.
          queueMicrotask(() => {
            list.hidden = true;
            control.attrs["aria-expanded"] = "false";
            (f.doc as unknown as { activeElement: ElementFixture }).activeElement = control;
          });
        },
      },
    },
  });
  const target: StandardFieldTarget = {
    kind: "scalar",
    valueKinds: ["boolean", "string"],
    control: "enum",
    locator: { kind: "option-key", key: "sourceMaps" },
    scope,
  };
  const fields = new StandardFields(f.builder, new AbortController().signal);
  assert.equal((await fields.probe("qaSourceMap", target)).readable, true);
  assert.deepEqual(
    (await fields.candidates("qaSourceMap", target)).items.map((item) => item.value),
    [false, true, "inline"],
  );
  assert.deepEqual(keys, ["Escape"]);
  assert.equal(list.hidden, true);
  assert.equal((await fields.inspect("qaSourceMap", target))!.value, false);
  await fields.select("qaSourceMap", target, { by: "value", value: true });
  assert.equal((await fields.inspect("qaSourceMap", target))!.value, true);
  await fields.select("qaSourceMap", target, { by: "value", value: false });
  assert.equal((await fields.inspect("qaSourceMap", target))!.value, false);
  const form = new CaseForm(
    f.builder,
    "web-desktop",
    new AbortController().signal,
    undefined,
    undefined,
    {
      id: "web-desktop",
      label: "Web 桌面端",
      configurationTitle: "Web 桌面端",
      category: "X-Device",
      fields: { sourceMaps: target },
    },
  );
  const original = await form.read("sourceMaps");
  await fields.select("qaSourceMap", target, { by: "value", value: "inline" });
  assert.equal((await fields.inspect("qaSourceMap", target))!.value, "inline");
  await form.restoreControl("sourceMaps", original);
  assert.equal((await form.read("sourceMaps")).value, false);
  await assert.rejects(
    fields.candidates("qaSourceMap", { ...target, kind: "string", valueKinds: undefined }),
    /expected=string, actual=boolean/,
  );
  const safeStop = (error: unknown) =>
    error instanceof ConfigurationOperationError &&
    error.disposition === "stop" &&
    error.diagnostic?.phase === "standard-enum.dismiss";
  const before = keys.length;
  dismissal = "foreign-focus";
  await assert.rejects(fields.candidates("qaSourceMap", target), safeStop);
  assert.equal(keys.length, before, "foreign focus must not receive Escape");
  assert.equal(list.hidden, false);
  // Reset only this offline UI fixture before the independent unresponsive-popup scenario.
  list.hidden = true;
  control.attrs["aria-expanded"] = "false";
  dismissal = "stays-open";
  await assert.rejects(fields.candidates("qaSourceMap", target), safeStop);
  assert.equal(keys.length, before + 1, "dismissal is sent once and is never retried");
  assert.equal((await fields.inspect("qaSourceMap", target))!.value, false);
  assert.equal(list.hidden, false);
  const extra = row.add(new ElementFixture("INPUT"));
  extra.type = "text";
  assert.equal((await fields.probe("qaSourceMap", target)).readable, false);
});

test("native enum candidates retain boolean type and refuse ambiguous labels without changing controls", async () => {
  const f = domFixture();
  const standard = new StandardFields(f.builder, new AbortController().signal);
  const target: StandardFieldTarget = {
    kind: "boolean",
    control: "enum",
    locator: { kind: "option-key", key: "packages.qa-standard-platform.mode" },
    scope,
  };
  f.mode.options = [];
  for (const value of [false, true]) {
    const item = new ElementFixture("OPTION", { "data-pink-enum-value": JSON.stringify(value) });
    item.value = String(value);
    item.label = "相同标签";
    f.mode.options.push(item);
  }
  f.mode.value = "false";
  const observed = await standard.candidates("mode", target);
  assert.deepEqual(
    observed.items.map((item) => item.value),
    [false, true],
  );
  assert.equal(
    assertCandidateObservation(observed, { by: "value", value: "false" }, { present: false })
      .passed,
    true,
  );
  await assert.rejects(standard.select("mode", target, { by: "value", value: "false" }), /受阻/);
  await assert.rejects(
    standard.select("mode", target, { by: "label", label: "相同标签" }),
    /ambiguous/,
  );
  assert.deepEqual(f.inputs, []);
  assert.equal(
    (await standard.select("mode", target, { by: "value", value: true })).selected.value,
    true,
  );
  assert.equal((await standard.inspect("mode", target))!.value, true);
  f.mode.options[1].disabled = true;
  await assert.rejects(standard.select("mode", target, { by: "value", value: true }), /受阻/);
});

test("a missing popup candidate closes only its own popup; cleanup failure preserves the original error and stops", async () => {
  const f = domFixture();
  const row = f.rows[3];
  row.children = row.children.slice(0, 1);
  const combo = row.add(
    new ElementFixture("BUTTON", {
      role: "combobox",
      "aria-controls": "choices",
      "aria-expanded": "false",
    }),
  );
  const hidden = row.add(new ElementFixture("INPUT"));
  hidden.type = "hidden";
  hidden.value = "original";
  const list = f.root.add(new ElementFixture("DIV", { id: "choices", role: "listbox" }));
  list.hidden = true;
  list.add(
    new ElementFixture(
      "DIV",
      { role: "option", "data-pink-enum-value": '"qa-added"' },
      "QA 新候选",
    ),
  );
  let failClose = false;
  f.builder.click = async (_kind, _selector, _ui, _choice, verify) => {
    await verify?.();
    if (!list.hidden) throw new Error("popup covers the trigger");
    list.hidden = !list.hidden;
    combo.attrs["aria-expanded"] = String(!list.hidden);
    (f.doc as unknown as { activeElement: ElementFixture }).activeElement = list.children[0];
    return Date.now();
  };
  const keys: string[] = [];
  Object.setPrototypeOf(f.builder, Builder.prototype);
  Object.assign(f.builder, {
    cdp: { dom: f.builder.caseDom },
    hostName: "fixture",
    signal: new AbortController().signal,
    page: {
      evaluate: async () => true,
      keyboard: {
        press: async (key: string) => {
          keys.push(key);
          assert.equal(key, "Escape");
          if (failClose) throw new Error("fixture popup close obstructed");
          list.hidden = true;
          combo.attrs["aria-expanded"] = "false";
        },
      },
    },
  });
  const standard = new StandardFields(f.builder, new AbortController().signal);
  const target: StandardFieldTarget = {
    kind: "string",
    control: "enum",
    locator: { kind: "option-key", key: "packages.qa-standard-platform.mode" },
    scope,
  };
  await assert.rejects(
    standard.select("mode", target, { by: "value", value: "missing" }),
    /unavailable-candidate/,
  );
  assert.equal(list.hidden, true);
  assert.equal(hidden.value, "original");
  assert.deepEqual(keys, ["Escape"]);
  failClose = true;
  await assert.rejects(
    standard.select("mode", target, { by: "value", value: "missing" }),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.code === "context" &&
      error.disposition === "stop" &&
      error.cause instanceof Error &&
      error.cause.message.includes("unavailable-candidate") &&
      JSON.stringify(error.diagnostic).includes("close obstructed"),
  );
  assert.deepEqual(keys, ["Escape", "Escape"]);
});

test("same executor reads a new platform, new fields and a new candidate from JSON, restores after assertion failure, and stops after recovery failure", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../fixtures/configuration-steps/standard-target-v2.json", import.meta.url),
      "utf8",
    ),
  ) as BuildStepsDocument;
  async function run(
    document: BuildStepsDocument,
    restoreFails = false,
    existingPlatform = false,
    hiddenChild = false,
    prepareUi?: (f: ReturnType<typeof domFixture>) => void,
  ) {
    const f = domFixture();
    prepareUi?.(f);
    if (hiddenChild) f.rows[3].hidden = true;
    const identity = { executable: "offline", project: "offline", windowId: 1 };
    if (existingPlatform) f.rows[3].attrs["data-option-key"] = "packages.web-desktop.mode";
    const session = new ExecutionContext(identity, async () => identity);
    let generation = 0;
    class ObservedForm extends CaseForm {
      async primaryBuildEnabled() {
        return false;
      } // A disabled build button is allowed for configuration checks.
      async alerts() {
        return [];
      }
      async restoreControl(field: string, original: Parameters<CaseForm["restoreControl"]>[1]) {
        if (restoreFails) throw new Error("fixture restore transport failure");
        return super.restoreControl(field, original);
      }
    }
    validateConfigurationSteps(document);
    const loaded: LoadedConfigurationSteps = {
      path: "offline",
      sourceSha256: valueHash(document),
      documentSha256: valueHash(document),
      document,
    };
    const result = await runConfigurationSteps(loaded, {
      session,
      evidenceKind: "offline-fixture",
      closeConfiguration: async (operations) => operations.context.invalidate(),
      probePlatform: async (): Promise<TargetObservation> => ({
        scopeReady: true,
        scopeComplete: true,
        matchCount: 1,
        presence: "present",
        visible: true,
        readable: false,
        writable: false,
        control: "platform-card",
      }),
      openConfiguration: async (platform) => {
        const bind = () =>
          session.bind(platform, platform, ++generation, async () => ({
            title: platform,
            generation,
          }));
        const form = new ObservedForm(
          f.builder,
          platform,
          new AbortController().signal,
          undefined,
          undefined,
          document.targets!.find((t) => t.id === platform),
        );
        return new ConfigurationOperations(bind(), form, async () => bind());
      },
    });
    return { f, result };
  }
  const normal = await run(source);
  assert.equal(normal.result.outcome, "passed");
  assert.ok("buildAttempted" in normal.result);
  assert.equal(normal.result.buildAttempted, false);
  assert.equal(normal.result.cases[0].restoration, "passed");
  assert.equal(normal.f.toggle.checked, false);
  assert.equal(normal.f.mode.value, "original");
  const conditional = structuredClone(source);
  conditional.targets![0].families = [{ parent: "qaSwitch", enabled: true, children: ["qaMode"] }];
  const unreadableOriginal = await run(conditional, false, false, true);
  assert.equal(unreadableOriginal.result.cases[0].outcome, "blocked");
  assert.equal(unreadableOriginal.result.cases[0].restoration, "not-recorded");
  assert.deepEqual(unreadableOriginal.f.inputs, []);
  const builtin = structuredClone(source.targets![0]);
  builtin.id = "web-desktop";
  builtin.label = "Web 桌面端";
  builtin.configurationTitle = "Web 桌面端";
  builtin.fields.qaMode.locator = { kind: "option-key", key: "packages.web-desktop.mode" };
  builtin.fields.qaRemoved.locator = { kind: "option-key", key: "packages.web-desktop.removed" };
  const builtinDocument = configurationCheckDocument({
    caseId: "qa.builtin-new-field",
    platform: "web-desktop",
    targets: [builtin],
    values: { qaMode: "qa-added", qaSwitch: true },
  });
  const builtinResult = await run(builtinDocument, false, true);
  assert.equal(builtinResult.result.outcome, "passed");
  assert.equal(builtinResult.f.mode.value, "original");
  const mixed = structuredClone(source.targets![0]);
  mixed.fields = {
    sourceMaps: {
      kind: "scalar",
      control: "enum",
      valueKinds: ["boolean", "string"],
      locator: source.targets![0].fields.qaMode.locator,
      scope,
    },
  };
  const mixedDocument = configurationCheckDocument({
    caseId: "qa.typed-enum",
    platform: mixed.id,
    targets: [mixed],
    values: { sourceMaps: false },
  });
  const typedOptions = (f: ReturnType<typeof domFixture>) => {
    f.mode.options = [false, true, "false", "inline"].map((value, index) => {
      const option = new ElementFixture("OPTION", {
        "data-pink-enum-value": JSON.stringify(value),
      });
      option.value = String(index);
      option.label = String(value);
      return option;
    });
    f.mode.value = "1";
  };
  const typed = await run(mixedDocument, false, false, false, typedOptions);
  assert.equal(typed.result.cases[0].outcome, "passed");
  assert.equal(typed.result.cases[0].restoration, "passed");
  assert.equal(typed.f.mode.value, "1");
  const wrongType = structuredClone(mixedDocument);
  const independent = wrongType.cases[0].steps.find(
    (step) => step.op === "assert" && step.check === "values",
  );
  assert.ok(independent?.op === "assert" && independent.check === "values");
  independent.values.sourceMaps = "false";
  const rejectedType = await run(wrongType, false, false, false, typedOptions);
  assert.equal(
    rejectedType.result.cases[0].outcome,
    "failed",
    "string false must not equal boolean false",
  );
  assert.equal(rejectedType.result.cases[0].restoration, "passed");
  assert.equal(rejectedType.f.mode.value, "1");
  const edited = structuredClone(source);
  const values = edited.cases[0].steps.find((s) => s.op === "assert" && s.check === "values")!;
  if (values.op === "assert" && values.check === "values")
    values.values.qaMode = "wrong-expectation";
  edited.cases.push({ ...structuredClone(source.cases[0]), caseId: "qa.following" });
  const failed = await run(edited);
  assert.equal(failed.result.cases[0].outcome, "failed");
  assert.equal(failed.result.cases[0].restoration, "passed");
  assert.equal(failed.result.cases[1].outcome, "passed");
  assert.equal(failed.f.mode.value, "original");
  const unsafe = await run(edited, true);
  assert.equal(unsafe.result.cases[0].restoration, "failed");
  assert.equal(unsafe.result.cases[1].outcome, "skipped");
});

test("opening a declared platform verifies its page without first requiring every declared field to exist", async () => {
  const identity = { executable: "offline", project: "offline", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  const target = {
    id: "qa-unregistered",
    label: "QA platform",
    configurationTitle: "QA config",
    category: "X-Application" as const,
    fields: { removed: absent },
  };
  const builder = {
    configurationGeneration: 1,
    openConfigurationPage: async () => ({ title: "QA config" }),
    configurationIdentity: async () => ({ title: "QA config", generation: 1, instance: 1 }),
  } as unknown as Builder;
  const configuration = await BuilderConfiguration.open(
    builder,
    session,
    target.id,
    new AbortController().signal,
    target,
  );
  assert.equal(configuration.platform, "qa-unregistered");
  await assert.rejects(
    BuilderConfiguration.open(
      {
        ...builder,
        configurationIdentity: async () => ({ title: "Wrong config", generation: 1, instance: 1 }),
      } as unknown as Builder,
      session,
      target.id,
      new AbortController().signal,
      target,
    ),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "stop",
  );
});

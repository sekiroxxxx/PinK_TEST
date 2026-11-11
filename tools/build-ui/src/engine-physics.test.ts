import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Page } from "playwright-core";
import { Builder } from "./builder.js";
import { Cdp } from "./cdp.js";
import { CaseForm, type CaseControl } from "./case-form.js";
import type { FormView } from "./configuration-page.js";
import { ConfigurationOperationError } from "./configuration-context.js";

// External DOM and input effects for the captured Base UI popup; all adapter logic is real.
class Element {
  children: Element[] = [];
  parentElement: Element | null = null;
  hidden = false;
  constructor(
    readonly tagName: string,
    readonly attrs: Record<string, string> = {},
    public textContent = "",
  ) {}
  add(child: Element) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attrs;
  }
  getClientRects(): unknown[] {
    return this.hidden || this.parentElement?.getClientRects().length === 0 ? [] : [{}];
  }
  descendants(): Element[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  contains(el: Element) {
    return this === el || this.descendants().includes(el);
  }
  closest(selector: string): Element | null {
    if (selector === "[data-option-key]" && this.hasAttribute("data-option-key")) return this;
    if (selector === '[data-slot="select-content"]' && this.attrs["data-slot"] === "select-content")
      return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.descendants().filter((el) =>
      selector === '[role="option"]'
        ? el.attrs.role === "option"
        : selector === '[role="listbox"]'
          ? el.attrs.role === "listbox"
          : false,
    );
  }
}

async function fixture(
  t: TestContext,
  language: "en" | "zh",
  failure?: "missing" | "foreign-focus",
) {
  if (!globalThis.CSS) Object.assign(globalThis, { CSS: { escape: (s: string) => s } });
  const field = "overwriteProjectSettings.includeModules.physics";
  const root = new Element("HTML"),
    body = root.add(new Element("BODY"));
  const row = body.add(new Element("DIV", { "data-option-key": field }));
  const trigger = row.add(
    new Element("BUTTON", {
      id: "physics",
      role: "combobox",
      "aria-expanded": "false",
      "aria-controls": "physics-list",
    }),
  );
  const popup = body.add(
    new Element("DIV", { "data-slot": "select-content", role: "presentation" }),
  );
  const list = popup.add(new Element("DIV", { id: "physics-list", role: "listbox" }));
  popup.hidden = true;
  let labels =
    language === "en"
      ? {
          "physics-ammo": "Bullet Based Physics System",
          "physics-builtin": "Builtin Physics System",
        }
      : { "physics-ammo": "基于 Bullet 的物理系统", "physics-builtin": "内置物理系统" };
  const ids = new Map<Element, string>();
  for (const [id, label] of Object.entries(labels)) {
    if (failure && id === "physics-builtin") continue;
    ids.set(list.add(new Element("DIV", { role: "option" }, label)), id);
  }
  // An unrelated list has the same visible text. It must never receive the selection.
  body
    .add(new Element("DIV", { role: "listbox" }))
    .add(new Element("DIV", { role: "option" }, labels["physics-builtin"]));
  let value = "physics-ammo",
    sequence = 10,
    documentId = 1;
  const clicks: string[] = [],
    keys: string[] = [];
  const listeners = new Set<(event: { data: unknown }) => void>();
  const query = (selector: string): Element[] => {
    if (selector === "#physics") return [trigger];
    if (selector === '[id="physics-list"]') return [list];
    if (selector === '[data-slot="select-content"]:has([id="physics-list"])') return [popup];
    if (selector.includes(":nth-of-type(")) {
      const parts = selector
        .split(" > ")
        .map((part) => /^([a-z]+):nth-of-type\((\d+)\)$/.exec(part));
      if (parts.some((part) => !part)) return [];
      let node: Element | undefined = root;
      for (const part of parts.slice(1))
        node = node?.children.filter((child) => child.tagName.toLowerCase() === part![1])[
          Number(part![2]) - 1
        ];
      return node ? [node] : [];
    }
    return root.querySelectorAll(selector);
  };
  const document = {
    readyState: "complete",
    activeElement: trigger,
    defaultView: {
      getComputedStyle: () => ({ visibility: "visible" }),
      addEventListener: (_name: string, fn: (event: { data: unknown }) => void) =>
        listeners.add(fn),
      removeEventListener: (_name: string, fn: (event: { data: unknown }) => void) =>
        listeners.delete(fn),
    },
    querySelectorAll: query,
    querySelector: (selector: string) => query(selector)[0] ?? null,
    getElementById: (id: string) => root.descendants().find((el) => el.attrs.id === id) ?? null,
  };
  const emit = (result: unknown, id = ++sequence) => {
    for (const listener of listeners)
      listener({
        data: { source: "host", kind: "response", ok: true, id: `webview:${id}`, result },
      });
  };
  const metadata = () => ({
    physics: {
      options: Object.fromEntries(Object.entries(labels).map(([id, label]) => [id, { label }])),
    },
    physics2d: null,
    gfxWebgl2: null,
    nativeCodeModules: [],
  });
  const cdp = {
    evaluate: async () => ({
      activeFrames: 1,
      pendingFrames: 0,
      readyState: "complete",
      uiReady: true,
    }),
    contentDocumentNode: async () => documentId,
    dom: async (fn: (doc: unknown, ...args: unknown[]) => unknown, ...args: unknown[]) =>
      structuredClone(await fn(document, ...args)),
    close: () => {},
  };
  const page = {
    getByRole: () => ({ getAttribute: async () => "true" }),
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      filter: () => ({ all: async () => [{ getAttribute: async () => "fixture" }] }),
    }),
    evaluate: async () => true,
    keyboard: {
      press: async (key: string) => {
        keys.push(key);
        assert.equal(key, "Escape");
        popup.hidden = true;
        trigger.attrs["aria-expanded"] = "false";
        delete trigger.attrs["aria-controls"];
        document.activeElement = trigger;
      },
    },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify([
          {
            type: "iframe",
            url: "https://fixture/?extensionId=SUD.pink-builder&id=fixture",
            webSocketDebuggerUrl: "ws://offline",
          },
        ]),
      ),
  );
  t.mock.method(Cdp, "connect", async () => cdp as unknown as Cdp);
  const builder = await Builder.open(
    page as unknown as Page,
    "http://offline",
    new AbortController().signal,
    "category",
    1000,
    true,
  );
  t.after(() => builder.close());
  t.mock.method(builder, "home", async () => {});
  t.mock.method(
    builder,
    "configurationPage",
    async () => ({ title: "Web Desktop", state: "form" }) as FormView,
  );
  t.mock.method(
    builder,
    "click",
    async (...[kind, selector, _ui, _choice, verify]: Parameters<Builder["click"]>) => {
      await verify?.();
      clicks.push(`${kind}:${selector}`);
      if (kind === "platform") {
        emit(metadata());
        return Date.now();
      }
      const target = query(selector)[0];
      if (target === trigger) {
        if (!popup.hidden) throw new Error("popup covers trigger");
        popup.hidden = false;
        trigger.attrs["aria-expanded"] = "true";
        document.activeElement = failure === "foreign-focus" ? body : popup;
      } else {
        assert.ok(ids.has(target), "selection must belong to the controlled list");
        value = ids.get(target)!;
        popup.hidden = true;
        trigger.attrs["aria-expanded"] = "false";
      }
      return Date.now();
    },
  );
  await builder.observeEngineModules();
  await builder.openConfigurationPage("Web Desktop");
  class Form extends CaseForm {
    async read(): Promise<CaseControl> {
      return { kind: "enum", value, selector: "#physics", disabled: false };
    }
    async inspect() {
      return this.read();
    }
  }
  return {
    builder,
    form: new Form(builder, "web-desktop", new AbortController().signal, async () => {}),
    field,
    clicks,
    keys,
    value: () => value,
    open: () => !popup.hidden,
    listeners,
    emit,
    metadata,
    replaceDocument: () => {
      documentId++;
    },
    relabel: () => {
      labels = { "physics-ammo": "new Bullet", "physics-builtin": "new Builtin" };
    },
  };
}

test("the same source field/value selects Chinese and English metadata candidates within its own popup", async (t) => {
  for (const language of ["en", "zh"] as const)
    await t.test(language, async (t) => {
      const f = await fixture(t, language);
      await f.builder.observeEngineModules();
      assert.equal(f.listeners.size, 1);
      assert.equal(await f.form.set(f.field, "physics-builtin"), true);
      assert.equal(f.value(), "physics-builtin");
      assert.equal(f.open(), false);
      assert.equal(await f.form.set(f.field, "physics-builtin"), false);
      assert.equal(f.clicks.length, 3, "one platform open, one trigger and one selection");
    });
});

test("missing physics candidate closes the covering focused popup once without changing the machine value", async (t) => {
  const f = await fixture(t, "en", "missing");
  await assert.rejects(
    f.form.set(f.field, "physics-builtin"),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "blocked",
  );
  assert.deepEqual(f.keys, ["Escape"]);
  assert.equal(f.value(), "physics-ammo");
  assert.equal(f.open(), false);
  assert.equal(f.clicks.length, 2);
});

test("foreign focus is not dismissed and leaves the original physics value untouched", async (t) => {
  const f = await fixture(t, "en", "foreign-focus");
  await assert.rejects(
    f.form.set(f.field, "physics-builtin"),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "stop",
  );
  assert.deepEqual(f.keys, []);
  assert.equal(f.value(), "physics-ammo");
});

test("physics metadata cannot outlive its configuration or document and ignores old response sequences", async (t) => {
  const f = await fixture(t, "en");
  const old = f.metadata();
  f.relabel();
  await f.builder.openConfigurationPage("Web Desktop");
  assert.equal((await f.builder.enginePhysicsOptions())["physics-builtin"], "new Builtin");
  f.emit(old, 1);
  assert.equal((await f.builder.enginePhysicsOptions())["physics-builtin"], "new Builtin");
  f.replaceDocument();
  await assert.rejects(f.builder.enginePhysicsOptions(), /归属失效/);
  assert.equal(f.listeners.size, 1);
});

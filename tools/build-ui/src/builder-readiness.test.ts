import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Page } from "playwright-core";
import { Builder } from "./builder.js";
import { Cdp } from "./cdp.js";
import { ConfigurationOperationError } from "./configuration-context.js";

// Simulated Webview documents and input delivery; Builder readiness, probe and baseline are real.
async function fixture(t: TestContext) {
  if (!globalThis.CSS) Object.assign(globalThis, { CSS: { escape: (s: string) => s } });
  const signal = new AbortController();
  let clicks = 0,
    installs = 0,
    sequence = 0;
  let afterInput: (() => void) | undefined;
  class Button {
    disabled = false;
    constructor(readonly ownerDocument: ReturnType<typeof makeDocument>) {}
    get innerText() {
      return this.ownerDocument.history ? "Build & Package Results" : "View build history";
    }
    getClientRects() {
      return [{}];
    }
    getAttribute() {
      return null;
    }
    contains(element: unknown) {
      return element === this;
    }
    scrollIntoView() {}
    getBoundingClientRect() {
      return { left: 10, top: 10, width: 80, height: 20 };
    }
  }
  function makeDocument(id: number) {
    const listeners = new Set<(event: { data: unknown }) => void>();
    const doc = {
      id,
      history: false,
      readyState: "complete",
      listeners,
      defaultView: {
        HTMLButtonElement: Button,
        getComputedStyle: () => ({ visibility: "visible", pointerEvents: "auto" }),
        addEventListener: (_name: string, listener: (event: { data: unknown }) => void) => {
          installs++;
          listeners.add(listener);
        },
        removeEventListener: (_name: string, listener: (event: { data: unknown }) => void) =>
          listeners.delete(listener),
      },
      querySelector: () => null,
      querySelectorAll: (selector: string): unknown[] => (selector === "button" ? [button] : []),
      elementFromPoint: () => button,
    };
    const button = new Button(doc);
    return doc;
  }
  let active = makeDocument(124),
    pending: ReturnType<typeof makeDocument> | undefined;
  let activeFrames = 1;
  const frame = {
    get contentDocument() {
      return active;
    },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    clientLeft: 0,
    clientTop: 0,
    get ownerDocument() {
      return outer;
    },
  };
  const outer = {
    querySelectorAll: (selector: string): unknown[] =>
      selector === "#active-frame"
        ? Array(activeFrames).fill(frame)
        : selector === "#pending-frame"
          ? pending
            ? [{ contentDocument: pending }]
            : []
          : selector === "iframe"
            ? [frame]
            : [],
    defaultView: { getComputedStyle: () => ({ visibility: "visible" }) },
    elementFromPoint: () => frame,
  };
  function evaluate(fn: (...args: never[]) => unknown, args: unknown[], doc: unknown) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
    try {
      return structuredClone(fn(...(args as never[])));
    } finally {
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else Reflect.deleteProperty(globalThis, "document");
    }
  }
  const cdp = {
    evaluate: async (fn: (...args: never[]) => unknown, ...args: unknown[]) =>
      evaluate(fn, args, outer),
    contentDocumentNode: async () => active.id,
    dom: async (fn: (doc: unknown, ...args: unknown[]) => unknown, ...args: unknown[]) =>
      structuredClone(fn(active, ...args)),
    close: () => {},
  };
  const page = {
    getByRole: () => ({ getAttribute: async () => "true" }),
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      boundingBox: async () => ({ x: 0, y: 0 }),
      filter: () => ({ all: async () => [{ getAttribute: async () => "fixture" }] }),
    }),
    evaluate: async (fn: (...args: never[]) => unknown, ...args: unknown[]) =>
      evaluate(fn, args, {
        elementFromPoint: () => ({ getAttribute: () => "fixture" }),
      }),
    mouse: {
      click: async () => {
        clicks++;
        active.history = !active.history;
        if (active.history)
          for (const listener of active.listeners)
            listener({
              data: {
                source: "host",
                kind: "response",
                ok: true,
                id: `webview:${++sequence}`,
                result: [],
              },
            });
        const delivered = afterInput;
        afterInput = undefined;
        delivered?.();
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
    signal.signal,
    "category",
    1000,
    true,
  );
  t.after(() => builder.close());
  return {
    builder,
    signal,
    active: () => active,
    clicks: () => clicks,
    installs: () => installs,
    afterNextInput: (action: () => void) => {
      afterInput = action;
    },
    beginReplacement: () => {
      pending = makeDocument(291);
    },
    finishReplacement: () => {
      assert.ok(pending);
      active = pending;
      pending = undefined;
    },
    duplicateActive: () => {
      activeFrames = 2;
    },
  };
}

test("probe installation waits for a pending replacement instead of listening to the visible old page", async (t) => {
  const f = await fixture(t);
  const old = f.active();
  f.beginReplacement();
  const installing = f.builder.installProbe();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.installs(), 0);
  assert.equal(f.clicks(), 0);
  f.finishReplacement();
  await installing;
  assert.equal(old.listeners.size, 0);
  assert.equal(f.active().listeners.size, 1);
  assert.deepEqual(await f.builder.baseline(true), []);
  assert.equal(f.clicks(), 2, "one history open and one return, with no retries");
});

test("a pending or changed document after installation stops before history input and never reinstalls", async (t) => {
  const f = await fixture(t);
  await f.builder.installProbe();
  f.beginReplacement();
  await assert.rejects(f.builder.baseline(true), (error: unknown) => {
    assert.ok(error instanceof ConfigurationOperationError);
    assert.equal(error.disposition, "stop");
    const observations = error.diagnostic?.observations as {
      phase: string;
      frame: { pendingFrames: number };
    };
    assert.equal(observations.phase, "history.before-home");
    assert.equal(observations.frame.pendingFrames, 1);
    return true;
  });
  assert.equal(f.clicks(), 0);
  f.finishReplacement();
  await assert.rejects(f.builder.waitForReady("activate"), /文档 124 → 291/);
  assert.equal(f.installs(), 1);
  assert.equal(f.active().listeners.size, 0);
});

test("readiness cancellation performs no installation or UI input", async (t) => {
  const f = await fixture(t);
  f.beginReplacement();
  const installing = f.builder.installProbe();
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.signal.abort(new Error("QA stopped"));
  await assert.rejects(installing, /abort|QA stopped/i);
  assert.equal(f.installs(), 0);
  assert.equal(f.clicks(), 0);
});

test("replacement during history input records the exact boundary and does not retry the delivered click", async (t) => {
  const f = await fixture(t);
  await f.builder.installProbe();
  f.afterNextInput(() => {
    f.beginReplacement();
    f.finishReplacement();
  });
  await assert.rejects(f.builder.baseline(true), (error: unknown) => {
    assert.ok(error instanceof ConfigurationOperationError);
    assert.equal(error.disposition, "stop");
    const observations = error.diagnostic?.observations as {
      phase: string;
      installedDocument: number;
      currentDocument: number;
    };
    assert.equal(observations.phase, "history.after-open");
    assert.equal(observations.installedDocument, 124);
    assert.equal(observations.currentDocument, 291);
    return true;
  });
  assert.equal(f.clicks(), 1);
  assert.equal(f.installs(), 1);
});

test("ambiguous active frames fail with readiness evidence before installation", async (t) => {
  const f = await fixture(t);
  f.duplicateActive();
  await assert.rejects(f.builder.installProbe(), (error: unknown) => {
    assert.ok(error instanceof ConfigurationOperationError);
    assert.equal(error.diagnostic?.phase, "builder-readiness");
    return true;
  });
  assert.equal(f.installs(), 0);
  assert.equal(f.clicks(), 0);
});

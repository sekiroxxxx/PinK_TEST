import { test } from "node:test";
import assert from "node:assert/strict";
import { CaseForm, type CaseControl } from "./case-form.js";
import type { Builder } from "./builder.js";
import { ConfigurationOperationError } from "./configuration-context.js";

function observedDropdown(failure?: "candidate" | "cleanup") {
  let open = false,
    value = "portrait";
  const clicks: string[] = [];
  const trigger = {
    getAttribute: (name: string) =>
      name === "role"
        ? "combobox"
        : name === "aria-expanded"
          ? String(open)
          : name === "aria-controls"
            ? "list"
            : null,
  };
  const option = {
    textContent: "横屏",
    getClientRects: () => [{}],
    hasAttribute: () => false,
    getAttribute: (name: string) =>
      name === "data-pink-enum-value"
        ? '"landscapeRight"'
        : name === "aria-disabled" && failure
          ? "true"
          : null,
  };
  const document = {
    querySelector: () => trigger,
    querySelectorAll: () => (open ? [option] : []),
    getElementById: () => (open ? { getClientRects: () => [{}] } : null),
  };
  const builder = {
    caseDom: async (fn: (document: unknown, ...args: unknown[]) => unknown, ...args: unknown[]) =>
      fn(document, ...args),
    click: async (kind: string, label: string) => {
      clicks.push(`${kind}:${label}`);
      if (kind === "option") {
        value = "landscapeRight";
        open = false;
      } else {
        if (open && failure === "cleanup") throw new Error("trigger obstructed");
        open = !open;
      }
      return Date.now();
    },
  } as unknown as Builder;
  // Supply only external control observations; set(), DOM candidate matching and cleanup are real.
  class ObservedForm extends CaseForm {
    async read(): Promise<CaseControl> {
      return { kind: "enum", value, disabled: false, selector: "#orientation" };
    }
    async inspect() {
      return this.read();
    }
  }
  const form = new ObservedForm(
    builder,
    "wechatgame",
    new AbortController().signal,
    async () => {},
  );
  return { form, clicks, isOpen: () => open, value: () => value };
}

test("enum selects the actual raw value through its observed UI label", async () => {
  const f = observedDropdown();
  assert.equal(await f.form.set("packages.wechatgame.orientation", "landscapeRight"), true);
  assert.equal(f.value(), "landscapeRight");
  assert.deepEqual(f.clicks, ["case-control:#orientation", "option:横屏"]);
});

test("enum candidate failure closes its own popup without selecting or retrying", async () => {
  const f = observedDropdown("candidate");
  await assert.rejects(
    f.form.set("packages.wechatgame.orientation", "landscapeRight"),
    /候选已禁用/,
  );
  assert.equal(f.isOpen(), false);
  assert.equal(f.value(), "portrait");
  assert.deepEqual(f.clicks, ["case-control:#orientation", "case-control:#orientation"]);
});

test("failed popup cleanup stops with original input error and cleanup diagnosis", async () => {
  const f = observedDropdown("cleanup");
  await assert.rejects(
    f.form.set("packages.wechatgame.orientation", "landscapeRight"),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.disposition === "stop" &&
      error.cause instanceof Error &&
      error.cause.message.includes("候选已禁用") &&
      JSON.stringify(error.diagnostic).includes("trigger obstructed"),
  );
  assert.equal(f.value(), "portrait");
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readBuilderEntries,
  readBuilderHomeScope,
  uniqueBuilderEntries,
} from "./builder-entries.js";
import { resolvePlatformRoute, type DiscoveredBuilder } from "./builder-routing.js";
import { ConfigurationOperationError } from "./configuration-context.js";

test("registered Builder identities survive renamed and additional categories without a title map", () => {
  const tabs = [
    {
      label: "原生平台",
      classes: ["pink-activity-image", "pink-activity-builder-native-mask-ab123"],
    },
    {
      label: "新的分类",
      classes: ["pink-activity-image", "pink-activity-builder-qa-extra-color-cd456"],
    },
    { label: "资源", classes: ["pink-activity-image", "pink-activity-assets-mask-aa11"] },
  ].map(({ label, classes }) => ({
    getClientRects: () => [{}],
    getAttribute: () => label,
    querySelectorAll: () => [{ classList: classes }],
  }));
  const document = { querySelectorAll: () => tabs } as unknown as Document;
  assert.deepEqual(uniqueBuilderEntries(readBuilderEntries(document)), [
    { key: "pink-activity-builder-native", label: "原生平台" },
    { key: "pink-activity-builder-qa-extra", label: "新的分类" },
  ]);
  assert.throws(
    () => uniqueBuilderEntries([...readBuilderEntries(document), readBuilderEntries(document)[0]]),
    (error: unknown) =>
      error instanceof ConfigurationOperationError && error.disposition === "stop",
  );
});

const binding = (key: string, cards: Array<{ label: string; platform?: string }>) =>
  ({
    entry: { key, label: "任意显示名" },
    home: { ready: true, complete: true, cards },
  }) as DiscoveredBuilder;

test("a ready footer with an empty or not-yet-loaded embedded home cannot prove platform absence", () => {
  const cards: unknown[] = [];
  const child = {
    URL: "about:blank",
    readyState: "complete",
    defaultView: { getComputedStyle: () => ({ visibility: "visible" }) },
    querySelectorAll: (selector: string) => (selector === ".platform-card,.pk-card" ? cards : []),
  };
  const doc = {
    URL: "vscode-webview://builder/active.html",
    readyState: "complete",
    defaultView: {
      __pink__: { category: "native", categoryTitle: "终端" },
      getComputedStyle: () => ({ visibility: "visible" }),
    },
    querySelectorAll: (selector: string): unknown[] =>
      selector === "iframe" ? [frame] : selector === "button" ? [footer] : [],
  };
  const frame = { ownerDocument: doc, contentDocument: child, getClientRects: () => [{}] };
  const footer = { ownerDocument: doc, textContent: "查看构建记录", getClientRects: () => [{}] };
  assert.equal(readBuilderHomeScope(doc as unknown as Document).ready, false);
  child.URL = "vscode-webview://builder/home.html";
  const empty = readBuilderHomeScope(doc as unknown as Document);
  assert.equal(empty.complete, false);
  assert.equal(empty.reason, "awaiting-platform-cards");
  for (const label of ["OHOS", "NEXT", "AGC", "Android", "Web Desktop", "Web Mobile", "Windows"])
    cards.push({
      ownerDocument: child,
      getClientRects: () => [{}],
      getAttribute: () => null,
      querySelector: () => ({ textContent: label }),
    });
  const ready = readBuilderHomeScope(doc as unknown as Document);
  assert.equal(ready.ready, true);
  assert.equal(ready.complete, true);
  assert.equal(ready.cards.length, 7);
});

test("platform routes follow current cards, not persisted categories; ambiguity stops and absence is execution support", () => {
  const native = binding("builder-anywhere", [{ label: "Web Desktop", platform: "web-desktop" }]);
  const added = binding("builder-new", [{ label: "QA 新平台" }]);
  assert.equal(
    resolvePlatformRoute([added, native], { id: "web-desktop", label: "旧显示名" }).binding,
    native,
  );
  assert.equal(
    resolvePlatformRoute([added, native], { id: "qa-new", label: "QA 新平台" }).binding,
    added,
  );
  assert.throws(
    () => resolvePlatformRoute([added, added], { id: "qa-new", label: "QA 新平台" }),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.code === "context" &&
      error.disposition === "stop",
  );
  assert.throws(
    () => resolvePlatformRoute([native], { id: "qa-missing", label: "未安装平台" }),
    (error: unknown) =>
      error instanceof ConfigurationOperationError &&
      error.disposition === "blocked" &&
      error.diagnostic?.phase === "runtime-capability",
  );
  assert.throws(
    () =>
      resolvePlatformRoute(
        [binding("different-id", [{ label: "QA 新平台", platform: "another-platform" }])],
        { id: "qa-new", label: "QA 新平台" },
      ),
    ConfigurationOperationError,
  );
});

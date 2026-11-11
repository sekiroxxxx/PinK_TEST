import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Page } from "playwright-core";
import { readSuccessCard, readTaskBatch } from "./history-page.js";
import { Builder } from "./builder.js";
import { Cdp } from "./cdp.js";

const at = new Date(2026, 10, 5, 11, 22, 28).getTime();
const output = "qa_web_desktop_publish-001";
const platform = "web-desktop";
const platformTitle = "Web Desktop";

// Literal rendered labels from the reviewed package and QA screenshot, not generated expectations.
function batch(
  month: string,
  day: string,
  time: string,
  status: string,
  name = output,
  title = platformTitle,
) {
  const card = {
    querySelectorAll: (selector: string) =>
      selector === "img.pk-card-icon"
        ? [{ src: "vscode-webview://builder/baseline-assets/web-desktop-iconurl-4f248271.png" }]
        : selector === "span"
          ? [{ textContent: `${title} - ${name}` }]
          : [],
    querySelector: (selector: string) =>
      selector === ".pk-card-status" ? { innerText: status } : null,
  };
  const cards = [card];
  const section = {
    parentElement: {
      parentElement: { firstElementChild: { textContent: `${month} 1 Sessions 1 Records` } },
    },
    querySelectorAll: (selector: string) => (selector === ".pk-card-main" ? cards : []),
  };
  const header = {
    innerText: `Build ${day} ${time} 1 Targets`,
    getAttribute: () => "true",
    querySelectorAll: () =>
      ["Build", day, time, "1 Targets"].map((textContent) => ({ textContent })),
    closest: () => section,
  };
  return { header, cards };
}

async function adapter(t: TestContext, document: Document) {
  const cdp = {
    evaluate: async () => ({
      activeFrames: 1,
      pendingFrames: 0,
      readyState: "complete",
      uiReady: true,
    }),
    dom: async (fn: (doc: Document, ...args: never[]) => unknown, ...args: never[]) =>
      structuredClone(fn(document, ...args)),
    close: () => {},
  };
  const page = {
    getByRole: () => ({ getAttribute: async () => "true" }),
    locator: () => ({
      count: async () => 1,
      isVisible: async () => true,
      filter: () => ({ all: async () => [{ getAttribute: async () => "fixture" }] }),
    }),
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
  return builder;
}

function document(
  locale: string | undefined,
  batches: ReturnType<typeof batch>[],
  navigatorLanguage = "zh-CN",
) {
  return {
    defaultView: { __pink__: { locale }, navigator: { language: navigatorLanguage } },
    querySelectorAll: (selector: string) =>
      selector === "button.pk-batch-header"
        ? batches.map((b) => b.header)
        : selector === ".pk-card-main"
          ? batches.flatMap((b) => b.cards)
          : [],
  } as unknown as Document;
}

test("English batch dates follow Builder locale and its Nov. punctuation, independent of OS language", () => {
  const old = batch("2025.11", "Nov. 5", "11:22:28", "Success");
  const latest = batch("2026.11", "Nov. 5", "11:22:28", "Success");
  const doc = document("en", [old, latest]);
  const found = readTaskBatch(doc, at);
  assert.deepEqual(found, { label: "Build Nov. 5 11:22:28 1 Targets", expanded: true });
  // Identical header text across months remains ambiguous for the later card check.
  assert.throws(
    () => readSuccessCard(doc, output, platformTitle, found!.label),
    /批次无法唯一对应/,
  );
  assert.deepEqual(readSuccessCard(document("en", [latest]), output, platformTitle, found!.label), {
    matches: 1,
    status: "Success",
  });
});

test("Chinese batch and success labels retain exact platform/output identity", () => {
  const latest = batch("2026.11", "11月5日", "11:22:28", "成功");
  const doc = document("zh-cn", [latest], "en-US");
  const found = readTaskBatch(doc, at);
  assert.deepEqual(found, { label: "Build 11月5日 11:22:28 1 Targets", expanded: true });
  assert.deepEqual(readSuccessCard(doc, output, platformTitle, found!.label), {
    matches: 1,
    status: "成功",
  });
  assert.deepEqual(readSuccessCard(doc, "other-output", platformTitle, found!.label), {
    matches: 0,
    status: undefined,
  });
  assert.deepEqual(readSuccessCard(doc, output, "Web Mobile", found!.label), {
    matches: 0,
    status: undefined,
  });
});

test("navigator locale fallback and a different batch do not select the older successful card", () => {
  const old = batch("2026.11", "Nov. 5", "11:21:28", "Success");
  const latest = batch("2026.11", "Nov. 5", "11:22:28", "Failed");
  const doc = document(undefined, [old, latest], "en-US");
  const found = readTaskBatch(doc, at);
  assert.equal(found?.label, latest.header.innerText);
  assert.deepEqual(readSuccessCard(doc, output, platformTitle, found!.label), {
    matches: 1,
    status: "Failed",
  });
  const generated = batch("2026.11", "Nov. 5", "11:22:28", "Generated");
  assert.deepEqual(
    readSuccessCard(document("en", [generated]), output, platformTitle, generated.header.innerText),
    { matches: 1, status: "Generated" },
  );
});

test("ambiguous batch times and duplicate matching cards stop instead of accepting any success", () => {
  const first = batch("2026.11", "Nov. 5", "11:22:28", "Success");
  const second = batch("2026.11", "Nov. 5", "11:22:28", "Success");
  assert.throws(() => readTaskBatch(document("en", [first, second]), at), /批次时间存在歧义/);
  first.cards.push(first.cards[0]);
  assert.throws(
    () => readSuccessCard(document("en", [first]), output, platformTitle, first.header.innerText),
    /同名任务卡片/,
  );
  assert.equal(
    readTaskBatch(document("en", [batch("2026.11", "Nov. 4", "11:22:28", "Success")]), at),
    undefined,
  );
});

test("actual card adapter uses the verified platform title, not the icon URL, and retains mismatch evidence", async (t) => {
  for (const [locale, title, success] of [
    ["en", "Web Desktop", "Success"],
    ["zh-cn", "Web 桌面端", "成功"],
  ])
    await t.test(locale, async (t) => {
      const latest = batch("2026.11", "Nov. 5", "11:22:28", success, output, title);
      const builder = await adapter(t, document(locale, [latest]));
      await assert.rejects(builder.successText(output, platform), /缺少本轮已核对的平台身份/);
      builder.bindHistoryPlatformTitle(platform, title);
      assert.equal(await builder.successText(output, platform), success);
      await assert.rejects(builder.successText(output, "web-mobile"), /缺少本轮已核对的平台身份/);
      assert.equal(await builder.successText("other-output", platform), undefined);
      assert.equal(builder.historyCardEvidence()?.matches, 0);
      latest.cards[0].querySelector = () => ({ innerText: "Generated" });
      assert.equal(await builder.successText(output, platform), undefined);
      assert.equal(builder.historyCardEvidence()?.status, "Generated");
    });
});

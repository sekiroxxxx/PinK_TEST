import type { Page } from "playwright-core";
import { ConfigurationOperationError } from "./configuration-context.js";
import { waitFor } from "./common.js";

export interface BuilderEntry {
  /** The registered activity-container identity, independent of its localized title. */
  key: string;
  label: string;
}

/** Reads the existing activity-container icon identity emitted by the workbench. */
export function readBuilderEntries(document: Document = globalThis.document): BuilderEntry[] {
  const entries: BuilderEntry[] = [];
  for (const tab of document.querySelectorAll<HTMLElement>('[role="tab"]')) {
    if (!tab.getClientRects().length) continue;
    const keys = new Set<string>();
    for (const icon of tab.querySelectorAll<HTMLElement>(".pink-activity-image"))
      for (const name of icon.classList) {
        const match = /^(pink-activity-builder-[\w-]+)-(?:mask|color)-[\da-f]+$/i.exec(name);
        if (match) keys.add(match[1]);
      }
    if (keys.size !== 1) continue;
    entries.push({ key: [...keys][0], label: tab.getAttribute("aria-label") ?? "" });
  }
  return entries;
}

export function uniqueBuilderEntries(entries: BuilderEntry[]): BuilderEntry[] {
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
    throw new ConfigurationOperationError("context", "构建入口标识不唯一，停止导航", "stop", {
      diagnostic: { phase: "entry-discovery", observations: { entries } },
    });
  return entries;
}

export function builderEntryTab(page: Page, entry: BuilderEntry) {
  if (!/^pink-activity-builder-[\w-]+$/.test(entry.key))
    throw new Error("无效的运行时构建入口标识");
  return page.locator('[role="tab"]').filter({
    has: page.locator(
      `.pink-activity-image[class*="${entry.key}-mask-"],.pink-activity-image[class*="${entry.key}-color-"]`,
    ),
  });
}

export async function activateBuilderEntry(page: Page, entry: BuilderEntry, signal: AbortSignal) {
  const tab = builderEntryTab(page, entry);
  if ((await tab.count()) !== 1)
    throw new ConfigurationOperationError("context", "已发现的构建入口失效或不唯一", "stop", {
      diagnostic: { phase: "entry-discovery", observations: { entry } },
    });
  if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click({ timeout: 15_000 });
  await waitFor(
    "已识别的构建入口激活",
    async () => ((await tab.getAttribute("aria-expanded")) === "true" ? true : undefined),
    15_000,
    signal,
  );
}

/** The footer mounts before the embedded home receives its platform list. */
export function readBuilderHomeScope(document: Document) {
  const docs: Document[] = [];
  let inaccessible = false;
  const visible = (node: Element) =>
    (node as HTMLElement).getClientRects().length > 0 &&
    node.ownerDocument.defaultView!.getComputedStyle(node).visibility !== "hidden";
  const visit = (doc: Document) => {
    if (docs.includes(doc)) return;
    docs.push(doc);
    for (const frame of doc.querySelectorAll<HTMLIFrameElement>("iframe")) {
      if (!visible(frame)) continue;
      let child: Document | null = null;
      try {
        child = frame.contentDocument;
      } catch {
        /* Keep the incomplete scope observable. */
      }
      if (child) visit(child);
      else inaccessible = true;
    }
  };
  visit(document);
  const injected = (
    document.defaultView as Window & {
      __pink__?: { category?: unknown; categoryTitle?: unknown };
    }
  ).__pink__;
  const cards = docs.flatMap((doc) =>
    [...doc.querySelectorAll<HTMLElement>(".platform-card,.pk-card")]
      .filter(visible)
      .map((card) => ({
        label: card.querySelector(".platform-card-title,.pk-card-foot")?.textContent?.trim() ?? "",
        platform:
          card.getAttribute("data-platform-id") ?? card.getAttribute("data-platform") ?? undefined,
      })),
  );
  const framesReady = docs.every(
    (doc) => doc.readyState === "complete" && doc.URL !== "about:blank",
  );
  const complete = !inaccessible && framesReady && cards.length > 0;
  const buttons = docs.flatMap((doc) => [...doc.querySelectorAll<HTMLButtonElement>("button")]);
  return {
    categoryId: typeof injected?.category === "string" ? injected.category : undefined,
    categoryTitle: typeof injected?.categoryTitle === "string" ? injected.categoryTitle : undefined,
    complete,
    ready:
      complete &&
      buttons.some(
        (button) =>
          visible(button) &&
          ["查看构建记录", "View build history"].includes(button.textContent?.trim() ?? ""),
      ) &&
      !docs.some((doc) =>
        [...doc.querySelectorAll('[aria-busy="true"],[data-loading="true"]')].some(visible),
      ),
    reason: inaccessible
      ? "inaccessible-frame"
      : !framesReady
        ? "loading-frame"
        : !cards.length
          ? "awaiting-platform-cards"
          : undefined,
    cards,
  };
}

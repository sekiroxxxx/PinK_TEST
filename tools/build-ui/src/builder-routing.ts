import type { Page } from "playwright-core";
import { Builder } from "./builder.js";
import { readForm } from "./configuration-page.js";
import { waitFor } from "./common.js";
import { ConfigurationOperationError, type ExecutionContext } from "./configuration-context.js";
import { builderUiLabels } from "./builder-ui-labels.js";
import {
  activateBuilderEntry,
  readBuilderEntries,
  uniqueBuilderEntries,
  type BuilderEntry,
} from "./builder-entries.js";

export interface PlatformIdentity {
  id: string;
  label: string;
  configurationTitle?: string;
}
export interface DiscoveredBuilder {
  entry: BuilderEntry;
  builder: Builder;
  home: Awaited<ReturnType<Builder["discoverHome"]>>;
}

/** Card names are existing case locators, not a version-to-category map. */
export function resolvePlatformRoute(entries: DiscoveredBuilder[], platform: PlatformIdentity) {
  const labels = new Set([
    ...builderUiLabels("platform", platform.label),
    ...(platform.configurationTitle ? [platform.configurationTitle] : []),
  ]);
  const matches = entries.flatMap((binding) =>
    binding.home.cards
      .filter((card) => (card.platform ? card.platform === platform.id : labels.has(card.label)))
      .map((card) => ({ binding, card })),
  );
  if (matches.length > 1)
    throw new ConfigurationOperationError(
      "context",
      `平台 ${platform.id} 对应多个构建卡片，停止导航`,
      "stop",
      {
        diagnostic: {
          phase: "entry-discovery",
          observations: {
            platform: platform.id,
            entries: matches.map(({ binding, card }) => ({
              entry: binding.entry,
              label: card.label,
            })),
          },
        },
      },
    );
  if (!matches.length)
    throw new ConfigurationOperationError(
      "precondition",
      `执行能力不足：当前构建入口没有唯一可识别的平台卡片 ${platform.id}`,
      "blocked",
      {
        diagnostic: {
          phase: "runtime-capability",
          observations: {
            kind: "execution-support",
            platform: platform.id,
            entries: entries.map(({ entry, home }) => ({
              entry,
              complete: home.complete,
              cards: home.cards,
            })),
          },
        },
      },
    );
  return matches[0];
}

export async function discoverBuilderRoutes(
  page: Page,
  endpoint: string,
  session: ExecutionContext,
  signal: AbortSignal,
  timeoutMs: number,
  register: (binding: DiscoveredBuilder) => Promise<void>,
  cleanupSignal: AbortSignal = signal,
) {
  let observedTabs: Array<{ label: string | null }> = [];
  let entries: BuilderEntry[];
  try {
    entries = await waitFor(
      "当前实例的构建入口标识",
      async () => {
        await session.verify();
        const found = uniqueBuilderEntries(await page.evaluate(readBuilderEntries, undefined));
        if (found.length) return found;
        observedTabs = await page
          .getByRole("tab")
          .evaluateAll((tabs) => tabs.map((tab) => ({ label: tab.getAttribute("aria-label") })));
        return undefined;
      },
      60_000,
      signal,
    );
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new ConfigurationOperationError(
      "context",
      "执行能力不足：未发现可唯一识别的 Builder 活动入口",
      "stop",
      {
        cause,
        diagnostic: {
          phase: "entry-discovery",
          observations: { kind: "execution-support", observedTabs },
        },
      },
    );
  }
  const bindings: DiscoveredBuilder[] = [];
  for (const entry of entries) {
    await session.verify();
    const builder = await Builder.open(
      page,
      endpoint,
      signal,
      entry,
      timeoutMs,
      true,
      cleanupSignal,
    );
    const binding: DiscoveredBuilder = {
      entry,
      builder,
      home: {
        categoryId: undefined,
        categoryTitle: undefined,
        complete: false,
        ready: false,
        reason: "awaiting-platform-cards",
        cards: [],
      },
    };
    // Own the connection immediately, including when a later readiness check fails.
    bindings.push(binding);
    await register(binding);
    if ((await builder.caseDom(readForm)).state !== "awaiting-dialog")
      throw new ConfigurationOperationError(
        "context",
        "构建入口中存在未归属配置页，保留原页面",
        "stop",
        {
          diagnostic: { phase: "entry-discovery", observations: { entry } },
        },
      );
    await builder.home(() => session.verify());
    let previous = "";
    try {
      binding.home = await waitFor(
        "当前构建入口的平台首页",
        async () => {
          const home = await builder.discoverHome();
          binding.home = home;
          const state = JSON.stringify(home);
          if (state !== previous) {
            previous = state;
            await register(binding);
          }
          return home.ready ? home : undefined;
        },
        Math.min(timeoutMs, 60_000),
        signal,
      );
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw new ConfigurationOperationError(
        "precondition",
        "构建首页的平台列表尚未完整就绪，未判定平台缺失",
        "blocked",
        {
          cause,
          diagnostic: {
            phase: "entry-readiness",
            observations: { kind: "runtime-readiness", entry, home: binding.home },
          },
        },
      );
    }
    await register(binding);
  }
  return {
    bindings,
    activate: async (binding: DiscoveredBuilder) => {
      await session.verify();
      await activateBuilderEntry(page, binding.entry, cleanupSignal);
    },
  };
}

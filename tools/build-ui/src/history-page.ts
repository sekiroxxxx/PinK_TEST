export interface HistoryCard {
  title: string;
  platform: string;
  status: string;
  statusIcon: string;
  error: string;
  visible: boolean;
}

export interface HistoryBatch {
  label: string;
  expanded: boolean;
  counts: string[];
  cards: HistoryCard[];
}

export interface HistoryMonth {
  label: string;
  counts: string[];
  batches: HistoryBatch[];
}

export interface HistoryView {
  search: string;
  filter: string;
  filterExpanded: boolean;
  menuOptions: string[];
  emptyText?: string;
  months: HistoryMonth[];
}

/** Match the timestamp's rendered batch using the locale injected by the actual Builder. */
export function readTaskBatch(document: Document, at: number) {
  const window = document.defaultView as Window & { __pink__?: { locale?: string } };
  const locale = window.__pink__?.locale || (window.navigator.language || "en").toLowerCase();
  const date = new Date(at);
  const month = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  // BuildResult uses en-US abbreviated months with a period for its English date labels.
  const day = locale.startsWith("en")
    ? date
        .toLocaleDateString("en-US", { month: "short", day: "numeric" })
        .replace(/^([A-Za-z]{3})\s/, "$1. ")
    : date.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  const matches = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button.pk-batch-header"),
  ).filter((button) => {
    const monthHeader = button.closest('[data-slot="collapsible-section"]')?.parentElement
      ?.parentElement?.firstElementChild;
    const labels = Array.from(button.querySelectorAll("span")).map((span) =>
      span.textContent?.trim(),
    );
    return (
      monthHeader?.textContent?.trim().startsWith(month) &&
      labels.includes(day) &&
      labels.includes(time)
    );
  });
  if (matches.length > 1) throw new Error("本次记录批次时间存在歧义，停止 UI 复核");
  const button = matches[0];
  return button
    ? { label: button.innerText.trim(), expanded: button.getAttribute("aria-expanded") === "true" }
    : undefined;
}

/** Exact batch/platform/output identity remains independent of the translated success label. */
export function readSuccessCard(
  document: Document,
  outputName: string,
  platformTitle: string,
  batchLabel: string | undefined,
) {
  let scope: ParentNode = document;
  if (batchLabel) {
    const headers = [
      ...document.querySelectorAll<HTMLButtonElement>("button.pk-batch-header"),
    ].filter((header) => header.innerText.trim() === batchLabel);
    if (headers.length !== 1) throw new Error("本次成功卡片的批次无法唯一对应");
    scope = headers[0].closest('[data-slot="collapsible-section"]')!;
  }
  const cards = Array.from(scope.querySelectorAll<HTMLElement>(".pk-card-main")).filter((card) =>
    Array.from(card.querySelectorAll("span")).some(
      (span) => span.textContent?.trim() === `${platformTitle} - ${outputName}`,
    ),
  );
  if (cards.length > 1) throw new Error("结果页存在同名任务卡片，无法唯一复核");
  const status = cards[0]?.querySelector<HTMLElement>(".pk-card-status")?.innerText.trim();
  return { matches: cards.length, status };
}

/** Read rendered UI only. No React state, product commands or task writes. */
export function readHistory(document: Document): HistoryView {
  const list = document.querySelector<HTMLElement>(".pk-build-inner");
  if (!list) throw new Error("历史列表尚未就绪");
  const search = document.querySelector<HTMLInputElement>("input[placeholder]");
  const filters = document.querySelectorAll<HTMLButtonElement>(
    'button[data-slot="dropdown-menu-trigger"]:not([aria-label])',
  );
  if (!search || filters.length !== 1) throw new Error("历史搜索或筛选控件不唯一");
  const visible = (element: HTMLElement) =>
    element.getClientRects().length > 0 &&
    document.defaultView!.getComputedStyle(element).visibility === "visible";
  const text = (element: Element | null | undefined) => element?.textContent?.trim() ?? "";
  return {
    search: search.value,
    filter: text(filters[0]),
    filterExpanded: filters[0].getAttribute("aria-expanded") === "true",
    menuOptions: Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      .filter(visible)
      .map(text),
    emptyText: list.querySelector("button.pk-batch-header") ? undefined : text(list),
    months: Array.from(list.children)
      .filter((month) => month.querySelector("button.pk-batch-header"))
      .map((month) => ({
        label: text(month.firstElementChild?.children[0]),
        counts: Array.from(month.firstElementChild?.children ?? [])
          .slice(1)
          .map(text),
        batches: Array.from(
          month.querySelectorAll<HTMLButtonElement>("button.pk-batch-header"),
        ).map((header) => {
          const section = header.closest('[data-slot="collapsible-section"]')!;
          return {
            label: header.innerText.trim(),
            expanded: header.getAttribute("aria-expanded") === "true",
            counts: Array.from(header.querySelectorAll("span"))
              .filter((element) => element.children.length === 0)
              .map(text)
              .filter((value) => /^\d+\s*(个目标|成功|失败|构建中)$/.test(value)),
            cards: Array.from(section.querySelectorAll<HTMLElement>(".pk-hist-card")).map(
              (card) => {
                const icon = card.querySelector<HTMLImageElement>("img.pk-card-icon");
                const status = card.querySelector<HTMLElement>(".pk-card-status");
                const title = card.querySelector(".pk-card-left-main-row > div > div > span");
                return {
                  title: text(title),
                  platform: icon?.src.match(/\/platforms\/([^/]+)\//)?.[1] ?? "",
                  status: text(status),
                  statusIcon: status?.querySelector("i")?.className ?? "",
                  error: text(card.querySelector(".pk-card-error")),
                  visible: visible(card),
                };
              },
            ),
          };
        }),
      })),
  };
}

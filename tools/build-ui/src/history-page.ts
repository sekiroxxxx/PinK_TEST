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

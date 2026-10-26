import { isDeepStrictEqual } from "node:util";
import type { Builder } from "./builder.js";
import { waitFor } from "./common.js";
import type { StageView } from "./configuration-stages.js";
import { ConfigurationOperationError } from "./configuration-context.js";

/** Read only the StageButtons subtree of the verified modal, never a history card. */
export function readStageUi(document: Document): StageView {
  const modal = document.querySelector('button[aria-label="Close"]')?.parentElement?.parentElement;
  if (!modal?.getClientRects().length) throw new Error("阶段区缺少配置页身份");
  const visible = (e: Element) =>
    !!e.getClientRects().length &&
    document.defaultView!.getComputedStyle(e).visibility !== "hidden";
  const labels: Record<string, string> = {
    构建: "build",
    Build: "build",
    build: "build",
    生成: "make",
    Make: "make",
    make: "make",
    运行: "run",
    Run: "run",
    run: "run",
    发布: "publish",
    Publish: "publish",
    publish: "publish",
    上传: "upload",
    Upload: "upload",
    upload: "upload",
  };
  const primaries = [...modal.querySelectorAll<HTMLButtonElement>("button.pk-btn--primary")].filter(
    (b) =>
      visible(b) && labels[b.querySelector(":scope > span")?.textContent?.trim() ?? ""] === "build",
  );
  if (primaries.length !== 1) throw new Error("主构建阶段无法唯一识别");
  const root = primaries[0].parentElement!;
  const selector = (element: Element) => {
    const path: string[] = [];
    for (let e: Element | null = element; e && e !== document.documentElement; e = e.parentElement)
      path.unshift(
        `${e.tagName.toLowerCase()}:nth-child(${[...e.parentElement!.children].indexOf(e) + 1})`,
      );
    return "html > " + path.join(" > ");
  };
  const disabled = (e: Element) =>
    e.hasAttribute("disabled") ||
    e.getAttribute("aria-disabled") === "true" ||
    e.hasAttribute("data-disabled");
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("button.pk-btn")].filter(visible);
  const groups = buttons.map((button) =>
    [...button.querySelectorAll(":scope > span:not([role])")].map((span) => {
      const id = labels[span.textContent?.trim() ?? ""];
      if (!id) throw new Error("出现未适配的阶段文案，停止操作");
      return id;
    }),
  );
  if (groups[0]?.[0] !== "build" || groups.some((g) => !g.length))
    throw new Error("阶段组结构不符合当前适配");
  const ids = groups.flat();
  if (new Set(ids).size !== ids.length) throw new Error("可见阶段重复");
  // Visual groups can absorb children; retain declared stage order independently of grouping.
  const visibleIds = ["build", "make", "run", "upload", "publish"].filter((id) => ids.includes(id));
  const links = [...root.querySelectorAll(".codicon-link")].filter(visible).map((icon, i) => {
    const control = icon.closest('button,[role="button"]');
    if (!control || !groups[i + 1]) throw new Error("连接入口无法对应相邻阶段组");
    return {
      previous: groups[i][0],
      stage: groups[i + 1][0],
      disabled: disabled(control),
      selector: selector(control),
    };
  });
  if (links.length !== groups.length - 1) throw new Error("连接入口数与阶段组不匹配");
  const unlinks = buttons.flatMap((button, i) => {
    const controls = [...button.querySelectorAll('[role="button"][tabindex]')];
    if (controls.length !== groups[i].length - 1) throw new Error("拆分入口数与阶段组不匹配");
    return controls.map((control, j) => ({
      group: groups[i][0],
      stage: groups[i][j + 1],
      selector: selector(control),
    }));
  });
  return {
    groups,
    visible: visibleIds,
    buttons: buttons.map((b, i) => ({
      stage: groups[i][0],
      label: b.innerText.trim(),
      disabled: disabled(b),
      selector: selector(b),
    })),
    links,
    unlinks,
  };
}

export async function changeStageUi(
  builder: Builder,
  signal: AbortSignal,
  verify: (() => Promise<void>) | undefined,
  kind: "link" | "unlink",
  anchor: string,
  stage: string,
  before: StageView,
) {
  const target =
    kind === "link"
      ? before.links.find((l) => l.previous === anchor && l.stage === stage)
      : before.unlinks.find((l) => l.group === anchor && l.stage === stage);
  if (!target)
    throw new ConfigurationOperationError("precondition", "阶段操作目标不存在", "blocked");
  // Settle hover before hit testing: tooltip arrows may cover a control center.
  // The final point must still hit this exact control; no click is retried.
  await builder.caseHover(target.selector, verify);
  await builder.caseDom(async (document) => {
    await new Promise<void>((resolve) =>
      document.defaultView!.requestAnimationFrame(() =>
        document.defaultView!.requestAnimationFrame(() => resolve()),
      ),
    );
  });
  await builder.click(
    "case-control",
    target.selector,
    undefined,
    undefined,
    async () => {
      await verify?.();
      if (!isDeepStrictEqual(await builder.caseDom(readStageUi), before))
        throw new ConfigurationOperationError("snapshot", "点击前阶段区已改变", "stop");
    },
    true,
  );
  let last = "",
    since = Date.now();
  await waitFor(
    "阶段 UI 转换与保存稳定",
    async () => {
      await verify?.();
      const current = await builder.caseDom(readStageUi),
        serialized = JSON.stringify(current.groups);
      if (isDeepStrictEqual(current.groups, before.groups)) return;
      if (last !== serialized) {
        last = serialized;
        since = Date.now();
        return;
      }
      return Date.now() - since >= 600 ? true : undefined;
    },
    10000,
    signal,
  );
}

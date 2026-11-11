import { isDeepStrictEqual } from "node:util";
import { ConfigurationOperationError } from "./configuration-context.js";

export interface BuilderTarget {
  kind: "builder";
  representativePlatform: string;
}
export const legacyBuilderRepresentatives: Readonly<Record<string, string>> = Object.freeze({
  "X-Device": "web-desktop",
  "X-Application": "wechatgame",
});

/** Legacy categories are input migration rules, never runtime navigation labels. */
export function normalizeBuilderTarget(value: unknown): BuilderTarget {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("公共目标需要明确的代表平台");
  const target = value as Record<string, unknown>;
  if (
    target.kind !== "builder" ||
    Object.keys(target).some(
      (key) => !["kind", "representativePlatform", "category"].includes(key),
    ) ||
    Object.hasOwn(target, "representativePlatform") === Object.hasOwn(target, "category")
  )
    throw new Error("公共目标须只声明 representativePlatform，或使用旧 category 兼容输入");
  const platform = Object.hasOwn(target, "representativePlatform")
    ? target.representativePlatform
    : typeof target.category === "string" &&
        Object.hasOwn(legacyBuilderRepresentatives, target.category)
      ? legacyBuilderRepresentatives[target.category]
      : undefined;
  if (
    typeof platform !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(platform) ||
    ["constructor", "prototype"].includes(platform)
  )
    throw new Error("公共目标代表平台无效；未知旧分类须显式改为 representativePlatform");
  return { kind: "builder", representativePlatform: platform };
}
export type BuilderButton = "history" | "build-all";
export interface BuilderHomeObservation {
  representativePlatform: string;
  entryKey: string;
  ready: boolean;
  view: "home";
  buttons: Record<
    BuilderButton,
    { visible: boolean; disabled: boolean | null; matchCount: number }
  >;
}
export interface BuilderHomeExpected {
  ready?: boolean;
  buttons?: Partial<Record<BuilderButton, { visible?: boolean; disabled?: boolean }>>;
}
export interface BuilderUiPort {
  open(target: BuilderTarget): Promise<void>;
  read(target: BuilderTarget): Promise<BuilderHomeObservation>;
  home(target: BuilderTarget): Promise<void>;
}

/** Only the two declared home controls; no arbitrary selectors, text or button clicks. */
export function readBuilderHome(
  document: Document,
): Omit<BuilderHomeObservation, "representativePlatform" | "entryKey"> {
  const visible = (element: Element) =>
    (element as HTMLElement).getClientRects().length > 0 &&
    element.ownerDocument.defaultView!.getComputedStyle(element).visibility !== "hidden";
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const inspect = (labels: string[]) => {
    const matches = buttons.filter(
      (button) => visible(button) && labels.includes(button.textContent?.trim() ?? ""),
    );
    return {
      visible: matches.length > 0,
      disabled:
        matches.length === 1
          ? matches[0].disabled || matches[0].getAttribute("aria-disabled") === "true"
          : null,
      matchCount: matches.length,
    };
  };
  const history = inspect(["查看构建记录", "View build history"]);
  const buildAll = inspect(["全部构建", "Build All", "Build all"]);
  return {
    view: "home",
    ready:
      history.matchCount === 1 &&
      ![...document.querySelectorAll('button[aria-label="Close"]')].some(visible) &&
      ![...document.querySelectorAll('[aria-busy="true"],[data-loading="true"]')].some(visible),
    buttons: { history, "build-all": buildAll },
  };
}

export function assertBuilderHome(
  observed: BuilderHomeObservation,
  current: BuilderHomeObservation,
  expected: BuilderHomeExpected,
) {
  if (!isDeepStrictEqual(observed, current))
    throw new ConfigurationOperationError("snapshot", "公共构建页面观察已变化，请重新回读", "stop");
  if (!current.ready || Object.values(current.buttons).some((button) => button.matchCount > 1))
    throw new ConfigurationOperationError(
      "precondition",
      "公共构建页面未就绪或目标不唯一",
      "blocked",
    );
  const matches =
    (expected.ready === undefined || current.ready === expected.ready) &&
    Object.entries(expected.buttons ?? {}).every(([key, value]) => {
      const actual = current.buttons[key as BuilderButton];
      return (
        (value.visible === undefined || actual.visible === value.visible) &&
        (value.disabled === undefined || actual.disabled === value.disabled)
      );
    });
  if (!matches)
    throw new ConfigurationOperationError(
      "assertion",
      "公共构建页面状态不符合结构化预期",
      "failed",
    );
  return { matched: true, observation: current };
}

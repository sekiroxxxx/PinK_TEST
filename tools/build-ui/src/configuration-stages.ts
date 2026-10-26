import { isDeepStrictEqual } from "node:util";
import { ConfigurationOperationError, type ConfigurationContext } from "./configuration-context.js";

export interface StageView {
  groups: string[][];
  visible: string[];
  buttons: Array<{ stage: string; label: string; disabled: boolean; selector?: string }>;
  links: Array<{ previous: string; stage: string; disabled: boolean; selector: string }>;
  unlinks: Array<{ group: string; stage: string; selector: string }>;
}
export interface StagePort {
  readStages(): Promise<StageView>;
  changeStage(
    kind: "link" | "unlink",
    anchor: string,
    stage: string,
    before: StageView,
  ): Promise<void>;
  stageHint?(control: "button" | "link" | "unlink", stage: string): Promise<string>;
}
export interface StageRecord {
  session: ConfigurationContext["session"];
  platform: string;
  view: StageView;
  expectedGroups: string[][];
  pendingGroups?: string[][];
}
export interface StageSnapshot {
  context: ConfigurationContext;
  revision: number;
  view: StageView;
}
export interface StageExpected {
  groups: string[][];
  visible?: string[];
  disabled?: Record<string, boolean>;
  linkDisabled?: Record<string, boolean>;
}

export function assertBuildOnly(view: StageView): void {
  const primary = view.groups.find((g) => g[0] === "build");
  if (!primary || primary.length !== 1)
    throw new ConfigurationOperationError(
      "precondition",
      `仅构建用例不能提交显式串联：${primary?.join(" → ") ?? "无法确认构建阶段"}；请通过声明的 UI 操作准备初态`,
      "blocked",
    );
}

/** Uses the same configuration lifetime/revision; records survive verified reopenings only. */
export class ConfigurationStages {
  private taskGuard?: () => void;
  constructor(
    private readonly context: () => ConfigurationContext,
    private readonly port: Partial<StagePort>,
    private readonly mutate: (action: () => Promise<void>) => Promise<void>,
  ) {}

  bindTaskGuard(guard: () => void) {
    this.taskGuard = guard;
  }

  async read(): Promise<StageSnapshot> {
    const context = this.context();
    await context.verify();
    this.taskGuard?.();
    if (!this.port.readStages)
      throw new ConfigurationOperationError("precondition", "缺少阶段 UI 观察适配", "blocked");
    const revision = context.revision;
    const view = await this.port.readStages();
    await context.verify();
    this.taskGuard?.();
    if (revision !== context.revision)
      throw new ConfigurationOperationError("snapshot", "阶段读取期间配置已改变", "stop");
    return { context, revision, view };
  }

  async record(): Promise<StageRecord> {
    const { context, view } = await this.read();
    return {
      session: context.session,
      platform: context.platform,
      view,
      expectedGroups: structuredClone(view.groups),
    };
  }

  async hint(control: "button" | "link" | "unlink", stage: string, contains: string) {
    const before = await this.read();
    if (!this.port.stageHint)
      throw new ConfigurationOperationError("precondition", "缺少阶段提示观察适配", "blocked");
    const text = await this.port.stageHint(control, stage);
    const after = await this.read();
    if (
      before.context !== after.context ||
      before.revision !== after.revision ||
      !isDeepStrictEqual(before.view, after.view)
    )
      throw new ConfigurationOperationError("snapshot", "提示观察期间阶段区已改变", "stop");
    if (!text.includes(contains))
      throw new ConfigurationOperationError("assertion", "阶段提示不符合预期", "failed");
    return { control, stage, text };
  }

  private async owns(record: StageRecord) {
    const context = this.context();
    await context.verify();
    if (record.session !== context.session || record.platform !== context.platform)
      throw new ConfigurationOperationError("context", "阶段记录不属于当前会话和平台", "stop");
    const current = await this.read();
    if (!isDeepStrictEqual(current.view.visible, record.view.visible))
      throw new ConfigurationOperationError(
        "context",
        "可见阶段清单已改变，不能安全恢复或修改",
        "stop",
      );
    if (
      !isDeepStrictEqual(current.view.groups, record.expectedGroups) &&
      !isDeepStrictEqual(current.view.groups, record.pendingGroups)
    )
      throw new ConfigurationOperationError(
        "context",
        "串联已被本例之外的操作改变，停止覆盖或恢复",
        "stop",
      );
    return current;
  }

  async change(record: StageRecord, kind: "link" | "unlink", anchor: string, stage: string) {
    const before = await this.owns(record);
    if (!this.port.changeStage)
      throw new ConfigurationOperationError("precondition", "缺少阶段连接/拆分适配", "blocked");
    const groups = structuredClone(before.view.groups);
    if (kind === "link") {
      const index = groups.findIndex((g) => g[0] === stage);
      if (index < 1 || groups[index - 1][0] !== anchor)
        throw new ConfigurationOperationError(
          "precondition",
          "连接需要相邻独立阶段组的精确初态",
          "blocked",
        );
      const link = before.view.links.find((l) => l.previous === anchor && l.stage === stage);
      if (!link || link.disabled)
        throw new ConfigurationOperationError(
          "precondition",
          "目标连接控件不存在或已禁用",
          "blocked",
        );
      groups[index - 1].push(...groups[index]);
      groups.splice(index, 1);
    } else {
      const index = groups.findIndex((g) => g[0] === anchor);
      const split = index < 0 ? -1 : groups[index].indexOf(stage);
      if (split < 1)
        throw new ConfigurationOperationError(
          "precondition",
          "拆分需要目标位于所声明的阶段组中",
          "blocked",
        );
      if (before.view.buttons.find((b) => b.stage === anchor)?.disabled)
        throw new ConfigurationOperationError(
          "precondition",
          "拆分控件位于禁用阶段按钮内，不能安全点击；需先通过声明的连接操作接入可用组",
          "blocked",
        );
      const tail = groups[index].splice(split);
      groups.splice(index + 1, 0, tail);
    }
    record.pendingGroups = groups;
    await this.mutate(() => this.port.changeStage!(kind, anchor, stage, before.view));
    const after = await this.read();
    if (!isDeepStrictEqual(after.view.groups, groups))
      throw new ConfigurationOperationError("assertion", "阶段转换结果与指定顺序不符", "failed");
    record.expectedGroups = structuredClone(groups);
    record.pendingGroups = undefined;
    return after.view;
  }

  async assert(snapshot: StageSnapshot, expected: StageExpected) {
    const current = await this.read();
    if (
      snapshot.context !== current.context ||
      snapshot.revision !== current.revision ||
      !isDeepStrictEqual(snapshot.view, current.view)
    )
      throw new ConfigurationOperationError(
        "snapshot",
        "阶段快照已过期，请在当前页重新回读",
        "stop",
      );
    const checks = [isDeepStrictEqual(current.view.groups, expected.groups)];
    if (expected.visible) checks.push(isDeepStrictEqual(current.view.visible, expected.visible));
    for (const [stage, disabled] of Object.entries(expected.disabled ?? {}))
      checks.push(current.view.buttons.find((b) => b.stage === stage)?.disabled === disabled);
    for (const [stage, disabled] of Object.entries(expected.linkDisabled ?? {}))
      checks.push(current.view.links.find((l) => l.stage === stage)?.disabled === disabled);
    if (!checks.every(Boolean))
      throw new ConfigurationOperationError(
        "assertion",
        "阶段分组、顺序或禁用状态不符合预期",
        "failed",
      );
    return { groups: current.view.groups, visible: current.view.visible, matched: true };
  }

  async restore(record: StageRecord) {
    try {
      let current = await this.owns(record);
      if (!isDeepStrictEqual(current.view.groups, record.view.groups)) {
        // First separate current visible stages, then reconstruct the recorded ordered groups.
        for (;;) {
          const group = current.view.groups.find((g) => g.length > 1);
          if (!group) break;
          if (current.view.buttons.find((b) => b.stage === group[0])?.disabled) {
            const link = current.view.links.find((l) => l.stage === group[0] && !l.disabled);
            if (!link) throw new Error("禁用阶段组没有可用的 UI 恢复路径");
            // A nested unlink cannot receive a click inside a disabled native button.
            // Link its group to the preceding available chain, split there, then rebuild.
            await this.change(record, "link", link.previous, group[0]);
          } else await this.change(record, "unlink", group[0], group.at(-1)!);
          current = await this.owns(record);
        }
        for (const group of record.view.groups)
          for (const stage of group.slice(1)) await this.change(record, "link", group[0], stage);
      }
      current = await this.owns(record);
      if (!isDeepStrictEqual(current.view.groups, record.view.groups))
        throw new Error("原串联未恢复");
      return { groups: current.view.groups, restored: true };
    } catch (cause) {
      throw new ConfigurationOperationError(
        "restore",
        "阶段恢复失败，停止后续用例并保留现场",
        "stop",
        { cause },
      );
    }
  }
}

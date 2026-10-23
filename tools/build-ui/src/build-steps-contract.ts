import type {
  ConfigurationStep,
  ConfigurationStepsDocument,
} from "./configuration-steps-contract.js";
import type { ConfigurationTarget } from "./configuration-targets.js";

export type BuildStep =
  | { id: string; op: "config.open" }
  | { id: string; op: "config.close"; page: string }
  | (Extract<ConfigurationStep, { op: "record" | "set" | "restore" }> & { page: string })
  | (Extract<ConfigurationStep, { op: "read" }> & { page: string; scope?: "build" })
  | Extract<ConfigurationStep, { op: "assert" }>
  | { id: string; op: "build.submit"; page: string; snapshot: string }
  | { id: string; op: "build.wait"; task: string }
  | {
      id: string;
      op: "assert";
      check: "build-result";
      task: string;
      result: string;
      expected: { state: "success" };
    };
export interface BuildStepCase {
  caseId: string;
  platform: string;
  onFailure?: "continue" | "stop";
  steps: BuildStep[];
  finally: BuildStep[];
}
export interface BuildStepsDocument {
  kind: "pink-configuration-steps";
  schemaVersion: 2;
  targets?: ConfigurationTarget[];
  cases: BuildStepCase[];
}

/** Lifecycle validation plus projection through the existing field/type/capability contract. */
export function validateBuildSteps(
  input: unknown,
  validateV1: (input: unknown) => ConfigurationStepsDocument,
): BuildStepsDocument {
  const error = (at: string, reason: string): never => {
    throw new Error(`${at}：${reason}`);
  };
  const obj = (value: unknown, at: string): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) error(at, "必须是对象");
    return value as Record<string, unknown>;
  };
  const keys = (o: Record<string, unknown>, allowed: string[], at: string) => {
    if (Object.keys(o).some((k) => !allowed.includes(k))) error(at, "含未支持的属性");
  };
  const id = (v: unknown, at: string): string => {
    if (typeof v !== "string" || !/^[a-zA-Z0-9][\w.-]*$/.test(v)) error(at, "需要有效标识符");
    return v as string;
  };
  const doc = obj(input, "document");
  keys(doc, ["kind", "schemaVersion", "cases", "targets"], "document");
  if (
    doc.kind !== "pink-configuration-steps" ||
    doc.schemaVersion !== 2 ||
    !Array.isArray(doc.cases) ||
    !doc.cases.length
  )
    error("document", "需要非空 v2 步骤用例");
  const projections: unknown[] = [];
  for (const [ci, raw] of (doc.cases as unknown[]).entries()) {
    const at = `cases[${ci}]`,
      c = obj(raw, at);
    keys(c, ["caseId", "platform", "onFailure", "steps", "finally"], at);
    if (!Array.isArray(c.steps) || !c.steps.length || !Array.isArray(c.finally))
      error(at, "需要 steps 与 finally 数组");
    if (!(c.finally as unknown[]).some((step) => obj(step, at).op === "config.close"))
      error(at, "finally 必须声明关闭操作，失败时也要收尾");
    if (obj((c.finally as unknown[])[0], at).op !== "config.open")
      error(at, "finally 须先绑定清理页面，不能依赖可能未执行的页面步骤");
    let active: string | undefined,
      record: string | undefined,
      restored = false,
      revision = 0;
    let submitted: string | undefined,
      waited: string | undefined,
      checked = false;
    const ids = new Set<string>(),
      recorded = new Set<string>(),
      mutated = new Set<string>();
    const snapshots = new Map<
      string,
      { page: string; revision: number; fields: string[]; build: boolean }
    >();
    const projected: Record<string, unknown>[] = [],
      allFields = new Set<string>();
    const usePage = (ref: unknown, where: string) => {
      if (!active || ref !== active)
        error(where, "必须引用当前有效页面；关闭或提交后的旧页面不能复用");
    };
    for (const [cleanup, sequence] of [
      [false, c.steps],
      [true, c.finally],
    ] as const) {
      for (const [si, rawStep] of (sequence as unknown[]).entries()) {
        const where = `${at}.${cleanup ? "finally" : "steps"}[${si}]`,
          s = obj(rawStep, where);
        const stepId = id(s.id, where);
        if (ids.has(stepId)) error(where, "步骤 id 重复");
        ids.add(stepId);
        if (cleanup && !["config.open", "restore", "config.close"].includes(String(s.op)))
          error(where, "finally 只允许打开、恢复、关闭");
        const { page: _page, scope: _scope, ...projection } = s;
        switch (s.op) {
          case "config.open":
            keys(s, ["id", "op"], where);
            if (submitted && !waited) error(where, "本批须等待任务收尾后才能再次打开配置");
            if (active && !cleanup) error(where, "已有打开页面，需先显式关闭");
            active = stepId;
            revision++;
            break;
          case "config.close":
            keys(s, ["id", "op", "page"], where);
            usePage(s.page, where);
            active = undefined;
            revision++;
            break;
          case "record":
            keys(s, ["id", "op", "page", "fields"], where);
            usePage(s.page, where);
            if (record || !Array.isArray(s.fields) || !s.fields.length)
              error(where, "每例需要至多一份非空原值记录");
            record = stepId;
            for (const f of s.fields as string[]) {
              recorded.add(f);
              allFields.add(f);
            }
            break;
          case "set":
            keys(s, ["id", "op", "page", "field", "value", "input"], where);
            usePage(s.page, where);
            if (!recorded.has(String(s.field))) error(where, "修改字段必须显式记录原值");
            mutated.add(String(s.field));
            allFields.add(String(s.field));
            revision++;
            projected.push(projection);
            break;
          case "read":
            keys(s, ["id", "op", "page", "fields", "scope"], where);
            usePage(s.page, where);
            if (
              !Array.isArray(s.fields) ||
              !s.fields.length ||
              (s.scope !== undefined && s.scope !== "build")
            )
              error(where, "回读需要字段和有效 scope");
            if (
              s.scope === "build" &&
              [...mutated].some((f) => !(s.fields as unknown[]).includes(f))
            )
              error(where, "提交快照必须包括本例所有已修改字段");
            snapshots.set(stepId, {
              page: active!,
              revision,
              fields: s.fields as string[],
              build: s.scope === "build",
            });
            (s.fields as string[]).forEach((f) => allFields.add(f));
            projected.push(projection);
            break;
          case "assert":
            if (s.check === "build-result") {
              keys(s, ["id", "op", "check", "task", "result", "expected"], where);
              const expected = obj(s.expected, where);
              keys(expected, ["state"], where);
              if (
                !submitted ||
                s.task !== submitted ||
                !waited ||
                s.result !== waited ||
                expected.state !== "success"
              )
                error(where, "结果断言必须引用本例已收集任务；当前终点仅支持 success");
              checked = true;
            } else {
              keys(
                s,
                s.check === "values"
                  ? ["id", "op", "check", "snapshot", "values"]
                  : ["id", "op", "check", "field", "expected"],
                where,
              );
              if (s.check === "values") {
                const snap = snapshots.get(String(s.snapshot));
                if (!snap || snap.page !== active || snap.revision !== revision)
                  error(where, "必须引用当前页面未过期的快照");
              } else if (!active) error(where, "控件断言需要已打开页面");
              projected.push(projection);
            }
            break;
          case "build.submit": {
            keys(s, ["id", "op", "page", "snapshot"], where);
            usePage(s.page, where);
            const snap = snapshots.get(String(s.snapshot));
            if (submitted || !snap?.build || snap.page !== active || snap.revision !== revision)
              error(where, "每例最多一次提交，且须引用当前页面的构建快照");
            submitted = stepId;
            active = undefined;
            revision++;
            break;
          }
          case "build.wait":
            keys(s, ["id", "op", "task"], where);
            if (!submitted || s.task !== submitted || waited)
              error(where, "必须等待本例已提交任务，不能重复等待或引用其他任务");
            waited = stepId;
            break;
          case "restore":
            keys(s, ["id", "op", "page", "record"], where);
            usePage(s.page, where);
            if (!cleanup || !record || s.record !== record || restored)
              error(where, "恢复必须在 finally 中唯一引用本例原值记录");
            restored = true;
            break;
          default:
            error(where, "未支持的操作");
        }
      }
    }
    if (active) error(at, "结束时必须关闭配置页");
    if (record && !restored) error(at, "原值记录必须有 finally 恢复");
    if ([...snapshots.values()].some((s) => s.build) && !submitted)
      error(at, "构建快照需要对应的提交步骤");
    if (submitted && !["web-desktop", "web-mobile"].includes(String(c.platform)))
      error(at, "首批 v2 构建仅开放两个 Web 平台；专用材料和平台合同仍走旧入口");
    if (submitted && (!waited || !checked)) error(at, "提交后必须声明等待和结果断言");
    let prefix = "projection";
    while (ids.has(prefix) || ids.has(prefix + "End")) prefix += "X";
    projections.push({
      caseId: c.caseId,
      platform: c.platform,
      onFailure: c.onFailure,
      steps: [
        { id: prefix, op: "record", fields: allFields.size ? [...allFields] : ["name"] },
        ...projected,
        { id: prefix + "End", op: "restore", record: prefix },
      ],
    });
  }
  validateV1({
    kind: "pink-configuration-steps",
    schemaVersion: 1,
    targets: doc.targets,
    cases: projections,
  });
  return structuredClone(doc) as unknown as BuildStepsDocument;
}

export function buildStepDependencies(c: BuildStepCase) {
  const record = c.steps.find((s) => s.op === "record");
  let active: string | undefined;
  return [...c.steps, ...c.finally].map((s) => {
    const requires = [
      ...("page" in s ? [s.page] : []),
      ...("snapshot" in s ? [s.snapshot] : []),
      ...("task" in s ? [s.task] : []),
      ...("result" in s ? [s.result] : []),
      ...(s.op === "restore" ? [s.record] : s.op === "set" && record ? [record.id] : []),
      ...(s.op === "assert" && (s.check === "prompt" || s.check === "state") && active
        ? [active]
        : []),
    ];
    if (s.op === "config.open") active = s.id;
    if (s.op === "config.close" || s.op === "build.submit") active = undefined;
    return { id: s.id, requires };
  });
}

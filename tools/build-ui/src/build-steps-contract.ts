import type {
  ConfigurationStep,
  ConfigurationStepsDocument,
} from "./configuration-steps-contract.js";
import { validateConfigurationTargets, type ConfigurationTarget } from "./configuration-targets.js";
import type { CandidateMatch, ProbeExpected } from "./standard-fields.js";
import type { CaseValue } from "./finalized-cases.js";
import { hiddenCondition, preparationFields } from "./configuration-step-values.js";
import { configurationFamilies } from "./configuration-operations.js";
import { platformCatalog } from "./platform-catalog.js";
import type { StageExpected } from "./configuration-stages.js";
import type { InitialChecks } from "./configuration-input-actions.js";
import { stepOperations, stepAssertions } from "./step-operation-capabilities.js";
import type { BuilderTarget, BuilderHomeExpected } from "./builder-checks.js";

export type BuildStep =
  | { id: string; op: "builder.open" | "builder.home" }
  | { id: string; op: "builder.read"; page: string }
  | {
      id: string;
      op: "assert";
      check: "builder-state";
      snapshot: string;
      expected: BuilderHomeExpected;
    }
  | { id: string; op: "platform.probe" }
  | { id: string; op: "config.probe" | "config.candidates"; page: string; field: string }
  | { id: string; op: "config.select"; page: string; field: string; candidate: CandidateMatch }
  | { id: string; op: "assert"; check: "probe"; observation: string; expected: ProbeExpected }
  | {
      id: string;
      op: "assert";
      check: "candidate";
      observation: string;
      candidate: CandidateMatch;
      expected: { present: boolean; disabled?: boolean };
    }
  | { id: string; op: "config.open" }
  | { id: string; op: "config.close"; page: string }
  | { id: string; op: "config.ready"; page: string }
  | { id: string; op: "config.require"; page: string; expected: InitialChecks }
  | { id: string; op: "input.cancel-file"; page: string; field: string }
  | { id: string; op: "input.clear-field"; page: string; field: string }
  | { id: string; op: "input.clear-scenes"; page: string }
  | { id: string; op: "assert"; check: "empty" | "protected-choice"; page: string; field: string }
  | { id: string; op: "assert"; check: "build-enabled"; page: string; expected: boolean }
  | {
      id: string;
      op: "assert";
      check: "unchanged";
      page: string;
      snapshot: string;
      fields: string[];
    }
  | { id: string; op: "stage.record"; page: string }
  | { id: string; op: "stage.read"; page: string }
  | {
      id: string;
      op: "stage.hint";
      page: string;
      control: "button" | "link" | "unlink";
      stage: string;
      contains: string;
    }
  | { id: string; op: "stage.link"; page: string; record: string; previous: string; stage: string }
  | { id: string; op: "stage.unlink"; page: string; record: string; group: string; stage: string }
  | { id: string; op: "stage.restore"; page: string; record: string; reopen?: boolean }
  | { id: string; op: "assert"; check: "stages"; snapshot: string; expected: StageExpected }
  | { id: string; op: "assert"; check: "build-scope"; page: string; expected: { allowed: boolean } }
  | { id: string; op: "config.expand"; page: string; section: "network-timeout" }
  | { id: string; op: "config.prepare"; page: string; field: string; value: CaseValue }
  | { id: string; op: "retain"; page: string; fields: string[] }
  | { id: string; op: "input.google-icon"; page: string; file: CaseValue }
  | {
      id: string;
      op: "input.openpaas-game";
      page: string;
      value: CaseValue;
      requireChange?: boolean;
    }
  | (Extract<ConfigurationStep, { op: "record" | "set" }> & { page: string })
  | (Extract<ConfigurationStep, { op: "restore" }> & { page: string; reopen?: boolean })
  | (Extract<ConfigurationStep, { op: "read" }> & {
      page: string;
      scope?: "build";
      retained?: string;
      hidden?: string[];
    })
  | Extract<ConfigurationStep, { op: "assert" }>
  | { id: string; op: "build.submit"; page: string; snapshot: string }
  | { id: string; op: "build.wait"; task: string }
  | { id: string; op: "assert"; check: "retained"; page: string; retained: string }
  | { id: string; op: "assert"; check: "hidden"; page: string; field: string; observed?: string }
  | { id: string; op: "assert"; check: "agc-material" | "openpaas-ready"; page: string }
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
  platform?: string;
  target?: BuilderTarget;
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
  const caseIds = new Set<string>();
  const targets = validateConfigurationTargets(doc.targets);
  for (const [ci, raw] of (doc.cases as unknown[]).entries()) {
    const at = `cases[${ci}]`,
      c = obj(raw, at);
    keys(c, ["caseId", "platform", "target", "onFailure", "steps", "finally"], at);
    const caseId = id(c.caseId, at);
    if (caseIds.has(caseId)) error(at, "用例 caseId 重复");
    caseIds.add(caseId);
    if (c.onFailure !== undefined && !["continue", "stop"].includes(String(c.onFailure)))
      error(at, "onFailure 仅支持 continue/stop");
    if (!Array.isArray(c.steps) || !c.steps.length || !Array.isArray(c.finally))
      error(at, "需要 steps 与 finally 数组");
    if (c.target !== undefined) {
      if (c.platform !== undefined) error(at, "公共目标不能同时声明 platform");
      const target = obj(c.target, `${at}.target`);
      keys(target, ["kind", "category"], `${at}.target`);
      if (
        target.kind !== "builder" ||
        !["X-Device", "X-Application"].includes(String(target.category))
      )
        error(at, "公共目标仅支持 Builder 分类");
      let page: string | undefined;
      const snapshots = new Set<string>();
      const ids = new Set<string>();
      for (const [cleanup, sequence] of [
        [false, c.steps],
        [true, c.finally],
      ] as const) {
        for (const [index, rawStep] of (sequence as unknown[]).entries()) {
          const where = `${at}.${cleanup ? "finally" : "steps"}[${index}]`,
            s = obj(rawStep, where);
          const stepId = id(s.id, where);
          if (ids.has(stepId)) error(where, "步骤 id 重复");
          ids.add(stepId);
          if (s.op === "builder.open" && !cleanup) {
            keys(s, ["id", "op"], where);
            page = stepId;
            snapshots.clear();
          } else if (s.op === "builder.read" && !cleanup) {
            keys(s, ["id", "op", "page"], where);
            if (!page || s.page !== page) error(where, "公共页面回读须引用前面的打开步骤");
            snapshots.add(stepId);
          } else if (s.op === "assert" && s.check === "builder-state" && !cleanup) {
            keys(s, ["id", "op", "check", "snapshot", "expected"], where);
            if (!snapshots.has(String(s.snapshot)))
              error(where, "公共断言须引用本例当前页面的回读");
            const expected = obj(s.expected, `${where}.expected`);
            keys(expected, ["ready", "buttons"], where);
            if (!Object.keys(expected).length) error(where, "公共断言需要明确预期");
            if (expected.ready !== undefined && typeof expected.ready !== "boolean")
              error(where, "ready 须为布尔值");
            if (expected.buttons !== undefined) {
              const buttons = obj(expected.buttons, where);
              keys(buttons, ["history", "build-all"], where);
              if (!Object.keys(buttons).length) error(where, "按钮预期不能为空");
              for (const value of Object.values(buttons)) {
                const state = obj(value, where);
                keys(state, ["visible", "disabled"], where);
                if (
                  !Object.keys(state).length ||
                  Object.values(state).some((v) => typeof v !== "boolean")
                )
                  error(where, "按钮预期须明确布尔状态");
              }
            }
          } else if (s.op === "builder.home" && cleanup) keys(s, ["id", "op"], where);
          else error(where, "公共目标不支持此操作；不能使用平台配置或隐式构建");
        }
      }
      if (
        (c.finally as unknown[]).length !== 1 ||
        obj((c.finally as unknown[])[0], at).op !== "builder.home"
      )
        error(at, "公共检查 finally 必须声明一次返回构建主页");
      continue;
    }
    id(c.platform, `${at}.platform`);
    if (!(c.finally as unknown[]).some((step) => obj(step, at).op === "config.close"))
      error(at, "finally 必须声明关闭操作，失败时也要收尾");
    if (obj((c.finally as unknown[])[0], at).op !== "config.open")
      error(at, "finally 须先绑定清理页面，不能依赖可能未执行的页面步骤");
    const recordsConfiguration = (c.steps as unknown[]).some((s) => obj(s, at).op === "record");
    const target = targets.find((t) => t.id === c.platform);
    const observations = new Map<string, { page?: string; revision: number; kind: string }>();
    const candidate = (raw: unknown, where: string) => {
      const value = obj(raw, where);
      keys(value, value.by === "value" ? ["by", "value"] : ["by", "label"], where);
      if (
        value.by === "value"
          ? !["string", "number", "boolean"].includes(typeof value.value) ||
            (typeof value.value === "number" && !Number.isFinite(value.value))
          : value.by !== "label" || typeof value.label !== "string" || !value.label.trim()
      )
        error(where, "候选须按有类型值或精确标签匹配");
    };
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
    const retained = new Map<string, string[]>(),
      hidden = new Map<string, { field: string; page: string; writes: number }>();
    const writes = new Map<string, number>(),
      checks = new Set<string>();
    const snapshots = new Map<
      string,
      {
        page: string;
        revision: number;
        fields: string[];
        build: boolean;
        writes: Map<string, number>;
      }
    >();
    const projected: Record<string, unknown>[] = [],
      allFields = new Set<string>();
    let stageRecord: string | undefined,
      stagesRestored = false;
    const stageSnapshots = new Map<string, { page: string; revision: number }>();
    const stageId = (value: unknown, where: string) => {
      if (!["build", "make", "run", "upload", "publish"].includes(String(value)))
        error(where, "未适配的阶段 ID");
    };
    const usePage = (ref: unknown, where: string) => {
      if (!active || ref !== active)
        error(where, "必须引用当前有效页面；关闭或提交后的旧页面不能复用");
    };
    const mutate = (fields: string[], where: string) => {
      for (const field of fields) {
        if (recordsConfiguration && !recorded.has(field))
          error(where, `要求恢复的用例须在操作前记录字段：${field}`);
        if ([...retained.values()].some((fields) => fields.includes(field)))
          error(where, "保留字段不能同时作为写入目标");
        allFields.add(field);
        mutated.add(field);
        writes.set(field, (writes.get(field) ?? 0) + 1);
      }
      revision++;
    };
    const validateInput = (field: string, value: unknown, stepId: string) => {
      let readId = stepId + "InputRead",
        checkId = stepId + "InputCheck";
      while (
        (c.steps as Array<{ id?: string }>).some((s) => s.id === readId || s.id === checkId) ||
        projected.some((s) => s.id === readId || s.id === checkId)
      ) {
        readId += "X";
        checkId += "X";
      }
      allFields.add(field);
      projected.push(
        { id: readId, op: "read", fields: [field] },
        {
          id: checkId,
          op: "assert",
          check: "values",
          snapshot: readId,
          values: { [field]: value },
        },
      );
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
        if (!Object.hasOwn(stepOperations, String(s.op))) error(where, "未支持的操作");
        const operation = stepOperations[s.op as BuildStep["op"]];
        if (cleanup && !("cleanup" in operation && operation.cleanup))
          error(where, "finally 只允许打开、恢复、关闭");
        const { page: _page, scope: _scope, ...projection } = s;
        switch (s.op) {
          case "platform.probe":
            keys(s, ["id", "op"], where);
            if (active) error(where, "平台探查须在配置页外进行");
            observations.set(stepId, { revision, kind: "probe" });
            break;
          case "config.probe":
          case "config.candidates":
            keys(s, ["id", "op", "page", "field"], where);
            usePage(s.page, where);
            allFields.add(String(s.field));
            observations.set(stepId, {
              page: active,
              revision,
              kind: s.op === "config.probe" ? "probe" : "candidate",
            });
            break;
          case "config.select":
            keys(s, ["id", "op", "page", "field", "candidate"], where);
            usePage(s.page, where);
            candidate(s.candidate, where);
            mutate([String(s.field)], where);
            if (obj(s.candidate, where).by === "value")
              validateInput(String(s.field), obj(s.candidate, where).value, stepId);
            break;
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
          case "config.ready":
            keys(s, ["id", "op", "page"], where);
            usePage(s.page, where);
            revision++;
            break;
          case "config.require": {
            keys(s, ["id", "op", "page", "expected"], where);
            usePage(s.page, where);
            const expected = obj(s.expected, where);
            keys(
              expected,
              [
                "buildEnabled",
                "visible",
                "nonEmpty",
                "noPrompt",
                "cleanOrEmpty",
                "differs",
                "emptyWhen",
              ],
              where,
            );
            if (
              !Object.keys(expected).length ||
              (expected.buildEnabled !== undefined && typeof expected.buildEnabled !== "boolean")
            )
              error(where, "初态要求必须非空，按钮状态为布尔值");
            const observeFields = (value: unknown) => {
              if (
                !Array.isArray(value) ||
                !value.length ||
                value.some((v) => typeof v !== "string") ||
                new Set(value).size !== value.length
              )
                error(where, "初态字段需要非空且不重复的字段数组");
              (value as string[]).forEach((f) => allFields.add(f));
            };
            for (const key of ["visible", "nonEmpty", "noPrompt", "cleanOrEmpty"])
              if (expected[key] !== undefined) observeFields(expected[key]);
            if (expected.differs !== undefined)
              for (const [field, value] of Object.entries(obj(expected.differs, where)))
                validateInput(field, value, stepId + field.replace(/\W/g, ""));
            if (expected.emptyWhen !== undefined) {
              if (!Array.isArray(expected.emptyWhen) || !expected.emptyWhen.length)
                error(where, "条件初态要求必须是非空数组");
              for (const raw of expected.emptyWhen as unknown[]) {
                const condition = obj(raw, where);
                keys(condition, ["field", "value", "children"], where);
                validateInput(
                  String(condition.field),
                  condition.value,
                  stepId + "Condition" + projected.length,
                );
                observeFields(condition.children);
              }
            }
            break;
          }
          case "input.cancel-file":
          case "input.clear-field": {
            keys(s, ["id", "op", "page", "field"], where);
            usePage(s.page, where);
            const field = String(s.field);
            mutate([field], where);
            if (
              s.op === "input.cancel-file" &&
              !/(?:Path|PemPath|\.icon|\.customIcon|File)$/.test(field)
            )
              error(where, "仅注册文件路径控件的取消操作");
            projected.push({ id: stepId, op: "read", fields: [field] });
            break;
          }
          case "input.clear-scenes":
            keys(s, ["id", "op", "page"], where);
            usePage(s.page, where);
            mutate(["scenes", "startScene"], where);
            break;
          case "stage.record":
            keys(s, ["id", "op", "page"], where);
            usePage(s.page, where);
            if (stageRecord || cleanup) error(where, "每例至多一份阶段原值记录");
            stageRecord = stepId;
            break;
          case "stage.read":
            keys(s, ["id", "op", "page"], where);
            usePage(s.page, where);
            stageSnapshots.set(stepId, { page: active!, revision });
            break;
          case "stage.hint":
            keys(s, ["id", "op", "page", "control", "stage", "contains"], where);
            usePage(s.page, where);
            stageId(s.stage, where);
            if (
              !["button", "link", "unlink"].includes(String(s.control)) ||
              typeof s.contains !== "string" ||
              !s.contains.trim()
            )
              error(where, "提示观察需要控件类型、阶段及非空预期文本");
            break;
          case "stage.link":
          case "stage.unlink":
            keys(
              s,
              ["id", "op", "page", "record", s.op === "stage.link" ? "previous" : "group", "stage"],
              where,
            );
            usePage(s.page, where);
            if (!stageRecord || s.record !== stageRecord)
              error(where, "修改前须引用本例阶段原值记录");
            stageId(s.stage, where);
            stageId(s.op === "stage.link" ? s.previous : s.group, where);
            if (s.stage === "build") error(where, "构建只能作为组首，不能作为连接或拆分目标");
            revision++;
            break;
          case "stage.restore":
            keys(s, ["id", "op", "page", "record", "reopen"], where);
            usePage(s.page, where);
            if (
              !cleanup ||
              !stageRecord ||
              s.record !== stageRecord ||
              stagesRestored ||
              (s.reopen !== undefined && typeof s.reopen !== "boolean")
            )
              error(where, "阶段恢复须在 finally 唯一引用本例记录，reopen 为布尔值");
            stagesRestored = true;
            revision++;
            break;
          case "config.expand":
            keys(s, ["id", "op", "page", "section"], where);
            usePage(s.page, where);
            if (s.section !== "network-timeout" || c.platform !== "openpaas")
              error(where, "仅注册 OpenPaaS 网络超时分组");
            revision++;
            break;
          case "config.prepare": {
            keys(s, ["id", "op", "page", "field", "value"], where);
            usePage(s.page, where);
            const fields = preparationFields(String(s.field), s.value as CaseValue);
            if (!fields) error(where, "此字段未注册联动准备");
            mutate(fields!, where);
            validateInput(String(s.field), s.value, stepId);
            break;
          }
          case "retain":
            keys(s, ["id", "op", "page", "fields"], where);
            usePage(s.page, where);
            if (
              !Array.isArray(s.fields) ||
              !s.fields.length ||
              (s.fields as string[]).some((f) => mutated.has(f))
            )
              error(where, "保留值需在该字段被修改前观察");
            retained.set(stepId, s.fields as string[]);
            for (const field of s.fields as string[]) allFields.add(field);
            projected.push({ id: stepId, op: "read", fields: s.fields });
            break;
          case "input.google-icon":
            keys(s, ["id", "op", "page", "file"], where);
            usePage(s.page, where);
            if (c.platform !== "google-play") error(where, "图标操作只适用 Google Play");
            mutate(
              ["packages.google-play.customIcon", "packages.google-play.customIconFile"],
              where,
            );
            validateInput("packages.google-play.customIcon", s.file, stepId);
            break;
          case "input.openpaas-game":
            keys(s, ["id", "op", "page", "value", "requireChange"], where);
            usePage(s.page, where);
            if (
              c.platform !== "openpaas" ||
              (s.requireChange !== undefined && typeof s.requireChange !== "boolean")
            )
              error(where, "已有游戏操作仅适用 OpenPaaS，requireChange 须为布尔值");
            mutate(["packages.openpaas.appid"], where);
            validateInput("packages.openpaas.appid", s.value, stepId);
            break;
          case "record":
            keys(s, ["id", "op", "page", "fields"], where);
            usePage(s.page, where);
            if (
              record ||
              !Array.isArray(s.fields) ||
              !s.fields.length ||
              s.fields.some((field) => typeof field !== "string") ||
              new Set(s.fields).size !== s.fields.length
            )
              error(where, "每例需要至多一份非空原值记录");
            record = stepId;
            for (const f of [
              ...(s.fields as string[]),
              ...configurationFamilies(s.fields as string[], target?.families).flatMap((family) => [
                family.parent,
                ...family.children,
              ]),
            ]) {
              recorded.add(f);
              allFields.add(f);
            }
            break;
          case "set":
            keys(s, ["id", "op", "page", "field", "value", "input"], where);
            usePage(s.page, where);
            mutate([String(s.field)], where);
            projected.push(projection);
            break;
          case "read":
            keys(s, ["id", "op", "page", "fields", "scope", "retained", "hidden"], where);
            usePage(s.page, where);
            if (
              !Array.isArray(s.fields) ||
              !s.fields.length ||
              (s.scope !== undefined && s.scope !== "build")
            )
              error(where, "回读需要字段和有效 scope");
            if ((s.retained !== undefined || s.hidden !== undefined) && s.scope !== "build")
              error(where, "保留值与隐藏证据只附加到构建快照");
            if (s.retained !== undefined && !retained.has(String(s.retained)))
              error(where, "保留值引用无效");
            if (
              s.hidden !== undefined &&
              (!Array.isArray(s.hidden) || new Set(s.hidden).size !== s.hidden.length)
            )
              error(where, "hidden 须为不重复的断言引用");
            const hiddenFields = ((s.hidden as string[] | undefined) ?? []).map((ref) => {
              const value = hidden.get(ref);
              if (
                !value ||
                value.page !== active ||
                value.writes !== (writes.get(value.field) ?? 0)
              )
                error(where, "隐藏证据无效或已被再次修改");
              return value!.field;
            });
            if (new Set(hiddenFields).size !== hiddenFields.length)
              error(where, "每个隐藏字段只能附加一份观察");
            if (
              s.scope === "build" &&
              [...mutated].some(
                (f) => !(s.fields as unknown[]).includes(f) && !hiddenFields.includes(f),
              )
            )
              error(where, "提交快照必须包括本例所有已修改字段");
            snapshots.set(stepId, {
              page: active!,
              revision,
              fields: s.fields as string[],
              build: s.scope === "build",
              writes: new Map(writes),
            });
            (s.fields as string[]).forEach((f) => allFields.add(f));
            projected.push({ id: stepId, op: "read", fields: s.fields });
            break;
          case "assert":
            if (!Object.hasOwn(stepAssertions, String(s.check))) error(where, "未支持的断言");
            if (s.check === "probe" || s.check === "candidate") {
              keys(
                s,
                s.check === "probe"
                  ? ["id", "op", "check", "observation", "expected"]
                  : ["id", "op", "check", "observation", "candidate", "expected"],
                where,
              );
              const observed = observations.get(String(s.observation));
              if (
                !observed ||
                observed.page !== active ||
                observed.revision !== revision ||
                observed.kind !== s.check
              )
                error(where, "须引用同一上下文中未过期的目标或候选观察");
              const expected = obj(s.expected, where);
              if (s.check === "probe") {
                keys(expected, ["presence", "visible", "readable", "writable", "control"], where);
                if (
                  !Object.keys(expected).length ||
                  (expected.presence !== undefined &&
                    !["present", "absent"].includes(String(expected.presence))) ||
                  ["visible", "readable", "writable"].some(
                    (k) => expected[k] !== undefined && typeof expected[k] !== "boolean",
                  ) ||
                  (expected.control !== undefined &&
                    !["text", "number", "boolean", "enum", "platform-card"].includes(
                      String(expected.control),
                    ))
                )
                  error(where, "目标断言需要明确的存在性、状态或控件类型");
              } else {
                keys(expected, ["present", "disabled"], where);
                candidate(s.candidate, where);
                if (
                  typeof expected.present !== "boolean" ||
                  (expected.disabled !== undefined &&
                    (typeof expected.disabled !== "boolean" || !expected.present))
                )
                  error(where, "候选预期需要 present；禁用状态仅用于存在的候选");
              }
              break;
            }
            if (s.check === "empty" || s.check === "protected-choice") {
              keys(s, ["id", "op", "check", "page", "field"], where);
              usePage(s.page, where);
              allFields.add(String(s.field));
            } else if (s.check === "build-enabled") {
              keys(s, ["id", "op", "check", "page", "expected"], where);
              usePage(s.page, where);
              if (typeof s.expected !== "boolean") error(where, "按钮状态预期须为布尔值");
            } else if (s.check === "unchanged") {
              keys(s, ["id", "op", "check", "page", "snapshot", "fields"], where);
              usePage(s.page, where);
              const baseline = snapshots.get(String(s.snapshot));
              if (
                !baseline ||
                !Array.isArray(s.fields) ||
                !s.fields.length ||
                s.fields.some((f) => !baseline.fields.includes(String(f)))
              )
                error(where, "保留比较须引用本例已经观察的字段");
            } else if (s.check === "stages") {
              keys(s, ["id", "op", "check", "snapshot", "expected"], where);
              const snap = stageSnapshots.get(String(s.snapshot));
              if (!snap || snap.page !== active || snap.revision !== revision)
                error(where, "阶段断言须引用当前页未过期的阶段快照");
              const expected = obj(s.expected, where);
              keys(expected, ["groups", "visible", "disabled", "linkDisabled"], where);
              if (!Array.isArray(expected.groups) || !expected.groups.length)
                error(where, "阶段断言需要完整有序分组");
              const seen = new Set<string>();
              for (const g of expected.groups as unknown[]) {
                if (!Array.isArray(g) || !g.length) error(where, "阶段组不能为空");
                for (const stage of g as unknown[]) {
                  stageId(stage, where);
                  if (seen.has(String(stage))) error(where, "预期阶段不得重复");
                  seen.add(String(stage));
                }
              }
              if ((expected.groups as string[][])[0][0] !== "build")
                error(where, "首组须以 build 开头");
              if (expected.visible !== undefined) {
                if (
                  !Array.isArray(expected.visible) ||
                  expected.visible.length !== seen.size ||
                  new Set(expected.visible).size !== seen.size
                )
                  error(where, "可见阶段应与分组中的阶段集合一致");
                for (const stage of expected.visible as unknown[])
                  if (!seen.has(String(stage))) error(where, "可见阶段不属于预期分组");
              }
              for (const key of ["disabled", "linkDisabled"])
                if (expected[key] !== undefined)
                  for (const [stage, flag] of Object.entries(obj(expected[key], where)))
                    if (!seen.has(stage) || typeof flag !== "boolean")
                      error(where, "阶段状态须引用可见阶段并使用布尔值");
            } else if (s.check === "build-scope") {
              keys(s, ["id", "op", "check", "page", "expected"], where);
              usePage(s.page, where);
              const expected = obj(s.expected, where);
              keys(expected, ["allowed"], where);
              if (typeof expected.allowed !== "boolean") error(where, "构建范围预期须为布尔值");
            } else if (s.check === "retained") {
              keys(s, ["id", "op", "check", "page", "retained"], where);
              usePage(s.page, where);
              if (!retained.has(String(s.retained))) error(where, "必须引用已观察的保留值");
            } else if (s.check === "hidden") {
              keys(s, ["id", "op", "check", "page", "field", "observed"], where);
              usePage(s.page, where);
              const field = String(s.field),
                condition = hiddenCondition(field),
                observed = snapshots.get(String(s.observed));
              if (!condition) error(where, "字段未注册隐藏条件");
              if (
                s.observed !== undefined
                  ? !observed ||
                    observed.page !== active ||
                    !observed.fields.includes(field) ||
                    (observed.writes.get(field) ?? 0) !== (writes.get(field) ?? 0)
                  : field !== "wasmCompressionMode"
              )
                error(where, "隐藏子项须引用本页未再写入的观察；仅 Asmjs 压缩可使用父项推导 false");
              allFields.add(field);
              allFields.add(condition!.field);
              hidden.set(stepId, { field, page: active!, writes: writes.get(field) ?? 0 });
            } else if (s.check === "agc-material" || s.check === "openpaas-ready") {
              keys(s, ["id", "op", "check", "page"], where);
              usePage(s.page, where);
              if (c.platform !== (s.check === "agc-material" ? "huawei-agc" : "openpaas"))
                error(where, "专属检查与平台不符");
              checks.add(s.check);
            } else if (s.check === "build-result") {
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
            if (c.platform === "huawei-agc" && !checks.has("agc-material"))
              error(where, "AGC 提交前必须检查服务文件及包名");
            if (c.platform === "openpaas" && !checks.has("openpaas-ready"))
              error(where, "OpenPaaS 提交前必须核对必填项及已有游戏");
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
            keys(s, ["id", "op", "page", "record", "reopen"], where);
            usePage(s.page, where);
            if (!cleanup || !record || s.record !== record || restored)
              error(where, "恢复必须在 finally 中唯一引用本例原值记录");
            if (stageRecord && !stagesRestored)
              error(where, "应先恢复阶段关系，再核对原字段和按钮状态");
            if (s.reopen !== undefined && typeof s.reopen !== "boolean")
              error(where, "reopen 必须为布尔值");
            restored = true;
            break;
          default:
            error(where, "未支持的操作");
        }
      }
    }
    if (active) error(at, "结束时必须关闭配置页");
    if (record && !restored) error(at, "原值记录必须有 finally 恢复");
    if (stageRecord && !stagesRestored) error(at, "阶段原值记录必须有 finally 恢复");
    if (
      recordsConfiguration &&
      (mutated.has("startScene") || mutated.has("scenes")) &&
      (!recorded.has("startScene") || !recorded.has("scenes"))
    )
      error(at, "场景操作必须同时记录初始场景和场景集合，保证联动恢复");
    if ([...snapshots.values()].some((s) => s.build) && !submitted)
      error(at, "构建快照需要对应的提交步骤");
    if (submitted && !platformCatalog.some((p) => p.id === c.platform))
      error(at, "新标准平台尚无构建合同，仅支持配置操作");
    if (submitted && target && Object.keys(target.fields).some((field) => allFields.has(field)))
      error(at, "描述扩展的标准字段尚无任务参数合同，仅支持配置检查");
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
  if (projections.length)
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
      ...("observation" in s ? [s.observation] : []),
      ...("task" in s ? [s.task] : []),
      ...("result" in s ? [s.result] : []),
      ...("retained" in s && s.retained ? [s.retained] : []),
      ...("hidden" in s ? (s.hidden ?? []) : []),
      ...("observed" in s && s.observed ? [s.observed] : []),
      ...("record" in s ? [s.record] : []),
      ...(s.op === "restore"
        ? []
        : [
              "set",
              "config.select",
              "config.prepare",
              "input.google-icon",
              "input.openpaas-game",
              "input.cancel-file",
              "input.clear-field",
              "input.clear-scenes",
            ].includes(s.op) && record
          ? [record.id]
          : []),
      ...(s.op === "assert" && (s.check === "prompt" || s.check === "state") && active
        ? [active]
        : []),
    ];
    if (s.op === "config.open") active = s.id;
    if (s.op === "config.close" || s.op === "build.submit") active = undefined;
    return { id: s.id, requires };
  });
}

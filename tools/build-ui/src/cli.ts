import { parseArgs } from "node:util";
import { writeResultReport } from "./result-report.js";
import { createOfflinePlan, readRunConfiguration, pinkExecutable } from "./offline-plan.js";
import { createHash } from "node:crypto";
import { publicValues } from "./case-inputs.js";
import { describeFieldCapabilities, validateExecutableCatalog } from "./field-capabilities.js";
import { valueHash, verifyExpectedPlan } from "./plan-integrity.js";
import { assertWindowIdentity } from "./workspace-identity.js";
import { ExecutionContext, ConfigurationOperationError } from "./configuration-context.js";
import { readBuildPreferences } from "./build-preferences.js";
import { setTimeout as delay } from "node:timers/promises";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright-core";
import { Builder, ConfigurationReadinessError, type ConfigurationReadiness } from "./builder.js";
import { startSession, findWindow, engineSelection } from "./session.js";
import { TaskObserver, isTerminal, taskTiming, taskTimeout } from "./task-observer.js";
import { submitBuild, observedBuildTask, assertBuildSucceeded } from "./build-operations.js";
import { platformEntry } from "./platform-catalog.js";
import { selectSpecialOptions } from "./special-options.js";
import { selectAcceptanceCases } from "./acceptance-cases.js";
import { selectFinalizedCases, readFinalMaterials, finalCaseKeys } from "./finalized-cases.js";
import { FormSampleError } from "./form-validation.js";
import {
  prepareFinalizedCase,
  assertFinalizedTask,
  restoreFinalizedCase,
  CasePrerequisiteError,
  type FinalPrepared,
  type FinalEvidence,
} from "./finalized-flow.js";
import { selectLocalOptions } from "./build-cases.js";
import { readAgcMaterial, configureAgc } from "./agc.js";
import { prepareOpenpaasBuild } from "./openpaas.js";
import {
  existingPlatformIds,
  existingFields,
  existingPublicKeys,
  selectExistingPlatforms,
  checkExistingTask,
} from "./existing-platforms.js";
import {
  waitFor,
  errorMessage,
  type Options,
  type Task,
  type Configuration,
  type FieldValue,
} from "./common.js";
import {
  platforms,
  additionalPlatforms,
  baseCombinationPlatforms,
  debugFields,
  releaseFields,
  releaseBFields,
  releaseCLocalFields,
  releaseCLocalSpecialFields,
  canApplySpecial,
  releaseBSpecialFields,
  deferredReleaseBBranches,
  specialFields,
  deferredReleaseBranches,
  omittedFields,
  optionAt,
  type SpecialFieldContract,
  type SpecialField,
  type Platform,
} from "./profiles.js";

function combinationPlatform(target: { id: string }): Platform {
  const platform = baseCombinationPlatforms.find((item) => item.id === target.id);
  if (!platform) throw new Error(`平台尚未开放配置组合：${target.id}`);
  return platform;
}

interface CaseResult {
  finalized?: FinalEvidence;
  blockerKind?: string;
  openpaasBuild?: Awaited<ReturnType<typeof prepareOpenpaasBuild>>;
  agcServices?: Awaited<ReturnType<typeof configureAgc>>;
  caseId: string;
  group: number;
  platform: string;
  category: string;
  profile: string;
  purpose?: "target" | "transition";
  sourceCaseIds?: string[];
  requiresInitialFrom?: string[];
  outcome: "not-run" | "submitted" | "passed" | "blocked" | "failed" | "stopped" | "not-applicable";
  stage: string;
  failure?: string;
  initial?: Configuration;
  configured?: Configuration;
  reopened?: Configuration;
  finalConfiguration?: Configuration;
  persistenceCheck: {
    requested: boolean;
    state: "not-requested" | "not-run" | "passed" | "blocked" | "failed";
  };
  conditionalSteps?: Array<{ key: string; expected: FieldValue; state: string }>;
  hiddenFields?: {
    initial: string[];
    final: string[];
    retainedFromInitial: Record<string, FieldValue>;
  };
  webgpuPreviewUI?: Awaited<ReturnType<Builder["checkMobileWebGPUHint"]>>;
  expected?: Record<string, boolean | string>;
  existingConfiguration?: {
    contracts?: SpecialFieldContract[];
    values: Record<string, FieldValue>;
    uiUncovered: string[];
    queuedTaskChecks?: ReturnType<typeof checkExistingTask>;
    taskChecks?: ReturnType<typeof checkExistingTask>;
  };
  omittedFields: string[];
  changedFields: string[];
  confirmedChangedFields: string[];
  submittedAt?: number;
  acceptedAt?: number;
  stateAtAcceptance?: string;
  task?: Task;
  queuedTask?: Task;
  timing?: ReturnType<typeof taskTiming>;
  timeout?: "startup-wait" | "processing";
  configurationReadiness?: {
    initial?: ConfigurationReadiness;
    reopened?: ConfigurationReadiness;
    failure?: ConfigurationReadiness;
  };
  screenshot?: string;
  screenshotOmittedReason?: string;
  specialConfiguration?: {
    mode: "baseline" | "non-default";
    variant: "generic" | "vivo-custom";
    uiUncovered: string[];
    expected: Record<string, FieldValue>;
    initial?: Record<string, FieldValue>;
    configured?: Record<string, FieldValue>;
    reopened?: Record<string, FieldValue>;
    final?: Record<string, FieldValue>;
    taskChecks?: Record<string, "matched" | "omitted-empty" | "omitted-default">;
    queuedTaskChecks?: Record<string, "matched" | "omitted-empty" | "omitted-default">;
  };
  checks: {
    uiConfiguration: boolean;
    persistence: boolean;
    taskOptions: boolean;
    uiSuccess: boolean;
    specialConfiguration?: boolean;
    specialTaskOptions?: boolean;
    queuedTaskOptions?: boolean;
    specialQueuedTaskOptions?: boolean;
  };
}

interface GroupResult {
  number: number;
  caseIds: string[];
  platforms: string[];
  startedAt?: number;
  submissionsClosedAt?: number;
  settledAt?: number;
  outcome: "not-run" | "running" | "passed" | "failed" | "incomplete";
  queueCoverage: "not-run" | "observed" | "not-observed" | "not-applicable";
}

function assertConfiguration(
  configuration: Configuration,
  expected: Record<string, boolean | string>,
): void {
  const differences = Object.entries(expected).filter(
    ([key, value]) => configuration.fields[key] !== value,
  );
  if (differences.length)
    throw new Error(
      `组合回读不一致：${differences.map(([key, value]) => `${key}: 期望 ${JSON.stringify(value)}，实际 ${JSON.stringify(configuration.fields[key])}`).join("；")}`,
    );
}

function assertScene(configuration: Configuration, sceneId: string): void {
  if (configuration.startSceneId !== sceneId || configuration.selectedScenes.length !== 1)
    throw new Error(`组合要求初始场景UUID=${sceneId}且只选一个场景；工具不自动改场景材料`);
}

function assertSpecialValues(values: Record<string, FieldValue>, fields: SpecialField[]): void {
  for (const field of fields) {
    if (values[field.key] !== field.expected)
      throw new Error(
        `专属配置不一致：${field.key}，期望 ${JSON.stringify(field.expected)}，实际 ${JSON.stringify(values[field.key])}`,
      );
  }
}

function assertSpecialTask(
  task: Task,
  fields: SpecialField[],
): Record<string, "matched" | "omitted-empty" | "omitted-default"> {
  if (!task.specialOptions) throw new Error("本次任务缺少专属字段观察数据");
  return Object.fromEntries(
    fields.map((field) => {
      const actual = task.specialOptions![field.key];
      if (!actual) throw new Error(`专属字段未被观察：${field.key}`);
      if (
        !actual.present &&
        field.optionalEmpty &&
        ["", "[redacted:empty]"].includes(String(field.expected))
      )
        return [field.key, "omitted-empty"];
      if (!actual.present && field.missingDefault === false && field.expected === false)
        return [field.key, "omitted-default"];
      if (!actual.present || actual.value !== field.expected)
        throw new Error(
          `任务专属参数不一致：${field.key}，期望 ${JSON.stringify(field.expected)}，实际 ${actual.present ? JSON.stringify(actual.value) : "未设置"}`,
        );
      return [field.key, "matched"];
    }),
  );
}

function assertTaskOptions(
  task: Task,
  configuration: Configuration,
  expected: Record<string, boolean | string>,
): void {
  if (!task.options) throw new Error("本次任务没有提供 options，无法核对组合参数");
  const differences = Object.entries(expected).filter(
    ([key, value]) =>
      !(
        key === "wasmCompressionMode" &&
        value === false &&
        optionAt(task.options!, key) === undefined
      ) &&
      optionAt(task.options!, key) !==
        (key === "sourceMaps" && value !== "inline"
          ? value === "true"
          : key === "wasmCompressionMode" && value === true
            ? "brotli"
            : value),
  );
  if (differences.length)
    throw new Error(
      `任务组合参数不一致：${differences.map(([key, value]) => `${key}: 期望 ${JSON.stringify(value)}，实际 ${JSON.stringify(optionAt(task.options!, key))}`).join("；")}`,
    );
  const scenes = task.options.scenes as Array<{ uuid?: string }> | undefined;
  if (
    task.options.startScene !== configuration.startSceneId ||
    !Array.isArray(scenes) ||
    scenes.length !== 1 ||
    scenes[0].uuid !== configuration.startSceneId
  )
    throw new Error("本次任务的初始场景或场景列表与 UI 不一致");
  if (
    task.platform !== "openpaas" &&
    Array.isArray(task.options.nextStages) &&
    task.options.nextStages.length
  )
    throw new Error("本次任务包含后续阶段，超出仅构建终点");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pink: { type: "string" },
      project: { type: "string" },
      port: { type: "string", default: "9222" },
      timeout: { type: "string", default: "600" },
      "queue-timeout": { type: "string", default: "1800" },
      "configuration-timeout": { type: "string", default: "120" },
      platform: { type: "string", default: "web-desktop" },
      "agc-services": { type: "string" },
      profile: { type: "string" },
      suite: { type: "string" },
      plan: { type: "string" },
      groups: { type: "string" },
      materials: { type: "string" },
      cases: { type: "string" },
      "cases-file": { type: "string" },
      "run-config": { type: "string" },
      "expected-plan": { type: "string" },
      "check-plan": { type: "boolean", default: false },
      "field-capabilities": { type: "boolean", default: false },
      preview: { type: "boolean", default: false },
      "preview-file": { type: "string" },
      "list-cases": { type: "boolean", default: false },
      results: { type: "string" },
      persistence: { type: "string", default: "skip" },
      "apply-profile": { type: "boolean", default: false },
      "scene-uuid": { type: "string", default: "2e58824f-0bca-4f31-a495-1eceb60b610f" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "字段能力：--field-capabilities；离线核验已预览计划：--run-config <启动.json> --expected-plan <计划.json> --check-plan；four-groups 实际执行必须提供 expected-plan。",
    );
    console.log(
      "QA入口：--plan four-groups --cases-file <用例.json> --materials <材料.json> --project <工程> --preview [--preview-file <计划.json>]；或 --run-config <启动.json> --preview。预览不启动或连接PinK。",
    );
    console.log(
      "默认验收：--plan acceptance；--list-cases 离线查看52项合并组合（公共UI专项独立选择）。调试/本地发布：--profile debug|release-a --platform <18平台ID>；--suite debug-additional|release-a-additional为新增10平台，debug-all|release-a-all为18平台。可用--cases <profile.平台ID,...>选择子集。含AGC时必须提供--agc-services <agconnect-services.json>。原priority批次仍为8平台，B/C仍限该范围。",
    );
    console.log(
      "node dist/cli.js --pink <PinK.exe> --project <工程目录> [--profile existing|debug|release-a|release-b|release-c-local] [--platform <平台ID>] [--suite existing-local-seven|debug-priority|release-a-priority|release-b-priority|release-c-local-priority] [--persistence skip|verify] [--apply-profile] [--scene-uuid <UUID>] [--port 9222] [--timeout 600] [--queue-timeout 1800] [--configuration-timeout 120] [--results <目录>]\nexisting-local-seven沿用微信、抖音、支付宝、Android、Google Play、Windows、鸿蒙NEXT当前配置，单平台可用--profile existing --platform <ID>。\n专属组合：--plan special-options-ten；九项本地选项用例：--plan local-options-nine [--cases <逗号分隔caseId>]；不与上述profile/suite/persistence混用，按固定用例顺序执行。\n每组最多 2 项；配置页就绪后操作，组内逐个提交、组间等待收尾。timeout 从首次观察到 processing 起算；queue-timeout 为此前的启动等待上限。不验证产物。",
    );
    return;
  }
  if (values["field-capabilities"]) {
    console.log(JSON.stringify(describeFieldCapabilities(), null, 2));
    return;
  }
  if (values["run-config"]) {
    const config = await readRunConfiguration(values["run-config"]);
    values.plan ??= "four-groups";
    values.pink ??= config.pink;
    values.project ??= config.project;
    values["cases-file"] ??= config.casesFile;
    values.materials ??= config.materials;
    values.groups ??= config.groups;
    values.cases ??= config.caseIds?.join(",");
    values.results ??= config.results;
    values["expected-plan"] ??= config.expectedPlan;
    if (!process.argv.some((arg) => arg === "--port" || arg.startsWith("--port=")) && config.port)
      values.port = String(config.port);
  }
  if (values["preview-file"] && !values.preview)
    throw new Error("preview-file 必须与 preview 一起使用");
  if (values.plan === "four-groups" && values["agc-services"])
    throw new Error(
      "four-groups 的 AGC 文件必须在用例材料引用中声明，不能用 agc-services 绕过计划",
    );
  if (
    (values["cases-file"] || values.preview || values["check-plan"] || values["expected-plan"]) &&
    values.plan !== "four-groups"
  )
    throw new Error("cases-file/preview 仅用于 four-groups");
  if (values["check-plan"] && !values["expected-plan"])
    throw new Error("check-plan 需要 expected-plan");
  if (values.preview && values["check-plan"])
    throw new Error("preview 与 check-plan 分别用于生成和核验计划，不能混用");
  if (
    values.plan === "four-groups" &&
    !values.preview &&
    !values["check-plan"] &&
    !values["list-cases"] &&
    !values["expected-plan"]
  )
    throw new Error("four-groups 执行必须提供 expected-plan；请先预览再启动");
  let guardedPlan: Awaited<ReturnType<typeof createOfflinePlan>> | undefined;
  let planVerification: Awaited<ReturnType<typeof verifyExpectedPlan>> | undefined;
  if (values.preview || values["check-plan"] || values["expected-plan"]) {
    if (
      values.profile ||
      values.suite ||
      values["apply-profile"] ||
      values.persistence !== "skip" ||
      values.platform !== "web-desktop"
    )
      throw new Error("离线计划不能混用旧 profile/suite/platform/persistence");
    const plan = await createOfflinePlan({
      casesFile: values["cases-file"],
      materials: values.materials,
      project: values.project,
      pink: values.pink,
      groups: values.groups,
      cases: values.cases,
      runConfig: values["run-config"],
      port: Number(values.port),
      timeoutsMs: {
        startupWait: Number(values["queue-timeout"]) * 1000,
        processing: Number(values.timeout) * 1000,
        configuration: Number(values["configuration-timeout"]) * 1000,
      },
    });
    guardedPlan = plan;
    if (!values.preview) {
      planVerification = await verifyExpectedPlan(resolve(values["expected-plan"]!), plan);
      if (plan.startup.issues.length)
        throw new Error(`计划启动条件不满足：${plan.startup.issues.join("；")}`);
    }
    if (values["check-plan"]) {
      console.log(
        JSON.stringify({
          kind: "pink-build-plan-verification",
          ...planVerification,
          runtimeVerified: false,
          buildSubmitted: false,
        }),
      );
      return;
    }
    if (values.preview) {
      const json = JSON.stringify(plan, null, 2) + "\n";
      if (values["preview-file"]) {
        await writeFile(resolve(values["preview-file"]), json, "utf8");
        console.log(
          `离线计划：${resolve(values["preview-file"])}\n${JSON.stringify(plan.summary)}；未启动PinK，未提交构建`,
        );
      } else console.log(json);
      process.exitCode = plan.startup.issues.length || plan.summary.blocked ? 1 : 0;
      return;
    }
  }
  if (process.platform !== "win32") throw new Error("当前工具仅支持 Windows");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("需要 Node.js 24 或更高版本");
  if (
    values.plan !== undefined &&
    !["four-groups", "acceptance", "local-options-nine", "special-options-ten"].includes(
      values.plan,
    )
  )
    throw new Error("未知 plan");
  if (values.cases !== undefined && !values.plan && !values.suite)
    throw new Error("cases 必须与 plan 或 suite 一起使用");
  if (
    values.plan &&
    (values.profile ||
      values.suite ||
      values["apply-profile"] ||
      values.persistence !== "skip" ||
      values.platform !== "web-desktop")
  )
    throw new Error(
      "plan 使用独立用例集合，不能混用 profile/suite/platform/apply-profile/persistence",
    );
  if ((values.groups || values.materials) && values.plan !== "four-groups")
    throw new Error("groups/materials 仅用于 four-groups");
  const finalMaterials = await readFinalMaterials(values.materials);
  const catalogPath = values["cases-file"]
    ? resolve(values["cases-file"])
    : fileURLToPath(new URL("../../case-catalog/public-combinations.json", import.meta.url));
  const catalogBytes = values.plan === "four-groups" ? await readFile(catalogPath) : undefined;
  const catalog = catalogBytes
    ? validateExecutableCatalog(JSON.parse(catalogBytes.toString("utf8").replace(/^\uFEFF/, "")))
    : undefined;
  const caseSource = catalogBytes
    ? {
        path: catalogPath,
        revision: catalog!.revision,
        sha256: createHash("sha256").update(catalogBytes).digest("hex"),
      }
    : undefined;
  const plannedCases =
    values.plan === "four-groups"
      ? await selectFinalizedCases(values.cases, values.groups, finalMaterials, {
          catalog,
          catalogPath,
          project: values.project,
        })
      : values.plan === "acceptance"
        ? selectAcceptanceCases(values.cases)
        : values.plan === "special-options-ten"
          ? selectSpecialOptions(values.cases)
          : values.plan
            ? selectLocalOptions(values.cases)
            : [];
  if (
    guardedPlan &&
    (caseSource?.sha256 !== guardedPlan.snapshot.sha256 ||
      valueHash(finalMaterials) !== guardedPlan.snapshot.materialsSha256 ||
      JSON.stringify(plannedCases.map((c) => c.caseId)) !==
        JSON.stringify(guardedPlan.cases.map((c) => c.caseId)) ||
      JSON.stringify(plannedCases.map((c) => c.finalized?.formValidation?.sourceSha256 ?? null)) !==
        JSON.stringify(guardedPlan.cases.map((c) => c.formValidation?.sourceSha256 ?? null)))
  )
    throw new Error("计划核验后加载的用例或材料发生变化，请重新预览");
  if (values["list-cases"]) {
    if (!values.plan) throw new Error("list-cases 必须指定 plan，不连接 PinK");
    console.log(
      JSON.stringify(
        {
          plan: values.plan,
          caseSource,
          count: plannedCases.length,
          maxTasksPerGroup: 2,
          publicUI:
            "independently selected representative-platform checks; no all-platform exercise prerequisite",
          cases: plannedCases.map((item, index) => ({
            caseId: item.caseId,
            finalized: item.finalized && {
              values: publicValues(item.finalized.values, catalog?.fieldTypes),
              revision: item.finalized.revision,
              group: item.finalized.group,
              endpoint: item.finalized.endpoint,
              blockers: item.finalized.blockers,
              retained: item.finalized.retained,
              formValidation: item.finalized.formValidation && {
                sampleId: item.finalized.formValidation.sampleId,
                sourceSha256: item.finalized.formValidation.sourceSha256,
                kind: item.finalized.formValidation.execution.kind,
                field: item.finalized.formValidation.execution.field,
                alert: item.finalized.formValidation.execution.alert,
                submitted: false,
              },
            },
            platform: item.platform,
            title: item.title,
            group: Math.floor(index / 2) + 1,
            profile: item.profile,
            purpose:
              item.purpose ?? (item.initialPublic || item.initialSpecial ? "transition" : "target"),
            sourceCaseIds: item.sourceCaseIds,
            requiresInitialFrom: item.requiresInitialFrom,
            initialPublic: item.initialPublic,
            initialSpecial: item.initialSpecial,
            expected: item.expected,
            specials: item.specials.map((field) => ({
              key: field.key,
              expected: field.redact || field.fingerprint ? "[redacted]" : field.expected,
              operation: item.writes.some((step) => step.key === field.key)
                ? "set-target-if-different"
                : "read-and-check",
            })),
            preserved: item.preserveFields?.map((field) => field.key),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (!values.pink || !values.project) throw new Error("必须提供 --pink 和 --project");
  const definitions = new Map(plannedCases.map((item) => [item.caseId, item]));
  const suiteProfiles: Record<string, string> = {
    "existing-local-seven": "existing",
    "debug-priority": "debug",
    "release-a-priority": "release-a",
    "release-b-priority": "release-b",
    "release-c-local-priority": "release-c-local",
    "debug-additional": "debug",
    "release-a-additional": "release-a",
    "debug-all": "debug",
    "release-a-all": "release-a",
  };
  if (values.suite && !suiteProfiles[values.suite]) throw new Error("批次参数无效");
  const profile = values.plan
    ? "release-local-options"
    : (values.profile ?? (values.suite ? suiteProfiles[values.suite] : "existing"));
  if (
    (!values.plan &&
      !["existing", "debug", "release-a", "release-b", "release-c-local"].includes(profile)) ||
    (values.suite && profile !== suiteProfiles[values.suite])
  )
    throw new Error("组合参数无效");
  if (!["skip", "verify"].includes(values.persistence))
    throw new Error("persistence只能为skip或verify");
  if (profile === "existing" && (values.persistence === "verify" || values["apply-profile"]))
    throw new Error("existing不设置组合，不能要求配置修改/保存专项");
  const persistenceRequested = values.persistence === "verify";
  const sceneId = values["scene-uuid"].trim();
  if (!sceneId) throw new Error("场景UUID不能为空");
  const release = profile.startsWith("release-");
  const roundSpecials =
    profile === "release-b"
      ? releaseBSpecialFields
      : profile === "release-c-local"
        ? releaseCLocalSpecialFields
        : specialFields;
  const existingCandidate = (id: string) =>
    ["huawei-agc", "ohos", "openpaas"].includes(id) ||
    existingPlatformIds.some((item) => item === id);
  let selected: Array<Pick<Platform, "id" | "label" | "category">> =
    values.suite === "existing-local-seven"
      ? selectExistingPlatforms(values.cases)
      : profile === "existing" && existingCandidate(values.platform)
        ? [platformEntry(values.platform)]
        : values.plan
          ? baseCombinationPlatforms.filter((p) =>
              plannedCases.some((item) => item.platform === p.id),
            )
          : values.suite?.endsWith("-additional")
            ? [...additionalPlatforms]
            : values.suite?.endsWith("-all")
              ? [...baseCombinationPlatforms]
              : values.suite
                ? [...platforms]
                : baseCombinationPlatforms.filter((p) => p.id === values.platform);
  if (values.cases && values.suite && values.suite !== "existing-local-seven") {
    const ids = values.cases.split(",").map((id) => id.trim());
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !selected.some((p) => id === `${profile}.${p.id}`))
    )
      throw new Error("cases须为所选批次中不重复的<profile>.<平台ID>");
    selected = selected.filter((p) => ids.includes(`${profile}.${p.id}`));
  }
  if (
    ["release-b", "release-c-local"].includes(profile) &&
    selected.some((p) => existingCandidate(p.id))
  )
    throw new Error("新增10平台仅开放existing/debug/release-a；B/C专项仍限原优先8平台");
  if (values["agc-services"] && !selected.some((p) => p.id === "huawei-agc"))
    throw new Error("agc-services仅用于包含huawei-agc的执行集合");
  if (
    values.plan !== "four-groups" &&
    selected.some((p) => p.id === "huawei-agc") &&
    !values["agc-services"]
  )
    throw new Error(
      "AGC构建须显式提供--agc-services <agconnect-services.json>，工具将通过UI选择该文件及匹配包名",
    );
  const agcMaterial =
    values["agc-services"] && values.plan !== "four-groups"
      ? await readAgcMaterial(values["agc-services"])
      : undefined;
  if (!selected.length) {
    const entry = platformEntry(values.platform);
    if (entry.build === "existing-only")
      throw new Error(`${entry.id}仅开放 -Profile existing，不支持调试/发布组合`);
    throw new Error(
      `${entry.id}配置页可用run-config-ui.ps1检查；构建未开放：${entry.reason ?? "尚无构建组合合同"}`,
    );
  }
  if (
    profile === "existing" &&
    values.platform !== "web-desktop" &&
    !existingCandidate(values.platform)
  )
    throw new Error("existing仅支持web-desktop、已开放的7个平台、AGC、OHOS及OpenPaaS");
  const options: Options = {
    pink: await pinkExecutable(values.pink),
    project: resolve(values.project),
    port: Number(values.port),
    timeoutMs: Number(values.timeout) * 1000,
    queueTimeoutMs: Number(values["queue-timeout"]) * 1000,
    configurationTimeoutMs: Number(values["configuration-timeout"]) * 1000,
    resultsRoot: resolve(
      values.results ?? fileURLToPath(new URL("../../../results", import.meta.url)),
    ),
  };
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535)
    throw new Error("端口必须是 1024–65535 的整数");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1000)
    throw new Error("超时秒数必须至少为 1");
  if (!Number.isFinite(options.queueTimeoutMs) || options.queueTimeoutMs < 1000)
    throw new Error("启动等待超时秒数必须至少为 1");
  if (!Number.isFinite(options.configurationTimeoutMs) || options.configurationTimeoutMs < 1000)
    throw new Error("配置加载超时秒数必须至少为 1");
  await access(options.pink);
  await access(join(options.project, "package.json"));
  if (selected.some((p) => existingCandidate(p.id))) {
    const preferences = await readBuildPreferences(options.project, values.plan === "four-groups");
    for (const platform of selected.filter((p) => existingCandidate(p.id))) {
      const current = preferences[platform.id];
      if (!current) {
        if (profile === "existing")
          throw new Error(`缺少已保存的平台配置：${platform.id}；工具不自动创建配置`);
        // D/A define public targets and capture the product's visible special defaults.
        continue;
      }
      // OpenPaaS follows the normal button's product-managed stage chain, as requested.
      if (platform.id === "openpaas") continue;
      for (const key of ["nextStages", "buildStageGroup"] as const) {
        const value = current[key];
        if (
          value !== undefined &&
          value !== null &&
          value !== false &&
          value !== "" &&
          !(Array.isArray(value) && value.length === 0)
        )
          throw new Error(`${platform.id}存在后续阶段配置${key}，本批只允许构建，未修改该配置`);
      }
    }
  }
  const project = JSON.parse(await readFile(join(options.project, "package.json"), "utf8")) as {
    name?: string;
  };
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const configuredEngine = await engineSelection(options.project);
  let runtimeIdentity: Awaited<ReturnType<typeof assertWindowIdentity>> | undefined;
  let executionContext: ExecutionContext | undefined;
  const directory = join(options.resultsRoot, runId);
  await mkdir(directory, { recursive: true });
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("用户停止执行；未自动取消正在运行的构建"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let browser: Browser | undefined, page: Page | undefined;
  let launch: { pid: number; mode: string; endpoint: string } | undefined;
  let fatal: string | undefined;
  const confirmWindow = async () => {
    try {
      runtimeIdentity = await assertWindowIdentity(page!, options.project, options.pink);
    } catch (error) {
      fatal = `工程或程序身份核对失败，停止后续提交：${errorMessage(error)}`;
      throw error;
    }
  };
  let finished = false;
  const observers = new Map<string, Builder>();
  let taskObserver: TaskObserver | undefined;
  const caseSpecials = new Map<CaseResult, SpecialField[]>();
  const finalPrepared = new Map<CaseResult, FinalPrepared>();
  const warnings: string[] = [];
  const executionCases = values.plan
    ? plannedCases.map((item) => ({
        caseId: item.caseId,
        platform: selected.find((p) => p.id === item.platform)!,
      }))
    : selected.map((p) => ({ caseId: `${profile}.${p.id}`, platform: p }));
  const cases: CaseResult[] = executionCases.map(({ caseId, platform: p }, index) => ({
    caseId,
    group: Math.floor(index / 2) + 1,
    platform: p.id,
    category: p.category,
    profile: definitions.get(caseId)?.profile ?? profile,
    purpose:
      definitions.get(caseId)?.purpose ??
      (definitions.get(caseId)?.initialPublic || definitions.get(caseId)?.initialSpecial
        ? "transition"
        : "target"),
    sourceCaseIds: definitions.get(caseId)?.sourceCaseIds,
    requiresInitialFrom: definitions.get(caseId)?.requiresInitialFrom,
    outcome: "not-run",
    stage: "not-run",
    omittedFields: profile !== "existing" ? omittedFields(combinationPlatform(p)) : [],
    changedFields: [],
    confirmedChangedFields: [],
    persistenceCheck: {
      requested: persistenceRequested,
      state: persistenceRequested ? "not-run" : "not-requested",
    },
    checks: {
      uiConfiguration: false,
      persistence: false,
      taskOptions: false,
      uiSuccess: false,
      queuedTaskOptions: false,
      ...(release ? { specialConfiguration: false, specialTaskOptions: false } : {}),
      ...(release ? { specialQueuedTaskOptions: false } : {}),
    },
  }));
  const groups: GroupResult[] = Array.from({ length: Math.ceil(cases.length / 2) }, (_, index) => ({
    number: index + 1,
    caseIds: cases.slice(index * 2, index * 2 + 2).map((result) => result.caseId),
    platforms: cases.slice(index * 2, index * 2 + 2).map((result) => result.platform),
    outcome: "not-run",
    queueCoverage: "not-run",
  }));
  const timeline: Array<{
    at: string;
    caseId?: string;
    platform?: string;
    stage: string;
    message: string;
  }> = [];
  const report = (stage: string, message: string, result?: CaseResult, updateStage = true) => {
    if (result && updateStage) result.stage = stage;
    timeline.push({
      at: new Date().toISOString(),
      caseId: result?.caseId,
      platform: result?.platform,
      stage,
      message,
    });
    console.log(`[${result?.caseId ?? "session"}][${stage}] ${message}`);
  };
  const save = async () => {
    let product: { pinkVersion?: string; commit?: string } | undefined;
    try {
      product = JSON.parse(
        await readFile(join(options.pink, "..", "resources/app/product.json"), "utf8"),
      ) as typeof product;
    } catch {
      /* Version is optional evidence. */
    }
    const outcome = abort.signal.aborted
      ? "stopped"
      : !finished
        ? "running"
        : !fatal && cases.every((c) => c.outcome === "passed" || c.outcome === "not-applicable")
          ? "passed"
          : values.plan === "four-groups" &&
              !fatal &&
              cases.every((c) => ["passed", "not-applicable", "blocked"].includes(c.outcome))
            ? "incomplete"
            : "failed";
    const single = cases.length === 1 ? cases[0] : undefined;
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(
        {
          schemaVersion: values.plan === "four-groups" ? 6 : 5,
          caseSource,
          planVerification,
          runtimeIdentity,
          configuredEngine,
          runId,
          outcome,
          failure: fatal ?? single?.failure,
          stage: single?.stage,
          suite: values.suite,
          plan: values.plan,
          profile,
          execution: {
            mode: "groups-of-two",
            maxTasksPerGroup: 2,
            timeoutBasis: "webview-observation",
            startupWaitTimeoutMs: options.queueTimeoutMs,
            processingTimeoutMs: options.timeoutMs,
            configurationTimeoutMs: options.configurationTimeoutMs,
            persistence: values.persistence,
            applyProfile: values["apply-profile"],
            sceneUuid: values.plan === "four-groups" ? undefined : sceneId,
            sceneSelection:
              values.plan === "four-groups"
                ? "from-case-inputs; see case sceneResolution"
                : undefined,
          },
          coverage:
            profile === "existing" && selected.some((p) => existingCandidate(p.id))
              ? {
                  selectedCaseIds: cases.map((item) => item.caseId),
                  configuration: agcMaterial
                    ? "AGC material selected via UI; matching JSON package; other current UI values retained"
                    : "current-UI-values; no profile writes or persistence exercise",
                  specialOptions: "explicit-visible-field-contracts; see each case for UI gaps",
                  endpoint: "build-success",
                  ...(selected.some((p) => p.id === "openpaas")
                    ? {
                        openpaasEndpoint:
                          "normal build-button task final success/failure; internal stages retained",
                      }
                    : {}),
                  artifactsVerified: false,
                }
              : !values.plan && selected.some((p) => existingCandidate(p.id))
                ? {
                    selectedCaseIds: cases.map((item) => item.caseId),
                    profile,
                    configuration:
                      "explicit platform D/A fields; final UI snapshot used for submission and terminal checks",
                    specialOptions:
                      "additional platforms preserve contracted current UI values; priority platforms retain their existing profile contracts",
                    persistence: values.persistence,
                    endpoint:
                      "normal build-button task final success/failure; OpenPaaS internal stages retained",
                    artifactsVerified: false,
                  }
                : values.plan
                  ? {
                      plan: values.plan,
                      selectedCaseIds: cases.map((item) => item.caseId),
                      ...(values.plan === "local-options-nine" || values.plan === "acceptance"
                        ? {
                            sourceMapsContract: {
                              ui: "string false/true/inline",
                              task: "boolean false/true or string inline",
                            },
                          }
                        : {}),
                      publicUI:
                        "independent representative checks, not an all-platform prerequisite",
                      targetSemantics:
                        "sourceCaseIds are design lineage; passing this case does not pass every branch in those source cases",
                      endpoint: "build-success",
                      artifactsVerified: false,
                      openpaas: selected.some((p) => p.id === "openpaas")
                        ? "normal build-button task final success/failure; internal stages retained"
                        : "excluded",
                    }
                  : release
                    ? {
                        round:
                          profile === "release-c-local"
                            ? "C-local"
                            : profile === "release-b"
                              ? "B"
                              : "A",
                        specialOptions:
                          profile === "release-c-local"
                            ? "local-return-branches"
                            : profile === "release-b"
                              ? "selected-non-defaults"
                              : values["apply-profile"]
                                ? "explicit-baseline-application"
                                : "baseline-only",
                        nonDefaultSpecialBranches:
                          profile !== "release-a" || values["apply-profile"]
                            ? "see-cases"
                            : "not-run",
                        otherPublicModes:
                          profile === "release-c-local"
                            ? "merge_all_json/local-return; Zip-remote not-run"
                            : profile === "release-b"
                              ? "merge_dep/subpackage/conditional-wasm"
                              : "not-run",
                        textureAtlasProcessingVerified: false,
                        deferred:
                          profile !== "release-a"
                            ? deferredReleaseBBranches()
                            : deferredReleaseBranches,
                      }
                    : undefined,
          platform: single?.platform,
          project: options.project,
          pink: { path: options.pink, version: product?.pinkVersion, commit: product?.commit },
          launch,
          configuration: single?.finalConfiguration,
          submittedAt: single?.submittedAt,
          task: single?.task,
          cases,
          groups,
          summary: {
            total: cases.length,
            passed: cases.filter((c) => c.outcome === "passed").length,
            failed: cases.filter((c) => c.outcome === "failed").length,
            blocked: cases.filter((c) => c.outcome === "blocked").length,
            notApplicable: cases.filter((c) => c.outcome === "not-applicable").length,
            notRun: cases.filter((c) => c.outcome === "not-run").length,
            submitted: cases.filter((c) => c.outcome === "submitted").length,
            stopped: cases.filter((c) => c.outcome === "stopped").length,
          },
          checks: {
            configurationModifiedByTool: cases.some((c) => c.changedFields.length > 0),
            artifactsVerified: false,
            runtimeVerified: false,
          },
          cleanup: {
            warnings,
            pinkCloseRequested: false,
            buildAutomaticallyCancelled: false,
            taskMayStillBeRunning: cases.some(
              (c) =>
                c.submittedAt !== undefined &&
                (!c.task || ["waiting", "processing"].includes(c.task.state)),
            ),
          },
          timeline,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  };
  const progress = new Map<string, string>();
  const supervise = () => {
    for (const result of cases) {
      if (!result.task) continue;
      const current = observedBuildTask(taskObserver!, result.task.id);
      result.task = current;
      result.timing = taskTiming(current, result.submittedAt!, Date.now());
      const state = `${current.state}:${current.progress}:${current.message ?? ""}`;
      if (progress.get(current.id) !== state) {
        report(
          "task",
          `${current.state} ${Math.round(current.progress * 100)}% ${current.message ?? ""}`,
          result,
          false,
        );
        progress.set(current.id, state);
      }
      const timeout = taskTimeout(
        current,
        result.submittedAt!,
        Date.now(),
        options.queueTimeoutMs,
        options.timeoutMs,
      );
      if (timeout && !result.failure) {
        result.timeout = timeout;
        result.failure =
          timeout === "startup-wait"
            ? "启动等待超时：未在上限内观察到 processing（包括排队及首次进度前准备）"
            : "构建观察超时：首次 processing 后超过上限";
        result.outcome = "failed";
        report("timeout", result.failure, result, false);
      }
    }
  };
  const checkSubmission = (baselineIds: Set<string>) => {
    try {
      abort.signal.throwIfAborted();
      taskObserver!.assertHealthy();
      const owned = new Set(cases.flatMap((result) => (result.task ? [result.task.id] : [])));
      const foreign = taskObserver!
        .tasks()
        .filter((task) => !isTerminal(task) && !owned.has(task.id));
      if (foreign.length)
        throw new Error(`存在本轮之外的活动任务：${foreign.map((task) => task.id).join(", ")}`);
      if (taskObserver!.tasks().some((task) => !baselineIds.has(task.id) && !owned.has(task.id)))
        throw new Error("本轮出现未关联的新任务，停止后续提交");
      if (cases.some((result) => result.timeout)) throw new Error("已发生任务超时，停止后续提交");
    } catch (error) {
      fatal = errorMessage(error);
      throw error;
    }
  };
  try {
    report("startup", "启动或连接指定 PinK，沿用当前用户环境");
    if (guardedPlan) {
      const current = await createOfflinePlan({
        casesFile: values["cases-file"],
        materials: values.materials,
        project: values.project,
        pink: values.pink,
        groups: values.groups,
        cases: values.cases,
        runConfig: values["run-config"],
        port: Number(values.port),
        timeoutsMs: guardedPlan.timeoutsMs,
      });
      await verifyExpectedPlan(resolve(values["expected-plan"]!), current);
    }
    const session = await startSession(options, abort.signal, (info) => {
      launch = info;
    });
    browser = session.browser;
    launch = { pid: session.pid, mode: session.mode, endpoint: session.endpoint };
    page = await findWindow(browser, options.project, abort.signal, options.pink);
    await confirmWindow();
    executionContext = new ExecutionContext(runtimeIdentity!, () =>
      assertWindowIdentity(page!, options.project, options.pink),
    );
    await waitFor(
      "工程构建分类就绪",
      async () =>
        (await page!.getByRole("tab", { name: selected[0].category, exact: true }).count()) === 1
          ? true
          : undefined,
      180_000,
      abort.signal,
    );
    const baselineIds = new Set<string>();
    const allSpecials = [
      ...new Map(
        [
          ...(values.plan
            ? plannedCases.flatMap((item) => [...item.specials, ...(item.preserveFields ?? [])])
            : release
              ? selected
                  .filter((p) => !existingCandidate(p.id))
                  .flatMap((p) => roundSpecials(combinationPlatform(p)))
              : []),
          ...selected.filter((p) => existingCandidate(p.id)).flatMap((p) => existingFields(p.id)),
        ].map((field) => [field.key, field]),
      ).values(),
    ];
    report("baseline", "提交前核对完整任务基线，保留两类面板的观察器");
    let initialIds: string | undefined;
    for (const category of new Set(selected.map((platform) => platform.category))) {
      report("baseline-category", `读取 ${category} 完整任务基线`);
      const observer = await Builder.open(
        page,
        session.endpoint,
        abort.signal,
        category,
        options.configurationTimeoutMs,
      );
      observers.set(category, observer);
      await observer.installProbe(
        allSpecials,
        selected.some((p) => p.id === "openpaas"),
        finalCaseKeys(plannedCases),
      );
      const tasks = await observer.baseline();
      report("baseline-category", `${category} 已观察 ${tasks.length} 项任务`);
      const ids = JSON.stringify(tasks.map((task) => task.id).sort());
      if (initialIds !== undefined && ids !== initialIds)
        throw new Error("两类面板的完整任务基线不一致");
      initialIds = ids;
      for (const task of tasks) baselineIds.add(task.id);
    }
    taskObserver = new TaskObserver([...observers.values()]);
    await taskObserver.poll();
    taskObserver.start(supervise);
    for (const group of groups) {
      group.startedAt = Date.now();
      group.outcome = "running";
      const groupCases = cases.filter((result) => result.group === group.number);
      report("group", `第 ${group.number} 组开始，最多 ${groupCases.length} 项`);
      for (const result of groupCases) {
        const platform = selected.find((item) => item.id === result.platform)!;
        const definition = definitions.get(result.caseId);
        let builder: Builder | undefined;
        try {
          if (definition?.finalized?.blockers.length) {
            result.blockerKind = definition.finalized.blockers[0].kind;
            throw new CasePrerequisiteError(
              definition.finalized.blockers[0].kind,
              definition.finalized.blockers.map((b) => b.reason).join("；"),
            );
          }
          checkSubmission(baselineIds);
          await confirmWindow();
          report("builder", `打开 ${platform.category} / ${platform.label}`, result);
          builder = await Builder.open(
            page,
            session.endpoint,
            abort.signal,
            platform.category,
            options.configurationTimeoutMs,
          );
          const existingContract = definition?.finalized
            ? []
            : [
                ...new Map(
                  [
                    ...(existingCandidate(platform.id) ? existingFields(platform.id) : []),
                    ...(definition?.preserveFields ?? []),
                  ]
                    .filter(
                      (field) => !definition?.specials.some((target) => target.key === field.key),
                    )
                    .map((field) => [field.key, field]),
                ).values(),
              ];
          let specials =
            definition?.specials ??
            (release && !existingCandidate(platform.id)
              ? roundSpecials(combinationPlatform(platform))
              : []);
          const expected =
            definition?.expected ??
            (profile === "debug"
              ? debugFields(combinationPlatform(platform))
              : profile === "release-c-local"
                ? releaseCLocalFields(combinationPlatform(platform))
                : profile === "release-b"
                  ? releaseBFields(combinationPlatform(platform))
                  : profile === "release-a"
                    ? releaseFields(combinationPlatform(platform))
                    : undefined);
          result.expected = expected;
          const keys = [
            ...new Set([
              ...(existingContract.length ? existingPublicKeys : []),
              ...Object.keys(expected ?? { debug: true }),
            ]),
          ];
          const loading = (state: ConfigurationReadiness["states"][number]) =>
            report(
              "configuration-loading",
              `${state.state}${state.missingField ? `：${state.missingField}` : ""}`,
              result,
              false,
            );
          report("configuration", "读取配置初态", result);
          if (definition?.finalized) {
            result.expected = undefined;
            const prepared = await prepareFinalizedCase(
              builder,
              definition,
              options.project,
              abort.signal,
              values["agc-services"],
              executionContext,
            );
            finalPrepared.set(result, prepared);
            result.finalized = prepared.evidence;
            if (
              prepared.evidence.checkpoints.some(
                (c) => c.key === "persistence" && c.state === "passed",
              )
            ) {
              result.persistenceCheck = { requested: true, state: "passed" };
              result.checks.persistence = true;
            }
            result.initial = prepared.configuration;
            result.finalConfiguration = prepared.configuration;
            result.changedFields = [...prepared.evidence.changed];
            result.confirmedChangedFields = [...prepared.evidence.changed];
            result.checks.uiConfiguration = true;
            result.checks.specialConfiguration = true;
            if (definition.finalized.endpoint === "ui") {
              await restoreFinalizedCase(
                builder,
                definition,
                prepared,
                options.project,
                abort.signal,
              );
              result.outcome = "passed";
              report("ui-complete", "UI 检查及恢复完成，未提交构建", result);
              continue;
            }
          } else {
            if (platform.id === "openpaas") {
              result.openpaasBuild = await prepareOpenpaasBuild(builder);
              result.initial = await builder.readConfiguration(keys, Date.now(), loading);
            } else if (platform.id === "huawei-agc" && agcMaterial) {
              report("configure-agc", "通过UI选择服务JSON并核对匹配包名", result);
              result.agcServices = await configureAgc(builder, agcMaterial);
              result.changedFields.push(...result.agcServices.changed);
              result.confirmedChangedFields.push(...result.agcServices.changed);
              // The original two AGC values are in agcServices.before. Public values are unchanged.
              result.initial = await builder.readConfiguration(keys, Date.now(), loading);
            } else {
              result.initial = await builder.configuration(
                platform,
                keys.filter((key) => key !== "wasmCompressionMode"),
                loading,
              );
            }
            if (definition?.expandSection) await builder.expandSection(definition.expandSection);
            result.configurationReadiness = { initial: builder.readinessEvidence() };
            if (existingContract.length) {
              const view = await builder.configurationPage();
              const observed = await builder.readSpecialFields(existingContract);
              const checkedKeys = new Set(
                [...existingContract, ...specials].map((field) => field.key),
              );
              result.existingConfiguration = {
                contracts: existingContract,
                values: observed,
                uiUncovered: [
                  ...view.fields
                    .filter(
                      (field) =>
                        field.visible &&
                        field.key.startsWith(`packages.${platform.id}.`) &&
                        !checkedKeys.has(field.key),
                    )
                    .map((field) => field.key),
                  ...view.unkeyedFields
                    .filter(
                      (field) =>
                        ![...existingContract, ...specials].some(
                          (contract) => contract.uiLabel === field.label,
                        ),
                    )
                    .map((field) => `custom:${field.label}`),
                ],
              };
              caseSpecials.set(
                result,
                existingContract.map((field) => ({ ...field, expected: observed[field.key] })),
              );
            }
            if (definition?.initialPublic)
              assertConfiguration(result.initial, definition.initialPublic);
            if (specials.length) {
              const layout = await builder.specialLayout(specials);
              specials = layout.fields;
              caseSpecials.set(result, specials);
              report(
                "special-baseline",
                `回读 ${specials.length} 个专属字段，核对未授权变化的基准`,
                result,
              );
              result.specialConfiguration = {
                mode:
                  profile !== "release-a" || values["apply-profile"] ? "non-default" : "baseline",
                variant: layout.variant,
                uiUncovered: layout.uiUncovered,
                expected: Object.fromEntries(specials.map((field) => [field.key, field.expected])),
              };
              const initiallyHidden = [...(definition?.hiddenAtStart ?? [])];
              if (definition?.purpose === "target") {
                // Ordinary targets may start on either side. Read visible parent controls before children.
                const conditionalParents = [
                  { parent: "encrypted", hiddenWhen: false, children: ["xxteaKey", "compressZip"] },
                  { parent: "globalAdapter", hiddenWhen: true, children: ["globalVariable"] },
                  { parent: "androidInstant", hiddenWhen: false, children: ["remoteUrl"] },
                  {
                    parent: "renderBackEnd.gles3",
                    hiddenWhen: false,
                    children: ["renderBackEnd.gles2"],
                  },
                ];
                for (const rule of conditionalParents) {
                  const parent = specials.find(
                    (field) => field.key === `packages.${platform.id}.${rule.parent}`,
                  );
                  const children = specials.filter((field) =>
                    rule.children.some((key) => field.key === `packages.${platform.id}.${key}`),
                  );
                  if (!parent || !children.length) continue;
                  const observed = await builder.readSpecialFields([parent]);
                  if (observed[parent.key] === rule.hiddenWhen)
                    initiallyHidden.push(...children.map((field) => field.key));
                }
              }
              await builder.assertSpecialHidden(
                specials.filter((field) => initiallyHidden.includes(field.key)),
              );
              result.specialConfiguration.initial = await builder.readSpecialFields(
                specials.filter((field) => !initiallyHidden.includes(field.key)),
              );
              if (definition) {
                result.hiddenFields = {
                  initial: initiallyHidden,
                  final: [],
                  retainedFromInitial: {},
                };
                assertSpecialValues(
                  result.specialConfiguration.initial,
                  specials
                    .filter((field) => Object.hasOwn(definition.initialSpecial ?? {}, field.key))
                    .map((field) => ({
                      ...field,
                      expected: definition.initialSpecial![field.key],
                    })),
                );
              }
              const baseline = definition ? [] : specialFields(combinationPlatform(platform));
              const writable = specials.filter((field) =>
                definition
                  ? definition.writes.some((step) => step.key === field.key)
                  : canApplySpecial(field) &&
                    (values["apply-profile"] ||
                      profile === "release-c-local" ||
                      (profile === "release-b" &&
                        field.expected !==
                          baseline.find((item) => item.key === field.key)?.expected)),
              );
              const unchanged = specials.filter(
                (field) => !writable.includes(field) && !initiallyHidden.includes(field.key),
              );
              assertSpecialValues(result.specialConfiguration.initial, unchanged);
            }
            result.finalConfiguration = result.initial;
            if (expected) {
              if (result.initial.name !== project.name)
                throw new Error("构建名称与目标工程清单不一致");
              assertScene(result.initial, sceneId);
              if (
                platform.id === "taobao-mini-game" &&
                (profile === "release-c-local" || expected.nativeCodeBundleMode === "asmjs")
              ) {
                if (result.initial.fields.nativeCodeBundleMode !== "asmjs") {
                  const cleared = await builder.setField("wasmCompressionMode", false);
                  result.changedFields.push("wasmCompressionMode");
                  if (cleared) result.confirmedChangedFields.push("wasmCompressionMode");
                  result.conditionalSteps = [
                    {
                      key: "wasmCompressionMode",
                      expected: false,
                      state: cleared ? "read-back-before-hiding" : "unchanged-before-hiding",
                    },
                  ];
                } else {
                  result.conditionalSteps = [
                    {
                      key: "wasmCompressionMode",
                      expected: false,
                      state: "not-observed-hidden-at-start",
                    },
                  ];
                }
              }
              for (const [key, value] of Object.entries(expected!)) {
                report("configure", `${key} → ${JSON.stringify(value)}`, result);
                // Record before sending input: a delivery error may still have changed this field.
                if (result.initial.fields[key] !== value) result.changedFields.push(key);
                if (await builder.setField(key, value)) result.confirmedChangedFields.push(key);
              }
              if (
                result.specialConfiguration &&
                (definition ||
                  profile === "release-b" ||
                  profile === "release-c-local" ||
                  values["apply-profile"])
              ) {
                const writes = definition
                  ? definition.writes.map((step) => ({
                      step,
                      field: specials.find((field) => field.key === step.key)!,
                    }))
                  : specials.filter(canApplySpecial).map((field) => ({
                      field,
                      step: { key: field.key, before: undefined, input: undefined },
                    }));
                for (const { field, step } of writes) {
                  if (!field) throw new Error(`未定义写入字段：${step.key}`);
                  const before = await builder.readSpecialFields([field]);
                  if (step.before !== undefined) {
                    assertSpecialValues(before, [{ ...field, expected: step.before }]);
                    (result.conditionalSteps ??= []).push({
                      key: field.key,
                      expected: step.before,
                      state: "read-back-before-writing",
                    });
                  }
                  if (before[field.key] === field.expected) continue;
                  result.changedFields.push(field.key);
                  report(
                    "configure-special",
                    `${field.key} → ${JSON.stringify(field.expected)}`,
                    result,
                  );
                  if (await builder.setSpecialField(field, step.input))
                    result.confirmedChangedFields.push(field.key);
                }
              }
              result.configured = await builder.readConfiguration(keys);
              if (result.specialConfiguration) {
                const hidden = definition?.hiddenAtEnd ?? [];
                await builder.assertSpecialHidden(
                  specials.filter((field) => hidden.includes(field.key)),
                );
                const visible = specials.filter((field) => !hidden.includes(field.key));
                result.specialConfiguration.configured = await builder.readSpecialFields(visible);
                assertSpecialValues(result.specialConfiguration.configured, visible);
                if (result.hiddenFields) {
                  result.hiddenFields.final = hidden;
                  result.hiddenFields.retainedFromInitial = Object.fromEntries(
                    hidden.map((key) => {
                      const value = result.specialConfiguration!.initial![key];
                      if (value !== specials.find((field) => field.key === key)?.expected)
                        throw new Error(`隐藏字段缺少已确认初值：${key}`);
                      return [key, value];
                    }),
                  );
                }
              }
              assertConfiguration(result.configured, expected!);
              assertScene(result.configured, sceneId);
              if (definition?.webgpuPreview !== undefined)
                result.webgpuPreviewUI = await builder.checkMobileWebGPUHint(
                  definition.webgpuPreview,
                );
              result.checks.uiConfiguration = true;
              result.finalConfiguration = result.configured;
              if (result.specialConfiguration) {
                result.specialConfiguration.final = result.specialConfiguration.configured;
                result.checks.specialConfiguration = true;
              }
              if (persistenceRequested) {
                if (!result.confirmedChangedFields.length) {
                  result.persistenceCheck.state = "blocked";
                  throw new Error(
                    "保存专项要求真实合法变化；当前已等于目标，不能以同值重开算修改通过",
                  );
                }
                report("persistence", "关闭并重开配置，核对保存值及最终输出名称", result);
                await builder.closeConfiguration();
                result.reopened = await builder.configuration(platform, keys, loading);
                result.configurationReadiness!.reopened = builder.readinessEvidence();
                if (result.specialConfiguration) {
                  result.specialConfiguration.reopened = await builder.readSpecialFields(specials);
                  assertSpecialValues(result.specialConfiguration.reopened, specials);
                  result.checks.specialConfiguration = true;
                }
                assertConfiguration(result.reopened, expected!);
                assertScene(result.reopened, sceneId);
                if (
                  result.reopened.startSceneId !== result.initial.startSceneId ||
                  result.reopened.name !== result.initial.name ||
                  result.reopened.buildPath !== result.initial.buildPath
                )
                  throw new Error("关闭重开后工程名称、场景或构建路径发生非预期变化");
                result.checks.persistence = true;
                result.persistenceCheck.state = "passed";
                result.finalConfiguration = result.reopened;
                if (result.specialConfiguration)
                  result.specialConfiguration.final = result.specialConfiguration.reopened;
              }
            }
          }
          let configuration = result.finalConfiguration;
          if (!configuration) throw new Error("提交前缺少最终配置快照");
          if (profile === "existing") {
            // Preserve the current form: observe its value, then verify this submission received it.
            assertScene(configuration, sceneId);
            const debug = configuration.fields.debug;
            if (typeof debug !== "boolean") throw new Error("当前配置缺少可核对的 Debug 值");
            result.expected = { debug };
            result.checks.uiConfiguration = true;
          }
          if (existingContract.length) {
            if (configuration.name !== project.name)
              throw new Error("构建名称与目标工程清单不一致");
            const final = await builder.readConfiguration(keys);
            assertConfiguration(final, configuration.fields);
            if (
              final.name !== configuration.name ||
              final.buildPath !== configuration.buildPath ||
              final.startSceneId !== configuration.startSceneId ||
              final.outputName !== configuration.outputName
            )
              throw new Error("只读回读期间工程、场景、路径或输出名称发生变化，停止提交");
            const fields = existingContract.map((field) => ({
              ...field,
              expected: result.existingConfiguration!.values[field.key],
            }));
            assertSpecialValues(await builder.readSpecialFields(existingContract), fields);
            result.finalConfiguration = final;
            configuration = final;
            result.expected = { ...final.fields };
            result.checks.specialConfiguration = true;
          }
          checkSubmission(baselineIds);
          const finalMaterial = finalPrepared.get(result)?.agcMaterial;
          if (
            finalMaterial &&
            (await readAgcMaterial(finalMaterial.path)).sha256 !== finalMaterial.sha256
          )
            throw new Error("AGC 材料在配置后发生变化，停止本项提交");
          if (result.agcServices && agcMaterial) {
            const currentMaterial = await readAgcMaterial(agcMaterial.path);
            if (currentMaterial.sha256 !== agcMaterial.sha256)
              throw new Error("AGC服务文件在配置后发生变化，停止提交");
          }
          const preparedConfiguration = finalPrepared.get(result);
          report("submit", `点击一次构建：${configuration.outputName}`, result);
          const submission = await submitBuild({
            source: taskObserver!,
            baselineIds,
            platform: platform.id,
            outputName: configuration.outputName,
            signal: abort.signal,
            verify: async () => {
              checkSubmission(baselineIds);
              await confirmWindow();
              if (preparedConfiguration)
                await preparedConfiguration.operations.assertSnapshotCurrent(
                  preparedConfiguration.snapshot,
                );
            },
            click: () => builder!.click("button", "构建"),
            onAttempt: (at) => {
              result.submittedAt = at;
            },
          });
          result.task = submission.task;
          result.acceptedAt = submission.acceptedAt;
          result.stateAtAcceptance = result.task.state;
          result.queuedTask = structuredClone(result.task);
          result.outcome = "submitted";
          report("queued", "核对本次唯一任务的入队参数", result);
          if (result.finalized) {
            assertFinalizedTask(result.task, result.finalized);
            result.checks.queuedTaskOptions = true;
            result.checks.specialQueuedTaskOptions = true;
          }
          if (result.existingConfiguration) {
            result.existingConfiguration.queuedTaskChecks = checkExistingTask(
              result.task,
              result.existingConfiguration.contracts ?? existingFields(result.platform),
              result.existingConfiguration.values,
            );
            result.checks.specialQueuedTaskOptions = true;
          }
          // Check the queued snapshot now, and the execution snapshot again during collection.
          if (result.expected) {
            assertTaskOptions(result.task, configuration, result.expected);
            if (
              result.conditionalSteps?.some((step) =>
                ["read-back-before-hiding", "unchanged-before-hiding"].includes(step.state),
              ) &&
              optionAt(result.task.options!, "wasmCompressionMode") !== undefined
            )
              throw new Error("关闭压缩后任务仍携带wasmCompressionMode");
            result.checks.queuedTaskOptions = true;
          }
          if (result.specialConfiguration) {
            result.specialConfiguration.queuedTaskChecks = assertSpecialTask(result.task, specials);
            result.checks.specialQueuedTaskOptions = true;
          }
          report(
            "accepted",
            `已关联 ${result.task.id}（${result.task.state}），继续下一配置`,
            result,
          );
        } catch (error) {
          if (error instanceof ConfigurationOperationError && error.disposition === "stop")
            fatal = error.message;
          if (error instanceof FormSampleError && definition?.finalized) {
            result.finalized = {
              revision: definition.finalized.revision,
              group: "conditional",
              endpoint: "ui",
              values: {},
              changed: [],
              preserved: [],
              checkpoints: [],
              restoration: error.evidence.restoration,
              formValidation: error.evidence,
            };
            if (error.prerequisite) result.blockerKind = "initial-state";
          }
          if (error instanceof ConfigurationReadinessError) {
            result.configurationReadiness ??= {};
            result.configurationReadiness.failure = error.evidence;
            fatal = "配置页未就绪，停止后续提交并收集已关联任务";
          }
          if (error instanceof CasePrerequisiteError) result.blockerKind = error.kind;
          if (error instanceof ConfigurationOperationError && error.disposition === "blocked")
            result.blockerKind = "initial-state";
          if (errorMessage(error).includes("条件用例配置恢复失败")) fatal = errorMessage(error);
          result.failure = errorMessage(error);
          if (result.stage === "persistence" && result.persistenceCheck.state !== "blocked")
            result.persistenceCheck.state = "failed";
          result.outcome = abort.signal.aborted
            ? "stopped"
            : error instanceof ConfigurationOperationError && error.disposition === "blocked"
              ? "blocked"
              : error instanceof CasePrerequisiteError && error.kind === "not-applicable"
                ? "not-applicable"
                : error instanceof FormSampleError && error.prerequisite
                  ? "blocked"
                  : definition?.finalized && !(error instanceof CasePrerequisiteError)
                    ? "failed"
                    : result.submittedAt === undefined
                      ? "blocked"
                      : "failed";
          console.error(`[${result.caseId}][${result.stage}] ${result.failure}`);
          if (
            (release ||
              (existingCandidate(result.platform) &&
                existingFields(result.platform).some((field) => field.fingerprint))) &&
            result.submittedAt === undefined
          )
            result.screenshotOmittedReason =
              "配置含脱敏身份或平台私密字段，提交前失败仅保存脱敏回读值";
          else if (page && !page.isClosed()) {
            try {
              result.screenshot = `${result.caseId}-failure.png`;
              await page.screenshot({ path: join(directory, result.screenshot), timeout: 5000 });
            } catch {
              result.screenshot = undefined;
            }
          }
        } finally {
          try {
            if (!fatal)
              await builder?.closeConfiguration(
                definition?.finalized ? () => executionContext!.verify() : undefined,
              );
          } catch (error) {
            warnings.push(errorMessage(error));
            fatal = "Builder 配置关闭失败，停止后续提交";
          }
          try {
            await builder?.close();
          } catch (error) {
            warnings.push(errorMessage(error));
            fatal = "Builder 清理失败，停止后续提交";
          }
          await save();
        }
        // A uniquely associated task remains observable even when its parameters fail a check.
        // Collect its terminal state and retain the case failure without blocking unrelated cases.
        if (result.submittedAt !== undefined && result.failure && !result.task)
          fatal ??= "提交是否生效不明，停止后续提交";
        if (abort.signal.aborted || fatal || page.isClosed()) break;
      }
      group.submissionsClosedAt = Date.now();
      report("collection", `第 ${group.number} 组提交结束，等待本组收尾后再开下一组`);
      while (
        groupCases.some((result) => result.task && !result.timeout && !isTerminal(result.task))
      ) {
        abort.signal.throwIfAborted();
        taskObserver.assertHealthy();
        await delay(1000, undefined, { signal: abort.signal });
        await save();
      }
      taskObserver.assertHealthy();
      // Refresh each category through the real history UI before final card checks.
      for (const category of new Set(
        groupCases.filter((result) => result.task).map((result) => result.category),
      )) {
        if (fatal) break;
        await executionContext.verify();
        const ui = await Builder.open(
          page,
          session.endpoint,
          abort.signal,
          category,
          options.configurationTimeoutMs,
        );
        try {
          await observers.get(category)!.historySnapshot();
          await taskObserver.poll();
          supervise();
          for (const result of groupCases.filter(
            (item) => item.category === category && item.task,
          )) {
            try {
              const current = taskObserver.get(result.task!.id);
              if (!current) throw new Error("最终完整列表中没有本次任务");
              result.task = current;
              result.timing = taskTiming(current, result.submittedAt!, Date.now());
              if (!result.failure) report("collect", "核对本次任务终态及参数", result);
              if (result.finalized && !result.failure) {
                assertFinalizedTask(current, result.finalized);
                result.checks.taskOptions = true;
                result.checks.specialTaskOptions = true;
              }
              if (result.failure) {
                const prepared = finalPrepared.get(result);
                if (prepared && definitions.get(result.caseId)?.finalized?.scenario) {
                  await restoreFinalizedCase(
                    ui,
                    definitions.get(result.caseId)!,
                    prepared,
                    options.project,
                    abort.signal,
                  );
                }
                continue;
              }
              assertBuildSucceeded(current);
              const configuration = result.finalConfiguration;
              if (!configuration) throw new Error("终态核对缺少最终配置快照");
              if (result.expected) {
                assertTaskOptions(current, configuration, result.expected);
                if (
                  result.conditionalSteps?.some((step) =>
                    ["read-back-before-hiding", "unchanged-before-hiding"].includes(step.state),
                  ) &&
                  optionAt(current.options!, "wasmCompressionMode") !== undefined
                )
                  throw new Error("终态任务仍携带已关闭的wasmCompressionMode");
                result.checks.taskOptions = true;
              }
              if (result.specialConfiguration) {
                result.specialConfiguration.taskChecks = assertSpecialTask(
                  current,
                  caseSpecials.get(result)!,
                );
                result.checks.specialTaskOptions = true;
              }
              if (result.existingConfiguration) {
                result.existingConfiguration.taskChecks = checkExistingTask(
                  current,
                  result.existingConfiguration.contracts ?? existingFields(result.platform),
                  result.existingConfiguration.values,
                );
                result.checks.specialTaskOptions = true;
              }
              report("ui-confirmation", "复核本次成功卡片", result);
              await ui.revealTask(current);
              await waitFor(
                "本次卡片成功",
                () => ui.successText(configuration.outputName, result.platform),
                15_000,
                abort.signal,
              );
              result.checks.uiSuccess = true;
              const prepared = finalPrepared.get(result);
              if (prepared)
                await restoreFinalizedCase(
                  ui,
                  definitions.get(result.caseId)!,
                  prepared,
                  options.project,
                  abort.signal,
                );
              result.outcome = "passed";
              report("complete", `成功：${current.id}，未检查产物`, result);
            } catch (error) {
              if (error instanceof ConfigurationOperationError && error.disposition === "stop")
                fatal = error.message;
              if (errorMessage(error).includes("条件用例配置恢复失败")) fatal = errorMessage(error);
              result.failure = errorMessage(error);
              result.outcome = abort.signal.aborted ? "stopped" : "failed";
              console.error(`[${result.caseId}][${result.stage}] ${result.failure}`);
              if (definitions.get(result.caseId)?.finalized)
                result.screenshotOmittedReason = "四组场景可能含平台身份或签名，只保留脱敏状态";
              else if (!page.isClosed()) {
                try {
                  result.screenshot = `${result.caseId}-failure.png`;
                  await page.screenshot({
                    path: join(directory, result.screenshot),
                    timeout: 5000,
                  });
                } catch {
                  result.screenshot = undefined;
                }
              }
            }
            const preparedAfterFailure = finalPrepared.get(result);
            if (
              !fatal &&
              preparedAfterFailure &&
              preparedAfterFailure.evidence.restoration === "pending" &&
              result.task &&
              isTerminal(result.task)
            ) {
              try {
                await restoreFinalizedCase(
                  ui,
                  definitions.get(result.caseId)!,
                  preparedAfterFailure,
                  options.project,
                  abort.signal,
                );
              } catch (error) {
                fatal = errorMessage(error);
                result.failure = fatal;
                result.outcome = "failed";
              }
            }
            await save();
            if (fatal) break;
          }
        } finally {
          await ui.close();
        }
      }
      const tasks = groupCases.flatMap((result) => (result.task ? [result] : []));
      group.queueCoverage =
        groupCases.length < 2
          ? "not-applicable"
          : tasks.length === 2 &&
              tasks[1].submittedAt! < (tasks[0].task!.completedAt ?? 0) &&
              tasks[1].task!.observation?.waitingAt !== undefined &&
              tasks[1].task!.observation?.processingAt !== undefined &&
              tasks.every((result) => result.outcome === "passed")
            ? "observed"
            : "not-observed";
      if (tasks.some((result) => !isTerminal(result.task!))) {
        fatal ??= "本组仍有任务未收尾，停止后续分组";
        group.outcome = "failed";
      } else {
        group.settledAt = Date.now();
        group.outcome = groupCases.every(
          (result) => result.outcome === "passed" || result.outcome === "not-applicable",
        )
          ? "passed"
          : "failed";
      }
      report(
        "group-complete",
        `第 ${group.number} 组 ${group.outcome}，队列覆盖 ${group.queueCoverage}`,
      );
      await save();
      if (abort.signal.aborted || fatal || page.isClosed()) break;
    }
  } catch (error) {
    fatal = errorMessage(error);
    console.error(fatal);
  } finally {
    executionContext?.invalidate();
    await taskObserver?.stop().catch((error) => {
      warnings.push(errorMessage(error));
      fatal ??= "任务观察器停止失败";
    });
    for (const group of groups) if (group.outcome === "running") group.outcome = "failed";
    for (const result of cases) {
      if (result.outcome === "submitted") {
        result.outcome = abort.signal.aborted ? "stopped" : "failed";
        result.failure ??= fatal ?? "未完成统一结果收集";
      }
    }
    for (const observer of observers.values()) {
      try {
        await observer.close();
      } catch (error) {
        warnings.push(errorMessage(error));
        fatal ??= "任务观察器释放失败";
      }
    }
    try {
      await browser?.close();
    } catch (error) {
      warnings.push(errorMessage(error));
    }
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    finished = true;
    await save();
    console.log(`结果：${join(directory, "result.json")}`);
    try {
      console.log(`报告：${await writeResultReport(join(directory, "result.json"))}`);
    } catch (error) {
      fatal ??= `HTML 报告生成失败：${errorMessage(error)}`;
      warnings.push(`HTML 报告生成失败：${errorMessage(error)}`);
      console.error(warnings.at(-1));
      await save();
    }
    process.exitCode = abort.signal.aborted
      ? 130
      : !fatal && cases.every((c) => c.outcome === "passed" || c.outcome === "not-applicable")
        ? 0
        : 1;
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 2;
});

import { readFile, stat, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { caseContract } from "./case-contract.js";
import { publicValues } from "./case-inputs.js";
import { readFinalMaterials, selectFinalizedCases } from "./finalized-cases.js";
import { platformCatalog } from "./platform-catalog.js";
import { readAgcMaterial } from "./agc.js";
import { describeFieldCapabilities, validateExecutableCatalog } from "./field-capabilities.js";
import { sealPlan, valueHash, contentHash } from "./plan-integrity.js";

export interface RunConfiguration {
  schemaVersion: 1;
  pink?: string;
  project?: string;
  casesFile?: string;
  materials?: string;
  groups?: string;
  caseIds?: string[];
  port?: number;
  results?: string;
  expectedPlan?: string;
}
export async function readRunConfiguration(file: string): Promise<RunConfiguration> {
  const data: unknown = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("启动配置必须是对象");
  const value = data as RunConfiguration;
  if (value.schemaVersion !== 1) throw new Error("启动配置仅支持 schemaVersion 1");
  for (const key of Object.keys(value))
    if (
      ![
        "schemaVersion",
        "pink",
        "project",
        "casesFile",
        "materials",
        "groups",
        "caseIds",
        "port",
        "results",
        "expectedPlan",
      ].includes(key)
    )
      throw new Error(`启动配置未知字段：${key}`);
  for (const key of [
    "pink",
    "project",
    "casesFile",
    "materials",
    "results",
    "expectedPlan",
    "groups",
  ] as const)
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key]?.trim()))
      throw new Error(`启动配置 ${key} 需要非空字符串`);
  if (
    value.caseIds !== undefined &&
    (!Array.isArray(value.caseIds) ||
      !value.caseIds.length ||
      value.caseIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(value.caseIds).size !== value.caseIds.length)
  )
    throw new Error("启动配置 caseIds 需要不重复的用例ID数组");
  if (
    value.port !== undefined &&
    (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535)
  )
    throw new Error("启动配置 port 必须为1024–65535的整数");
  for (const key of [
    "pink",
    "project",
    "casesFile",
    "materials",
    "results",
    "expectedPlan",
  ] as const)
    if (value[key]) value[key] = resolve(dirname(resolve(file)), value[key]!);
  return value;
}
export async function pinkExecutable(path: string): Promise<string> {
  const absolute = resolve(path);
  const info = await stat(absolute);
  const executable = info.isDirectory() ? join(absolute, "PinK.exe") : absolute;
  if (!(await stat(executable)).isFile()) throw new Error("未找到指定 PinK.exe");
  return realpath(executable);
}

export async function createOfflinePlan(options: {
  casesFile?: string;
  materials?: string;
  project?: string;
  pink?: string;
  groups?: string;
  cases?: string;
  runConfig?: string;
  port?: number;
  timeoutsMs?: { startupWait: number; processing: number; configuration: number };
}) {
  const casesFile = resolve(
    options.casesFile ??
      fileURLToPath(new URL("../../case-catalog/public-combinations.json", import.meta.url)),
  );
  const bytes = await readFile(casesFile);
  const catalog = validateExecutableCatalog(
    JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
  );
  const materials = await readFinalMaterials(options.materials);
  const timeoutsMs = options.timeoutsMs ?? {
    startupWait: 1_800_000,
    processing: 600_000,
    configuration: 120_000,
  };
  const startup: {
    pink?: { path: string; version?: string; commit?: string };
    project?: string;
    issues: string[];
    runtimeVerified: false;
    port: number;
    debugPortOwnershipVerified: false;
  } = {
    issues: [],
    runtimeVerified: false,
    port: options.port ?? 9222,
    debugPortOwnershipVerified: false,
  };
  if (!Number.isInteger(startup.port) || startup.port < 1024 || startup.port > 65535)
    startup.issues.push("调试端口必须为1024–65535的整数；未查询运行实例");
  if (Object.values(timeoutsMs).some((value) => !Number.isFinite(value) || value < 1000))
    startup.issues.push("各阶段超时必须至少为1秒");
  if (options.project) {
    try {
      startup.project = await realpath(resolve(options.project));
      const project = JSON.parse(await readFile(join(startup.project, "package.json"), "utf8"));
      if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error();
    } catch {
      startup.issues.push("测试工程不可读取或缺少有效 package.json");
    }
  }
  if (options.pink) {
    try {
      const path = await pinkExecutable(options.pink);
      const product = JSON.parse(
        await readFile(join(dirname(path), "resources/app/product.json"), "utf8"),
      );
      startup.pink = {
        path,
        version: typeof product.pinkVersion === "string" ? product.pinkVersion : undefined,
        commit: typeof product.commit === "string" ? product.commit : undefined,
      };
      if (!startup.pink.version)
        startup.issues.push("安装包 product.json 缺少版本；尚未确认待测版本");
    } catch {
      startup.issues.push("待测 PinK 安装包或 product.json 不可读取");
    }
  }
  const selected = await selectFinalizedCases(options.cases, options.groups, materials, {
    catalog,
    catalogPath: casesFile,
    project: startup.project,
  });
  const cases = await Promise.all(
    selected.map(async (item, index) => {
      const c = item.finalized!;
      const blockers = [...c.blockers];
      if (
        item.platform === "huawei-agc" &&
        c.endpoint === "build" &&
        typeof c.values["packages.huawei-agc.serviceConfigPath"] === "string"
      ) {
        try {
          const agc = await readAgcMaterial(
            c.values["packages.huawei-agc.serviceConfigPath"] as string,
          );
          if (agc.packageName !== c.values["packages.huawei-agc.packageName"])
            blockers.push({ kind: "material", reason: "AGC 服务 JSON 包名与用例目标不同" });
        } catch {
          blockers.push({
            kind: "material",
            reason: "AGC 服务 JSON 不可解析或缺少 client.package_name",
          });
        }
      }
      if (!platformCatalog.some((p) => p.id === item.platform))
        blockers.push({ kind: "ui-adapter", reason: "此平台尚未注册 UI 接入描述" });
      const state = blockers.some((b) => b.kind === "not-applicable")
        ? "not-applicable"
        : blockers.length
          ? "blocked"
          : "ready-for-runtime-preflight";
      return {
        caseId: item.caseId,
        title: item.title,
        platform: item.platform,
        group: c.group,
        batch: Math.floor(index / 2) + 1,
        endpoint: c.endpoint,
        state,
        values: publicValues(c.values, catalog.fieldTypes),
        retained: c.retained,
        formValidation: c.formValidation
          ? {
              sampleId: c.formValidation.sampleId,
              sourceSha256: c.formValidation.sourceSha256,
              kind: c.formValidation.execution.kind,
              field: c.formValidation.execution.field,
              alert: c.formValidation.execution.alert,
              trigger: c.formValidation.execution.trigger,
              requiresNonEmpty: c.formValidation.execution.requiresNonEmpty,
              unchanged: c.formValidation.execution.unchanged,
              after: c.formValidation.execution.after?.map((a) => ({
                field: a.field,
                disabled: a.disabled,
                value: publicValues({ [a.field]: a.value }, catalog.fieldTypes)[a.field],
              })),
              child: c.formValidation.execution.child,
              input: c.formValidation.execution.input,
              submitted: false,
              prepare: c.formValidation.execution.prepare?.map((step) => ({
                field: step.field,
                value: publicValues({ [step.field]: step.value }, catalog.fieldTypes)[step.field],
              })),
              setup: c.formValidation.execution.setup?.map((step) => ({
                field: step.field,
                value: publicValues({ [step.field]: step.value }, catalog.fieldTypes)[step.field],
              })),
            }
          : undefined,
        assignments: (c.formValidation
          ? [
              ...(c.formValidation.execution.setup ?? []).map((s) => s.field),
              ...(["field-input", "parent-visibility"].includes(c.formValidation.execution.kind)
                ? [c.formValidation.execution.field]
                : []),
            ]
          : caseContract.orderedKeys(c.values, c.configurationOrder)
        ).map((field) => ({
          field,
          value: publicValues({ [field]: c.values[field] }, catalog.fieldTypes)[field],
          operation: c.formValidation
            ? "temporary-UI-input-with-readback-and-restoration"
            : "set-target-if-different-and-read-back",
        })),
        materialRefs: c.materialRefs,
        blockers,
        sceneResolution: c.sceneContext ? structuredClone(c.sceneContext) : undefined,
        runtimeChecks: [
          "installed-process-and-port-owner",
          "actual-workspace-file-URI",
          "builder-ready",
          "platform-dialog-identity",
          "field-candidates-and-visibility",
          "final-UI-readback",
          ...(c.endpoint === "build"
            ? ["queued-task-parameters", "terminal-task-parameters", "task-success-card"]
            : ["UI-check-and-restoration"]),
        ],
      };
    }),
  );
  const materialFiles: Array<{ path: string; sha256: string | null }> = [];
  const inputPaths = new Set<string>();
  for (const reference of new Set(selected.flatMap((c) => c.finalized?.materialRefs ?? []))) {
    if (!reference.endsWith(".path")) continue;
    let bound: unknown = materials.bindings;
    for (const part of reference.split("."))
      bound =
        bound && typeof bound === "object" ? (bound as Record<string, unknown>)[part] : undefined;
    if (typeof bound === "string") inputPaths.add(bound);
  }
  for (const item of selected)
    for (const [key, value] of [
      ...Object.entries(item.finalized?.values ?? {}),
      ...(item.finalized?.formValidation?.execution.prepare ?? []).map(
        (step) => [step.field, step.value] as const,
      ),
    ])
      if (
        typeof value === "string" &&
        value &&
        !value.includes("://") &&
        ((key !== "buildPath" && /(?:Path|\.icon)$/.test(key)) ||
          (key === "packages.google-play.customIcon" && !["default", "custom"].includes(value)))
      )
        inputPaths.add(resolve(value));
  for (const path of inputPaths)
    materialFiles.push({
      path,
      sha256: await readFile(path)
        .then(contentHash)
        .catch(() => null),
    });
  materialFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sealPlan({
    kind: "pink-build-plan",
    schemaVersion: 1,
    phase: "offline",
    runtimeVerified: false,
    buildSubmitted: false,
    engineSettingsModified: false,
    maxTasksPerGroup: 2,
    capabilitiesSha256: valueHash(describeFieldCapabilities()),
    selection: {
      groups: (options.groups ?? "publish,debug,mixed,conditional").split(",").map((s) => s.trim()),
      requestedCaseIds: options.cases?.split(",").map((s) => s.trim()) ?? null,
    },
    timeoutsMs,
    snapshot: {
      casesFile,
      revision: catalog.revision,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      materialsFile: options.materials ? resolve(options.materials) : undefined,
      runConfig: options.runConfig ? resolve(options.runConfig) : undefined,
      materialsSha256: valueHash(materials),
      materialFiles,
      projectPackageSha256: startup.project
        ? await readFile(join(startup.project, "package.json"))
            .then(contentHash)
            .catch(() => null)
        : null,
    },
    startup,
    cases,
    summary: {
      total: cases.length,
      readyForRuntimePreflight: cases.filter((c) => c.state === "ready-for-runtime-preflight")
        .length,
      blocked: cases.filter((c) => c.state === "blocked").length,
      notApplicable: cases.filter((c) => c.state === "not-applicable").length,
    },
    limitations: [
      "离线文件可访问不等于签名有效、账号可用或构建成功",
      "primary/secondary 是离线候选，运行时须核对真实UI并优先当前有效初始场景",
      "未连接PinK；安装包文件版本不等于运行实例身份；引擎设置未改变",
    ],
  });
}

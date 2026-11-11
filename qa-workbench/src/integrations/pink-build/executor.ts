import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { atomicWrite, hash, json, readJson, Serial } from "../../main/files.js";
import { verifyNodeRuntime } from "../../main/nodeRuntime.js";
import { distinctDirectories } from "../../main/settings.js";
import {
  ProgressLines,
  readAutomationResult,
  automationTargetSchema,
  automationOriginSchema,
} from "../../shared/automation.js";
import type { AutomationPort } from "../types.js";
import {
  assembleNativeDocument,
  executorIdentitySchema,
  nativeContract,
  type ExecutorIdentity,
} from "./nativeContract.js";
import {
  executionRequestSchema,
  type ExecutionDetail,
  type ExecutionPreview,
  type ExecutionState,
} from "../../shared/execution.js";

const preflightCaseSchema = z.object({
  caseId: z.string(),
  title: z.string().optional(),
  group: z.string().optional(),
  platform: z.string().optional(),
  target: automationTargetSchema.optional(),
  status: z.enum(["ready", "blocked", "not-applicable"]),
  gaps: z.array(z.object({ kind: z.string(), reason: z.string() })),
  sourceCaseIds: z.array(z.string()).optional(),
});
const planSchema = z.object({
  kind: z.literal("pink-configuration-steps-launch-plan"),
  schemaVersion: z.literal(1),
  executor: executorIdentitySchema.optional(),
  integrity: z.object({ algorithm: z.literal("sha256"), sha256: z.string() }),
  startup: z.object({ pink: z.string(), project: z.string() }),
  steps: z.object({
    execution: z.object({ willSubmit: z.boolean() }).optional(),
    preflight: z.array(preflightCaseSchema).optional(),
    catalog: z
      .object({
        cases: z.array(preflightCaseSchema),
      })
      .optional(),
    cases: z.array(
      z.object({
        caseId: z.string(),
        title: z.string().optional(),
        group: z.string().optional(),
        platform: z.string().optional(),
        target: automationTargetSchema.optional(),
        precondition: preflightCaseSchema
          .pick({ status: true, gaps: true })
          .extend({ status: z.enum(["blocked", "not-applicable"]) })
          .optional(),
        steps: z.array(z.object({ op: z.string() })),
        finally: z.array(z.object({ op: z.string() })).optional(),
      }),
    ),
  }),
});
const currentPlanSchema = planSchema.extend({
  executor: executorIdentitySchema,
});
type Prepared = {
  preview: ExecutionPreview;
  args: string[];
  cli: string;
  node: string;
  files: Record<string, string>;
  cwd: string;
  executor: ExecutorIdentity;
};

function planContentHash(value: unknown): string {
  const canonical = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(canonical)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, child]) => [key, canonical(child)]),
          )
        : item;
  return hash(JSON.stringify(canonical(value)));
}

// This module owns the PinK protocol. The renderer receives data and opaque IDs,
// never a shell command, process handle or arbitrary executable entry point.
export class PinkBuildExecutor implements AutomationPort {
  private prepared = new Map<string, Prepared>();
  private children = new Map<string, ChildProcess>();
  private states = new Map<string, ExecutionState>();
  private writes = new Serial();
  private starting = false;
  private closing = false;
  private directories = new Map<string, string>();
  constructor(
    readonly root: string,
    private moduleRoot: () => string,
    private options: {
      outputRoot?: () => string;
      historyRoots?: () => string[];
      nodePath?: () => string;
    } = {},
  ) {}
  private directory(id: string) {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error("执行记录标识无效");
    return this.directories.get(id) || resolve(this.root, id);
  }
  private async persist(state: ExecutionState) {
    const snapshot = structuredClone(state);
    await this.writes.run(() =>
      atomicWrite(
        join(this.directory(state.id), "session.json"),
        json(snapshot),
      ),
    );
  }
  private process(
    node: string,
    cli: string,
    args: string[],
    cwd: string,
    ipc = false,
  ) {
    const env = { ...process.env };
    delete env.PINK_BUILD_STEPS_WORKER;
    return spawn(node, [cli, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env,
      stdio: ipc
        ? ["ignore", "pipe", "pipe", "ipc"]
        : ["ignore", "pipe", "pipe"],
    });
  }
  async preview(value: unknown): Promise<ExecutionPreview> {
    const request = executionRequestSchema.parse(value);
    if (request.moduleId !== "pink-build")
      throw new Error("该模块尚未接入真实执行器");
    if (!isAbsolute(request.executable) || !isAbsolute(request.projectPath))
      throw new Error("真实执行需要编辑器和工程的完整本机路径");
    const node =
      this.options.nodePath?.() || process.env.QA_AUTOMATION_NODE || "node";
    const cwd = this.moduleRoot();
    const contract = await nativeContract(cwd);
    const assembly =
      request.inputKind === "composition"
        ? await assembleNativeDocument(
            contract,
            request.document,
            request.selection,
            {
              project: request.projectPath,
              ...(request.materialsPath
                ? { materials: request.materialsPath }
                : {}),
            },
          )
        : undefined;
    const input = assembly?.document || request.document;
    const caseIds = assembly?.caseIds || request.caseIds;
    const format = contract.identifyNativeDocument(input);
    const document = contract.validateNativeDocument(input).document;
    if (format.format === "steps") {
      const nativeIds = (document.cases as { caseId: string }[]).map(
        (item) => item.caseId,
      );
      if (JSON.stringify(caseIds) !== JSON.stringify(nativeIds))
        throw new Error(
          "步骤文件按完整链路顺序执行，不支持部分筛选；请重新确认范围。",
        );
    }
    const outputRoot = this.options.outputRoot?.() || this.root;
    await verifyNodeRuntime(node);
    const id = randomUUID(),
      directory = resolve(outputRoot, id);
    this.directories.set(id, directory);
    await mkdir(directory, { recursive: true });
    const source = join(directory, "cases.json"),
      planPath = join(directory, "preview.json");
    const snapshots: Record<string, string> = {};
    if (assembly) {
      for (const [name, value] of Object.entries({
        "composition.json": request.document,
        "selection.json": request.selection ?? null,
        "assembly.json": assembly,
      })) {
        const path = join(directory, name),
          bytes = json(value);
        await atomicWrite(path, bytes);
        snapshots[path] = hash(bytes);
      }
    }
    await atomicWrite(source, json(document));
    const cli = join(cwd, "tools/build-ui/dist/configuration-steps-cli.js");
    await stat(cli);
    const args = [
      "--input",
      source,
      "--pink",
      request.executable,
      "--project",
      request.projectPath,
      "--results",
      join(directory, "results"),
    ];
    if (format.format === "catalog") {
      args.push("--cases", caseIds.join(","));
      if (request.executionMode === "configuration")
        args.push("--endpoint", "ui");
    }
    if (request.materialsPath) args.push("--materials", request.materialsPath);
    await new Promise<void>((resolve, reject) => {
      const child = this.process(
        node,
        cli,
        [...args, "--preview", "--output", planPath],
        cwd,
      );
      let output = "";
      child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
        output = (output + chunk).slice(-24000);
      });
      child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
        output = (output + chunk).slice(-24000);
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve() : reject(new Error("计划预览失败：" + output)),
      );
    });
    const bytes = await readFile(planPath),
      plan = currentPlanSchema.parse(JSON.parse(bytes.toString("utf8")));
    await contract.verifyExecutorIdentity(plan.executor);
    const building = request.executionMode === "build";
    const catalogCases = plan.steps.catalog?.cases;
    if (format.format === "catalog" && !catalogCases)
      throw new Error(
        "工具未返回完整 Catalog 预检清单，请更新工具后重新预览。",
      );
    const preflight =
      plan.steps.preflight ??
      catalogCases ??
      plan.steps.cases.map((item) => ({
        caseId: item.caseId,
        title: item.title,
        group: item.group,
        platform: item.platform,
        target: item.target,
        status: item.precondition?.status || "ready",
        gaps: item.precondition?.gaps || [],
      }));
    const requested = new Set(caseIds);
    const expectedOrder = JSON.stringify(caseIds);
    if (
      requested.size !== caseIds.length ||
      JSON.stringify(preflight.map((item) => item.caseId)) !== expectedOrder ||
      (catalogCases &&
        JSON.stringify(catalogCases.map((item) => item.caseId)) !==
          expectedOrder)
    )
      throw new Error("预检清单与本轮完整选择或顺序不一致，未允许执行。");
    const plannedIds = plan.steps.cases.map((item) => item.caseId);
    if (
      new Set(plannedIds).size !== plannedIds.length ||
      plannedIds.some((id) => !requested.has(id)) ||
      (format.format === "steps" &&
        JSON.stringify(plannedIds) !== expectedOrder)
    )
      throw new Error("步骤计划与本轮完整选择或顺序不一致，未允许执行。");
    const readyIds = new Set(
      preflight
        .filter((item) => item.status === "ready")
        .map((item) => item.caseId),
    );
    const runnableCases = plan.steps.cases.filter((item) =>
      readyIds.has(item.caseId),
    );
    if (runnableCases.length !== readyIds.size)
      throw new Error("预检标记为可执行的用例缺少完整步骤，未允许执行。");
    const operations = runnableCases.flatMap((item) => [
      ...item.steps,
      ...(item.finally || []),
    ]);
    const reportOnly =
      preflight.length > 0 &&
      preflight.every((item) => item.status !== "ready") &&
      plan.steps.execution?.willSubmit === false;
    const canStart =
      reportOnly ||
      (runnableCases.length > 0 &&
        (building
          ? plan.steps.execution?.willSubmit === true &&
            operations.some((s) => s.op === "build.submit")
          : plan.steps.execution?.willSubmit === false &&
            !operations.some((s) => s.op.startsWith("build."))));
    const preview: ExecutionPreview = {
      id,
      title: request.title,
      sourceId: request.sourceId,
      version: request.version,
      executable: plan.startup.pink,
      projectPath: plan.startup.project,
      planPath,
      planHash: plan.integrity.sha256,
      canStart,
      ...(reportOnly ? { reportOnly: true } : {}),
      executionMode: request.executionMode,
      ...(assembly
        ? {
            composition: {
              assemblyPath: join(directory, "assembly.json"),
              assemblyHash: snapshots[join(directory, "assembly.json")],
              documentSha256: assembly.documentSha256!,
              origins: assembly.sourceMap,
              presentation: request.presentation,
            },
          }
        : {}),
      reason: reportOnly
        ? "所选用例均受阻或不适用；仅生成预检报告，不启动或连接编辑器，不提交构建。"
        : canStart
          ? building
            ? "执行器确认：将提交真实构建，等待任务结果，并按用例定义完成核验与收尾。"
            : "执行器确认：仅配置检查，不提交构建。"
          : building
            ? "所选范围没有可执行的构建提交，或计划未明确提交构建；请核对用例与受阻原因。"
            : "配置检查不能包含构建操作；请调整范围，或明确选择真实构建后重新预览。",
      cases: preflight.map((item) => ({
        ...item,
        operations: runnableCases
          .filter((entry) => entry.caseId === item.caseId)
          .flatMap((entry) => [...entry.steps, ...(entry.finally || [])])
          .map((step) => step.op),
      })),
    };
    const files = {
      ...snapshots,
      [source]: hash(await readFile(source)),
      [planPath]: hash(bytes),
      [cli]: hash(await readFile(cli)),
    };
    this.prepared.set(id, {
      preview,
      args,
      cli,
      node,
      files,
      cwd,
      executor: structuredClone(plan.executor),
    });
    return preview;
  }
  async start(id: string): Promise<ExecutionState> {
    if (this.closing) throw new Error("工作台正在退出，未启动执行");
    if (this.starting || this.children.size)
      throw new Error("已有真实执行正在运行或收尾，请等待完成");
    const prepared = this.prepared.get(id);
    if (!prepared?.preview.canStart)
      throw new Error("请先生成与本轮运行方式一致且允许执行的计划");
    this.starting = true;
    try {
      for (const [path, expected] of Object.entries(prepared.files))
        if (hash(await readFile(path)) !== expected)
          throw new Error("预览后用例、计划或执行入口已变化，请重新预览");
      const contract = await nativeContract(prepared.cwd);
      await contract.verifyExecutorIdentity(prepared.executor);
      const state: ExecutionState = {
        id,
        preview: prepared.preview,
        status: "starting",
        startedAt: new Date().toISOString(),
      };
      await this.persist(state);
      this.states.set(id, state);
      if (this.closing) {
        state.status = "error";
        state.error = "工作台在启动前退出，本轮没有连接编辑器。";
        await this.persist(state);
        throw new Error(state.error);
      }
      const logs = createWriteStream(
        join(this.directory(id), "execution.log"),
        { flags: "a" },
      );
      const parser = new ProgressLines();
      const child = this.process(
        prepared.node,
        prepared.cli,
        [
          ...prepared.args,
          "--run",
          "--expected-plan",
          prepared.preview.planPath,
        ],
        prepared.cwd,
        true,
      );
      this.children.set(id, child);
      this.prepared.delete(id);
      const receive = (chunk: string, end = false) => {
        try {
          for (const progress of parser.push(chunk, end)) {
            state.progress = progress;
            state.status = state.status === "stopping" ? "stopping" : "running";
          }
          void this.persist(state).catch((e: Error) => {
            state.error = "记录保存失败：" + e.message;
            this.requestStop(id);
          });
        } catch (error) {
          state.error = "进度协议错误：" + String(error);
          this.requestStop(id);
        }
      };
      logs.on("error", (error) => {
        state.error = "日志保存失败：" + error.message;
        this.requestStop(id);
      });
      child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
        logs.write(chunk);
        receive(chunk);
      });
      child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
        logs.write(chunk);
      });
      child.once("error", (error) => {
        state.error = "执行器启动失败：" + error.message;
      });
      child.once("close", (code) => {
        receive("", true);
        logs.end();
        void this.finish(state, code)
          .catch((error: Error) => {
            state.status = "error";
            state.error = error.message;
            void this.persist(state).catch(() => {});
          })
          .finally(() => this.children.delete(id));
      });
      return structuredClone(state);
    } finally {
      this.starting = false;
    }
  }
  private owned(id: string, path: string) {
    const rel = relative(this.directory(id), path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("执行器产出不在本轮目录内");
    return path;
  }
  private async finish(state: ExecutionState, code: number | null) {
    state.exitCode = code;
    state.finishedAt = new Date().toISOString();
    if (state.progress?.lifecycle === "finished") {
      const result = readAutomationResult(
        await readJson(this.owned(state.id, state.progress.artifacts.result)),
        "本机独立执行器",
        state.preview.title,
      );
      if (JSON.stringify(result.progress) !== JSON.stringify(state.progress))
        throw new Error("最终结果与进度通知不一致，未标记报告就绪");
      await stat(this.owned(state.id, state.progress.artifacts.report));
      if (code !== 0 && state.progress.outcome === "passed")
        state.error = "用例上报通过，但执行进程异常退出，请核对收尾日志";
      state.status = state.error ? "error" : "finished";
    } else {
      state.status = "error";
      state.error ||=
        "执行器未提供完整终态，不能判定测试通过。请查看启动或执行日志。";
    }
    await this.persist(state);
  }
  private requestStop(id: string) {
    const child = this.children.get(id),
      state = this.states.get(id);
    if (!child || !state) return;
    state.status = "stopping";
    if (child.connected)
      child.send({ type: "pink-steps-stop" }, (error) => {
        if (error) state.error = "停止请求未送达：" + error.message;
      });
  }
  async stop(id: string) {
    this.requestStop(id);
    const state = this.states.get(id);
    if (state) await this.persist(state);
  }
  get active() {
    return this.starting || this.children.size > 0;
  }
  async shutdown() {
    this.closing = true;
    await Promise.all([...this.children.keys()].map((id) => this.stop(id)));
  }
  async list(): Promise<ExecutionState[]> {
    const roots = distinctDirectories([
      this.root,
      this.options.outputRoot?.() || this.root,
      ...(this.options.historyRoots?.() || []),
      ...[...this.directories.values()].map(dirname),
    ]);
    const list = new Map<string, ExecutionState>();
    for (const root of roots) {
      const entries = await readdir(root, { withFileTypes: true }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      for (const entry of entries.filter(
        (e) => e.isDirectory() && /^[\da-f-]{36}$/.test(e.name),
      )) {
        const directory = resolve(root, entry.name),
          previous = this.directories.get(entry.name);
        if (previous && distinctDirectories([previous, directory]).length !== 1)
          throw new Error(
            "多个输出目录存在相同编号的执行记录，请核对：" + entry.name,
          );
        this.directories.set(entry.name, directory);
        let state = this.states.get(entry.name);
        if (!state) {
          try {
            state = (await readJson(
              join(this.directory(entry.name), "session.json"),
            )) as ExecutionState;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          if (state.id !== entry.name)
            throw new Error("执行记录编号与目录不一致：" + entry.name);
          if (["starting", "running", "stopping"].includes(state.status)) {
            state.status = "interrupted";
            state.error =
              "工作台上次退出时未确认收尾；保留原结果，不自动重跑。";
          }
          this.states.set(state.id, state);
        }
        list.set(state.id, structuredClone(state));
      }
    }
    return [...list.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }
  async runDirectory(id: string) {
    if (!(await this.list()).some((state) => state.id === id))
      throw new Error("执行记录不存在");
    return this.directory(id);
  }
  async detail(id: string): Promise<ExecutionDetail> {
    const state = (await this.list()).find((state) => state.id === id);
    if (!state) throw new Error("执行记录不存在");
    const logs = (
      await readFile(join(this.directory(id), "execution.log"), "utf8").catch(
        () => "",
      )
    ).slice(-48000);
    let record;
    if (state.status === "finished" && state.progress) {
      record = readAutomationResult(
        await readJson(this.owned(id, state.progress.artifacts.result)),
        "本机独立执行器",
        state.preview.title,
      );
      record.reportHtml = await readFile(
        this.owned(id, state.progress.artifacts.report),
        "utf8",
      );
      // Historical display uses the frozen plan, not the current mounted cases.
      const snapshot = await readJson(
        join(this.directory(id), "preview.json"),
      ).catch(() => undefined);
      if (snapshot && typeof snapshot === "object") {
        const { integrity, ...body } = snapshot as Record<string, unknown>;
        const parsed = planSchema.safeParse(snapshot);
        if (
          parsed.success &&
          parsed.data.integrity.sha256 === state.preview.planHash &&
          parsed.data.integrity.sha256 === record.result.planSha256 &&
          planContentHash(body) === parsed.data.integrity.sha256
        ) {
          record.definition = body.steps as Record<string, unknown>;
        }
      }
      if (state.preview.composition) {
        const provenance = state.preview.composition;
        const bytes = await readFile(this.owned(id, provenance.assemblyPath));
        if (hash(bytes) !== provenance.assemblyHash)
          throw new Error("本轮组装快照已变化，不能将结果关联到用例节点。");
        const assembly = JSON.parse(bytes.toString("utf8"));
        const contract = await nativeContract(this.moduleRoot());
        if (!contract.mapCompositionResults)
          throw new Error(
            "当前工具缺少结果来源校验；原始报告仍保留在本轮目录。",
          );
        contract.mapCompositionResults(assembly, record.result);
        record.origins = z
          .array(automationOriginSchema)
          .parse(assembly.sourceMap);
        const definition = await readJson(
          join(this.directory(id), "composition.json"),
        );
        const selection = await readJson(
          join(this.directory(id), "selection.json"),
        );
        if (
          planContentHash(definition) !== assembly.definitionSha256 ||
          planContentHash(selection) !== assembly.selectionSha256
        )
          throw new Error(
            "本轮组合定义或选择快照已变化，不能显示为原执行链路。",
          );
        record.composition = {
          moduleId: "pink-build",
          definition: definition as Record<string, unknown>,
          selection,
          presentation: state.preview.composition.presentation,
        };
      }
    }
    return { ...state, logs, record };
  }
}

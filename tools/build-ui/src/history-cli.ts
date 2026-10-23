import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Browser, Page } from "playwright-core";
import { Builder } from "./builder.js";
import { errorMessage, waitFor, type Options, type Task } from "./common.js";
import type { HistoryView, HistoryCard } from "./history-page.js";
import { platforms } from "./profiles.js";
import { findWindow, startSession } from "./session.js";

class Blocked extends Error {}
interface Reference {
  file: string;
  runId: string;
  task: Pick<Task, "id" | "platform" | "state" | "outputName" | "completedAt" | "groupId">;
}
interface Check {
  caseId: string;
  title: string;
  outcome: "passed" | "failed" | "blocked";
  at: string;
  evidence?: unknown;
  failure?: string;
}
// This label remains English in the verified 0.0.1.39 package's Chinese UI.
const allLabel = "All Platforms";
const normal = (value: string) => value.replace(/\s+/g, " ").trim();
const key = (task: Pick<Task, "platform" | "outputName">) =>
  `${task.platform}\u0000${task.outputName ?? ""}`;
const cards = (view: HistoryView) =>
  view.months.flatMap((month) => month.batches.flatMap((batch) => batch.cards));
const matches = (card: HistoryCard, task: Pick<Task, "platform" | "outputName">) =>
  card.platform === task.platform && card.title.endsWith(` - ${task.outputName}`);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pink: { type: "string" },
      project: { type: "string" },
      port: { type: "string", default: "9222" },
      results: { type: "string" },
      "success-result": { type: "string" },
      "failure-result": { type: "string" },
      "success-platform": { type: "string", default: "web-desktop" },
      "failure-platform": { type: "string", default: "taobao-mini-game" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node dist/history-cli.js --pink <PinK.exe> --project <工程> --success-result <已有结果JSON> --failure-result <已有结果JSON> [--success-platform web-desktop] [--failure-platform taobao-mini-game] [--port 9222] [--results <目录>]\n仅操作历史搜索、筛选和批次折叠，核对现存记录；不打开配置或提交/重建/取消/移除任务，不执行后续阶段。",
    );
    return;
  }
  if (process.platform !== "win32" || Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("需要 Windows 和 Node.js 24+");
  if (!values.pink || !values.project || !values["success-result"] || !values["failure-result"])
    throw new Error("必须提供 pink、project、success-result 和 failure-result");
  const options: Options = {
    pink: resolve(values.pink),
    project: resolve(values.project),
    port: Number(values.port),
    timeoutMs: 60_000,
    queueTimeoutMs: 1_800_000,
    configurationTimeoutMs: 120_000,
    resultsRoot: resolve(
      values.results ?? fileURLToPath(new URL("../../../results", import.meta.url)),
    ),
  };
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535)
    throw new Error("端口必须是 1024–65535 的整数");
  await access(options.pink);
  JSON.parse(await readFile(join(options.project, "package.json"), "utf8"));
  const product = JSON.parse(
    await readFile(join(options.pink, "..", "resources/app/product.json"), "utf8"),
  ) as { pinkVersion?: string; commit?: string };
  async function reference(file: string, platform: string, state: string): Promise<Reference> {
    const data = JSON.parse(await readFile(file, "utf8")) as {
      project: string;
      runId: string;
      pink: { version?: string; commit?: string };
      cases: Array<{ task?: Task }>;
    };
    if (
      resolve(data.project).toLowerCase() !== options.project.toLowerCase() ||
      data.pink.version !== product.pinkVersion ||
      data.pink.commit !== product.commit
    )
      throw new Error(`历史证据工程或 PinK 版本不匹配：${file}`);
    const selected = data.cases?.filter(
      (item) => item.task?.platform === platform && item.task.state === state,
    );
    if (selected?.length !== 1 || !selected[0].task?.outputName)
      throw new Error(`历史证据必须包含唯一 ${platform}/${state} 任务及输出名：${file}`);
    const { id, outputName, completedAt, groupId } = selected[0].task;
    return {
      file: resolve(file),
      runId: data.runId,
      task: { id, platform, state, outputName, completedAt, groupId },
    };
  }
  const references = {
    success: await reference(values["success-result"], values["success-platform"], "success"),
    failure: await reference(values["failure-result"], values["failure-platform"], "failure"),
  };
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-history`;
  const directory = join(options.resultsRoot, runId);
  await mkdir(directory, { recursive: true });
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("用户停止历史只读检查"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let browser: Browser | undefined, page: Page | undefined, builder: Builder | undefined;
  let launch: { pid: number; mode: string; endpoint: string } | undefined;
  let initial: HistoryView | undefined;
  let baseline: Task[] = [];
  let allExpanded: Array<{ label: string; expanded: boolean }> = [];
  let fatal: string | undefined;
  const checks: Check[] = [];
  const warnings: string[] = [];
  const fingerprints: Record<string, { before: string; after?: string }> = {};
  const hash = async (name: string) =>
    createHash("sha256")
      .update(await readFile(join(options.project, "temp/pink-builder", `${name}.json`)))
      .digest("hex");
  async function check(caseId: string, title: string, action: () => Promise<unknown>) {
    try {
      const evidence = await action();
      checks.push({ caseId, title, at: new Date().toISOString(), outcome: "passed", evidence });
    } catch (error) {
      checks.push({
        caseId,
        title,
        at: new Date().toISOString(),
        outcome: error instanceof Blocked ? "blocked" : "failed",
        failure: errorMessage(error),
      });
    }
    console.log(`[${caseId}] ${checks.at(-1)!.outcome}: ${title}`);
  }
  async function readMatching(description: string, predicate: (view: HistoryView) => boolean) {
    let last: HistoryView | undefined;
    try {
      return await waitFor(
        description,
        async () => {
          last = await builder!.readHistory();
          return predicate(last) ? last : undefined;
        },
        15_000,
        abort.signal,
      );
    } catch (error) {
      throw new Error(
        `${errorMessage(error)}；末次UI：${JSON.stringify({ search: last?.search, filter: last?.filter, cards: last && cards(last).map(({ title, status }) => ({ title, status })), emptyText: last?.emptyText })}`,
      );
    }
  }
  async function query(search: string, filter = allLabel) {
    await builder!.filterHistory(filter);
    await builder!.searchHistory(search);
    return readMatching(
      "搜索与筛选值回读",
      (view) => view.search === search && view.filter === filter,
    );
  }
  async function expandAll() {
    const view = await builder!.readHistory();
    for (const batch of view.months.flatMap((month) => month.batches)) {
      if (!batch.expanded) await builder!.click("batch", batch.label);
    }
    return readMatching("批次展开", (current) =>
      current.months.every((month) => month.batches.every((batch) => batch.expanded)),
    );
  }
  async function expectTasks(expected: Task[], description: string) {
    const view = await readMatching(description, (view) => {
      const actual = cards(view);
      return (
        actual.length === expected.length &&
        expected.every((task) => actual.filter((card) => matches(card, task)).length === 1)
      );
    });
    return { search: view.search, filter: view.filter, taskIds: expected.map((task) => task.id) };
  }
  const categories = new Map([
    ...platforms.map((platform) => [platform.id, platform.category] as const),
    ["openpaas", "X-Application"] as const,
  ]);
  function categoryTasks(category: string) {
    const unknown = baseline.filter((task) => !categories.has(task.platform));
    if (unknown.length)
      throw new Blocked(`尚无平台分类合同：${unknown.map((task) => task.platform).join(",")}`);
    return baseline.filter((task) => categories.get(task.platform) === category);
  }
  try {
    for (const name of ["preferences", "tasks"]) fingerprints[name] = { before: await hash(name) };
    const session = await startSession(options, abort.signal, (value) => {
      launch = value;
      console.log(`[session] ${value.mode} PID ${value.pid}`);
    });
    browser = session.browser;
    page = await findWindow(browser, options.project, abort.signal, options.pink);
    await waitFor(
      "工程构建分类就绪",
      async () =>
        (await page!.getByRole("tab", { name: "X-Device", exact: true }).count()) === 1
          ? true
          : undefined,
      180_000,
      abort.signal,
    );
    builder = await Builder.open(page, session.endpoint, abort.signal, "X-Device", 120_000, true);
    const originalView = (await builder.isHistoryOpen()) ? await builder.readHistory() : undefined;
    await builder.installProbe();
    const snapshot = await builder.historySnapshot(true);
    if (snapshot.tasks.some((task) => ["waiting", "processing"].includes(task.state)))
      throw new Blocked("存在活动任务，无法稳定核对静态历史；不会取消该任务");
    baseline = snapshot.tasks.filter((task) => !task.parentTaskId);
    if (new Set(baseline.map(key)).size !== baseline.length)
      throw new Blocked("现有平台/输出名有重名任务，无法唯一关联卡片");
    for (const ref of Object.values(references)) {
      const current = baseline.find((task) => task.id === ref.task.id);
      if (
        !current ||
        Object.entries(ref.task).some(
          ([field, value]) => value !== undefined && current[field as keyof Task] !== value,
        )
      )
        throw new Blocked(`现存任务与指定历史证据不匹配：${ref.task.id}`);
    }
    initial = originalView ?? (await builder.readHistory());
    await query("");
    allExpanded = (await builder.readHistory()).months.flatMap((month) =>
      month.batches.map(({ label, expanded }) => ({ label, expanded })),
    );
    for (const batch of initial.months.flatMap((month) => month.batches)) {
      const saved = allExpanded.find((item) => item.label === batch.label);
      if (saved) saved.expanded = batch.expanded;
    }
    await expandAll();
    await check("UI-H01/H12", "历史记录与已有任务身份", () =>
      expectTasks(baseline, "完整历史任务集合"),
    );

    for (const [kind, ref] of Object.entries(references)) {
      const task = baseline.find((task) => task.id === ref.task.id)!;
      await check(`UI-H06-${kind}`, `输出名唯一搜索：${kind}`, async () => {
        await query(task.outputName!);
        return expectTasks([task], "按输出名命中唯一指定任务");
      });
      await check(`UI-H05-${kind}`, `平台名称搜索：${kind}`, async () => {
        const platform = platforms.find((platform) => platform.id === task.platform);
        if (!platform) throw new Blocked(`缺平台显示名称合同：${task.platform}`);
        await query(platform.label);
        return expectTasks(
          baseline.filter((other) => other.platform === task.platform),
          "平台名称搜索集合",
        );
      });
    }
    const success = baseline.find((task) => task.id === references.success.task.id)!;
    const failure = baseline.find((task) => task.id === references.failure.task.id)!;
    await check("UI-H06-case", "输出名搜索不区分大小写", async () => {
      await query(success.outputName!.toUpperCase());
      return expectTasks([success], "大写输出名命中");
    });
    await check("UI-H09", "无匹配提示与清空恢复", async () => {
      const search = `pink-history-no-match-${runId}`;
      await query(search);
      const empty = await readMatching(
        "无匹配空态",
        (view) => cards(view).length === 0 && !!view.emptyText,
      );
      assert.equal(empty.emptyText, "没有符合条件的构建任务");
      await query("");
      await expandAll();
      return {
        emptyText: empty.emptyText,
        restored: await expectTasks(baseline, "清空搜索恢复历史"),
      };
    });
    for (const category of ["X-Device", "X-Application"])
      await check(`UI-H07-${category}`, `分类筛选：${category}`, async () => {
        const expected = categoryTasks(category);
        await query("", category);
        await expandAll();
        return expectTasks(expected, "分类筛选集合");
      });
    await check("UI-H08", "搜索与分类交集及独立清空", async () => {
      const category = categories.get(failure.platform)!;
      const other = category === "X-Device" ? "X-Application" : "X-Device";
      await query(failure.outputName!, other);
      await expectTasks([], "不相交的搜索和分类");
      await query(failure.outputName!, category);
      await expectTasks([failure], "相交搜索和分类");
      await query("", category);
      await expandAll();
      await expectTasks(categoryTasks(category), "只清空搜索保留分类");
      await query(failure.outputName!, category);
      await builder!.filterHistory(allLabel);
      return expectTasks([failure], "只清空分类保留搜索");
    });
    await check("UI-H04", "成功任务批次折叠/展开且计数保持", async () => {
      await query(success.outputName!);
      await expandAll();
      const before = await builder!.readHistory();
      const batch = before.months
        .flatMap((month) => month.batches)
        .find((batch) => batch.cards.some((card) => matches(card, success)))!;
      await builder!.click("batch", batch.label);
      const folded = await readMatching("批次折叠", (view) => {
        const found = view.months
          .flatMap((month) => month.batches)
          .find((item) => item.label === batch.label);
        return !!found && !found.expanded && found.cards.every((card) => !card.visible);
      });
      assert.deepEqual(folded.months.flatMap((month) => month.batches)[0].counts, batch.counts);
      await builder!.click("batch", batch.label);
      await readMatching("批次展开后卡片可见", (view) =>
        cards(view).some((card) => matches(card, success) && card.visible),
      );
      return { taskId: success.id, batch: batch.label, counts: batch.counts };
    });
    for (const [kind, task, status, icon] of [
      ["success", success, "成功", "codicon-pass"],
      ["failure", failure, "失败", "codicon-error"],
    ] as const)
      await check(
        kind === "success" ? "UI-H16" : "UI-H17",
        `${status}状态、图标及任务归属`,
        async () => {
          await query(task.outputName!);
          await expandAll();
          await expectTasks([task], "终态任务唯一卡片");
          const card = cards(await builder!.readHistory())[0];
          assert.equal(card.status, status);
          assert.ok(card.statusIcon.split(" ").includes(icon), "状态图标错误");
          if (kind === "failure") {
            if (!task.message) throw new Blocked("失败任务无可核对错误摘要");
            assert.ok(
              normal(card.error).startsWith(normal(task.message).slice(0, 180)),
              "错误摘要与指定失败任务不一致",
            );
          } else assert.equal(card.error, "");
          const screenshot = `${kind}.png`;
          await page!.screenshot({ path: join(directory, screenshot), timeout: 10_000 });
          return { taskId: task.id, outputName: task.outputName, card, screenshot };
        },
      );
    await check("UI-H03", "未筛选的批次数与记录总数", async () => {
      if (baseline.some((task) => !task.groupId))
        throw new Blocked("历史任务缺 groupId，兼容统计口径尚未覆盖");
      await query("");
      await expandAll();
      await expectTasks(baseline, "统计前完整任务集合");
      const view = await builder!.readHistory();
      const count = (text: string, label: string) => {
        assert.ok(/^\d+\s*/.test(text), `无法读取${label}：${text}`);
        return Number(text.match(/^\d+/)![0]);
      };
      const batches = view.months.reduce((sum, month) => sum + count(month.counts[0], "批次数"), 0);
      const records = view.months.reduce((sum, month) => sum + count(month.counts[1], "记录数"), 0);
      assert.equal(batches, new Set(baseline.map((task) => task.groupId)).size);
      assert.equal(records, baseline.length);
      return {
        batches,
        records,
        months: view.months.map(({ label, counts }) => ({ label, counts })),
      };
    });
    await check("UI-H16/H17-counts", "仅success/failure批次的目标及成功失败统计", async () => {
      await query("");
      const view = await expandAll();
      const verified: unknown[] = [],
        deferred: unknown[] = [];
      for (const batch of view.months.flatMap((month) => month.batches)) {
        const tasks = batch.cards.map((card) => {
          const found = baseline.filter((task) => matches(card, task));
          assert.equal(found.length, 1, "批次卡片无法唯一关联");
          return found[0];
        });
        assert.equal(new Set(tasks.map((task) => task.groupId)).size, 1, "不同产品批次被错误合并");
        assert.equal(
          tasks.length,
          baseline.filter((task) => task.groupId === tasks[0].groupId).length,
          "产品批次缺任务",
        );
        if (tasks.some((task) => !["success", "failure"].includes(task.state))) {
          deferred.push({
            taskIds: tasks.map((task) => task.id),
            reason: "含 generated/取消等未明确统计口径，本次不判定",
          });
          continue;
        }
        const expected = [
          `${tasks.length} 个目标`,
          ...(["success", "failure"] as const).flatMap((state) => {
            const n = tasks.filter((task) => task.state === state).length;
            return n ? [`${n} ${state === "success" ? "成功" : "失败"}`] : [];
          }),
        ];
        assert.deepEqual(
          batch.counts.map(normal).sort(),
          expected.sort(),
          `批次统计错误：${batch.label}`,
        );
        verified.push({ taskIds: tasks.map((task) => task.id), counts: batch.counts });
      }
      return { verified, deferred };
    });
  } catch (error) {
    fatal = errorMessage(error);
    console.error(fatal);
  } finally {
    if (builder && baseline.length)
      await check("integrity-task-identity", "任务集合、状态和执行身份未变", async () => {
        const current = (await builder!.historySnapshot(true)).tasks.filter(
          (task) => !task.parentTaskId,
        );
        const identity = (tasks: Task[]) =>
          tasks
            .map(({ id, platform, state, outputName, groupId, createdAt, completedAt }) => ({
              id,
              platform,
              state,
              outputName,
              groupId,
              createdAt,
              completedAt,
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
        assert.deepEqual(identity(current), identity(baseline));
        return { before: baseline.length, after: current.length, newTaskIds: [] };
      });
    if (builder && initial) {
      try {
        await query("");
        const view = await builder.readHistory();
        for (const batch of view.months.flatMap((month) => month.batches)) {
          const saved = allExpanded.find((item) => item.label === batch.label);
          if (saved && saved.expanded !== batch.expanded) await builder.click("batch", batch.label);
        }
        await query(initial.search, initial.filter);
      } catch (error) {
        warnings.push(`历史视图恢复未完成：${errorMessage(error)}`);
      }
    }
    for (const name of Object.keys(fingerprints))
      await check(`integrity-${name}`, `${name}.json 内容未变`, async () => {
        fingerprints[name].after = await hash(name);
        assert.equal(fingerprints[name].after, fingerprints[name].before);
        return fingerprints[name];
      });
    await builder?.close().catch((error) => warnings.push(errorMessage(error)));
    await browser?.close().catch((error) => warnings.push(errorMessage(error)));
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    const outcome =
      !fatal &&
      !warnings.length &&
      checks.length &&
      checks.every((check) => check.outcome === "passed")
        ? "passed"
        : "failed";
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: "history-ui-readonly",
          runId,
          outcome,
          project: options.project,
          pink: { path: options.pink, version: product.pinkVersion, commit: product.commit },
          launch,
          references,
          scope: {
            readOnlyTasks: true,
            buildSubmitted: false,
            rebuild: false,
            cancel: false,
            remove: false,
            generate: false,
            run: false,
            artifactVerified: false,
            filteredStatistics: "not-requested",
            generatedAndCancelledStatistics: "contract-pending",
            secondaryGroupFilters: "not-requested",
          },
          checks,
          summary: Object.fromEntries(
            ["passed", "failed", "blocked"].map((state) => [
              state,
              checks.filter((check) => check.outcome === state).length,
            ]),
          ),
          fingerprints,
          fatal,
          warnings,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`结果：${join(directory, "result.json")}`);
    process.exitCode = abort.signal.aborted ? 130 : outcome === "passed" ? 0 : 1;
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 2;
});

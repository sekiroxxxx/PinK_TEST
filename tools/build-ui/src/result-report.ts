import { readFile, writeFile, stat } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
const list = (value: unknown): RecordValue[] => (Array.isArray(value) ? value.map(record) : []);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const labels: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  blocked: "受阻",
  stopped: "已停止",
  "not-run": "未执行",
  submitted: "结果未收齐",
  "not-applicable": "不适用",
  incomplete: "未全部完成",
  running: "进行中",
  pending: "待执行",
  skipped: "已跳过",
};
const stages: Record<string, string> = {
  "not-run": "尚未开始",
  session: "启动与连接",
  startup: "启动与连接",
  builder: "打开平台面板",
  configuration: "配置初态、前提检查与配置回读",
  configure: "配置与回读",
  persistence: "保存重开",
  submit: "提交构建",
  queued: "排队与参数核对",
  accepted: "已入队，等待构建与终态核对",
  collection: "统一结果收集",
  "ui-confirmation": "成功卡片核对",
  collect: "构建结果收集",
};
const taskStates: Record<string, string> = {
  waiting: "等待中",
  processing: "构建中",
  success: "成功",
  failure: "失败",
  cancelled: "已取消",
};
const restorations: Record<string, string> = {
  "not-required": "无需恢复",
  "not-recorded": "尚未记录原值",
  passed: "已恢复",
  failed: "恢复失败",
  unsafe: "无法安全恢复",
};

/** Render selected results and diagnostics. Never embed configuration/task option objects. */
export async function writeResultReport(resultPath: string): Promise<string> {
  const file = resolve(resultPath);
  const directory = dirname(file);
  const root = dirname(directory);
  const data = record(JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")));
  const configurationSteps = data.kind === "pink-configuration-steps-result";
  const reportTitle = configurationSteps
    ? data.buildAttempted === true
      ? "PinK 步骤构建报告"
      : "PinK 配置步骤报告（未提交构建）"
    : "PinK 构建测试报告";
  const entries = (Array.isArray(data.cases) ? list(data.cases) : list(data.checks)).map((item) => {
    if (!configurationSteps) return item;
    const progress = list(record(data.progress).cases).find((c) => c.caseId === item.caseId);
    const failures = [
      ...(item.openingFailure ? [record(item.openingFailure)] : []),
      ...list(item.steps).filter((s) => s.error),
    ];
    return {
      ...item,
      ...(progress ? { outcome: text(progress.status) } : {}),
      taskId: list(item.tasks)
        .map((t) => text(t.taskId))
        .filter(Boolean)
        .join("、"),
      stage:
        failures.map((s) => `${text(s.stepId)} (${text(s.operation)})`).join("、") || "配置步骤",
      failure:
        [
          text(record(item.failure).reason),
          ...failures.map((s) => `${text(s.stepId)}：${text(record(s.error).reason)}`),
          ...failures.flatMap((s) =>
            list(record(s.diagnostic).chain).map(
              (cause) =>
                `${text(s.stepId)} 底层：${text(cause.message)}${record(cause.recovery).phase ? ` [${text(record(cause.recovery).phase)} / ${text(record(cause.recovery).field)}]` : ""}`,
            ),
          ),
          text(record(item.stopReason).reason),
        ]
          .filter(Boolean)
          .join("\n") || (item.outcome === "skipped" ? "前项已停止，本例未执行" : text(data.fatal)),
      disposition: `恢复：${text(item.restoration)}；${item.stopFollowingCases ? "停止后续用例" : "允许后续用例"}`,
      screenshot:
        text(record(failures.find((s) => record(s.evidence).screenshot)?.evidence).screenshot) ||
        item.screenshot,
      screenshotOmittedReason:
        failures
          .map((s) => text(record(s.evidence).unavailable))
          .filter(Boolean)
          .join("；") || item.screenshotOmittedReason,
    };
  });
  if (!Array.isArray(data.cases) && !Array.isArray(data.checks))
    throw new Error("结果文件缺少 cases/checks，无法生成报告");
  const secrets = new Set<string>();
  function collectSecrets(value: unknown): void {
    if (Array.isArray(value)) value.forEach(collectSecrets);
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (
          /(?:password|secret|token|privateKey)$/i.test(key) &&
          typeof child === "string" &&
          child
        )
          secrets.add(child);
        else collectSecrets(child);
      }
  }
  collectSecrets(data);
  function clean(value: string): string {
    for (const secret of [...secrets].sort((a, b) => b.length - a.length))
      value = value.replaceAll(secret, "[已脱敏]");
    return value
      .replace(
        /((?:[\w.]*password|[\w.]*secret|[\w.]*token)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;，；]+)/gi,
        "$1[已脱敏]",
      )
      .replace(/(Bearer\s+)[\w.+/=-]+/gi, "$1[已脱敏]");
  }
  const html = (value: string) =>
    clean(value).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
    );
  async function localFile(
    from: string,
    name: string,
    screenshot = false,
  ): Promise<string | undefined> {
    if (!name || /^(?:[a-z]+:|\/\/)/i.test(name) || isAbsolute(name)) return;
    const path = resolve(from, name);
    const inside = relative(root, path);
    if (
      inside === ".." ||
      inside.startsWith("..\\") ||
      inside.startsWith("../") ||
      isAbsolute(inside)
    )
      return;
    if (screenshot && !/\.(?:png|jpe?g|webp)$/i.test(path)) return;
    if (!(await stat(path).catch(() => undefined))?.isFile()) return;
    return relative(directory, path).split(/[\\/]/).map(encodeURIComponent).join("/");
  }
  const issues: string[] = [];
  const resultRows: Array<{ item: RecordValue; raw: RecordValue }> = [];
  for (const item of entries) {
    const outcome = text(item.outcome);
    let source = file;
    let raw = item;
    let evidenceWarning = "";
    const ref = text(item.evidence);
    if (ref) {
      const link = await localFile(directory, ref);
      if (link) {
        source = resolve(directory, ref);
        try {
          const result = record(JSON.parse(await readFile(source, "utf8")));
          collectSecrets(result);
          raw = list(result.cases).find((c) => c.caseId === item.caseId) ?? item;
          if (item.taskId && text(record(raw.task).id) !== item.taskId) {
            raw = item;
            evidenceWarning = "证据中的任务ID不匹配，未引用该任务或截图。";
          }
        } catch {
          evidenceWarning = "原始证据无法读取。";
        }
      } else evidenceWarning = "原始证据文件不存在或路径不可用。";
    }
    resultRows.push({ item, raw });
    if (["passed", "not-applicable"].includes(outcome)) continue;
    const checks = list(raw.checks).filter((c) => c.outcome !== "passed");
    const task = record(raw.task);
    const reason =
      text(item.reason) ||
      text(item.failure) ||
      text(raw.failure) ||
      checks
        .map((c) => text(c.failure))
        .filter(Boolean)
        .join("\n") ||
      text(task.message) ||
      text(data.failure) ||
      text(data.fatal) ||
      "未记录具体原因，请查看原始结果。";
    const stage =
      text(raw.stage) || text(item.stage) || checks.map((c) => text(c.caseId)).join("、");
    const command = reason.match(/execute-task \[([^\]\r\n]+)\]/)?.[1];
    const stageLabel =
      raw.timeout === "startup-wait"
        ? "排队／启动等待超时"
        : raw.timeout === "processing"
          ? "构建处理中超时"
          : task.state === "failure"
            ? `构建执行${command ? ` · ${command}` : ""}（最近自动化环节：${stages[stage] ?? (stage || "未记录")}）`
            : stages[stage]
              ? `${stages[stage]} · ${stage}`
              : stage || "未记录";
    const shot = await localFile(dirname(source), text(raw.screenshot), true);
    const evidence = await localFile(directory, relative(directory, source));
    const taskId = text(item.taskId) || text(task.id) || text(record(raw.queuedTask).id);
    const disposition = text(item.disposition);
    const missingShot =
      text(raw.screenshotOmittedReason) ||
      (raw.screenshot ? "截图文件不存在或路径不可用" : "本例未记录截图");
    issues.push(`<article class="issue"><h2><span class="badge ${outcome === "failed" ? "failed" : "blocked"}">${html(labels[outcome] ?? "状态未知")}</span> ${html(text(item.caseId) || text(item.id) || "未命名检查")}</h2>
      <dl><div><dt>平台</dt><dd>${html(text(item.platform) || "公共检查")}</dd></div><div><dt>失败／受阻环节</dt><dd>${html(stageLabel)}</dd></div><div><dt>任务ID</dt><dd>${html(taskId || "未关联构建任务")}</dd></div></dl>
      <pre tabindex="0" aria-label="错误原因">${html(reason)}</pre>
      ${disposition ? `<p class="note">后续处置：${html(disposition)}</p>` : ""}
      ${evidenceWarning ? `<p class="note">${html(evidenceWarning)}</p>` : ""}
      <p class="links">${shot ? `<a href="${shot}" target="_blank" rel="noopener">查看截图 ↗</a>` : `<span>截图：${html(missingShot)}</span>`}${evidence ? `<a href="${evidence}">原始结果 JSON</a>` : ""}</p></article>`);
  }
  const rows = resultRows.map(({ item, raw }, index) => {
    const target = record(raw.target ?? item.target);
    const platform =
      text(raw.platform) ||
      text(item.platform) ||
      (target.kind === "builder" ? `公共主页 · ${text(target.category)}` : "公共检查");
    const tasks = list(raw.tasks).filter((task) => text(task.taskId));
    const legacyTask = record(raw.task);
    if (!tasks.length && (text(item.taskId) || text(legacyTask.id)))
      tasks.push({ taskId: text(item.taskId) || text(legacyTask.id), state: legacyTask.state });
    const taskSummary = tasks
      .map((task) => {
        const state = text(task.state);
        return `<div>${html(text(task.taskId))}<br>${html(state ? `${taskStates[state] ?? state} (${state})` : "状态未记录")}</div>`;
      })
      .join("");
    const restoration = text(raw.restoration) || text(item.restoration);
    return `<tr><td>${index + 1}</td><td>${html(text(item.caseId) || text(item.id) || "未命名检查")}</td><td>${html(platform)}</td><td>${html(labels[text(item.outcome)] ?? (text(item.outcome) || "未记录"))}</td><td>${taskSummary || "未关联构建任务"}</td><td>${html(restorations[restoration] ?? (restoration || "未记录"))}</td></tr>`;
  });
  const count = (state: string) => entries.filter((c) => c.outcome === state).length;
  const untouched = entries.filter(
    (c) => !["passed", "failed", "blocked", "not-applicable"].includes(text(c.outcome)),
  ).length;
  const summary = `共 ${entries.length} 项 · 通过 ${count("passed")} · 失败 ${count("failed")} · 受阻 ${count("blocked")} · 不适用 ${count("not-applicable")} · 未完成 ${untouched}`;
  const fatal = text(data.fatal) || text(data.failure);
  const warnings = Array.isArray(data.warnings) ? data.warnings : record(data.cleanup).warnings;
  const notices = [fatal, ...(Array.isArray(warnings) ? warnings.map(text) : [])].filter(Boolean);
  for (const cause of list(record(data.fatalDiagnostic).chain))
    if (text(cause.message) && !notices.includes(text(cause.message)))
      notices.push(text(cause.message));
  const capabilityRows = list(data.runtimeCapabilities).map(
    (capability) =>
      `<tr><td>${html(text(capability.platform))}</td><td>${capability.status === "ready" ? "入口已识别，控件按步骤核对" : "执行器能力受阻"}</td><td>${html(text(capability.reason) || text(record(capability.entry).label))}</td></tr>`,
  );
  for (const failure of list(data.checkpointErrors)) {
    const reason = list(failure.chain)
      .map((item) => text(item.message))
      .filter(Boolean)
      .join(" → ");
    if (reason) notices.push(`检查点写出失败：${reason}`);
  }
  for (const failure of list(data.cleanup).filter((item) => item.outcome === "failed"))
    notices.push(`${text(failure.resource)}释放失败：${text(failure.reason)}`);
  if (data.lifecycle && data.lifecycle !== "finished")
    notices.push(
      data.lifecycle === "stopping"
        ? "已收到停止请求，正在收集任务和安全恢复；报告尚未收尾。"
        : "执行尚未结束；本报告为检查点，不能计为通过。",
    );
  if (data.interruption)
    notices.push(
      `停止请求：${text(record(data.interruption).source)} ${text(record(data.interruption).requestedAt)}；已停止后续操作，收尾情况见步骤与恢复记录。`,
    );
  const lifecycle =
    data.lifecycle === "finished"
      ? "已收尾"
      : data.lifecycle === "stopping"
        ? "停止并收尾中"
        : "执行中";
  const cleanupSummary = list(data.cleanup)
    .map((r) => `${text(r.resource)}：${r.outcome === "passed" ? "已释放" : "释放失败"}`)
    .join("；");
  if (data.taskMayStillBeRunning === true || record(data.cleanup).taskMayStillBeRunning === true)
    notices.push("已尝试提交，但任务关联或收尾尚未确认，可能仍在运行；工具未自动取消。");
  const reportPath = resolve(
    directory,
    basename(file, ".json") === "result" ? "report.html" : `${basename(file, ".json")}-report.html`,
  );
  await writeFile(
    reportPath,
    `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self' file:; base-uri 'none'; form-action 'none'"><title>${reportTitle}</title>
<style>
:root{--paper:#f5f6f7;--surface:#fff;--ink:#20252b;--muted:#565f69;--line:#d8dde2;--error:#a52b30;--hold:#785300;--link:#1556a1}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1100px;margin:auto;padding:32px 24px 64px}h1{font-size:26px;line-height:1.4;margin:0 0 12px}h2{font-size:16px;margin:0;overflow-wrap:anywhere}.meta,.note,.links{color:var(--muted);font-size:14px;overflow-wrap:anywhere}.meta{margin:4px 0}.summary{margin:20px 0;padding:12px 16px;border:1px solid var(--line);background:var(--surface);font-weight:600}.issue{background:var(--surface);border:1px solid var(--line);padding:20px;margin:16px 0;border-radius:6px}.badge{display:inline-block;font-size:13px;padding:2px 8px;margin-right:8px;border-radius:4px}.failed{background:#fff0f1;color:var(--error)}.blocked{background:#fff5da;color:var(--hold)}dl{display:flex;flex-wrap:wrap;gap:12px 32px;margin:16px 0}dt{font-size:12px;color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}pre{font:13px/1.7 Consolas,"Microsoft YaHei",monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:280px;overflow:auto;background:var(--paper);padding:12px;margin:12px 0}.links{display:flex;flex-wrap:wrap;gap:12px 24px;margin:12px 0 0}a{color:var(--link);text-underline-offset:3px}a:focus-visible,pre:focus-visible{outline:3px solid var(--link);outline-offset:4px}.notice{border-left:3px solid var(--error);padding-left:12px}@media(max-width:600px){main{padding:20px 16px}.issue{padding:16px}dl{display:block}dl div{margin-top:8px}}@media print{body{background:white}main{padding:0;max-width:none}pre{max-height:none;overflow:visible}.issue{break-inside:avoid}}
.results{overflow-x:auto;margin:20px 0;background:var(--surface);border:1px solid var(--line)}table{border-collapse:collapse;width:100%;font-size:13px}caption{text-align:left;font-size:16px;font-weight:600;padding:12px}th,td{text-align:left;vertical-align:top;padding:10px;border-top:1px solid var(--line);overflow-wrap:anywhere}th{background:var(--paper)}td div+div{margin-top:8px}
</style></head><body><main><h1>${reportTitle}</h1>
<p class="meta">${html(text(data.runId) || (data.kind === "four-groups-base-acceptance-summary" ? "多次执行汇总（依据现有汇总 JSON）" : basename(directory)))} · ${html(labels[text(data.outcome)] ?? text(data.outcome))}</p>
<p class="meta">${html(text(data.project))}</p><p class="meta">${html(text(record(data.pink).version))} · 生成于 ${html(new Date().toISOString())} · <a href="${encodeURIComponent(basename(file))}">结果 JSON</a></p>
${data.lifecycle ? `<p class="meta">${html(lifecycle)}${cleanupSummary ? ` · ${html(cleanupSummary)}` : ""}</p>` : ""}
<p class="summary">${html(summary)}</p>
${notices.length ? `<section class="notice"><h2>运行级错误或清理提示</h2><pre tabindex="0">${html(notices.join("\n"))}</pre></section>` : ""}
${capabilityRows.length ? `<div class="results"><table><caption>执行能力检查（与材料前提分别记录）</caption><thead><tr><th scope="col">平台</th><th scope="col">状态</th><th scope="col">入口／原因</th></tr></thead><tbody>${capabilityRows.join("\n")}</tbody></table></div>` : ""}
${rows.length ? `<div class="results"><table><caption>全部用例（按结果记录顺序）</caption><thead><tr><th scope="col">序号</th><th scope="col">用例ID</th><th scope="col">平台／公共目标</th><th scope="col">结果</th><th scope="col">任务ID／状态</th><th scope="col">恢复状态</th></tr></thead><tbody>${rows.join("\n")}</tbody></table></div>` : ""}
${issues.length ? issues.join("\n") : `<p>${notices.length ? "没有用例级失败或受阻记录，请先处理上述运行级问题。" : entries.length ? "本次没有失败、受阻或未完成用例。" : "本次没有用例记录，不能据此判定通过。"}</p>`}
</main></body></html>\n`,
    "utf8",
  );
  return reportPath;
}

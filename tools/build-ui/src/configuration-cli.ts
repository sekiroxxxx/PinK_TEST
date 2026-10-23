import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Browser, Page } from "playwright-core";
import { Builder } from "./builder.js";
import { errorMessage, waitFor, type Options } from "./common.js";
import type { FormView } from "./configuration-page.js";
import { platformCatalog, platformEntry, type PlatformEntry } from "./platform-catalog.js";
import { findWindow, startSession, engineSelection } from "./session.js";
import { checkOpenpaasConfiguration, OpenpaasBlockedError } from "./openpaas.js";

interface Check {
  caseId: string;
  outcome: "passed" | "failed" | "blocked";
  evidence?: unknown;
  failure?: string;
}
interface CaseResult {
  caseId: string;
  platform: string;
  category: string;
  outcome: "not-run" | "passed" | "failed" | "blocked";
  checks: Check[];
  initial?: FormView;
  restored?: boolean;
  buildEligibility?: { state: string; reasons: string[]; command?: string };
}

function primary(view: FormView, key: string) {
  const field = view.fields.find((field) => field.key === key);
  if (!field) throw new Error(`页面缺少字段：${key}`);
  return field;
}

/** Compare input state, allowing only the product's automatic output-name allocation. */
function values(view: FormView) {
  return {
    fields: view.fields
      .map(({ key, controls }) => ({
        key,
        controls: controls.map(({ type, value }, index) => ({
          type,
          value: key === "buildPath" && index === 1 ? "[automatic-output-name]" : value,
        })),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    custom: view.unkeyedFields
      .map(({ label, controls }) => ({ label, controls }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function eligibility(platform: PlatformEntry, view: FormView) {
  const supported = ["supported", "existing-only", "base-combinations"].includes(platform.build);
  const reasons: string[] = [];
  if (platform.reason) reasons.push(platform.reason);
  if (view.alerts.some((alert) => alert.level === "error" || alert.level === "unknown"))
    reasons.push("页面有错误或未分类校验提示，需先处理再开放构建");
  const build = view.buttons.filter((button) => button.label === "构建");
  if (build.length !== 1 || build[0].disabled) reasons.push("构建按钮不唯一或当前不可用");
  return {
    state: supported && !reasons.length ? "available-with-profile-preflight" : "blocked",
    reasons,
    ...(supported && !reasons.length
      ? {
          command: `run-build-ui.ps1 -Pink <PinK.exe> -Project <工程目录> -Profile ${platform.build === "existing-only" ? "existing" : platform.build === "base-combinations" ? "<existing|debug|release-a>" : "<debug|release-a|release-b|release-c-local>"} -Platform ${platform.id}${platform.id === "huawei-agc" ? " -AgcServices <agconnect-services.json>" : ""}`,
        }
      : {}),
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      pink: { type: "string" },
      project: { type: "string" },
      port: { type: "string", default: "9222" },
      platforms: { type: "string", default: "all" },
      mode: { type: "string", default: "inspect" },
      "configuration-timeout": { type: "string", default: "120" },
      results: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (args.help) {
    console.log(
      "node dist/configuration-cli.js --pink <PinK.exe> --project <工程> [--platforms all|逗号分隔ID] [--mode inspect|exercise|openpaas] [--configuration-timeout 120] [--results <目录>]\ninspect检查配置页；exercise另外修改公共字段并恢复。openpaas仅搭配--platforms openpaas：必填版本名、已有游戏选择和UI回读，恢复原值；不新建游戏，不提交构建。通用模式仍不进入OpenPaaS。构建资格单独报告。",
    );
    return;
  }
  if (process.platform !== "win32" || Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("需要Windows和Node.js 24+");
  if (!args.pink || !args.project) throw new Error("必须提供pink和project");
  if (!["inspect", "exercise", "openpaas"].includes(args.mode))
    throw new Error("mode只能为inspect、exercise或openpaas");
  if (args.mode === "openpaas" && args.platforms !== "openpaas")
    throw new Error("openpaas模式仅支持--platforms openpaas，不检查其他平台");
  const ids =
    args.platforms === "all"
      ? platformCatalog.map((platform) => platform.id)
      : args.platforms.split(",").map((value) => value.trim());
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error("平台集合为空或重复");
  const selected = ids.map(platformEntry);
  const options: Options = {
    pink: resolve(args.pink),
    project: resolve(args.project),
    port: Number(args.port),
    timeoutMs: 600_000,
    queueTimeoutMs: 1_800_000,
    configurationTimeoutMs: Number(args["configuration-timeout"]) * 1000,
    resultsRoot: resolve(
      args.results ?? fileURLToPath(new URL("../../../results", import.meta.url)),
    ),
  };
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535 ||
    !Number.isFinite(options.configurationTimeoutMs) ||
    options.configurationTimeoutMs < 1000
  )
    throw new Error("端口或配置超时无效");
  await access(options.pink);
  const project = JSON.parse(await readFile(join(options.project, "package.json"), "utf8")) as {
    name?: string;
  };
  const product = JSON.parse(
    await readFile(join(options.pink, "..", "resources/app/product.json"), "utf8"),
  );
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-configuration`;
  const configuredEngine = await engineSelection(options.project);
  const directory = join(options.resultsRoot, runId);
  await mkdir(directory, { recursive: true });
  const abort = new AbortController();
  const stop = () => abort.abort(new Error("用户停止配置页检查；未提交或取消构建"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const cases: CaseResult[] = selected.map((platform) => ({
    caseId: `configuration.${platform.id}.${args.mode}`,
    platform: platform.id,
    category: platform.category,
    outcome: "not-run",
    checks: [],
  }));
  let browser: Browser | undefined, page: Page | undefined;
  let launch: unknown, fatal: string | undefined;
  const warnings: string[] = [];
  const integrity: Record<string, unknown> = {};
  const hash = async (file: string) =>
    createHash("sha256")
      .update(await readFile(join(options.project, "temp/pink-builder", file)))
      .digest("hex");
  const tasksBefore = await hash("tasks.json");
  const preferencesBefore = await hash("preferences.json");
  const save = async () => {
    const outcome =
      fatal || cases.some((item) => item.outcome === "failed") || warnings.length
        ? "failed"
        : cases.some((item) => item.outcome !== "passed")
          ? "incomplete"
          : "passed";
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          configuredEngine,
          kind: "configuration-ui",
          runId,
          outcome,
          project: options.project,
          material: { packageName: project.name },
          pink: { path: options.pink, version: product.pinkVersion, commit: product.commit },
          launch,
          mode: args.mode,
          scope: {
            platformIds: ids,
            buildSubmitted: false,
            artifactVerified: false,
            runtimeExecuted: false,
            checkboxExercised: args.mode === "exercise" ? "mangleProperties" : null,
            otherControls:
              args.mode === "openpaas"
                ? "existing game selection; versionName required check; restore via UI; no game creation"
                : "read-only-contract-checks; not all interaction branches",
            sensitiveComparison:
              args.mode === "openpaas"
                ? "game IDs SHA-256; credentials redacted; no token values retained"
                : "redacted empty/nonempty only; not secret-value identity",
          },
          cases,
          summary: Object.fromEntries(
            ["passed", "failed", "blocked", "not-run"].map((state) => [
              state,
              cases.filter((item) => item.outcome === state).length,
            ]),
          ),
          integrity,
          fatal,
          warnings,
        },
        null,
        2,
      ) + "\n",
    );
  };
  const check = async (result: CaseResult, caseId: string, action: () => Promise<unknown>) => {
    try {
      result.checks.push({ caseId, outcome: "passed", evidence: await action() });
    } catch (error) {
      result.checks.push({ caseId, outcome: "failed", failure: errorMessage(error) });
      throw error;
    }
  };
  try {
    const session = await startSession(options, abort.signal, (value) => {
      launch = value;
      console.log(`[session] ${value.mode} PID ${value.pid}`);
    });
    browser = session.browser;
    page = await findWindow(browser, options.project, abort.signal, options.pink);
    for (const category of new Set(selected.map((platform) => platform.category))) {
      await waitFor(
        `工程${category}就绪`,
        async () =>
          (await page!.getByRole("tab", { name: category, exact: true }).count()) === 1
            ? true
            : undefined,
        180_000,
        abort.signal,
      );
      const baseline = await Builder.open(
        page,
        session.endpoint,
        abort.signal,
        category,
        options.configurationTimeoutMs,
        true,
      );
      try {
        await baseline.installProbe();
        await baseline.baseline(true);
      } finally {
        await baseline.close();
      }
    }
    for (const result of cases) {
      if (abort.signal.aborted) break;
      const platform = platformEntry(result.platform);
      if (platform.configurationBlock && args.mode !== "openpaas") {
        result.outcome = "blocked";
        result.checks.push({
          caseId: "UI-P08-environment",
          outcome: "blocked",
          failure: platform.configurationBlock,
        });
        result.buildEligibility = {
          state: "blocked",
          reasons: [platform.configurationBlock, platform.reason ?? ""],
        };
        console.log(`[${platform.id}] blocked：${platform.configurationBlock}`);
        await save();
        continue;
      }
      let builder: Builder | undefined;
      let edited = false;
      let original: boolean | undefined;
      try {
        console.log(`[${platform.id}] 打开配置页`);
        builder = await Builder.open(
          page,
          session.endpoint,
          abort.signal,
          platform.category,
          options.configurationTimeoutMs,
          true,
        );
        if (args.mode === "openpaas") await builder.installProbe([], true);
        const initial = await builder.openConfigurationPage(platform.label);
        result.initial = initial;
        result.buildEligibility = eligibility(platform, initial);
        await check(result, "UI-N03/UI-C01", async () => {
          assert.equal(initial.title, platform.configurationTitle, "弹窗平台身份不一致");
          assert.equal(initial.state, "form");
          for (const key of [
            "name",
            "buildPath",
            "startScene",
            "scenes",
            "debug",
            "mainBundleCompressionType",
          ])
            assert.ok(primary(initial, key).controls.length, `字段缺控件：${key}`);
          assert.equal(primary(initial, "buildPath").controls.length, 2, "构建路径与输出名须分开");
          assert.equal(
            new Set(initial.fields.map((field) => field.key)).size,
            initial.fields.length,
            "字段key不唯一",
          );
          return {
            title: initial.title,
            fieldKeys: initial.fields.map((field) => field.key),
            customLabels: initial.unkeyedFields.map((field) => field.label),
            alerts: initial.alerts,
            buildEligibility: result.buildEligibility,
          };
        });
        await check(result, "UI-C05/UI-P03", async () => {
          const bound = initial.fields.filter((field) => field.controls.length);
          for (const field of bound) {
            assert.ok(field.key, "字段缺身份");
            assert.ok(
              field.controls.every((control) => control.value !== undefined),
              `字段不可回读：${field.key}`,
            );
          }
          for (const key of platform.requiredOptionKeys ?? [])
            assert.ok(primary(initial, key).controls.length, `专属字段缺控件：${key}`);
          for (const label of platform.requiredCustomLabels ?? []) {
            const matches = initial.unkeyedFields.filter((field) => field.label === label);
            assert.equal(matches.length, 1, `自定义字段须唯一：${label}`);
            assert.ok(matches[0].controls.length, `自定义字段缺控件：${label}`);
          }
          return {
            readableFields: bound.length,
            requiredOptionKeys: platform.requiredOptionKeys,
            requiredCustomLabels: platform.requiredCustomLabels,
            interactiveCoverage: "not implied by readback",
          };
        });
        if (args.mode === "openpaas") {
          await checkOpenpaasConfiguration(
            builder,
            initial,
            (id, action) => check(result, id, action),
            () => {
              result.restored = true;
            },
          );
        } else if (args.mode === "exercise") {
          const control = primary(initial, "mangleProperties").controls.find(
            (control) => control.type === "checkbox",
          );
          if (!control || control.disabled || typeof control.value !== "boolean")
            throw new Error("公共练习字段mangleProperties不可操作");
          original = control.value;
          await check(result, "UI-C24-change-save", async () => {
            edited = true;
            await builder!.formCheckbox("mangleProperties", !original);
            const changed = await builder!.configurationPage();
            await builder!.closeConfiguration();
            const reopened = await builder!.openConfigurationPage(platform.label);
            assert.equal(
              primary(reopened, "mangleProperties").controls.find(
                (control) => control.type === "checkbox",
              )?.value,
              !original,
            );
            assert.deepEqual(values(reopened), values(changed), "保存重开后字段值改变");
            return {
              key: "mangleProperties",
              before: original,
              changed: !original,
              reopened: !original,
            };
          });
          await check(result, "UI-C24-restore", async () => {
            await builder!.formCheckbox("mangleProperties", original!);
            await builder!.closeConfiguration();
            const restored = await builder!.openConfigurationPage(platform.label);
            assert.deepEqual(values(restored), values(initial), "UI恢复后的表单与原初态不同");
            result.restored = true;
            edited = false;
            return { key: "mangleProperties", restored: original };
          });
        }
        await builder.closeConfiguration();
        result.outcome = "passed";
        console.log(
          `[${platform.id}] 配置页 ${result.outcome}；构建 ${result.buildEligibility?.state}`,
        );
      } catch (error) {
        result.outcome = error instanceof OpenpaasBlockedError ? "blocked" : "failed";
        if (!result.checks.some((check) => check.outcome === "failed"))
          result.checks.push({
            caseId: "configuration-open",
            outcome: result.outcome,
            failure: errorMessage(error),
          });
        console.error(`[${platform.id}] ${errorMessage(error)}`);
      } finally {
        if (builder) {
          if (edited && original !== undefined && !abort.signal.aborted) {
            try {
              await builder.formCheckbox("mangleProperties", original);
              assert.deepEqual(
                values(await builder.configurationPage()),
                values(result.initial!),
                "恢复后仍有非目标配置差异",
              );
              result.restored = true;
            } catch (error) {
              warnings.push(`${platform.id}公共字段恢复失败：${errorMessage(error)}`);
            }
          }
          await builder
            .closeConfiguration()
            .catch((error) => warnings.push(`${platform.id}关闭配置失败：${errorMessage(error)}`));
          await builder.close().catch((error) => warnings.push(errorMessage(error)));
        }
        await save();
      }
      if (warnings.length) break;
    }
  } catch (error) {
    fatal = errorMessage(error);
    console.error(fatal);
  } finally {
    try {
      const tasksAfter = await hash("tasks.json");
      integrity.tasks = {
        before: tasksBefore,
        after: tasksAfter,
        unchanged: tasksBefore === tasksAfter,
      };
      if (tasksBefore !== tasksAfter) fatal ??= "任务文件发生变化，不能确认没有外部活动";
      const preferencesAfter = await hash("preferences.json");
      integrity.preferences = {
        before: preferencesBefore,
        after: preferencesAfter,
        byteIdentical: preferencesBefore === preferencesAfter,
        note:
          args.mode === "exercise" || args.mode === "openpaas"
            ? "按UI恢复本次编辑字段；产品加载/保存可能正常化配置或更新账号环境，不覆盖整个偏好文件"
            : "只读检查；产品加载可能正常化配置，任何差异保留",
      };
    } catch (error) {
      warnings.push(errorMessage(error));
    }
    await browser?.close().catch((error) => warnings.push(errorMessage(error)));
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await save();
    console.log(`结果：${join(directory, "result.json")}`);
    process.exitCode = abort.signal.aborted
      ? 130
      : !fatal && !warnings.length && cases.every((item) => item.outcome === "passed")
        ? 0
        : 1;
  }
}
main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 2;
});

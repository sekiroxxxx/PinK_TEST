import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
  join,
  dirname,
  resolve,
  relative,
  isAbsolute,
  basename,
  extname,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StateStore, serializeState } from "./store.js";
import { SettingsStore } from "./settings.js";
import { settingsInputSchema } from "../shared/settings.js";
import { atomicWrite, json, readJson, Serial } from "./files.js";
import { PinkBuildAdapter } from "../integrations/pink-build/adapter.js";
import { PinkBuildExecutor } from "../integrations/pink-build/executor.js";
import { authorNativeDocument } from "../integrations/pink-build/nativeContract.js";
import { recognizeProject } from "../shared/projectSelection.js";
import { launchTarget } from "./launch.js";
import { startWebHost } from "../development/hostService.js";
import {
  routeFileSchema,
  validateState,
  type CatalogDocument,
} from "../shared/model.js";

const directory = dirname(fileURLToPath(import.meta.url));
const webDevelopment =
  !app.isPackaged && process.env.QA_WEB_DEV_SERVICE === "1";
if (process.env.QA_DATA_DIR)
  app.setPath("userData", resolve(process.env.QA_DATA_DIR));
app.setName("QA Workbench");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
let window: BrowserWindow;
let pickerOpen = false;
const openDialog = async (options: Electron.OpenDialogOptions) => {
  if (pickerOpen) {
    throw new Error("已有系统选择窗口，请完成选择或取消后再试。");
  }
  pickerOpen = true;
  try {
    return await (webDevelopment
      ? dialog.showOpenDialog(options)
      : dialog.showOpenDialog(window, options));
  } finally {
    pickerOpen = false;
  }
};

async function boot() {
  await app.whenReady();
  const store = new StateStore(app.getPath("userData"));
  const settings = new SettingsStore(store.root, {
    moduleRoot:
      process.env.QA_PINK_TEST_ROOT || join(homedir(), "Desktop", "PinK-Test"),
    nodePath: process.env.QA_AUTOMATION_NODE || "",
  });
  let preferences = settings.defaultValues(),
    settingsError = "";
  try {
    preferences = await settings.read();
  } catch (error) {
    settingsError = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("设置读取失败", settingsError);
  }
  let moduleRoot = preferences.moduleRoot;
  let adapter = new PinkBuildAdapter(moduleRoot);
  const executor = new PinkBuildExecutor(
    join(store.root, "automation"),
    () => moduleRoot,
    {
      outputRoot: () => preferences.outputDirectory,
      historyRoots: () => preferences.outputDirectories,
      nodePath: () => preferences.nodePath,
    },
  );
  const mutations = new Serial();
  const id = z.string().min(1).max(300);
  const revision = z.number().int().nonnegative();
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  function invoke(
    name: string,
    handler: (...args: unknown[]) => Promise<unknown>,
  ) {
    handlers.set(name, handler);
    ipcMain.handle("qa:" + name, async (event, ...args: unknown[]) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ok: false, error: "无效调用来源" };
      try {
        return { ok: true, value: await handler(...args) };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "操作失败",
        };
      }
    });
  }
  const saveDialog = async (name: string) =>
    (
      await dialog.showSaveDialog(window, {
        defaultPath: name,
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
    ).filePath;
  const pickJson = async () =>
    (
      await openDialog({
        properties: ["openFile"],
        filters: [{ name: "JSON", extensions: ["json"] }],
      })
    ).filePaths[0];
  const inside = (path: string) => {
    const rel = relative(store.root, resolve(path));
    return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
  };

  invoke("bootstrap", async () => ({
    state: await store.read(),
    dataPath: store.root,
    moduleRoot,
    modules: [adapter.descriptor],
  }));
  invoke("hostInfo", async () => ({
    moduleRoot,
    modules: [adapter.descriptor],
  }));
  invoke("saveState", async (value, expected) =>
    mutations.run(() => store.save(value, revision.parse(expected))),
  );
  invoke("pickPath", async (kind) => {
    const selected = z.enum(["file", "directory"]).parse(kind);
    return (
      (
        await openDialog({
          properties: selected === "file" ? ["openFile"] : ["openDirectory"],
        })
      ).filePaths[0] ?? null
    );
  });
  invoke("launchTarget", launchTarget);
  invoke("previewAutomation", (request) => executor.preview(request));
  invoke("authorAutomation", (request) =>
    authorNativeDocument(moduleRoot, request),
  );
  invoke("startAutomation", (value) => executor.start(id.parse(value)));
  invoke("listAutomation", () => executor.list());
  invoke("readAutomation", (value) => executor.detail(id.parse(value)));
  invoke("stopAutomation", (value) => executor.stop(id.parse(value)));
  const savePreferences = async (value: unknown) => {
    const input = settingsInputSchema.parse(value);
    if (!isAbsolute(input.moduleRoot))
      throw new Error("请选择自动化工具目录的完整路径");
    const candidate =
      resolve(input.moduleRoot) === resolve(moduleRoot)
        ? adapter
        : new PinkBuildAdapter(input.moduleRoot);
    await candidate.load();
    preferences = await settings.save(input);
    moduleRoot = preferences.moduleRoot;
    adapter = candidate;
    settingsError = "";
    return preferences;
  };
  invoke("getSettings", async () => {
    if (settingsError) throw new Error(settingsError);
    return preferences;
  });
  invoke("saveSettings", (value) =>
    mutations.run(() => savePreferences(value)),
  );
  const openDirectory = async (path: string) => {
    if (!(await stat(path)).isDirectory())
      throw new Error("目录不存在，请核对设置或原记录位置");
    const error = await shell.openPath(path);
    if (error) throw new Error("无法打开目录：" + error);
  };
  invoke("openSettingsDirectory", async (value) => {
    const kind = z.enum(["output", "module", "data"]).parse(value);
    const path =
      kind === "output"
        ? preferences.outputDirectory
        : kind === "module"
          ? preferences.moduleRoot
          : store.root;
    if (kind === "output") await mkdir(path, { recursive: true });
    await openDirectory(path);
  });
  invoke("openAutomationDirectory", async (value) =>
    openDirectory(await executor.runDirectory(id.parse(value))),
  );
  invoke("configureModule", async () => {
    if (executor.active)
      throw new Error("请等待当前配置检查收尾后再更换工具目录");
    const root = (
      await openDialog({
        title: "选择可信的 PinK-Test 链路目录（将加载其共享合同模块）",
        properties: ["openDirectory"],
      })
    ).filePaths[0];
    if (!root) return null;
    await mutations.run(() =>
      savePreferences({
        moduleRoot: root,
        outputDirectory: preferences.outputDirectory,
        nodePath: preferences.nodePath,
      }),
    );
    return root;
  });
  invoke("pickProject", async () => {
    const folder = (
      await openDialog({
        title: "选择测试项目目录",
        properties: ["openDirectory"],
      })
    ).filePaths[0];
    if (!folder) return null;
    const descriptors: Record<string, string> = {};
    for (const name of ["project.json", "package.json"]) {
      try {
        const path = join(folder, name);
        if ((await stat(path)).size <= 256 * 1024)
          descriptors[name] = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("无法读取项目描述文件，请检查目录权限");
      }
    }
    return recognizeProject(
      basename(folder) || folder,
      folder,
      "absolute",
      descriptors,
    );
  });
  invoke("loadCatalog", async (pick) => {
    const path = z.boolean().parse(pick) ? await pickJson() : undefined;
    if (pick && !path) return null;
    return adapter.load(path);
  });
  invoke("validateCatalog", async (token, document) =>
    adapter.validate(id.parse(token), document as CatalogDocument),
  );
  invoke("saveCatalog", async (token, document, saveAs) =>
    mutations.run(async () => {
      const t = id.parse(token),
        as = z.boolean().parse(saveAs);
      const path = as
        ? await saveDialog("build-cases.personal.json")
        : undefined;
      if (as && !path) return null;
      if (!as) {
        const confirmation = await dialog.showMessageBox(window, {
          type: "question",
          message: "保存到当前用例文件？",
          detail:
            "这会修改当前来源。建议优先另存个人副本。保存前会检查文件是否已被外部修改。",
          buttons: ["取消", "保存当前文件"],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirmation.response !== 1) return null;
      }
      return adapter.save(t, document as CatalogDocument, path);
    }),
  );
  invoke("exportRoute", async (value) => {
    const route = routeFileSchema.parse({
      ...(value as object),
      kind: "qa-personal-route",
      schemaVersion: 1,
    });
    const path = await saveDialog("personal-route.json");
    if (!path) return null;
    await atomicWrite(path, json(route));
    return path;
  });
  invoke("importRoute", async () => {
    const path = await pickJson();
    if (!path) return null;
    const route = routeFileSchema.parse(await readJson(path));
    return {
      id: randomUUID(),
      name: route.name,
      items: route.items.map((item) => ({ ...item, id: randomUUID() })),
    };
  });
  const pickEvidence = async () => {
    const path = (
      await dialog.showOpenDialog(window, { properties: ["openFile"] })
    ).filePaths[0];
    if (!path) return null;
    if ((await stat(path)).size > 8 * 1024 * 1024)
      throw new Error("第一版单个证据文件最多 8 MB");
    const attachmentId = randomUUID();
    const destination = join(
      store.root,
      "attachments",
      attachmentId + extname(path),
    );
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(path, destination);
    return { id: attachmentId, name: basename(path), path: destination };
  };
  invoke("pickEvidence", pickEvidence);
  invoke("addAttachment", async (runId, issueId, expected) =>
    mutations.run(async () => {
      const r = id.parse(runId),
        i = id.parse(issueId),
        rev = revision.parse(expected);
      const state = await store.read();
      if (state.revision !== rev) throw new Error("记录已更新，请重试");
      const issue = state.runs
        .find((run) => run.id === r)
        ?.issues.find((issue) => issue.id === i);
      if (!issue) throw new Error("问题记录不存在");
      const attachment = await pickEvidence();
      if (!attachment) return null;
      issue.attachments.push(attachment);
      return store.save(state, rev);
    }),
  );
  invoke("openAttachment", async (runId, issueId, attachmentId) => {
    const state = await store.read();
    const attachment = state.runs
      .find((r) => r.id === id.parse(runId))
      ?.issues.find((i) => i.id === id.parse(issueId))
      ?.attachments.find((a) => a.id === id.parse(attachmentId));
    if (!attachment?.path || !inside(attachment.path))
      throw new Error("证据文件缺失，请重新补充");
    // Reveal rather than execute potentially active files supplied as evidence.
    await stat(attachment.path);
    shell.showItemInFolder(attachment.path);
  });
  invoke("exportRun", async (runId) => {
    const run = (await store.read()).runs.find((r) => r.id === id.parse(runId));
    if (!run) throw new Error("测试记录不存在");
    const path = await saveDialog("manual-test-result.json");
    if (!path) return null;
    const portable = structuredClone(run);
    for (const issue of portable.issues)
      for (const a of issue.attachments) a.path = "";
    await atomicWrite(
      path,
      json({
        kind: "qa-manual-result",
        schemaVersion: 1,
        run: portable,
        note: "人工测试结果；附件仅列文件名，完整证据请使用个人备份。包含本轮对象与环境快照。",
      }),
    );
    return path;
  });
  invoke("exportBackup", async () => {
    const state = await store.read();
    const files: Record<string, string> = {};
    const portable = structuredClone(state);
    for (const run of portable.runs)
      for (const issue of run.issues)
        for (const a of issue.attachments) {
          if (a.path && inside(a.path))
            files[a.id] = (await readFile(a.path)).toString("base64");
          a.path = "";
        }
    const content = json({
      kind: "qa-personal-backup",
      schemaVersion: 1,
      state: portable,
      files,
    });
    if (Buffer.byteLength(content) > 32 * 1024 * 1024)
      throw new Error("备份超过第一版 32 MB 限制，请减少附件后再试");
    const path = await saveDialog("qa-personal-backup.json");
    if (!path) return null;
    await atomicWrite(path, content);
    return path;
  });
  invoke("restoreBackup", async (expected) =>
    mutations.run(async () => {
      const rev = revision.parse(expected),
        path = await pickJson();
      if (!path) return null;
      const input = z
        .object({
          kind: z.literal("qa-personal-backup"),
          schemaVersion: z.literal(1),
          state: z.unknown(),
          files: z.record(
            z.string(),
            z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
          ),
        })
        .parse(await readJson(path));
      const candidate = validateState(input.state);
      const current = await store.read();
      if (current.revision !== rev) throw new Error("记录已更新，请重新恢复");
      const confirmation = await dialog.showMessageBox(window, {
        type: "question",
        message: "用备份替换本机记录？",
        detail: `备份包含 ${candidate.projects.length} 个项目、${candidate.runs.length} 次测试。当前记录会先保存为本机恢复前备份。环境路径需重新核对。`,
        buttons: ["取消", "备份当前并恢复"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirmation.response !== 1) return null;
      const restoredFiles: { path: string; bytes: Buffer }[] = [];
      for (const run of candidate.runs)
        for (const issue of run.issues)
          for (const a of issue.attachments) {
            const content = input.files[a.id];
            a.path = "";
            if (content !== undefined) {
              const bytes = Buffer.from(content, "base64");
              if (bytes.length > 8 * 1024 * 1024)
                throw new Error("备份中的单个附件超过限制");
              a.path = join(
                store.root,
                "attachments",
                randomUUID() + extname(basename(a.name)),
              );
              restoredFiles.push({ path: a.path, bytes });
            }
          }
      serializeState({ ...candidate, revision: rev + 1 });
      await atomicWrite(
        join(store.root, "before-restore-" + Date.now() + ".json"),
        json(current),
      );
      for (const file of restoredFiles)
        await atomicWrite(file.path, file.bytes);
      return store.save(candidate, rev);
    }),
  );

  window = new BrowserWindow({
    show: !webDevelopment,
    width: 1120,
    height: 820,
    minWidth: 780,
    minHeight: 620,
    backgroundColor: "#202326",
    title: "QA 工作台",
    webPreferences: {
      preload: join(directory, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.removeMenu();
  let closing = false;
  window.on("close", (event) => {
    if (!executor.active) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    window.setTitle("QA 工作台 · 正在停止检查并保存结果");
    void executor.shutdown().catch((error) => {
      window.setTitle("QA 工作台 · 停止请求失败：" + String(error));
    });
    const timer = setInterval(() => {
      if (!executor.active) {
        clearInterval(timer);
        window.close();
      }
    }, 500);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      message: "仍有未保存的修改或正在进行的保存操作。",
      detail: "返回工作台保存后再退出，可以避免丢失修改。",
      buttons: ["返回工作台", "放弃并退出"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  if (webDevelopment) {
    const infoPath = process.env.QA_WEB_BRIDGE_INFO;
    if (!infoPath || !isAbsolute(infoPath))
      throw new Error("网页联调需要指定本机连接文件");
    const cleanup = await startWebHost(
      infoPath,
      async (name, args) => {
        const handler = handlers.get(name);
        if (!handler) throw new Error("未开放此本机操作");
        return handler(...args);
      },
      async () => {
        await executor.shutdown();
        // shutdown requests a cooperative stop; keep the host alive until
        // configuration restoration and final files have finished.
        const timer = setInterval(() => {
          if (!executor.active) {
            clearInterval(timer);
            void cleanup().finally(() => window.close());
          }
        }, 250);
      },
    );
    app.on("before-quit", () => {
      void cleanup();
    });
  } else if (process.env.QA_DEV_URL === "http://127.0.0.1:5187")
    await window.loadURL(process.env.QA_DEV_URL);
  else await window.loadFile(join(directory, "../../dist/index.html"));
  app.on("second-instance", () => {
    if (webDevelopment) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
}
void boot().catch((error) => {
  dialog.showErrorBox(
    "QA 工作台启动失败",
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
});

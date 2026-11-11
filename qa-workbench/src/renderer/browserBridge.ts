import { z } from "zod";
import { saveBrowserRecovery, readBrowserRecovery } from "./browserRecovery";
import {
  recognizeProject,
  type ProjectSelection,
} from "../shared/projectSelection";
import type { DesktopBridge, Reply } from "../shared/bridge";
import {
  webHostMethods,
  type HostInfo,
  type WebHostMethod,
} from "../shared/webDevelopment";
import {
  routeFileSchema,
  validateState,
  type Attachment,
} from "../shared/model";
import {
  initializeBrowserStore,
  readBrowserState,
  readBrowserEnvelope,
  saveBrowserState,
  saveBrowserAttachment,
  readBrowserAttachment,
  type BrowserEnvelope as Envelope,
} from "./browserStore";

const browserBridgeMarker = Symbol.for("qa-workbench.browser-bridge");
export const browserMode =
  !window.qa || Reflect.get(window.qa, browserBridgeMarker) === true;
export let hasHostAccess = !browserMode;
export let localServiceMode = false;
async function hostCall<T>(
  method: WebHostMethod,
  args: unknown[] = [],
): Promise<T> {
  let reply: Reply<T>;
  try {
    const response = await fetch("/__qa_dev__/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, args }),
    });
    reply = await response.json();
  } catch {
    throw new Error(
      "本机联调服务无法连接。记录和草稿仍保留，请恢复服务后刷新页面。",
    );
  }
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
async function connectHost(): Promise<HostInfo | undefined> {
  if (!import.meta.env.DEV) return;
  const status = await fetch("/__qa_dev__/status")
    .then((response) => response.json())
    .catch(() => null);
  if (status?.kind !== "qa-workbench-web-dev-status" || !status.connected)
    return;
  const info = await hostCall<HostInfo>("hostInfo");
  Object.assign(
    bridge,
    Object.fromEntries(
      webHostMethods
        .filter((method) => method !== "hostInfo")
        .map((method) => [
          method,
          (...args: unknown[]) => hostCall(method, args),
        ]),
    ),
  );
  hasHostAccess = true;
  localServiceMode = true;
  return info;
}
export function chooseFile(
  accept = ".json",
  max = 32 * 1024 * 1024,
): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    document.body.append(input);
    input.oncancel = () => {
      input.remove();
      resolve(null);
    };
    input.onchange = () => {
      const file = input.files?.[0] || null;
      input.remove();
      if (file && file.size > max)
        reject(new Error(`文件超过 ${max / 1024 / 1024} MB 限制`));
      else resolve(file);
    };
    input.click();
  });
}
export function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}
const filesSchema = z.record(
  z.string(),
  z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/),
);
function portable(env: Envelope) {
  const state = structuredClone(env.state),
    files: Record<string, string> = {};
  for (const r of state.runs)
    for (const i of r.issues)
      for (const a of i.attachments) {
        if (env.files[a.id]) files[a.id] = env.files[a.id];
        a.path = "";
      }
  return { kind: "qa-personal-backup", schemaVersion: 1, state, files };
}
export async function exportBeforeRestoreBackup() {
  const raw = await readBrowserRecovery();
  if (!raw)
    throw new Error("尚无恢复前副本，请使用“导出个人备份”保存当前记录。");
  const value = z
    .object({ state: z.unknown(), files: filesSchema })
    .parse(JSON.parse(raw));
  return download(
    "qa-before-restore-backup.json",
    portable({ state: validateState(value.state), files: value.files }),
  );
}
async function pickEvidence(): Promise<Attachment | null> {
  const file = await chooseFile("", 8 * 1024 * 1024);
  if (!file) return null;
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("附件读取失败"));
    r.readAsDataURL(file);
  });
  const id = crypto.randomUUID();
  await saveBrowserAttachment(id, data);
  return { id, name: file.name, path: "browser:" + id };
}
const desktopOnly = async (): Promise<never> => {
  throw new Error(
    "此入口需要桌面文件合同。浏览器可挂载测试内容 JSON 或个人链路；不会加载本机可执行模块。",
  );
};
const bridge: DesktopBridge = {
  getSettings: async () => ({
    outputDirectory: "",
    moduleRoot: "",
    nodePath: "",
    dataPath: "当前浏览器独立存储，请使用个人备份",
    defaultOutputDirectory: "",
    outputDirectories: [],
  }),
  saveSettings: desktopOnly,
  openSettingsDirectory: desktopOnly,
  openAutomationDirectory: desktopOnly,
  previewAutomation: desktopOnly,
  authorAutomation: desktopOnly,
  startAutomation: desktopOnly,
  listAutomation: async () => [],
  readAutomation: desktopOnly,
  stopAutomation: desktopOnly,
  async launchTarget(request) {
    if (!request.executable.trim()) throw new Error("请先选择编辑器程序。");
    return { simulated: true, message: "模拟启动完成 · 未运行 EXE" };
  },
  async pickProject(): Promise<ProjectSelection | null> {
    const files = await new Promise<File[] | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.setAttribute("webkitdirectory", "");
      input.multiple = true;
      input.hidden = true;
      document.body.append(input);
      input.oncancel = () => {
        input.remove();
        resolve(null);
      };
      input.onchange = () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      };
      input.click();
    });
    if (!files) return null;
    if (!files.length)
      throw new Error(
        "所选目录为空或浏览器未提供文件列表，请选择包含项目文件的目录",
      );
    const folder = files[0].webkitRelativePath.split("/")[0];
    if (!folder) throw new Error("此浏览器未提供目录信息，请重新选择项目目录");
    const descriptors: Record<string, string> = {};
    for (const name of ["project.json", "package.json"]) {
      const file = files.find(
        (f) => f.webkitRelativePath === folder + "/" + name,
      );
      if (file && file.size <= 256 * 1024)
        descriptors[name] = await file.text();
    }
    return recognizeProject(folder, folder + "/", "relative", descriptors);
  },
  async bootstrap() {
    const host = await connectHost();
    return {
      state: await initializeBrowserStore(),
      dataPath: "当前浏览器独立存储（可导入个人备份）",
      moduleRoot: host?.moduleRoot || "",
      modules: host?.modules || [],
    };
  },
  async saveState(value, revision) {
    return saveBrowserState(value, revision);
  },
  async pickPath() {
    return null;
  },
  configureModule: desktopOnly,
  loadCatalog: desktopOnly,
  validateCatalog: desktopOnly,
  saveCatalog: desktopOnly,
  async exportBackup() {
    const content = portable(await readBrowserEnvelope());
    if (new Blob([JSON.stringify(content, null, 2)]).size > 32 * 1024 * 1024)
      throw new Error("备份超过 32 MB 限制");
    return download("qa-personal-backup.json", content);
  },
  async restoreBackup(revision) {
    const file = await chooseFile();
    if (!file) return null;
    const input = z
      .object({
        kind: z.literal("qa-personal-backup"),
        schemaVersion: z.literal(1),
        state: z.unknown(),
        files: filesSchema,
      })
      .parse(JSON.parse(await file.text()));
    const next = validateState(input.state),
      current = await readBrowserEnvelope();
    if (current.state.revision !== revision)
      throw new Error("记录已更新，请重试");
    for (const r of next.runs)
      for (const i of r.issues)
        for (const a of i.attachments) {
          const bytes = input.files[a.id];
          if (bytes && (bytes.length * 3) / 4 > 8 * 1024 * 1024)
            throw new Error("单个附件超过限制");
          a.path = bytes ? "browser:" + a.id : "";
        }
    if (
      !confirm(
        "用备份替换当前浏览器记录？恢复前会保存可导出的副本，未保存草稿保留，Electron 数据不受影响。",
      )
    )
      return null;
    if ((await readBrowserState()).revision !== revision)
      throw new Error("记录已更新，请重试");
    await saveBrowserRecovery(JSON.stringify(current), null);
    return saveBrowserState(next, revision, input.files);
  },
  async exportRoute(route) {
    const { id: _id, ...definition } = route;
    return download("qa-personal-route.json", {
      kind: "qa-personal-route",
      schemaVersion: 1,
      ...definition,
    });
  },
  async importRoute() {
    const file = await chooseFile();
    if (!file) return null;
    const value = routeFileSchema.parse(JSON.parse(await file.text()));
    return { id: crypto.randomUUID(), name: value.name, items: value.items };
  },
  pickEvidence,
  async addAttachment(runId, issueId, revision) {
    if ((await readBrowserState()).revision !== revision)
      throw new Error("记录已更新");
    const attachment = await pickEvidence();
    if (!attachment) return null;
    const state = await readBrowserState(),
      issue = state.runs
        .find((r) => r.id === runId)
        ?.issues.find((i) => i.id === issueId);
    if (!issue) throw new Error("问题不存在");
    issue.attachments.push(attachment);
    return saveBrowserState(state, revision);
  },
  async openAttachment(runId, issueId, id) {
    const state = await readBrowserState(),
      a = state.runs
        .find((r) => r.id === runId)
        ?.issues.find((i) => i.id === issueId)
        ?.attachments.find((a) => a.id === id),
      data = await readBrowserAttachment(id);
    if (!a || !data) throw new Error("证据缺失，请重新补充");
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/octet-stream" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async exportRun(id) {
    const run = structuredClone(
      (await readBrowserState()).runs.find((r) => r.id === id),
    );
    if (!run) throw new Error("记录不存在");
    for (const i of run.issues) for (const a of i.attachments) a.path = "";
    return download("qa-manual-result.json", {
      kind: "qa-manual-result",
      schemaVersion: 1,
      run,
    });
  },
};
if (browserMode) {
  Object.defineProperty(bridge, browserBridgeMarker, { value: true });
  window.qa = bridge;
}

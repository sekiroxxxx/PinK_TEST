import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, Reply } from "../shared/bridge.js";

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke("qa:" + name, ...args)) as Reply<T>;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}
const bridge: DesktopBridge = {
  bootstrap: () => call("bootstrap"),
  saveState: (state, expected) => call("saveState", state, expected),
  pickPath: (kind) => call("pickPath", kind),
  pickProject: () => call("pickProject"),
  launchTarget: (request) => call("launchTarget", request),
  previewAutomation: (request) => call("previewAutomation", request),
  authorAutomation: (request) => call("authorAutomation", request),
  startAutomation: (id) => call("startAutomation", id),
  listAutomation: () => call("listAutomation"),
  readAutomation: (id) => call("readAutomation", id),
  stopAutomation: (id) => call("stopAutomation", id),
  getSettings: () => call("getSettings"),
  saveSettings: (value) => call("saveSettings", value),
  openSettingsDirectory: (kind) => call("openSettingsDirectory", kind),
  openAutomationDirectory: (id) => call("openAutomationDirectory", id),
  configureModule: () => call("configureModule"),
  loadCatalog: (pick) => call("loadCatalog", pick),
  validateCatalog: (token, doc) => call("validateCatalog", token, doc),
  saveCatalog: (token, doc, as) => call("saveCatalog", token, doc, as),
  exportBackup: () => call("exportBackup"),
  restoreBackup: (rev) => call("restoreBackup", rev),
  exportRoute: (route) => call("exportRoute", route),
  importRoute: () => call("importRoute"),
  pickEvidence: () => call("pickEvidence"),
  addAttachment: (run, issue, rev) => call("addAttachment", run, issue, rev),
  openAttachment: (run, issue, attachment) =>
    call("openAttachment", run, issue, attachment),
  exportRun: (run) => call("exportRun", run),
};
contextBridge.exposeInMainWorld("qa", bridge);

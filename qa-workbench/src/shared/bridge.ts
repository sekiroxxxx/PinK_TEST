import type {
  Bootstrap,
  Attachment,
  Catalog,
  CatalogDocument,
  Route,
  Run,
  State,
} from "./model.js";
import type { ProjectSelection } from "./projectSelection.js";
import type { LaunchRequest, LaunchResult } from "./launch.js";
import type { NativeAuthoringRequest } from "./nativeAuthoring.js";
import type {
  ExecutionRequest,
  ExecutionPreview,
  ExecutionState,
  ExecutionDetail,
} from "./execution.js";
import type {
  SettingsInput,
  WorkbenchSettings,
  SettingsDirectory,
} from "./settings.js";

export interface DesktopBridge {
  bootstrap(): Promise<Bootstrap>;
  saveState(state: State, expectedRevision: number): Promise<State>;
  pickPath(kind: "file" | "directory"): Promise<string | null>;
  pickProject(): Promise<ProjectSelection | null>;
  launchTarget(request: LaunchRequest): Promise<LaunchResult>;
  authorAutomation(
    request: NativeAuthoringRequest,
  ): Promise<Record<string, unknown>>;
  previewAutomation(request: ExecutionRequest): Promise<ExecutionPreview>;
  startAutomation(previewId: string): Promise<ExecutionState>;
  listAutomation(): Promise<ExecutionState[]>;
  readAutomation(id: string): Promise<ExecutionDetail>;
  stopAutomation(id: string): Promise<void>;
  getSettings(): Promise<WorkbenchSettings>;
  saveSettings(settings: SettingsInput): Promise<WorkbenchSettings>;
  openSettingsDirectory(kind: SettingsDirectory): Promise<void>;
  openAutomationDirectory(id: string): Promise<void>;
  configureModule(): Promise<string | null>;
  loadCatalog(pick: boolean): Promise<Catalog | null>;
  validateCatalog(
    token: string,
    document: CatalogDocument,
  ): Promise<CatalogDocument>;
  saveCatalog(
    token: string,
    document: CatalogDocument,
    saveAs: boolean,
  ): Promise<Catalog | null>;
  exportBackup(): Promise<string | null>;
  restoreBackup(expectedRevision: number): Promise<State | null>;
  exportRoute(route: Route): Promise<string | null>;
  importRoute(): Promise<Route | null>;
  pickEvidence(): Promise<Attachment | null>;
  addAttachment(
    runId: string,
    issueId: string,
    expectedRevision: number,
  ): Promise<State | null>;
  openAttachment(
    runId: string,
    issueId: string,
    attachmentId: string,
  ): Promise<void>;
  exportRun(runId: Run["id"]): Promise<string | null>;
}

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };
declare global {
  interface Window {
    qa: DesktopBridge;
  }
}

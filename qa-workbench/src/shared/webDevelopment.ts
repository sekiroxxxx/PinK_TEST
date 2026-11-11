import type { Bootstrap } from "./model.js";

// Only these host operations are exposed during local browser development.
// Browser state, drafts, backups and attachments stay in the browser bridge.
export const webHostMethods = [
  "hostInfo",
  "pickPath",
  "pickProject",
  "launchTarget",
  "authorAutomation",
  "previewAutomation",
  "startAutomation",
  "listAutomation",
  "readAutomation",
  "stopAutomation",
  "getSettings",
  "saveSettings",
  "openSettingsDirectory",
  "openAutomationDirectory",
  "configureModule",
  "loadCatalog",
  "validateCatalog",
  "saveCatalog",
] as const;
export type WebHostMethod = (typeof webHostMethods)[number];
export type HostInfo = Pick<Bootstrap, "moduleRoot" | "modules">;
export const webOrigins = ["http://127.0.0.1:5187", "http://localhost:5187"];
export const canvasOrigins = ["http://127.0.0.1:5195"];

// The independent canvas may prepare plans, never launch an editor or a test.
export function canvasRpcAllowed(method: string, args: unknown[]) {
  if (method === "hostInfo" || method === "pickProject")
    return args.length === 0;
  if (method === "pickPath")
    return args.length === 1 && ["file", "directory"].includes(String(args[0]));
  if (method === "loadCatalog") return args.length === 1 && args[0] === false;
  if (args.length !== 1 || !args[0] || typeof args[0] !== "object")
    return false;
  const input = args[0] as Record<string, unknown>;
  if (method === "authorAutomation")
    return [
      "describe",
      "describeComposition",
      "validateComposition",
      "listCaseReferences",
      "createComposition",
      "compose",
      "template",
      "validate",
    ].includes(String(input.action));
  return method === "previewAutomation" && input.inputKind === "composition";
}
export const webRequestLimit = 32 * 1024 * 1024;

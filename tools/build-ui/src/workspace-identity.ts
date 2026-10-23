import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { Page } from "playwright-core";

export interface WorkspaceObservation {
  available: boolean;
  windowId?: number;
  execPath?: string;
  workspace?: {
    configPath?: unknown;
    uri?: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string };
  };
}

export function workspaceFolderPath(
  workspace: WorkspaceObservation["workspace"],
  platform: NodeJS.Platform = process.platform,
): string {
  if (!workspace) throw new Error("PinK 尚未打开工程");
  if (workspace.configPath) throw new Error("不支持多根工作区；需要明确的单文件夹工程");
  const uri = workspace.uri;
  if (!uri || uri.scheme !== "file" || typeof uri.path !== "string" || uri.query || uri.fragment)
    throw new Error("工程必须是无查询和片段的本地 file URI");
  // URI components are already decoded. Decoding again would corrupt literal %xx filenames.
  if (platform === "win32") {
    if (uri.authority && uri.authority !== "localhost") {
      if (!uri.path.startsWith("/") || /[\\/]/.test(uri.authority))
        throw new Error("工程 UNC URI 无效");
      return `\\\\${uri.authority}${uri.path.replaceAll("/", "\\")}`;
    }
    if (!/^\/[A-Za-z]:\//.test(uri.path)) throw new Error("工程 URI 缺少绝对 Windows 盘符路径");
    return uri.path.slice(1).replaceAll("/", "\\");
  }
  if ((uri.authority && uri.authority !== "localhost") || !uri.path.startsWith("/"))
    throw new Error("工程 URI 不是本机绝对路径");
  return uri.path;
}

export function sameCanonicalPath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
) {
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function verifyWorkspaceObservation(
  observed: WorkspaceObservation,
  expectedProject: string,
  expectedExecutable: string,
) {
  if (!observed.available) throw new Error("工作台尚未提供窗口配置，无法核对工程身份");
  const folder = workspaceFolderPath(observed.workspace);
  if (!observed.execPath || !isAbsolute(observed.execPath))
    throw new Error("工作台未提供绝对程序路径");
  const [project, executable, requestedProject, requestedExecutable] = await Promise.all([
    realpath(folder),
    realpath(observed.execPath),
    realpath(resolve(expectedProject)),
    realpath(resolve(expectedExecutable)),
  ]);
  if (!sameCanonicalPath(project, requestedProject))
    throw new Error(`工程路径不符：实际 ${project}；指定 ${requestedProject}`);
  if (!sameCanonicalPath(executable, requestedExecutable))
    throw new Error("工作台程序路径与指定 PinK 不符");
  return {
    windowId: observed.windowId,
    project,
    executable,
    basis: "workbench-file-URI-and-process-execPath",
    verifiedAt: new Date().toISOString(),
  };
}

export async function readWorkspaceObservation(page: Page): Promise<WorkspaceObservation> {
  return page.evaluate(() => {
    type Configuration = { windowId?: number; workspace?: WorkspaceObservation["workspace"] };
    const v = (
      window as unknown as {
        vscode?: {
          context?: { configuration?: () => Configuration | undefined };
          process?: { execPath?: string };
        };
      }
    ).vscode;
    const c = v?.context?.configuration?.();
    if (!c) return { available: false };
    const uri = c.workspace?.uri;
    // Select only identity fields; never return the configuration's userEnv or other private data.
    return {
      available: true,
      windowId: c.windowId,
      execPath: v?.process?.execPath,
      workspace: c.workspace
        ? {
            configPath: Boolean(c.workspace.configPath),
            uri: uri
              ? {
                  scheme: uri.scheme,
                  authority: uri.authority,
                  path: uri.path,
                  query: uri.query,
                  fragment: uri.fragment,
                }
              : undefined,
          }
        : undefined,
    };
  });
}

export async function assertWindowIdentity(page: Page, project: string, executable: string) {
  return verifyWorkspaceObservation(await readWorkspaceObservation(page), project, executable);
}

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium, type Browser, type Page } from "playwright-core";
import { waitFor, type Options } from "./common.js";
import { readWorkspaceObservation, verifyWorkspaceObservation } from "./workspace-identity.js";

const run = promisify(execFile);

export async function engineSelection(project?: string): Promise<{
  basis: string;
  type?: string;
  version?: string;
}> {
  try {
    const globalSettings = JSON.parse(
      await readFile(resolve(homedir(), ".pink/settings.json"), "utf8"),
    );
    const projectSettings = project
      ? await readFile(resolve(project, ".pink/settings.json"), "utf8")
          .then((raw) => JSON.parse(raw))
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return {};
            throw error;
          })
      : {};
    const settings = { ...globalSettings, ...projectSettings };
    return {
      basis: project
        ? "configured-selection; project overrides global; not a loaded-runtime fingerprint"
        : "configured-selection; not a loaded-runtime fingerprint",
      type:
        typeof settings["cocos.engine.type"] === "string"
          ? settings["cocos.engine.type"]
          : undefined,
      version:
        typeof settings["cocos.engine.version"] === "string"
          ? settings["cocos.engine.version"]
          : undefined,
    };
  } catch {
    return { basis: "unavailable" };
  }
}
interface PinkProcess {
  ProcessId: number;
  ExecutablePath: string;
  CommandLine: string;
}

async function mainProcesses(): Promise<PinkProcess[]> {
  const script = `@(Get-CimInstance Win32_Process -Filter "Name = 'PinK.exe'" | Where-Object { $_.CommandLine -notmatch '--type=|--node-ipc|bootstrap-fork|--clientProcessId' } | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`;
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15_000 },
  );
  if (!stdout.trim()) return [];
  const processes = JSON.parse(stdout) as PinkProcess | PinkProcess[];
  return Array.isArray(processes) ? processes : [processes];
}

async function portOwner(port: number): Promise<number | undefined> {
  const script = `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`;
  const { stdout } = await run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 15_000 },
  ).catch((error: { stdout?: string; code?: number }) => {
    if (error.code === 1 && !error.stdout?.trim()) return { stdout: "" };
    throw error;
  });
  const owners = stdout.trim().split(/\s+/).filter(Boolean).map(Number);
  if (owners.length > 1) throw new Error("调试端口对应多个进程，无法确认实例归属");
  return owners[0];
}

export async function startSession(
  options: Options,
  signal: AbortSignal,
  onLaunch: (launch: { pid: number; mode: string; endpoint: string }) => void,
) {
  const endpoint = `http://127.0.0.1:${options.port}`;
  const processes = await mainProcesses();
  const owner = await portOwner(options.port);
  const sameExecutable = (p: PinkProcess) =>
    resolve(p.ExecutablePath).toLowerCase() === options.pink.toLowerCase();
  let pid: number;
  let mode: "started" | "attached";
  if (owner !== undefined) {
    const process = processes.find((p) => p.ProcessId === owner && sameExecutable(p));
    if (!process) throw new Error("调试端口未由指定 PinK 主进程持有，请选择空闲端口");
    pid = owner;
    mode = "attached";
  } else {
    if (processes.some(sameExecutable)) {
      throw new Error(
        "指定 PinK 已运行但未开放所选调试端口。请保存并正常退出后重试；工具不会强制关闭实例。",
      );
    }
    if (processes.length) {
      throw new Error(
        "已有其他路径的 PinK 主进程运行。请使用该实例对应的打包版，或保存并正常退出后重试；工具不会启动另一个版本以免被现有实例接管。",
      );
    }
    // A QA run must open its requested project, independent of the last restored window.
    const child = spawn(
      options.pink,
      [options.project, `--remote-debugging-port=${options.port}`],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    await new Promise<void>((res, rej) => {
      child.once("spawn", res);
      child.once("error", rej);
    });
    if (!child.pid) throw new Error("启动 PinK 后未获得进程 ID");
    pid = child.pid;
    child.unref();
    mode = "started";
  }
  onLaunch({ pid, mode, endpoint });
  await waitFor(
    "PinK Chromium 调试端口",
    async () => {
      try {
        const response = await fetch(`${endpoint}/json/version`, {
          signal: AbortSignal.timeout(1500),
        });
        const version = (await response.json()) as {
          Browser?: string;
          webSocketDebuggerUrl?: string;
        };
        return response.ok && version.Browser && version.webSocketDebuggerUrl ? version : undefined;
      } catch {
        return undefined;
      }
    },
    60_000,
    signal,
  );
  if ((await portOwner(options.port)) !== pid)
    throw new Error("启动后调试端口归属发生变化，停止连接");
  await waitFor(
    "PinK 主窗口就绪",
    async () => {
      const script = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PinkBuildWindow {
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
$pinkProcess = Get-Process -Id ${pid} -ErrorAction Stop
if ($pinkProcess.MainWindowHandle -eq 0) { return }
$wasMinimized = [PinkBuildWindow]::IsIconic($pinkProcess.MainWindowHandle)
if ($wasMinimized) { [void][PinkBuildWindow]::ShowWindowAsync($pinkProcess.MainWindowHandle, 9) }
[void][PinkBuildWindow]::SetForegroundWindow($pinkProcess.MainWindowHandle)
@{ ready = $true; restored = $wasMinimized } | ConvertTo-Json -Compress
`;
      const { stdout } = await run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 15_000 },
      );
      if (!stdout.trim()) return undefined;
      const state = JSON.parse(stdout) as { ready: boolean; restored: boolean };
      if (state.restored) console.log("[window] 已恢复最小化的指定 PinK 窗口");
      return state.ready ? true : undefined;
    },
    60_000,
    signal,
  );
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000 });
  return { browser, endpoint, pid, mode };
}

export async function findWindow(
  browser: Browser,
  projectPath: string,
  signal: AbortSignal,
  executable: string,
): Promise<Page> {
  return waitFor(
    "指定工程的唯一工作台窗口",
    async () => {
      const candidates: Page[] = [];
      const mismatches: string[] = [];
      let pending = false;
      for (const context of browser.contexts())
        for (const page of context.pages()) {
          if (!page.url().includes("/workbench.html")) continue;
          const observed = await readWorkspaceObservation(page);
          if (!observed.available) {
            pending = true;
            continue;
          }
          try {
            await verifyWorkspaceObservation(observed, projectPath, executable);
            candidates.push(page);
          } catch (error) {
            mismatches.push(error instanceof Error ? error.message : String(error));
          }
        }
      if (candidates.length > 1)
        throw new Error("存在多个相同工程和程序路径的工作台，无法唯一选择");
      if (!candidates.length && !pending && mismatches.length)
        throw new Error(`没有匹配完整工程身份的窗口：${mismatches.join("；")}`);
      return candidates[0];
    },
    60_000,
    signal,
  );
}

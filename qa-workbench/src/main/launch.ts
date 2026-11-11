import { spawn } from "node:child_process";
import { isAbsolute, extname, dirname, resolve } from "node:path";
import { stat } from "node:fs/promises";
import { launchRequestSchema, type LaunchResult } from "../shared/launch.js";

export async function launchTarget(value: unknown): Promise<LaunchResult> {
  const request = launchRequestSchema.parse(value);
  if (
    !isAbsolute(request.executable) ||
    extname(request.executable).toLowerCase() !== ".exe"
  )
    throw new Error("请选择绝对路径下的 EXE 程序。");
  if (!(await stat(request.executable).catch(() => null))?.isFile())
    throw new Error("编辑器程序不存在，请重新选择位置。");
  const args: string[] = [];
  if (request.mode === "project-argument") {
    if (
      !isAbsolute(request.projectPath) ||
      !(await stat(request.projectPath).catch(() => null))?.isDirectory()
    )
      throw new Error("测试工程目录不存在，请重新选择。");
    args.push(resolve(request.projectPath));
  }
  // Execute the selected file directly. Paths are separate arguments, never shell code.
  const child = spawn(request.executable, args, {
    cwd: dirname(request.executable),
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const pid = child.pid;
  child.unref();
  return {
    simulated: false,
    pid,
    message:
      request.mode === "project-argument"
        ? "已发出启动请求，并传入工程目录。请在编辑器中核对打开结果。"
        : "已发出编辑器启动请求。请在编辑器中打开测试工程。",
  };
}

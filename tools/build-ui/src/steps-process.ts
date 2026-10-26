import { fork } from "node:child_process";

/** On Windows the UI worker has its own console group; a dead launcher is a stop request, not a killed recovery. */
export async function superviseSteps(file: string, args: string[]): Promise<number> {
  const child = fork(file, args, {
    env: { ...process.env, PINK_BUILD_STEPS_WORKER: "1" },
    detached: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout!.pipe(process.stdout, { end: false });
  child.stderr!.pipe(process.stderr, { end: false });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(
      "收到停止请求，正在等待执行器收集任务、恢复配置并生成报告；不会重复提交或取消构建。",
    );
    if (child.connected) child.send({ type: "pink-steps-stop" }, () => {});
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const message = (value: unknown) => {
    if (value && typeof value === "object" && "type" in value && value.type === "pink-steps-stop")
      stop();
  };
  process.on("message", message);
  process.on("disconnect", stop);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("message", message);
    process.removeListener("disconnect", stop);
  }
}

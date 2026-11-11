import { createServer } from "vite";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import electron from "electron";

const root = resolve(import.meta.dirname, "..");
const connectionFile = resolve(root, "../work/web-dev-service/connection.json");
async function connection() {
  try {
    const info = JSON.parse(await readFile(connectionFile, "utf8"));
    if (!Number.isInteger(info.port) || !/^[a-f0-9]{64}$/.test(info.token))
      return;
    const response = await fetch(`http://127.0.0.1:${info.port}/health`, {
      headers: { Authorization: "Bearer " + info.token },
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok && (await response.json()).ready) return info;
  } catch {
    /* No active service yet. */
  }
}
let child,
  server,
  info,
  stopping = false;
async function close(code = 0) {
  if (stopping) return;
  stopping = true;
  if (child && info && child.exitCode === null) {
    console.log("正在安全停止检查、恢复配置并保存结果…");
    try {
      const response = await fetch(`http://127.0.0.1:${info.port}/shutdown`, {
        method: "POST",
        headers: { Authorization: "Bearer " + info.token },
      });
      if (!response.ok) throw new Error("本机服务拒绝了停止请求");
    } catch (error) {
      console.error(
        "停止请求失败，保留运行进程；可再次按 Ctrl+C 重试。",
        error,
      );
      stopping = false;
      return;
    }
    if (child.exitCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
  }
  if (server) await server.close();
  process.exit(code);
}
try {
  info = await connection();
  if (!info) {
    child = spawn(electron, [root], {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
      // Separate the Windows process group so Ctrl+C can request safe cleanup.
      detached: process.platform === "win32",
      env: {
        ...process.env,
        QA_WEB_DEV_SERVICE: "1",
        QA_WEB_BRIDGE_INFO: connectionFile,
        QA_DATA_DIR:
          process.env.QA_DATA_DIR || resolve(root, "../work/web-dev-data"),
      },
    });
    child.on("error", (error) => {
      console.error(error);
      process.exitCode = 1;
    });
    for (let attempt = 0; attempt < 100 && !info; attempt++) {
      if (child.exitCode !== null) throw new Error("本机联调服务启动失败");
      await new Promise((resolve) => setTimeout(resolve, 200));
      info = await connection();
    }
    if (!info) throw new Error("本机联调服务未在启动时限内就绪");
    child.on("exit", () => {
      if (!stopping) void close(1);
    });
  }
  let existing;
  try {
    existing = await fetch("http://127.0.0.1:5187/__qa_dev__/status", {
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* Start the project's own dev server below. */
  }
  if (existing) {
    const status = await existing.json().catch(() => ({}));
    if (status.kind !== "qa-workbench-web-dev-status")
      throw new Error("5187 已被其他服务占用，请先检查正在运行的开发服务");
  } else {
    server = await createServer({ root });
    await server.listen();
  }
  console.log(
    "网页真实联调：http://127.0.0.1:5187/（配置检查 / 真实构建，先预览再执行）",
  );
  process.on("SIGINT", () => {
    void close();
  });
  process.on("SIGTERM", () => {
    void close();
  });
  // Keep a reused host/server session responsive to terminal shutdown.
  setInterval(() => {}, 60_000);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await close(1);
}

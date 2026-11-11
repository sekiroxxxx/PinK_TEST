import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWrite, json } from "../main/files.js";
import {
  canvasOrigins,
  canvasRpcAllowed,
  webOrigins,
} from "../shared/webDevelopment.js";
import { readBody, rpcSchema, send } from "./http.js";

export async function startWebHost(
  infoPath: string,
  invoke: (name: string, args: unknown[]) => Promise<unknown>,
  shutdown: () => Promise<void>,
) {
  const token = randomBytes(32).toString("hex");
  let closing = false;
  const server = createServer((req, res) => {
    void (async () => {
      const authorization = req.headers.authorization || "";
      const expected = "Bearer " + token;
      if (
        authorization.length !== expected.length ||
        !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
      )
        return send(res, 403, { ok: false, error: "无效本机开发凭据" });
      if (req.method === "GET" && req.url === "/health")
        return send(res, 200, { ready: !closing });
      if (req.method === "POST" && req.url === "/shutdown") {
        closing = true;
        send(res, 200, { ok: true });
        await shutdown();
        return;
      }
      if (
        closing ||
        req.method !== "POST" ||
        req.url !== "/rpc" ||
        ![...webOrigins, ...canvasOrigins].includes(req.headers.origin || "")
      )
        return send(res, 403, { ok: false, error: "无效本机开发来源" });
      const { method, args } = rpcSchema.parse(await readBody(req));
      if (
        canvasOrigins.includes(req.headers.origin || "") &&
        !canvasRpcAllowed(method, args)
      )
        return send(res, 403, {
          ok: false,
          error: "画布只开放编辑、校验和预览，不能启动或停止执行。",
        });
      send(res, 200, { ok: true, value: await invoke(method, args) });
    })().catch((error) => {
      if (!res.headersSent)
        send(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : "本机调用失败",
        });
    });
  });
  server.requestTimeout = 30_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("无法建立本机服务");
  const content = json({ port: address.port, token });
  await mkdir(dirname(infoPath), { recursive: true });
  await atomicWrite(infoPath, content);
  return async () => {
    server.close();
    // Never remove another development instance's connection file.
    if ((await readFile(infoPath, "utf8").catch(() => "")) === content)
      await unlink(infoPath);
  };
}

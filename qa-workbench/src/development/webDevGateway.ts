import type { Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connectionSchema, readBody, rpcSchema, send } from "./http.js";
import { webOrigins } from "../shared/webDevelopment.js";

export function webDevGateway(): Plugin {
  return {
    name: "qa-local-host-gateway",
    apply: "serve",
    configureServer(server) {
      const infoPath = resolve(
        server.config.root,
        "../work/web-dev-service/connection.json",
      );
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__qa_dev__/")) return next();
        void (async () => {
          const expectedOrigin = "http://" + req.headers.host;
          if (
            !webOrigins.includes(expectedOrigin) ||
            (req.headers.origin && req.headers.origin !== expectedOrigin) ||
            (req.headers["sec-fetch-site"] &&
              !["same-origin", "none"].includes(
                String(req.headers["sec-fetch-site"]),
              ))
          )
            return send(res, 403, { ok: false, error: "仅允许本机工作台调用" });
          const status =
            req.method === "GET" && req.url === "/__qa_dev__/status";
          if (
            !status &&
            (req.method !== "POST" ||
              req.url !== "/__qa_dev__/rpc" ||
              req.headers.origin !== expectedOrigin)
          )
            return send(res, 403, { ok: false, error: "无效调用来源" });
          const request = status
            ? undefined
            : rpcSchema.parse(await readBody(req));
          try {
            const connection = connectionSchema.parse(
              JSON.parse(await readFile(infoPath, "utf8")),
            );
            const response = await fetch(
              `http://127.0.0.1:${connection.port}/${status ? "health" : "rpc"}`,
              {
                method: status ? "GET" : "POST",
                headers: {
                  Authorization: "Bearer " + connection.token,
                  Origin: expectedOrigin,
                  "Content-Type": "application/json",
                },
                body: request ? JSON.stringify(request) : undefined,
                // Native file selection may stay open; health must fail fast.
                signal: status ? AbortSignal.timeout(1500) : undefined,
              },
            );
            const result = await response.json();
            if (status)
              send(res, 200, {
                kind: "qa-workbench-web-dev-status",
                connected: response.ok && result.ready === true,
              });
            else send(res, response.status, result);
          } catch {
            if (status)
              send(res, 200, {
                kind: "qa-workbench-web-dev-status",
                connected: false,
              });
            else
              send(res, 503, {
                ok: false,
                error:
                  "本机联调服务已断开。请运行 npm run dev:web:live，恢复后刷新页面；记录和草稿仍在浏览器中。",
              });
          }
        })().catch((error) => {
          if (!res.headersSent)
            send(res, 400, {
              ok: false,
              error: error instanceof Error ? error.message : "请求无效",
            });
        });
      });
    },
  };
}

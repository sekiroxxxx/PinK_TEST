import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { webHostMethods, webRequestLimit } from "../shared/webDevelopment.js";

export const connectionSchema = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/),
});
export const rpcSchema = z
  .object({
    method: z.enum(webHostMethods),
    args: z.array(z.unknown()).max(4),
  })
  .strict();
export function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}
export async function readBody(req: IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new Error("请求必须使用 JSON");
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > webRequestLimit) throw new Error("请求超过 32 MB 限制");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
}

import { ConfigurationOperationError } from "./configuration-context.js";

/** Preserve cause chains, never serialize arbitrary error properties or raw recovery records. */
export function configurationErrorDetail(error: unknown, sensitiveValues: string[] = []) {
  const redact = (text: string) => {
    for (const value of [...new Set(sensitiveValues)]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length))
      text = text.replaceAll(value, "[redacted]");
    return text
      .replace(
        /((?:password|secret|token|appkey)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
        "$1[redacted]",
      )
      .replace(/Bearer\s+[\w.+/=-]+/gi, "Bearer [redacted]");
  };
  const safe = (value: unknown): unknown => {
    if (typeof value === "string") return redact(value);
    if (Array.isArray(value)) return value.map(safe);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          /password|secret|token|value/i.test(k) ? "[redacted]" : safe(v),
        ]),
      );
    return value;
  };
  const chain: Array<{
    name: string;
    message: string;
    stack?: string;
    code?: string;
    diagnostic?: unknown;
    recovery?: unknown;
  }> = [];
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error) && chain.length < 6) {
    seen.add(error);
    chain.push({
      name: error.name,
      message: redact(error.message),
      stack: error.stack && redact(error.stack.split("\n").slice(0, 12).join("\n")),
      ...(error instanceof ConfigurationOperationError
        ? { code: error.code, diagnostic: safe(error.diagnostic), recovery: error.recovery }
        : {}),
    });
    error = error.cause;
  }
  return { capturedAt: new Date().toISOString(), chain };
}

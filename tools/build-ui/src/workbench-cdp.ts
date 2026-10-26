import { chromium, type ConnectOverCDPTransport } from "playwright-core";

/** Builder targets have their own Cdp clients. Nested webviews must not replace the workbench frame. */
export async function connectWorkbench(endpoint: string, timeout = 15_000) {
  const response = await fetch(`${endpoint}/json/version`, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error("读取工作台调试入口失败");
  const { webSocketDebuggerUrl } = (await response.json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("连接工作台调试入口超时"));
    }, timeout);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("连接工作台调试入口失败"));
      },
      { once: true },
    );
  });
  const transport: ConnectOverCDPTransport = {
    send(message) {
      const command = message as { method?: string; params?: { filter?: object[] } };
      if (command.method === "Target.setAutoAttach") {
        message = {
          ...message,
          params: {
            ...command.params,
            // Preserve CDP's default browser/tab exclusions when adding our iframe exclusion.
            filter: [
              { type: "iframe", exclude: true },
              ...(command.params?.filter ?? [
                { type: "browser", exclude: true },
                { type: "tab", exclude: true },
                {},
              ]),
            ],
          },
        };
      }
      socket.send(JSON.stringify(message));
    },
    close: () => socket.close(),
  };
  socket.addEventListener("message", (event) =>
    transport.onmessage?.(JSON.parse(String(event.data))),
  );
  socket.addEventListener("close", () => transport.onclose?.());
  socket.addEventListener("error", () => transport.onclose?.("工作台调试连接发生错误"));
  try {
    return await chromium.connectOverCDP(transport, { timeout });
  } catch (error) {
    socket.close();
    throw error;
  }
}

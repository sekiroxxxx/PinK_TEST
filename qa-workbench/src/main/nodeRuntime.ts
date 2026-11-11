import { spawn } from "node:child_process";

export async function verifyNodeRuntime(node: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(node, ["--version"], {
      shell: false,
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", (error) =>
      reject(new Error("无法启动指定的 Node.js：" + error.message)),
    );
    child.once("close", (code) =>
      code === 0 && Number(output.match(/^v(\d+)/)?.[1]) >= 24
        ? resolve()
        : reject(new Error("独立执行器需要 Node.js 24 或更新版本")),
    );
  });
}

import { rename, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { writeResultReport } from "./result-report.js";

export class CheckpointWriteError extends Error {
  readonly systemCode?: string;
  constructor(
    readonly phase: "write-json" | "replace-json" | "render-html",
    cause: unknown,
  ) {
    super(`检查点发布失败：${phase}；${cause instanceof Error ? cause.message : "未知原因"}`, {
      cause,
    });
    this.name = "CheckpointWriteError";
    this.systemCode = (cause as NodeJS.ErrnoException)?.code;
  }
}

async function replaceCheckpoint(temporary: string, file: string) {
  const deadline = Date.now() + 1000;
  for (;;) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      // Windows readers can briefly deny replacement, including ordinary Node readFile.
      // Retry only this rename; never truncate/remove the last valid result or repeat UI work.
      if (
        process.platform !== "win32" ||
        (error as NodeJS.ErrnoException).code !== "EPERM" ||
        Date.now() >= deadline
      )
        throw error;
      await delay(Math.min(10, deadline - Date.now()));
    }
  }
}

/** One run owns one publisher. drain includes error recording before a final snapshot is captured. */
export function createResultCheckpoint(
  file: string,
  onError: (error: CheckpointWriteError) => void,
) {
  let pending = Promise.resolve();
  return {
    publish(data: unknown, render = false): Promise<void> {
      const json = JSON.stringify(data, null, 2);
      const write = pending.then(async () => {
        let phase: CheckpointWriteError["phase"] = "write-json";
        try {
          await writeFile(file + ".tmp", json);
          phase = "replace-json";
          await replaceCheckpoint(file + ".tmp", file);
          if (render) {
            phase = "render-html";
            await writeResultReport(file);
          }
        } catch (error) {
          throw new CheckpointWriteError(phase, error);
        }
      });
      pending = write.catch(onError);
      return write;
    },
    drain: () => pending,
  };
}

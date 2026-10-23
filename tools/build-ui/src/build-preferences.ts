import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Four-group cases define their own targets; an unused project's missing cache is not a prerequisite. */
export async function readBuildPreferences(project: string, allowMissing: boolean) {
  const raw = await readFile(join(project, "temp/pink-builder/preferences.json"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (allowMissing && error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return (raw === undefined ? {} : JSON.parse(raw)) as Record<
    string,
    { nextStages?: unknown; buildStageGroup?: unknown }
  >;
}

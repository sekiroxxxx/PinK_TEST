import { z } from "zod";

export const projectSelectionSchema = z.object({
  name: z.string().min(1).max(300),
  folderName: z.string().min(1).max(300),
  path: z.string().max(50000),
  pathKind: z.enum(["absolute", "relative"]),
  recognizedBy: z.string().max(300),
  declaredVersion: z.string().max(300),
});
export type ProjectSelection = z.infer<typeof projectSelectionSchema>;

// Read data from two known root descriptors only. Never import project code.
export function recognizeProject(
  folderName: string,
  path: string,
  pathKind: ProjectSelection["pathKind"],
  descriptors: Record<string, string>,
): ProjectSelection {
  let name = folderName,
    recognizedBy = "目录名称",
    declaredVersion = "";
  for (const file of ["project.json", "package.json"]) {
    if (!descriptors[file]) continue;
    try {
      const data = JSON.parse(descriptors[file].replace(/^\uFEFF/, ""));
      const found = [data?.displayName, data?.name].find(
        (v) => typeof v === "string" && v.trim() && v.trim().length <= 300,
      );
      if (found) {
        name = found.trim();
        recognizedBy = file;
        declaredVersion =
          typeof data.version === "string" ? data.version.slice(0, 300) : "";
        break;
      }
    } catch {
      /* Unrecognized descriptors leave the selected directory usable. */
    }
  }
  return { name, folderName, path, pathKind, recognizedBy, declaredVersion };
}

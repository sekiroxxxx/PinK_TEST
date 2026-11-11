import { z } from "zod";

export const settingsInputSchema = z
  .object({
    outputDirectory: z.string().trim().min(1).max(32000),
    moduleRoot: z.string().trim().min(1).max(32000),
    nodePath: z.string().trim().max(32000),
  })
  .strict();
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type WorkbenchSettings = SettingsInput & {
  dataPath: string;
  defaultOutputDirectory: string;
  outputDirectories: string[];
};
export type SettingsDirectory = "output" | "module" | "data";

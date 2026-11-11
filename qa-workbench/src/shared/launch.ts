import { z } from "zod";
export const launchModeSchema = z.enum(["editor", "project-argument"]);
export const launchRequestSchema = z.object({
  executable: z.string().trim().min(1).max(5000),
  projectPath: z.string().max(5000),
  mode: launchModeSchema,
});
export type LaunchRequest = z.infer<typeof launchRequestSchema>;
export type LaunchResult = {
  simulated: boolean;
  pid?: number;
  message: string;
};

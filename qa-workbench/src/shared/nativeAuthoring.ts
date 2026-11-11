import { z } from "zod";

const document = z.record(z.string(), z.unknown());
const moduleId = z.string().min(1).max(100);
export const nativeAuthoringRequest = z.discriminatedUnion("action", [
  z.object({
    moduleId,
    action: z.literal("describe"),
  }),
  z.object({
    moduleId,
    action: z.literal("validate"),
    document,
  }),
  z.object({
    moduleId,
    action: z.literal("template"),
    input: document,
  }),
  z.object({
    moduleId,
    action: z.literal("describeComposition"),
  }),
  z.object({
    moduleId,
    action: z.literal("validateComposition"),
    definition: document,
    selection: z.unknown().optional(),
  }),
  z.object({
    moduleId,
    action: z.literal("listCaseReferences"),
    document,
  }),
  z.object({
    moduleId,
    action: z.literal("createComposition"),
    document,
    sourceId: z.string().min(1).max(300).optional(),
  }),
  z.object({
    moduleId,
    action: z.literal("compose"),
    definition: document,
    selection: z.unknown().optional(),
    options: document.optional(),
  }),
]);
export type NativeAuthoringRequest = z.infer<typeof nativeAuthoringRequest>;

export const nativeCaseReferencesSchema = z.object({
  documentSha256: z.string().min(1),
  items: z.array(
    z.object({
      caseId: z.string().min(1),
      platform: z.string().optional(),
      target: z.object({ kind: z.string() }).passthrough().optional(),
      title: z.string(),
      origin: z.object({
        kind: z.enum([
          "combination",
          "variant",
          "scenario",
          "form-sample",
          "steps-case",
        ]),
        sourcePath: z.array(
          z.union([z.string(), z.number().int().nonnegative()]),
        ),
        group: z.string().optional(),
        combinationId: z.string().optional(),
        scenarioId: z.string().optional(),
        familyId: z.string().optional(),
        sampleId: z.string().optional(),
      }),
    }),
  ),
});
export type NativeCaseReferences = z.infer<typeof nativeCaseReferencesSchema>;

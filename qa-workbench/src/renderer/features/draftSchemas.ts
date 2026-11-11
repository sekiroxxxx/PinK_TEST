import { z } from "zod";
import { stateSchema, statusSchema } from "../../shared/model";

const text = z.string().max(50000);
const step = stateSchema.shape.routes.element.shape.items.element;
export const routeDraft = z.object({
  name: text,
  version: text.optional(),
  items: z.array(step),
  quick: text,
  fromCatalog: z.boolean(),
  source: z
    .object({ name: text, revision: text, hash: text, moduleId: text })
    .optional(),
});
export const projectDraft = z.object({
  project: stateSchema.shape.projects.element.extend({ name: text }),
  environment: stateSchema.shape.environments.element.extend({ name: text }),
});
export const issueDraft = z.object({
  title: text,
  detail: text,
  markFailed: z.boolean(),
  attachments:
    stateSchema.shape.runs.element.shape.issues.element.shape.attachments,
});
export const issueReviewDraft =
  stateSchema.shape.runs.element.shape.issues.element.extend({ title: text });
export const itemReviewDraft = z.object({ status: statusSchema, note: text });
export const itemDraft = z.object({
  title: text,
  action: text,
  expected: text,
});
export const conclusionDraft = z.object({ conclusion: text });

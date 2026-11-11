import { z } from "zod";
import { detailSchema, mountSchema, contentSchema } from "./content.js";
import { projectSelectionSchema } from "./projectSelection.js";
import { memoSchema } from "./memo.js";
import { launchModeSchema } from "./launch.js";

const text = z.string().max(50000);
const id = z.string().min(1).max(300);
export const statusSchema = z.enum([
  "unchecked",
  "passed",
  "failed",
  "undecided",
  "blocked",
  "skipped",
]);
export type CheckStatus = z.infer<typeof statusSchema>;
export const statusNames: Record<CheckStatus, string> = {
  unchecked: "未检查",
  passed: "通过",
  failed: "失败",
  undecided: "待判断",
  blocked: "阻塞",
  skipped: "跳过",
};
const projectSchema = z.object({
  id,
  name: z.string().trim().min(1).max(300),
  description: text,
  location: projectSelectionSchema.optional(),
  lastOpenedAt: text.optional(),
  lastMountId: text.optional(),
});
const environmentSchema = z.object({
  id,
  projectId: id,
  name: z.string().trim().min(1).max(300),
  version: text,
  softwarePath: text,
  projectPath: text,
  materialsPath: text,
  notes: text,
  lastUsedAt: text.optional(),
  launchMode: launchModeSchema.optional(),
});
const stepSchema = z.object({
  id,
  title: z.string().trim().min(1).max(2000),
  action: text,
  expected: text,
  sourceId: text.optional(),
  group: text.optional(),
  details: detailSchema.optional(),
});
const attachmentSchema = z.object({ id, name: text, path: text });
const reviewSchema = z.object({
  id,
  at: text,
  status: statusSchema,
  note: text,
});
const runItemSchema = stepSchema.extend({
  status: statusSchema,
  reviews: z.array(reviewSchema),
  definitionHistory: z
    .array(z.object({ at: text, title: text, action: text, expected: text }))
    .optional(),
});
const issueSchema = z.object({
  id,
  itemId: text,
  title: z.string().trim().min(1).max(2000),
  detail: text,
  createdAt: text,
  state: z.enum(["open", "resolved", "follow-up"]),
  resolution: text,
  bugLink: text,
  attachments: z.array(attachmentSchema),
  history: z.array(
    z.object({
      at: text,
      state: z.enum(["open", "resolved", "follow-up"]),
      note: text,
      bugLink: text,
    }),
  ),
});
const runSchema = z.object({
  id,
  title: z.string().trim().min(1).max(2000),
  startedAt: text,
  finishedAt: text.optional(),
  conclusion: text,
  simulationSource: z
    .object({ runId: id, unitId: id, result: text })
    .optional(),
  project: projectSchema,
  environment: environmentSchema,
  source: z.object({ name: text, revision: text, hash: text, moduleId: text }),
  items: z.array(runItemSchema),
  issues: z.array(issueSchema),
});
export const simulationSchema = z.object({
  progressBasis: z.enum(["steps", "stages"]).optional(),
  id,
  title: text,
  startedAt: text,
  project: projectSchema,
  environment: environmentSchema,
  content: contentSchema,
  status: z.enum(["paused", "running", "done"]),
  units: z
    .array(
      z.object({
        id,
        group: text,
        title: text,
        stage: z.number().int().nonnegative(),
        status: z.enum(["queued", "running", "passed", "failed"]),
        evidence: text.default(""),
      }),
    )
    .min(1),
});
export type Simulation = z.infer<typeof simulationSchema>;
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  projects: z.array(projectSchema),
  environments: z.array(environmentSchema),
  selectedProjectId: text,
  selectedEnvironmentId: text,
  routes: z.array(
    z.object({
      id,
      name: z.string().trim().min(1).max(2000),
      items: z.array(stepSchema),
    }),
  ),
  runs: z.array(runSchema),
  memo: memoSchema,
  mounts: z.array(mountSchema).default([]),
  simulations: z.array(simulationSchema).default([]),
});
export const routeFileSchema = z.object({
  kind: z.literal("qa-personal-route"),
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(2000),
  items: z.array(stepSchema),
});
export type State = z.infer<typeof stateSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Run = z.infer<typeof runSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Route = State["routes"][number];

export function emptyState(): State {
  return {
    schemaVersion: 1,
    revision: 0,
    projects: [],
    environments: [],
    selectedProjectId: "",
    selectedEnvironmentId: "",
    routes: [],
    runs: [],
    memo: [],
    mounts: [],
    simulations: [],
  };
}

export function validateState(input: unknown): State {
  const state = stateSchema.parse(input);
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error("文件中存在重复 ID");
  };
  unique(state.projects.map((p) => p.id));
  unique(state.environments.map((e) => e.id));
  unique(state.runs.map((r) => r.id));
  unique(state.routes.map((r) => r.id));
  unique(state.mounts.map((m) => m.id));
  unique(state.simulations.map((s) => s.id));
  for (const simulation of state.simulations) {
    unique(simulation.units.map((u) => u.id));
    const definitions = simulation.content.groups.flatMap((g) => g.units);
    if (
      simulation.units.some(
        (u) =>
          !definitions.some((d) => d.id === u.id) ||
          !definitions.find((d) => d.id === u.id)?.steps.length ||
          u.stage > definitions.find((d) => d.id === u.id)!.stages.length,
      )
    )
      throw new Error("模拟执行单元与内容快照不一致");
  }
  if (
    state.environments.some(
      (e) => !state.projects.some((p) => p.id === e.projectId),
    )
  )
    throw new Error("环境关联的项目不存在");
  if (
    state.selectedProjectId &&
    !state.projects.some((p) => p.id === state.selectedProjectId)
  )
    throw new Error("所选项目不存在");
  if (
    state.selectedEnvironmentId &&
    !state.environments.some(
      (e) =>
        e.id === state.selectedEnvironmentId &&
        e.projectId === state.selectedProjectId,
    )
  )
    throw new Error("所选环境不属于当前项目");
  for (const route of state.routes) unique(route.items.map((i) => i.id));
  for (const run of state.runs) {
    unique(run.items.map((i) => i.id));
    unique(run.issues.map((i) => i.id));
    if (run.environment.projectId !== run.project.id)
      throw new Error("运行快照项目与环境不一致");
    if (
      run.issues.some(
        (i) => i.itemId && !run.items.some((s) => s.id === i.itemId),
      )
    )
      throw new Error("问题关联的检查项不存在");
  }
  return state;
}

export interface CatalogField {
  kind: "boolean" | "string" | "number" | "array" | "object";
  choices?: Array<string | number | boolean>;
  sensitive?: boolean;
}
export interface Combo {
  id: string;
  template: string;
  title: string;
  values: Record<string, unknown>;
  fieldCoverage?: Record<string, { state: "specified" | "retain" | "pending" }>;
  excludedFields?: string[];
  configurationOrder?: string[];
  notes?: string[];
  materials?: string[];
  variants?: Array<{
    title: string;
    values: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}
export interface CatalogDocument {
  schemaVersion: 1;
  revision: string;
  fieldTypes: Record<string, CatalogField>;
  templates: Array<{
    id: string;
    title: string;
    values: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  platforms: Array<{
    id: string;
    label: string;
    category?: string;
    combinations: Combo[];
    [key: string]: unknown;
  }>;
  conditionalScenarios: Array<{
    id: string;
    title: string;
    platforms: string[];
    representativePlatforms: string[];
    executionEndpoint: string;
    valuesByPlatform: Record<string, Record<string, unknown>>;
    fieldKeys?: string[];
    steps?: Array<{ action: string; expected: string }>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}
export interface CaseDetail {
  id: string;
  title: string;
  area: string;
  platform: string;
  type: string;
  prerequisites?: string;
  target?: string;
  notes?: string;
  steps: Array<{ action: string; expected: string }>;
}
export interface FieldCapability {
  key: string;
  kind: string;
  editable: boolean;
  sensitive?: boolean;
  choices?: Array<string | number | boolean>;
  allowedReferenceKinds?: string[];
  availability?: unknown;
  candidates?: unknown;
}
export interface Catalog {
  token: string;
  path: string;
  hash: string;
  contractVersion: string;
  document: CatalogDocument;
  normalized: CatalogDocument;
  details: CaseDetail[];
  fields: FieldCapability[];
  capabilitiesAvailable: boolean;
  detailsAvailable: boolean;
  detailsSource?: { path: string; hash: string; revision: string };
}
export interface ModuleDescriptor {
  id: string;
  name: string;
  interfaceVersion: 1;
  capabilities: {
    browse: boolean;
    edit: boolean;
    preview: boolean;
    start: boolean;
    observe: boolean;
    readResult: boolean;
  };
  reason: string;
}
export interface Bootstrap {
  state: State;
  dataPath: string;
  moduleRoot: string;
  modules: ModuleDescriptor[];
}

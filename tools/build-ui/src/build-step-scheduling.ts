import type { BuildStepCase } from "./build-steps-contract.js";

/** One policy shared by offline previews and execution. Platform preferences cannot overlap. */
export const buildStepScheduling = {
  maxTasksPerCase: 1,
  maxTasksPerGroup: 2,
  scheduling: "groups-of-two",
  submissionOrder: "sequential-configuration-and-submit",
  groupBarrier: "collect-and-cleanup-before-next-group",
  repeatedPlatform: "flush-before-next-case",
} as const;

export function buildStepGroups(cases: Pick<BuildStepCase, "caseId" | "platform">[]) {
  const groups: Array<{ number: number; caseIds: string[]; platforms: string[] }> = [];
  for (const c of cases) {
    let group = groups.at(-1);
    if (!group || group.caseIds.length === 2 || group.platforms.includes(c.platform)) {
      group = { number: groups.length + 1, caseIds: [], platforms: [] };
      groups.push(group);
    }
    group.caseIds.push(c.caseId);
    group.platforms.push(c.platform);
  }
  return groups;
}

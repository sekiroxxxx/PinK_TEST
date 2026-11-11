import type { TestContent, Mount } from "../../shared/content";
import type { Project, Environment, Step } from "../../shared/model";

export type EntryPage = "home" | "manual-entry" | "automation-entry";
export type RecordMode = "all" | "manual" | "automation";
export type CaseLocation = {
  mode: "manual" | "automation";
  mountId: string;
  nodeId?: string;
  resumeDraft?: boolean;
};
export type Page =
  | { kind: EntryPage }
  | { kind: "records"; sourceId: string; mode: RecordMode; back: Page }
  | { kind: "case-view" | "case-edit"; location: CaseLocation }
  | { kind: "manual-run"; id: string; back: Page; reviewing?: boolean }
  | { kind: "legacy-simulation"; id: string; back: Page }
  | { kind: "automation-run"; id: string; back: Page };

// Return destinations carry their own selection/filter context. They are UI
// state only and never alter saved runs or introduce a browser history entry.
export function returnLabel(page: Page): string {
  return {
    home: "返回工作台",
    "manual-entry": "返回自己测试",
    "automation-entry": "返回自动化入口",
    records: "返回测试记录",
    "case-view": "返回用例浏览",
    "case-edit": "返回用例编辑",
    "manual-run": "返回人工记录",
    "legacy-simulation": "返回自动化记录",
    "automation-run": "返回自动化记录",
  }[page.kind];
}
export type Preparation = {
  id: string;
  mode: "manual" | "automation";
  title: string;
  content: TestContent;
  candidates: string[];
  mount?: Mount;
  blank?: boolean;
  snapshot?: boolean;
  snapshotItems?: Step[];
  returnTo: Page;
  target?: { project: Project; environment: Environment };
};

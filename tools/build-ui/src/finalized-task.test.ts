import assert from "node:assert/strict";
import { test } from "node:test";
import { assertFinalizedTask, type FinalEvidence } from "./finalized-flow.js";
import type { Task } from "./common.js";

test("L10N task comparison accepts omitted unchecked Catalogs but detects changed selections", () => {
  const evidence: FinalEvidence = {
    revision: "regression",
    group: "publish",
    endpoint: "build",
    values: {
      "packages.localization-editor.targetLanguageMap": {
        en: { locale: "en", value: false },
        "zh-Hans": { locale: "zh-Hans", value: true },
      },
    },
    changed: [],
    preserved: ["packages.localization-editor.targetLanguageMap"],
    checkpoints: [],
    restoration: "not-required",
  };
  const task: Task = {
    id: "observed-shape",
    platform: "huawei-agc",
    state: "waiting",
    progress: 0,
    caseOptions: {
      "packages.localization-editor.targetLanguageMap": {
        "zh-Hans": { locale: "zh-Hans", value: true },
      },
    },
  };
  assert.doesNotThrow(() => assertFinalizedTask(task, evidence));
  task.caseOptions!["packages.localization-editor.targetLanguageMap"] = {};
  assert.throws(() => assertFinalizedTask(task, evidence), /targetLanguageMap/);
  task.caseOptions!["packages.localization-editor.targetLanguageMap"] = {
    "zh-Hans": { locale: "zh-Hans", value: true },
    en: { locale: "en", value: true },
  };
  assert.throws(() => assertFinalizedTask(task, evidence), /targetLanguageMap/);
  task.caseOptions!["packages.localization-editor.targetLanguageMap"] = {
    "zh-Hans": { locale: "zh-Hans", value: true },
    en: { locale: "en", value: "false" },
  };
  assert.throws(() => assertFinalizedTask(task, evidence), /条目格式/);
});

import type { BuildCase } from "./build-cases.js";
import type { BuildStep, BuildStepCase } from "./build-steps-contract.js";
import { configurationFamilies } from "./configuration-operations.js";
import { sensitiveConfigurationField } from "./configuration-steps-contract.js";

/** Compile the existing data contract into ordinary v2 operations, never a hidden form-run opcode. */
export function formToSteps(item: BuildCase): BuildStepCase {
  const e = item.finalized!.formValidation!.execution;
  const families = configurationFamilies([
    e.field,
    ...(e.prepare ?? []).map((a) => a.field),
    ...(e.setup ?? []).map((a) => a.field),
  ]);
  const fields = [
    ...new Set([
      e.field,
      ...(e.prepare ?? []).map((a) => a.field),
      ...(e.setup ?? []).map((a) => a.field),
      ...(e.unchanged ?? []),
      ...(e.after ?? []).map((a) => a.field),
      ...(e.child ? [e.child] : []),
      ...(e.field === "scenes" ? ["startScene"] : []),
    ]),
  ];
  let page = "open",
    index = 0;
  const steps: BuildStep[] = [
    { id: page, op: "config.open" },
    { id: "original", op: "record", page, fields },
  ];
  const id = (name: string) => `${name}-${++index}`;
  const require = (expected: Extract<BuildStep, { op: "config.require" }>["expected"]) =>
    steps.push({ id: id("require"), op: "config.require", page, expected });
  const set = (field: string, value: NonNullable<typeof e.value>, input?: string) => {
    if (sensitiveConfigurationField(field) && value === "")
      steps.push({ id: id("clear"), op: "input.clear-field", page, field });
    else
      steps.push({
        id: id("set"),
        op: "set",
        page,
        field,
        value,
        ...(input !== undefined ? { input } : {}),
      });
  };
  const readAssert = (field: string, value: NonNullable<typeof e.value>) => {
    if (sensitiveConfigurationField(field) && value === "")
      steps.push({ id: id("empty"), op: "assert", check: "empty", page, field });
    else {
      const snapshot = id("read");
      steps.push(
        { id: snapshot, op: "read", page, fields: [field] },
        { id: id("values"), op: "assert", check: "values", snapshot, values: { [field]: value } },
      );
    }
  };
  require({ buildEnabled: true });
  if (e.prepare?.length)
    require(
      e.prepare.some((a) => a.field === e.field && typeof a.value === "string" && a.value !== "")
        ? { cleanOrEmpty: [e.field] }
        : { noPrompt: [e.field] },
    );
  const signed = families.filter(
    (f) => f.parent.endsWith("useDebugKeystore") && f.enabled === false,
  );
  if (signed.length)
    require({
      emptyWhen: signed.map((f) => ({ field: f.parent, value: true, children: f.children })),
    });
  for (const a of [...(e.prepare ?? []), ...(e.setup ?? [])]) {
    require({ visible: [a.field] });
    set(a.field, a.value);
    readAssert(a.field, a.value);
  }
  if (e.requiresNonEmpty?.length) require({ nonEmpty: e.requiresNonEmpty });
  if (e.kind === "field-input") require({ noPrompt: [e.field] });
  if ((e.kind === "field-input" || e.kind === "parent-visibility") && e.input === undefined)
    require(
      sensitiveConfigurationField(e.field) && e.value === ""
        ? { nonEmpty: [e.field] }
        : { differs: { [e.field]: e.value! } },
    );
  const beforeFields = [
    ...new Set([e.field, ...(e.unchanged ?? []), ...(e.child ? [e.child] : [])]),
  ];
  require({ visible: beforeFields });
  steps.push({ id: "before", op: "read", page, fields: beforeFields });
  if (e.kind === "field-input" || e.kind === "parent-visibility") {
    set(e.field, e.value!, e.input);
    if (e.trigger === "reopen") {
      steps.push({ id: "closeForTrigger", op: "config.close", page });
      page = "reopened";
      steps.push({ id: page, op: "config.open" });
    }
    readAssert(e.field, e.value!);
    if (e.kind === "parent-visibility") {
      steps.push({
        id: id("hidden"),
        op: "assert",
        check: "hidden",
        page,
        field: e.child!,
        observed: "before",
      });
      if (e.prepare?.some((a) => a.field === e.field)) {
        set(e.field, !e.value);
        steps.push({
          id: id("childPreserved"),
          op: "assert",
          check: "unchanged",
          page,
          snapshot: "before",
          fields: [e.child!],
        });
        set(e.field, e.value!);
      }
    }
    if (e.alert)
      steps.push({
        id: id("prompt"),
        op: "assert",
        check: "prompt",
        field: e.field,
        expected: e.alert,
      });
  } else if (e.kind === "required-choice")
    steps.push({
      id: id("protectedChoice"),
      op: "assert",
      check: "protected-choice",
      page,
      field: e.field,
    });
  else if (e.kind === "scene-clear-all")
    steps.push({ id: id("clearScenes"), op: "input.clear-scenes", page });
  else steps.push({ id: id("cancelFile"), op: "input.cancel-file", page, field: e.field });
  if (e.unchanged?.length)
    steps.push({
      id: id("unchanged"),
      op: "assert",
      check: "unchanged",
      page,
      snapshot: "before",
      fields: e.unchanged,
    });
  for (const after of e.after ?? []) {
    readAssert(after.field, after.value);
    if (after.disabled !== undefined)
      steps.push({
        id: id("state"),
        op: "assert",
        check: "state",
        field: after.field,
        expected: { disabled: after.disabled },
      });
  }
  steps.push({ id: "button", op: "assert", check: "build-enabled", page, expected: true });
  return {
    caseId: item.caseId,
    platform: item.platform,
    steps,
    finally: [
      { id: "cleanup", op: "config.open" },
      {
        id: "restore",
        op: "restore",
        page: "cleanup",
        record: "original",
        ...(e.trigger === "reopen" ? { reopen: true } : {}),
      },
      { id: "close", op: "config.close", page: "cleanup" },
    ],
  };
}

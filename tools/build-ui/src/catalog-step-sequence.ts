import { caseContract } from "./case-contract.js";
import type { BuildCase } from "./build-cases.js";
import type { BuildStep, BuildStepCase } from "./build-steps-contract.js";
import type { CaseValue, FinalCase } from "./finalized-cases.js";
import { preparationFields } from "./configuration-step-values.js";

export function catalogRetainedFields(c: FinalCase) {
  return c.retained.filter(
    (field) => !(field === "wasmCompressionMode" && c.inputs?.nativeCodeBundleMode === "asmjs"),
  );
}

/** Expand existing ordered targets into visible, individually composable operations. */
export function catalogStepSequence(item: BuildCase): BuildStepCase {
  const c = item.finalized!,
    values = c.inputs ?? {},
    platform = item.platform;
  const retained = catalogRetainedFields(c);
  const prefix = `packages.${platform}.`,
    encrypted = prefix + "encrypted",
    zip = prefix + "compressZip";
  const globalText = prefix + "globalVariable",
    adapter = prefix + "globalAdapter";
  const hiddenText = values[adapter] === true && globalText in values;
  const hiddenZip = values[encrypted] === false && zip in values;
  const asmjs = values.nativeCodeBundleMode === "asmjs";
  const keys = Object.keys(values);
  const fields = new Set([
    ...keys,
    ...c.retained,
    ...keys.flatMap((key) => preparationFields(key, values[key]) ?? []),
    ...(keys.includes("startScene") || keys.includes("scenes") ? ["startScene", "scenes"] : []),
    ...(hiddenZip ? ["debug"] : []),
    ...(keys.includes("packages.google-play.customIcon")
      ? ["packages.google-play.customIconFile"]
      : []),
  ]);
  const steps: BuildStep[] = [
    { id: "open", op: "config.open" },
    { id: "ready", op: "config.ready", page: "open" },
  ];
  if (fields.size) steps.push({ id: "original", op: "record", page: "open", fields: [...fields] });
  if (retained.length) steps.push({ id: "retained", op: "retain", page: "open", fields: retained });
  let index = 0;
  const id = (name: string) => `${name}-${++index}`;
  const ready = () => steps.push({ id: id("ready"), op: "config.ready", page: "open" });
  const prepare = (field: string, value: CaseValue) =>
    steps.push({ id: id("prepare"), op: "config.prepare", page: "open", field, value });
  const set = (field: string, value: CaseValue) => {
    steps.push({ id: id("set"), op: "set", page: "open", field, value });
    ready();
  };
  const readAssert = (field: string, value: CaseValue) => {
    const ref = id("observe");
    steps.push(
      { id: ref, op: "read", page: "open", fields: [field] },
      { id: id("check"), op: "assert", check: "values", snapshot: ref, values: { [field]: value } },
    );
    return ref;
  };
  const hidden: string[] = [];
  const hiddenAssertions: Array<{ field: string; observed?: string }> = [];
  if (hiddenText) {
    set(adapter, false);
    set(globalText, values[globalText]);
    hiddenAssertions.push({
      field: globalText,
      observed: readAssert(globalText, values[globalText]),
    });
  }
  if (hiddenZip) {
    prepare(encrypted, true);
    set(encrypted, true);
    set(zip, values[zip]);
    hiddenAssertions.push({ field: zip, observed: readAssert(zip, values[zip]) });
  }
  const visibleValues = { ...values };
  let iconFile = false,
    expandedNetwork = false;
  for (const key of caseContract.orderedKeys(values, c.configurationOrder)) {
    if (
      (hiddenText && key === globalText) ||
      (hiddenZip && key === zip) ||
      (asmjs && key === "wasmCompressionMode")
    )
      continue;
    if (key === "packages.openpaas.appid") {
      steps.push({
        id: id("game"),
        op: "input.openpaas-game",
        page: "open",
        value: values[key],
        ...(c.scenario === "conditional.openpaas.game-switch" ? { requireChange: true } : {}),
      });
      ready();
      continue;
    }
    if (
      key === "packages.google-play.customIcon" &&
      !["default", "custom"].includes(String(values[key]))
    ) {
      steps.push({ id: id("icon"), op: "input.google-icon", page: "open", file: values[key] });
      visibleValues[key] = "custom";
      iconFile = true;
      ready();
      continue;
    }
    if (key.includes("networkTimeout.") && !expandedNetwork) {
      steps.push({
        id: id("expand"),
        op: "config.expand",
        page: "open",
        section: "network-timeout",
      });
      expandedNetwork = true;
    }
    if (preparationFields(key)) prepare(key, values[key]);
    set(key, values[key]);
  }
  if (asmjs) hiddenAssertions.push({ field: "wasmCompressionMode" });
  for (const entry of hiddenAssertions) {
    const ref = id("hidden");
    hidden.push(ref);
    steps.push({ id: ref, op: "assert", check: "hidden", page: "open", ...entry });
    delete visibleValues[entry.field];
  }
  if (retained.length)
    steps.push({
      id: "check-retained",
      op: "assert",
      check: "retained",
      page: "open",
      retained: "retained",
    });
  if (c.endpoint === "build" && platform === "huawei-agc")
    steps.push({ id: "agc", op: "assert", check: "agc-material", page: "open" });
  if (c.endpoint === "build" && platform === "openpaas")
    steps.push({ id: "game-ready", op: "assert", check: "openpaas-ready", page: "open" });
  const readFields = [
    ...new Set([
      ...Object.keys(visibleValues),
      ...keys
        .flatMap((key) => preparationFields(key, values[key]) ?? [])
        .filter(
          (key) => !hiddenAssertions.some((item) => item.field === key) && !retained.includes(key),
        ),
      ...(iconFile ? ["packages.google-play.customIconFile"] : []),
      ...(platform === "openpaas"
        ? ["packages.openpaas.appid", "packages.openpaas.versionName"]
        : []),
    ]),
  ];
  if (readFields.length) {
    steps.push({
      id: "final",
      op: "read",
      page: "open",
      fields: readFields,
      ...(c.endpoint === "build"
        ? {
            scope: "build" as const,
            ...(retained.length ? { retained: "retained" } : {}),
            ...(hidden.length ? { hidden } : {}),
          }
        : {}),
    });
    if (Object.keys(visibleValues).length)
      steps.push({
        id: "values",
        op: "assert",
        check: "values",
        snapshot: "final",
        values: visibleValues,
      });
  }
  if (c.endpoint === "build")
    steps.push(
      { id: "submit", op: "build.submit", page: "open", snapshot: "final" },
      { id: "wait", op: "build.wait", task: "submit" },
      {
        id: "success",
        op: "assert",
        check: "build-result",
        task: "submit",
        result: "wait",
        expected: { state: "success" },
      },
    );
  return {
    caseId: item.caseId,
    platform,
    steps,
    finally: [
      { id: "cleanup", op: "config.open" },
      ...(fields.size
        ? [{ id: "restore", op: "restore" as const, page: "cleanup", record: "original" }]
        : []),
      { id: "close", op: "config.close", page: "cleanup" },
    ],
  };
}

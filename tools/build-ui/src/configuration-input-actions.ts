import { ConfigurationOperationError } from "./configuration-context.js";
import { configurationEqual, type ConfigurationOperations } from "./configuration-operations.js";
import type { CaseValues, CaseValue } from "./finalized-cases.js";

export interface InitialChecks {
  buildEnabled?: boolean;
  nonEmpty?: string[];
  visible?: string[];
  noPrompt?: string[];
  cleanOrEmpty?: string[];
  differs?: CaseValues;
  emptyWhen?: Array<{ field: string; value: CaseValue; children: string[] }>;
}

/** Read-only initial-state requirements; a missing prerequisite is blocked, never repaired implicitly. */
export async function requireInitial(operations: ConfigurationOperations, expected: InitialChecks) {
  const require = (passed: boolean, reason: string) => {
    if (!passed) throw new ConfigurationOperationError("precondition", reason, "blocked");
  };
  if (expected.buildEnabled !== undefined)
    require((await operations.primaryBuildEnabled()) ===
      expected.buildEnabled, "初态构建按钮状态不满足要求；未修改配置");
  for (const field of expected.visible ?? [])
    require(!!(await operations.inspect(field)), `前提控件当前不可用：${field}`);
  for (const field of expected.nonEmpty ?? [])
    require(!!(await operations.read(field)).value, `缺合法非空初态：${field}`);
  for (const field of expected.noPrompt ?? [])
    require(!(await operations.alerts(field)).length, `初态字段已有错误：${field}`);
  for (const field of expected.cleanOrEmpty ?? [])
    require((await operations.read(field)).value === "" ||
      !(await operations.alerts(field)).length, `初态字段已有非空错误值：${field}`);
  for (const [field, value] of Object.entries(expected.differs ?? {}))
    require(!configurationEqual(
      (await operations.read(field)).value,
      value,
    ), `初态已等于测试目标，不能计本次修改覆盖：${field}`);
  for (const condition of expected.emptyWhen ?? [])
    if (configurationEqual((await operations.read(condition.field)).value, condition.value))
      for (const field of condition.children)
        require(!(await operations.inspect(field))
          ?.value, `初态存在应保留的子值，不自动清除：${field}`);
  return { satisfied: true };
}

export async function clearScenes(operations: ConfigurationOperations) {
  const before = await operations.read("scenes");
  const protectedChoices = before.choices?.filter((c) => c.checked && c.disabled) ?? [];
  if (protectedChoices.filter((c) => c.protectedReason === "initial-scene").length !== 1)
    throw new ConfigurationOperationError(
      "precondition",
      "受保护的初始场景不能唯一确认",
      "blocked",
    );
  await operations.clearAllScenes();
  operations.check(
    "scene-clear-preserves-initial",
    "scenes",
    configurationEqual(
      (await operations.read("scenes")).value,
      protectedChoices.map((c) => c.value),
    ),
  );
  return { protectedChoiceCount: protectedChoices.length, preserved: true };
}

export async function cancelFile(operations: ConfigurationOperations, field: string) {
  const before = await operations.read(field);
  await operations.cancelFileChoice(field);
  operations.check(
    "cancel-preserves-value",
    field,
    configurationEqual((await operations.read(field)).value, before.value),
  );
  return { field, preserved: true };
}

import type { RecordedAutomation } from "../../../shared/automation";
import { displayValue } from "../../features/structured/contract";
import { nativeValueRelations } from "./nativeStepRelations";
import {
  nativeFieldLabels,
  nativeOperationLabel,
} from "./nativeAuthoringAdapter";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
const objects = (value: unknown) =>
  Array.isArray(value) ? value.map(object) : [];
const outcomeLabels = new Map([
  ["passed", "通过"],
  ["failed", "失败"],
  ["skipped", "未执行"],
  ["stopped", "已停止"],
  ["blocked", "受阻"],
]);
const outcomeLabel = (outcome: unknown) =>
  outcomeLabels.get(String(outcome)) || "未提供结论";

export function NativeResultChecks({
  record,
  caseId,
}: {
  record: RecordedAutomation;
  caseId: string;
}) {
  const definition = record.definition;
  const plan = objects(definition?.cases).find(
    (item) => item.caseId === caseId,
  );
  const result = objects(record.result.cases).find(
    (item) => item.caseId === caseId,
  );
  const plannedSteps = objects(plan?.steps),
    actualSteps = objects(result?.steps);
  const platform = String(plan?.platform || result?.platform || "");
  const names = nativeFieldLabels(definition || {}, platform);
  const target = objects(definition?.targets).find(
    (target) => target.id === platform,
  );
  const targetLabel = String(target?.label || platform);
  const rows = nativeValueRelations(plannedSteps).map((link) => {
    const setting = plannedSteps[link.setting],
      assertion = plannedSteps[link.assertion];
    const read = actualSteps.find((step) => step.stepId === assertion.snapshot);
    const checked = actualSteps.find((step) => step.stepId === assertion.id);
    const conclusion = objects(checked?.output).find(
      (field) => field.field === link.field && field.phase === "readback",
    );
    const candidate = object(setting.candidate);
    return {
      id: `${setting.id}:${assertion.id}:${link.field}`,
      field: link.field,
      label: names[link.field] || link.field,
      setting:
        setting.op === "config.select"
          ? candidate.by === "label"
            ? `按名称：${String(candidate.label)}`
            : candidate.value
          : setting.value,
      expected: object(assertion.values)[link.field],
      actual: object(object(read?.output).fields)[link.field],
      status:
        conclusion?.passed === true
          ? "通过"
          : conclusion?.passed === false
            ? "失败"
            : "未提供字段结论",
    };
  });
  const assertions = plannedSteps.filter((step) => step.op === "assert");
  const probes = actualSteps.filter((step) =>
    ["platform.probe", "config.probe"].includes(String(step.operation)),
  );
  return (
    <details className="result-value-checks">
      <summary>
        {rows.length
          ? `配置核验 · ${rows.length} 项`
          : assertions.length
            ? `核验结果 · ${assertions.length} 项`
            : probes.length
              ? `探查结果 · ${probes.length} 项`
              : "配置核验"}
      </summary>
      {!!rows.length && (
        <>
          <p className="hint">
            设置与预期来自本轮已保存计划；实际值和结论来自执行侧原结果。
          </p>
          <div
            className="result-values-scroll"
            tabIndex={0}
            role="region"
            aria-label="配置核验明细"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">检查项</th>
                  <th scope="col">设置值</th>
                  <th scope="col">预期值</th>
                  <th scope="col">实际值</th>
                  <th scope="col">核验结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" title={row.field}>
                      {row.label}
                    </th>
                    {[row.setting, row.expected, row.actual].map(
                      (value, index) => (
                        <td key={index}>
                          {value === undefined ? "未提供" : displayValue(value)}
                        </td>
                      ),
                    )}
                    <td className={row.status === "失败" ? "error-text" : ""}>
                      {row.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {assertions
        .filter((assertion) => !rows.length || assertion.check !== "values")
        .map((assertion) => {
          const actual = actualSteps.find(
            (step) => step.stepId === assertion.id,
          );
          return (
            <div key={String(assertion.id)}>
              <strong>
                {nativeOperationLabel("assert", String(assertion.check))} ·{" "}
                {outcomeLabel(actual?.outcome)}
              </strong>
              <p>
                预期：
                {displayValue(assertion.expected ?? assertion.values ?? {})}
              </p>
              <details>
                <summary>执行侧原始核验结果</summary>
                <pre>
                  {JSON.stringify(
                    actual || { message: "未提供执行结果" },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          );
        })}
      {!!probes.length && (
        <div>
          <p className="hint">
            以下为本轮声明页面范围内的观察，是否符合预期以对应断言为准。
          </p>
          <ul>
            {probes.map((probe) => {
              const observed = object(probe.output);
              const planned = plannedSteps.find(
                (step) => step.id === probe.stepId,
              );
              const field = String(planned?.field || "");
              const presence =
                observed.presence === "present"
                  ? "已发现"
                  : observed.presence === "absent"
                    ? "未发现"
                    : observed.presence === "undetermined"
                      ? "未确定"
                      : "未提供观察结论";
              return (
                <li key={String(probe.stepId)}>
                  <strong>
                    {nativeOperationLabel(String(probe.operation))}
                    {(field || targetLabel) &&
                      ` · ${names[field] || field || targetLabel}`}
                  </strong>
                  <p>
                    观察结论：{presence} · 步骤执行：
                    {outcomeLabel(probe.outcome)}
                  </p>
                  <details>
                    <summary>观察范围与原始结果</summary>
                    <p>
                      范围就绪：
                      {observed.scopeReady === true
                        ? "是"
                        : observed.scopeReady === false
                          ? "否"
                          : "未提供"}
                      ；范围完整：
                      {observed.scopeComplete === true
                        ? "是"
                        : observed.scopeComplete === false
                          ? "否"
                          : "未提供"}
                      ；匹配数量：
                      {observed.matchCount === undefined ||
                      observed.matchCount === null
                        ? "未提供"
                        : displayValue(observed.matchCount)}
                    </p>
                    <pre>
                      {JSON.stringify(
                        {
                          declaredScope:
                            probe.operation === "platform.probe"
                              ? {
                                  category: target?.category,
                                  label: target?.label,
                                  homeScope: target?.homeScope,
                                }
                              : object(object(target?.fields)[field]).scope,
                          observation: probe,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!rows.length && !assertions.length && !probes.length && (
        <p className="hint">
          这份记录没有可关联的本轮计划与字段核验明细，仍可查看原始结果。不会使用当前用例补写历史值。
        </p>
      )}
    </details>
  );
}

import { InlineField } from "../structured/StructuredWorkspace";
import type { ExecutionAdjustment, ExecutionOptions } from "./modules";

export function ExecutionOverrides({
  items,
  options,
  values,
  change,
  disabled,
}: {
  items: { id: string; title: string }[];
  options: (id: string) => ExecutionOptions | undefined;
  values: Record<string, ExecutionAdjustment>;
  change: (id: string, value: ExecutionAdjustment) => void;
  disabled: boolean;
}) {
  const available = items
    .map((item) => ({ ...item, options: options(item.id) }))
    .filter((item) => item.options);
  if (!available.length) return null;
  return (
    <details className="execution-overrides">
      <summary>调整本轮参数与步骤</summary>
      <p className="hint">仅影响本轮计划，已保存用例保持不变。</p>
      <fieldset disabled={disabled}>
        {available.map((item) => {
          const settings = item.options!,
            value = values[item.id] || {};
          const fields = settings.fields.map((field) => ({
            ...field,
            value: Object.hasOwn(value.fields || {}, field.key)
              ? value.fields![field.key]
              : field.value,
            reset: Object.hasOwn(value.fields || {}, field.key),
            origin: Object.hasOwn(value.fields || {}, field.key)
              ? "本轮覆盖"
              : "已保存用例",
          }));
          return (
            <details
              key={item.id}
              className="execution-instance-options"
              open={available.length === 1}
            >
              <summary>{item.title}</summary>
              <p className="hint">{settings.note}</p>
              {fields.map((field) => (
                <InlineField
                  key={field.key}
                  field={field}
                  fields={fields}
                  change={(next) =>
                    change(item.id, {
                      ...value,
                      fields: { ...value.fields, [field.key]: next },
                    })
                  }
                  reset={() => {
                    const next = { ...value.fields };
                    delete next[field.key];
                    change(item.id, { ...value, fields: next });
                  }}
                />
              ))}
              {!!settings.steps?.length && (
                <div className="execution-step-selection">
                  <strong>本轮主步骤</strong>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() =>
                      change(item.id, { ...value, steps: undefined })
                    }
                  >
                    恢复完整主步骤
                  </button>
                  {settings.steps.map((step) => (
                    <label key={step.id}>
                      <input
                        type="checkbox"
                        checked={(
                          value.steps || settings.steps!.map((step) => step.id)
                        ).includes(step.id)}
                        onChange={(event) => {
                          const selected =
                            value.steps ||
                            settings.steps!.map((step) => step.id);
                          change(item.id, {
                            ...value,
                            steps: event.target.checked
                              ? (() => {
                                  const next = [...selected];
                                  const original = settings.steps!.findIndex(
                                    (item) => item.id === step.id,
                                  );
                                  const before = next.findIndex(
                                    (id) =>
                                      settings.steps!.findIndex(
                                        (item) => item.id === id,
                                      ) > original,
                                  );
                                  next.splice(
                                    before < 0 ? next.length : before,
                                    0,
                                    step.id,
                                  );
                                  return next;
                                })()
                              : selected.filter((id) => id !== step.id),
                          });
                        }}
                      />
                      <span>{step.title}</span>
                    </label>
                  ))}
                  {!!value.steps?.length && (
                    <ol
                      className="execution-step-order"
                      aria-label="本轮主步骤顺序"
                    >
                      {value.steps.map((id, index) => (
                        <li key={id}>
                          <span>
                            {
                              settings.steps!.find((step) => step.id === id)
                                ?.title
                            }
                          </span>
                          {[-1, 1].map((offset) => (
                            <button
                              key={offset}
                              className="text-button"
                              type="button"
                              disabled={
                                index + offset < 0 ||
                                index + offset >= value.steps!.length
                              }
                              aria-label={
                                (offset < 0 ? "上移 " : "下移 ") +
                                (settings.steps!.find((step) => step.id === id)
                                  ?.title || "步骤")
                              }
                              onClick={() => {
                                const next = [...value.steps!];
                                [next[index], next[index + offset]] = [
                                  next[index + offset],
                                  next[index],
                                ];
                                change(item.id, { ...value, steps: next });
                              }}
                            >
                              {offset < 0 ? "上移" : "下移"}
                            </button>
                          ))}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </details>
          );
        })}
      </fieldset>
    </details>
  );
}

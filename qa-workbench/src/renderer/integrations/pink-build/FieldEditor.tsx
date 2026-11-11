import { useState } from "react";
import { z } from "zod";
import { useDraft, DraftNotice } from "../../components/useDraft";
import type { Catalog, CatalogDocument, Combo } from "../../../shared/model";
import { Dialog } from "../../components/Dialog";
import { display, label } from "./labels";

export function FieldEditor({
  catalog,
  document,
  combo,
  fieldKey,
  apply,
  close,
}: {
  catalog: Catalog;
  document: CatalogDocument;
  combo: Combo;
  fieldKey: string;
  apply: (document: CatalogDocument) => Promise<boolean>;
  close: () => void;
}) {
  const definition = document.fieldTypes[fieldKey];
  const capability = catalog.fields.find((f) => f.key === fieldKey);
  const rawCombo = document.platforms
    .flatMap((p) => p.combinations)
    .find((c) => c.id === combo.id)!;
  const own = Object.hasOwn(rawCombo.values, fieldKey);
  const value = own ? rawCombo.values[fieldKey] : combo.values[fieldKey];
  const material =
    value && typeof value === "object" && "$material" in value
      ? String(value.$material)
      : "";
  const scene =
    value && typeof value === "object" && "$scene" in value
      ? String(value.$scene)
      : "";
  const draft = useDraft(
    "field:" + JSON.stringify([catalog.path, catalog.hash, combo.id, fieldKey]),
    {
      mode: !own
        ? "inherit"
        : material
          ? "material"
          : scene
            ? "scene"
            : definition?.sensitive
              ? "preserve"
              : "literal",
      input:
        material ||
        scene ||
        (definition?.sensitive
          ? ""
          : definition?.kind === "string"
            ? String(value ?? "")
            : JSON.stringify(value ?? null, null, 2)),
    },
    z.object({
      mode: z.enum(["inherit", "material", "scene", "preserve", "literal"]),
      input: z.string().max(50000),
    }),
  );
  const { mode, input } = draft.draft;
  const setMode = (mode: typeof draft.draft.mode) =>
    draft.setDraft((d) => ({ ...d, mode }));
  const setInput = (input: string) => draft.setDraft((d) => ({ ...d, input }));
  const [error, setError] = useState("");
  const coverage = rawCombo.fieldCoverage?.[fieldKey]?.state;
  const platformId =
    document.platforms.find((p) =>
      p.combinations.some((c) => c.id === combo.id),
    )?.id ?? "";
  const related = document.conditionalScenarios.filter(
    (s) =>
      s.platforms.includes(platformId) &&
      (s.fieldKeys?.includes(fieldKey) ||
        Object.hasOwn(s.valuesByPlatform[platformId] ?? {}, fieldKey)),
  );
  const editable =
    catalog.capabilitiesAvailable &&
    !!capability?.editable &&
    coverage !== "retain" &&
    coverage !== "pending" &&
    !rawCombo.excludedFields?.includes(fieldKey);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const next = structuredClone(document);
      const current = next.platforms
        .flatMap((p) => p.combinations)
        .find((c) => c.id === combo.id)!;
      if (mode === "inherit") delete current.values[fieldKey];
      else if (mode === "material")
        current.values[fieldKey] = { $material: input.trim() };
      else if (mode === "scene")
        current.values[fieldKey] =
          definition.kind === "array" ? [{ $scene: input }] : { $scene: input };
      else if (mode !== "preserve")
        current.values[fieldKey] =
          definition.kind === "string" ? input : JSON.parse(input);
      if (await apply(next)) {
        draft.clearDraft();
        close();
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <Dialog title={label(fieldKey)} onClose={close}>
      <DraftNotice
        {...draft}
        discard={() => {
          draft.clearDraft();
          close();
        }}
      />
      <p className="mono muted">{fieldKey}</p>
      <p>
        本轮目标：
        <strong>
          {display(combo.values[fieldKey], definition?.sensitive)}
        </strong>
      </p>
      <p className="hint">
        来源：{own ? "平台覆盖" : "公共模板"}。仅编辑用例目标，不修改 PinK
        现场。控件可用性仍需运行时确认。
      </p>
      {related.length > 0 && (
        <details>
          <summary>相关详细检查（原用例定义） {related.length} 项</summary>
          {related.map((s) => (
            <details key={s.id}>
              <summary>{s.title}</summary>
              <code>{s.id}</code>
              {s.steps?.map((step, index) => (
                <div className="case-step" key={index}>
                  <strong>
                    {index + 1}. {step.action}
                  </strong>
                  <p>预期：{step.expected}</p>
                </div>
              ))}
            </details>
          ))}
        </details>
      )}
      {editable ? (
        <form onSubmit={submit}>
          <label className="field">
            目标来源
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value as typeof mode;
                setMode(next);
                setInput(
                  next === "scene"
                    ? "primary"
                    : next === "literal"
                      ? definition.choices
                        ? definition.kind === "string"
                          ? String(definition.choices[0])
                          : JSON.stringify(definition.choices[0])
                        : definition.kind === "boolean"
                          ? "false"
                          : definition.kind === "number"
                            ? "0"
                            : definition.kind === "array"
                              ? "[]"
                              : definition.kind === "object"
                                ? "{}"
                                : ""
                      : next === "material"
                        ? material
                        : "",
                );
              }}
            >
              <option value="inherit">继承公共模板（删除平台覆盖）</option>
              {definition.sensitive ? (
                <option value="preserve">保留已有原值（隐藏）</option>
              ) : (
                <option value="literal">指定测试值</option>
              )}
              {capability.allowedReferenceKinds?.includes("material") && (
                <option value="material">引用私有材料</option>
              )}
              {capability.allowedReferenceKinds?.includes("scene") && (
                <option value="scene">自动场景角色</option>
              )}
            </select>
          </label>
          {mode === "material" && (
            <label className="field">
              材料引用名称
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="例如 androidSigning.password，不填写口令"
                required
              />
            </label>
          )}
          {mode === "scene" && (
            <label className="field">
              场景角色
              <select value={input} onChange={(e) => setInput(e.target.value)}>
                <option value="primary">primary</option>
                <option value="secondary">secondary</option>
              </select>
            </label>
          )}
          {mode === "literal" &&
            (definition.choices ? (
              <label className="field">
                测试值
                <select
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                >
                  {definition.choices.map((v) => (
                    <option
                      key={String(v)}
                      value={
                        definition.kind === "string"
                          ? String(v)
                          : JSON.stringify(v)
                      }
                    >
                      {String(v)}
                    </option>
                  ))}
                </select>
              </label>
            ) : definition.kind === "boolean" ? (
              <label className="field">
                开关
                <select
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                >
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </select>
              </label>
            ) : (
              <label className="field">
                {definition.kind === "array" || definition.kind === "object"
                  ? "测试值（JSON）"
                  : "测试值"}
                <textarea
                  aria-label="测试值"
                  rows={definition.kind === "string" ? 2 : 4}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
              </label>
            ))}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <footer className="dialog-actions">
            <button className="primary">校验并应用到草稿</button>
          </footer>
        </form>
      ) : (
        <p className="notice">
          此项当前只读：
          {coverage === "retain"
            ? "仅回读并保留现场值"
            : coverage === "pending"
              ? "合同待确认"
              : "执行器未声明可编辑能力"}
          。
        </p>
      )}
      <details>
        <summary>字段能力信息</summary>
        <pre>{JSON.stringify(capability ?? { state: "未提供" }, null, 2)}</pre>
      </details>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import type {
  Catalog,
  CatalogDocument,
  Combo,
  Step,
  Run,
} from "../../../shared/model";
import { Empty } from "../../components/Dialog";
import { RawCatalogDialog } from "./RawCatalogDialog";
import { FieldEditor } from "./FieldEditor";
import { display, label } from "./labels";

export function CatalogView({
  catalog,
  document,
  normalized,
  dirty,
  apply,
  save,
  load,
  manual,
}: {
  catalog: Catalog | null;
  document: CatalogDocument | null;
  normalized: CatalogDocument | null;
  dirty: boolean;
  apply: (doc: CatalogDocument) => Promise<boolean>;
  save: (as: boolean) => void;
  load: (pick: boolean) => void;
  manual: (steps: Step[], source?: Run["source"]) => void;
}) {
  const [category, setCategory] = useState<"platform" | "common">("platform");
  const [platformId, setPlatformId] = useState("web-desktop");
  const [comboId, setComboId] = useState("");
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [category, platformId, comboId]);
  const [query, setQuery] = useState("");
  const [field, setField] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const platform =
    normalized?.platforms.find((p) => p.id === platformId) ??
    normalized?.platforms[0];
  const combo = platform?.combinations.find((c) => c.id === comboId);
  const publicCases = catalog?.details.filter((c) => c.area === "common") ?? [];
  const groups = useMemo(
    () => Array.from(new Set(publicCases.map((c) => c.type || "其他检查"))),
    [catalog],
  );
  const matches = (value: unknown) =>
    JSON.stringify(value)
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase());
  const manualCombo = (c: Combo) =>
    manual(
      Object.entries(c.values)
        .filter(
          ([key]) =>
            !["retain", "pending"].includes(
              c.fieldCoverage?.[key]?.state ?? "",
            ),
        )
        .map(([key, value]) => ({
          id: crypto.randomUUID(),
          sourceId: c.id + ":" + key,
          title: label(key),
          action: `核对 ${key} 的配置。`,
          expected: display(value, document?.fieldTypes[key]?.sensitive),
        })),
      catalog
        ? {
            name: catalog.path,
            hash: catalog.hash,
            revision: catalog.document.revision,
            moduleId: "pink-build",
          }
        : undefined,
    );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">用例 / PinK 构建模块</p>
          <h1>用例清单</h1>
          <p>按平台看组合，按配置查看说明。展示内容来自现有用例文件。</p>
        </div>
        <div className="toolbar">
          <button onClick={() => load(false)}>加载默认</button>
          <button onClick={() => load(true)}>导入用例</button>
        </div>
      </div>
      {!catalog || !document || !normalized ? (
        <Empty title="尚未加载构建用例">
          <p>
            人工测试可独立使用。请先确认可信的 PinK-Test 链路目录，再加载用例。
          </p>
        </Empty>
      ) : (
        <>
          <div className="source-strip">
            <div>
              <strong>{document.revision}</strong>{" "}
              <span className="badge">
                {dirty ? "未保存草稿" : "已加载文件"}
              </span>
              <p title={catalog.path}>{catalog.path}</p>
            </div>
            <div className="toolbar">
              <button
                disabled={!catalog.capabilitiesAvailable}
                onClick={() => {
                  setRaw(JSON.stringify(document, null, 2));
                }}
              >
                编辑原文
              </button>
              <button
                disabled={!dirty || !catalog.capabilitiesAvailable}
                onClick={() => save(false)}
              >
                保存当前
              </button>
              <button
                className="primary"
                disabled={!catalog.capabilitiesAvailable}
                onClick={() => save(true)}
              >
                另存个人副本
              </button>
            </div>
          </div>
          {!catalog.capabilitiesAvailable && (
            <p className="notice">
              未找到字段能力合同，当前仅浏览。不会把 fieldTypes 当作操作注册表。
            </p>
          )}
          <div className="catalog-toolbar">
            <div className="segmented">
              <button
                className={category === "platform" ? "active" : ""}
                onClick={() => setCategory("platform")}
              >
                平台配置 <span>{normalized.platforms.length}</span>
              </button>
              <button
                className={category === "common" ? "active" : ""}
                onClick={() => setCategory("common")}
              >
                公共界面 <span>{publicCases.length}</span>
              </button>
            </div>
            <input
              className="search"
              type="search"
              aria-label="搜索用例与配置"
              placeholder="搜索名称、配置或用例说明"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {category === "platform" && (
            <>
              <div className="platform-bar">
                <label>
                  平台
                  <select
                    value={platform?.id ?? ""}
                    onChange={(e) => {
                      setPlatformId(e.target.value);
                      setComboId("");
                    }}
                  >
                    {normalized.platforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="muted">{platform?.category}</span>
                {combo && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setComboId("");
                      setQuery("");
                    }}
                  >
                    ← 全部组合
                  </button>
                )}
              </div>
              {!combo ? (
                <div className="combination-grid">
                  {platform?.combinations.filter(matches).map((c) => (
                    <button
                      className="combination-card"
                      key={c.id}
                      onClick={() => {
                        setComboId(c.id);
                        setQuery("");
                      }}
                    >
                      <span className="eyebrow">
                        {c.template === "conditional"
                          ? "条件场景目录"
                          : "平台组合"}
                      </span>
                      <h2>{c.title}</h2>
                      <p>
                        {Object.entries(c.values)
                          .slice(0, 4)
                          .map(
                            ([key, value]) =>
                              `${label(key)} ${display(value, document.fieldTypes[key]?.sensitive)}`,
                          )
                          .join(" · ") || "按前提选择适用的专项场景"}
                      </p>
                      <footer>
                        <span>{Object.keys(c.values).length} 个配置目标</span>
                        <span>查看配置 →</span>
                      </footer>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div className="section-heading">
                    <div>
                      <h2>{combo.title}</h2>
                      <small className="mono muted">{combo.id}</small>
                    </div>
                    <button
                      disabled={!Object.keys(combo.values).length}
                      onClick={() => manualCombo(combo)}
                    >
                      带这些目标自己测
                    </button>
                  </div>
                  {combo.notes?.length ? (
                    <details className="context-details">
                      <summary>组合前提与说明</summary>
                      <div className="inset">
                        {combo.notes.map((note, index) => (
                          <p key={index}>{note}</p>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {["公共配置", "平台专属配置"].map((group) => {
                    const entries = Object.entries(combo.values).filter(
                      ([key, value]) =>
                        (key.startsWith("packages.")
                          ? "平台专属配置"
                          : "公共配置") === group &&
                        matches({ key, label: label(key), value }),
                    );
                    return entries.length ? (
                      <details className="config-group" key={group} open>
                        <summary>
                          {group} <span>{entries.length} 项</span>
                        </summary>
                        <div>
                          {entries.map(([key, value]) => (
                            <button
                              className="config-row"
                              key={key}
                              onClick={() => setField(key)}
                            >
                              <span>
                                <strong>{label(key)}</strong>
                                {label(key) !== key && <small>{key}</small>}
                              </span>
                              <span className="config-value">
                                {display(
                                  value,
                                  document.fieldTypes[key]?.sensitive,
                                )}
                              </span>
                              <span className="badge">
                                {combo.fieldCoverage?.[key]?.state === "retain"
                                  ? "仅回读"
                                  : combo.fieldCoverage?.[key]?.state ===
                                      "pending"
                                    ? "待确认"
                                    : Object.hasOwn(
                                          document.platforms
                                            .flatMap((p) => p.combinations)
                                            .find((c) => c.id === combo.id)
                                            ?.values ?? {},
                                          key,
                                        )
                                      ? "平台覆盖"
                                      : "继承公共"}
                              </span>
                              <span aria-hidden="true">›</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null;
                  })}
                  {!!combo.excludedFields?.length && (
                    <details className="context-details">
                      <summary>
                        本平台不适用 {combo.excludedFields.length} 项
                      </summary>
                      <p>{combo.excludedFields.map(label).join("、")}</p>
                    </details>
                  )}
                  {!!combo.variants?.length && (
                    <details className="context-details">
                      <summary>组合变体 {combo.variants.length} 项</summary>
                      {combo.variants.map((variant, index) => (
                        <details className="inset" key={index}>
                          <summary>{variant.title}</summary>
                          {Object.entries(variant.values).map(
                            ([key, value]) => (
                              <p key={key}>
                                {label(key)}：
                                {display(
                                  value,
                                  document.fieldTypes[key]?.sensitive,
                                )}
                              </p>
                            ),
                          )}
                          <p className="hint">
                            此处展示定义；可执行实例由后续链路预览提供。
                          </p>
                        </details>
                      ))}
                    </details>
                  )}
                  {combo.template === "conditional" && (
                    <div>
                      {normalized.conditionalScenarios
                        .filter((s) => s.platforms.includes(platform!.id))
                        .filter(matches)
                        .map((s) => (
                          <details className="public-case" key={s.id}>
                            <summary>
                              {s.title}
                              <span className="badge">
                                {s.executionEndpoint === "ui"
                                  ? "界面检查"
                                  : "构建终点"}
                              </span>
                            </summary>
                            <div className="inset">
                              <code>{s.id}</code>
                              <p className="hint">
                                目录不是可执行 ID；本轮不启动自动化。
                              </p>
                              {Object.entries(
                                s.valuesByPlatform[platform!.id] ?? {},
                              ).map(([key, value]) => (
                                <p key={key}>
                                  {label(key)}：
                                  {display(
                                    value,
                                    document.fieldTypes[key]?.sensitive,
                                  )}
                                </p>
                              ))}
                            </div>
                          </details>
                        ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {category === "common" && (
            <>
              <p className="hint">
                来自原用例说明索引，当前只读；历史结果不代表本轮检查通过。
              </p>
              {!catalog.detailsAvailable && (
                <p className="notice">
                  未找到公共界面说明文件，未使用模拟数据替代。
                </p>
              )}
              {groups.map((group) => {
                const cases = publicCases.filter(
                  (c) => (c.type || "其他检查") === group && matches(c),
                );
                return cases.length ? (
                  <details
                    className="config-group"
                    key={group}
                    open={!!query || undefined}
                  >
                    <summary>
                      {group}
                      <span>{cases.length} 项</span>
                    </summary>
                    {cases.map((c) => (
                      <details
                        className="public-case"
                        key={c.id}
                        open={!!query || undefined}
                      >
                        <summary>
                          <span className="mono muted">{c.id}</span> {c.title}
                        </summary>
                        <div className="inset">
                          <p>{c.prerequisites}</p>
                          {c.steps?.map((step, i) => (
                            <div className="case-step" key={i}>
                              <strong>
                                {i + 1}. {step.action}
                              </strong>
                              <p>预期：{step.expected}</p>
                            </div>
                          ))}
                          {c.notes && <p className="hint">{c.notes}</p>}
                          <button
                            onClick={() =>
                              manual(
                                (c.steps ?? []).map((s, i) => ({
                                  id: crypto.randomUUID(),
                                  sourceId: c.id,
                                  title:
                                    c.title +
                                    (c.steps.length > 1 ? ` · ${i + 1}` : ""),
                                  action: s.action,
                                  expected: s.expected,
                                })),
                                catalog.detailsSource
                                  ? {
                                      ...catalog.detailsSource,
                                      name: catalog.detailsSource.path,
                                      moduleId: "pink-build",
                                    }
                                  : undefined,
                              )
                            }
                          >
                            带这条用例自己测
                          </button>
                        </div>
                      </details>
                    ))}
                  </details>
                ) : null;
              })}
            </>
          )}
          <p className="footnote">
            用例源 SHA-256：<code>{catalog.hash}</code> ·{" "}
            {catalog.contractVersion} · 尚未连接或执行
          </p>
          {field && combo && (
            <FieldEditor
              key={field + combo.id}
              catalog={catalog}
              document={document}
              combo={combo}
              fieldKey={field}
              apply={apply}
              close={() => setField("")}
            />
          )}
          {raw !== null && (
            <RawCatalogDialog
              initial={raw}
              draftKey={JSON.stringify([catalog.path, catalog.hash])}
              apply={apply}
              close={() => setRaw(null)}
            />
          )}
        </>
      )}
    </section>
  );
}

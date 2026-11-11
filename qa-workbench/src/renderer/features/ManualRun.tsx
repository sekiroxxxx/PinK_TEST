import { useId, useState } from "react";
import { Dialog, Empty } from "../components/Dialog";
import { ContentDetails } from "./ContentWorkspace";
import { useDraft, DraftNotice } from "../components/useDraft";
import { itemDraft } from "./draftSchemas";
import { ItemEditDialog } from "./ItemEditDialog";
import { ManualCheckFields } from "./ManualCheckFields";
import {
  statusNames,
  type CheckStatus,
  type Issue,
  type Run,
  type State,
} from "../../shared/model";
import {
  NewIssueDialog,
  IssueReviewDialog,
  ItemReviewDialog,
  FinishRunDialog,
} from "./ManualRunDialogs";

export function ManualRun({
  run,
  update,
  attach,
  openAttachment,
  exportRun,
  report,
  saveRoute,
  viewSource,
  goHome,
  back,
  backLabel,
  newRound,
  saveStatus,
  finished,
  reviewing,
  setReviewing,
}: {
  run: Run;
  goHome: () => void;
  back?: () => void;
  backLabel?: string;
  newRound?: () => void;
  finished: () => void;
  reviewing: boolean;
  setReviewing: (value: boolean) => void;
  saveStatus: "saving" | "saved" | "error";
  viewSource?: () => void;
  update: (run: Run) => Promise<boolean>;
  attach: (issueId: string) => Promise<void>;
  openAttachment: (issueId: string, attachmentId: string) => void;
  exportRun: () => void;
  report: (text: string) => void;
  saveRoute: (route: State["routes"][number]) => Promise<boolean>;
}) {
  const [add, setAdd] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [selected, setSelected] = useState(
    () =>
      run.items.find((i) => i.status === "unchecked")?.id ||
      run.items[0]?.id ||
      "",
  );
  const item = run.items.find((i) => i.id === selected) || run.items[0];
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [issueEdit, setIssueEdit] = useState<Issue | null>(null);
  const [end, setEnd] = useState(false);
  const readOnly = !!run.finishedAt && !reviewing;
  const [editItemId, setEditItemId] = useState<string | null>(null);
  const completed = run.items.filter((i) => i.status !== "unchecked").length;
  async function mark(itemId: string, status: CheckStatus, note = "") {
    const updated = {
      ...run,
      items: run.items.map((item) =>
        item.id !== itemId
          ? item
          : {
              ...item,
              status,
              reviews: [
                ...item.reviews,
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  status,
                  note,
                },
              ],
            },
      ),
    };
    return update(updated);
  }
  return (
    <section>
      <div className="run-navigation">
        <button className="text-button" onClick={back || goHome}>
          ← {backLabel || "返回工作台"}
        </button>
        <span
          className={saveStatus === "error" ? "error-text" : "run-save-status"}
          role="status"
          aria-live="polite"
        >
          {saveStatus === "saving"
            ? "正在保存进度…"
            : saveStatus === "error"
              ? "本次修改未保存"
              : run.finishedAt
                ? reviewing
                  ? "记录已保存"
                  : "本轮已结束"
                : "进度已保存"}
        </span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {run.finishedAt
              ? reviewing
                ? "人工复查"
                : "测试结果"
              : run.simulationSource || run.source.moduleId === "pink-build"
                ? "人工补查"
                : "人工测试"}{" "}
            · {completed}/{run.items.length} 项已反馈
          </p>
          <h1>{run.title}</h1>
          <p>
            {run.project.name} · {run.environment.version}
          </p>
        </div>
        <div className="toolbar">
          <button onClick={() => setShowIssues(true)}>
            本轮问题{run.issues.length ? " · " + run.issues.length : ""}
          </button>
          {!run.finishedAt && (
            <button onClick={() => setEnd(true)}>结束整理</button>
          )}
          {run.finishedAt && (
            <button
              className={readOnly ? "primary" : ""}
              onClick={() => setReviewing(!reviewing)}
            >
              {reviewing ? "返回结果" : "追加复查"}
            </button>
          )}
          <details className="more-menu">
            <summary>更多</summary>
            <div>
              {!readOnly && item && (
                <button onClick={() => setEditItemId(item.id)}>
                  编辑检查项
                </button>
              )}
              <button
                onClick={() => {
                  void saveRoute({
                    id: crypto.randomUUID(),
                    name: run.title,
                    items: run.items.map(
                      ({
                        status: _s,
                        reviews: _r,
                        definitionHistory: _h,
                        ...i
                      }) => i,
                    ),
                  }).then((ok) => {
                    if (ok) report("已保存为个人链路");
                  });
                }}
              >
                存为链路
              </button>
              <button onClick={exportRun}>导出结果</button>
              {newRound && (
                <button onClick={newRound}>沿用本轮用例开始新一轮</button>
              )}
            </div>
          </details>
        </div>
      </div>
      {run.finishedAt && (
        <section className="run-conclusion" aria-label="本轮结束结论">
          <div>
            <strong>结束时结论</strong>
            <time dateTime={run.finishedAt}>
              {new Date(run.finishedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </time>
          </div>
          <p>{run.conclusion || "未填写结论"}</p>
          {reviewing && (
            <small>复查追加保存，结束时的结论与时间保持不变。</small>
          )}
        </section>
      )}
      {run.simulationSource && (
        <div className="source-reference">
          来源：模拟自动化记录 · 原结果{" "}
          {run.simulationSource.result === "failed" ? "失败" : "通过"}{" "}
          <button className="text-button" onClick={viewSource}>
            查看原记录 →
          </button>
        </div>
      )}
      {run.source.moduleId === "pink-build" && (
        <div className="source-reference">
          来源：{run.source.name} · 原自动化结果保持不变{" "}
          <button className="text-button" onClick={viewSource}>
            查看原记录 →
          </button>
        </div>
      )}
      <details className="context-details">
        <summary>本轮对象与来源</summary>
        <div className="inset">
          <p>
            {run.environment.name} ·{" "}
            {run.environment.projectPath || "未填写工程路径"}
          </p>
          <p>{run.environment.softwarePath}</p>
          <p>
            来源：{run.source.name} · {run.source.revision}
          </p>
          {run.source.hash && <code>{run.source.hash}</code>}
        </div>
      </details>
      <div className="manual-workspace">
        <aside className="manual-outline" aria-label="测试链路">
          {run.items.map((i, index) => (
            <div key={i.id}>
              {i.group && i.group !== run.items[index - 1]?.group && (
                <h3>{i.group}</h3>
              )}
              <button
                className={i.id === item?.id ? "active" : ""}
                onClick={() => setSelected(i.id)}
              >
                <span className={"status " + i.status}>
                  {i.status === "passed"
                    ? "✓"
                    : i.status === "failed"
                      ? "×"
                      : i.status === "blocked"
                        ? "!"
                        : "○"}
                </span>
                <span>{i.title}</span>
              </button>
            </div>
          ))}
          {!run.finishedAt && (
            <button className="add-check" onClick={() => setAdd(true)}>
              ＋ 添加检查项
            </button>
          )}
        </aside>
        <article className="manual-detail">
          {item ? (
            <>
              <div className="detail-top">
                <small>
                  {item.group ||
                    `第 ${run.items.indexOf(item) + 1} 项 / ${run.items.length}`}
                </small>
                {readOnly ? (
                  <span className={"status " + item.status}>
                    {statusNames[item.status]}
                  </span>
                ) : (
                  <button
                    className={"text-button status " + item.status}
                    onClick={() => setReviewFor(item.id)}
                  >
                    {statusNames[item.status]} ⌄
                  </button>
                )}
              </div>
              <h2>{item.title}</h2>
              <div className="instruction">
                <span>操作</span>
                <p>{item.action || "尚未填写，可编辑补充。"}</p>
              </div>
              <div className="instruction">
                <span>预期</span>
                <p>{item.expected || "尚未填写，可编辑补充。"}</p>
              </div>
              {!!item.details?.length && (
                <details className="domain-disclosure">
                  <summary>配置与检查条件</summary>
                  <ContentDetails details={item.details} />
                </details>
              )}
              <div className="manual-actions">
                {!readOnly && (
                  <>
                    <button
                      className="primary"
                      onClick={() => {
                        void mark(item.id, "passed").then((ok) => {
                          if (ok && !run.finishedAt) {
                            const after =
                              run.items
                                .slice(run.items.indexOf(item) + 1)
                                .find((i) => i.status === "unchecked") ||
                              run.items.find(
                                (i) =>
                                  i.id !== item.id && i.status === "unchecked",
                              );
                            if (after) setSelected(after.id);
                          }
                        });
                      }}
                    >
                      {run.finishedAt ? "追加通过记录" : "✓ 通过并继续"}
                    </button>
                    <button onClick={() => setIssueFor(item.id)}>
                      记录问题
                    </button>
                  </>
                )}
                {readOnly && (
                  <button
                    className="text-button"
                    onClick={() => setReviewFor(item.id)}
                  >
                    查看反馈记录
                    {item.reviews.length ? " · " + item.reviews.length : ""}
                  </button>
                )}
              </div>
            </>
          ) : (
            <Empty
              title={run.finishedAt ? "本轮没有检查项" : "从第一个检查项开始"}
            >
              {!run.finishedAt && <p>可以边测边补充操作和预期。</p>}
            </Empty>
          )}
        </article>
      </div>
      {add && (
        <AddCheck
          run={run}
          close={() => setAdd(false)}
          save={async (values) => {
            const id = crypto.randomUUID();
            if (
              await update({
                ...run,
                items: [
                  ...run.items,
                  {
                    ...values,
                    id,
                    group: item?.group,
                    status: "unchecked",
                    reviews: [],
                  },
                ],
              })
            ) {
              setSelected(id);
              return true;
            }
            return false;
          }}
        />
      )}
      {showIssues && !issueEdit && issueFor === null && (
        <Dialog title="本轮问题" wide onClose={() => setShowIssues(false)}>
          <div className="toolbar">
            {readOnly ? (
              <button onClick={() => setReviewing(true)}>追加复查</button>
            ) : (
              <button onClick={() => setIssueFor("")}>＋ 记录本轮问题</button>
            )}
          </div>
          {!run.issues.length && <p className="empty">尚未记录问题。</p>}
          {run.issues.map((issue) => (
            <article className="issue-row" key={issue.id}>
              <div>
                <button
                  className="text-button"
                  onClick={() => setIssueEdit(structuredClone(issue))}
                >
                  {issue.title}
                </button>
                <p>
                  {issue.detail} ·{" "}
                  {issue.state === "resolved"
                    ? "已解决"
                    : issue.state === "follow-up"
                      ? "待跟进"
                      : "待复查"}
                </p>
                {issue.resolution && <p>复查：{issue.resolution}</p>}
                {issue.bugLink && <p className="mono">禅道：{issue.bugLink}</p>}
                <div className="attachments">
                  {issue.attachments.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => openAttachment(issue.id, a.id)}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
              {!readOnly && (
                <button onClick={() => void attach(issue.id)}>补充证据</button>
              )}
            </article>
          ))}
        </Dialog>
      )}
      {editItemId && (
        <ItemEditDialog
          run={run}
          itemId={editItemId}
          update={update}
          close={() => setEditItemId(null)}
        />
      )}
      {issueFor !== null && (
        <NewIssueDialog
          run={run}
          update={update}
          itemId={issueFor}
          close={() => setIssueFor(null)}
        />
      )}
      {issueEdit && (
        <IssueReviewDialog
          run={run}
          update={update}
          issue={issueEdit}
          readOnly={readOnly}
          close={() => setIssueEdit(null)}
        />
      )}
      {reviewFor && (
        <ItemReviewDialog
          run={run}
          reviewFor={reviewFor}
          mark={mark}
          readOnly={readOnly}
          close={() => setReviewFor(null)}
        />
      )}
      {end && (
        <FinishRunDialog
          run={run}
          update={update}
          close={() => setEnd(false)}
          finished={() => {
            setEnd(false);
            finished();
          }}
        />
      )}
    </section>
  );
}

function AddCheck({
  run,
  save,
  close,
}: {
  run: Run;
  save: (value: {
    title: string;
    action: string;
    expected: string;
  }) => Promise<boolean>;
  close: () => void;
}) {
  const formId = useId();
  const draft = useDraft(
    "new-check:" + run.id,
    { title: "", action: "", expected: "" },
    itemDraft,
  );
  return (
    <Dialog
      title="添加检查项"
      onClose={close}
      footer={
        <>
          <button onClick={close}>关闭</button>
          <button className="primary" type="submit" form={formId}>
            添加
          </button>
        </>
      }
    >
      {(draft.hasDraft || draft.storageError) && (
        <DraftNotice
          {...draft}
          discard={() => {
            draft.clearDraft();
            close();
          }}
        />
      )}
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.draft.title.trim()) return;
          void save(draft.draft).then((ok) => {
            if (ok) {
              draft.clearDraft();
              close();
            }
          });
        }}
      >
        <ManualCheckFields
          value={draft.draft}
          change={(field, value) =>
            draft.setDraft({ ...draft.draft, [field]: value })
          }
        />
      </form>
    </Dialog>
  );
}

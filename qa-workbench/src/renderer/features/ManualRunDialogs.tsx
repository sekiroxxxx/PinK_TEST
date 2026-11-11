import { useId, useState } from "react";
import {
  statusNames,
  type CheckStatus,
  type Issue,
  type Run,
  type Attachment,
} from "../../shared/model";
import { Dialog } from "../components/Dialog";
import { useDraft, DraftNotice } from "../components/useDraft";
import {
  issueDraft,
  issueReviewDraft,
  itemReviewDraft,
  conclusionDraft,
  itemDraft,
} from "./draftSchemas";
type Update = (run: Run) => Promise<boolean>;

export function NewIssueDialog({
  run,
  update,
  itemId,
  close,
}: {
  run: Run;
  update: Update;
  itemId: string;
  close: () => void;
}) {
  const formId = useId();
  const draft = useDraft(
    "new-issue:" + run.id + ":" + (itemId || "whole-run"),
    {
      title: "",
      detail: "",
      markFailed: false,
      attachments: [] as Attachment[],
    },
    issueDraft,
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const associated = run.items.some((item) => item.id === itemId);
  async function attach() {
    setPicking(true);
    setError("");
    try {
      const attachment = await window.qa.pickEvidence();
      if (attachment)
        draft.setDraft((d) => ({
          ...d,
          attachments: [...d.attachments, attachment],
        }));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPicking(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.draft.title.trim();
    if (!title || picking) return;
    const issue: Issue = {
      id: crypto.randomUUID(),
      itemId,
      title,
      detail: draft.draft.detail,
      createdAt: new Date().toISOString(),
      state: "open",
      resolution: "",
      bugLink: "",
      attachments: draft.draft.attachments,
      history: [],
    };
    const markFailed = associated && draft.draft.markFailed;
    const next: Run = {
      ...run,
      issues: [...run.issues, issue],
      items: run.items.map((item) =>
        item.id === itemId && markFailed
          ? {
              ...item,
              status: "failed",
              reviews: [
                ...item.reviews,
                {
                  id: crypto.randomUUID(),
                  at: new Date().toISOString(),
                  status: "failed",
                  note: "记录问题：" + title,
                },
              ],
            }
          : item,
      ),
    };
    if (await update(next)) {
      draft.clearDraft();
      close();
    }
  }
  return (
    <Dialog
      title="顺手记录问题"
      onClose={close}
      footer={
        <>
          <button type="button" onClick={close}>
            关闭
          </button>
          <button
            className="primary"
            disabled={picking}
            type="submit"
            form={formId}
          >
            {associated && draft.draft.markFailed
              ? "保存并标记失败"
              : "保存问题"}
          </button>
        </>
      }
    >
      <DraftNotice
        {...draft}
        discard={() => {
          draft.clearDraft();
          close();
        }}
      />
      <form id={formId} onSubmit={submit}>
        <label className="field">
          问题现象
          <input
            required
            autoFocus
            value={draft.draft.title}
            onChange={(e) =>
              draft.setDraft((d) => ({ ...d, title: e.target.value }))
            }
            placeholder="一句话记下遇到的问题"
          />
        </label>
        <label className="field">
          复现操作 / 补充说明
          <textarea
            rows={4}
            value={draft.draft.detail}
            onChange={(e) =>
              draft.setDraft((d) => ({ ...d, detail: e.target.value }))
            }
          />
        </label>
        <div className="section-heading">
          <h3>
            证据 <span className="muted">{draft.draft.attachments.length}</span>
          </h3>
          <button
            type="button"
            disabled={picking}
            onClick={() => {
              void attach();
            }}
          >
            {picking ? "正在复制…" : "＋ 添加证据"}
          </button>
        </div>
        <ul className="draft-attachments">
          {draft.draft.attachments.map((a) => (
            <li key={a.id}>
              <span>▧ {a.name}</span>
              <button
                type="button"
                className="quiet"
                aria-label={"移除证据：" + a.name}
                onClick={() =>
                  draft.setDraft((d) => ({
                    ...d,
                    attachments: d.attachments.filter(
                      (item) => item.id !== a.id,
                    ),
                  }))
                }
              >
                移除
              </button>
            </li>
          ))}
        </ul>
        <p className="hint">证据随草稿保留，保存后关联问题。</p>
        {associated && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.draft.markFailed}
              onChange={(e) =>
                draft.setDraft((d) => ({ ...d, markFailed: e.target.checked }))
              }
            />
            同时标记此检查项为失败
          </label>
        )}
        <p className="hint">
          {associated
            ? "不勾选则只记录问题，检查项结果保持原状。"
            : "本轮问题未关联具体检查项，不改变任何检查结果。"}
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

export function IssueReviewDialog({
  run,
  update,
  issue,
  close,
  readOnly = false,
}: {
  run: Run;
  update: Update;
  issue: Issue;
  close: () => void;
  readOnly?: boolean;
}) {
  const draft = useDraft(
    "issue-review:" + run.id + ":" + issue.id,
    issue,
    issueReviewDraft,
  );
  const issueEdit = readOnly ? issue : draft.draft;
  const setIssueEdit = draft.setDraft;
  const associatedItem = run.items.find((item) => item.id === issue.itemId);
  async function saveReview() {
    const ok = await update({
      ...run,
      issues: run.issues.map((i) =>
        i.id === issueEdit.id
          ? {
              ...issueEdit,
              history: [
                ...i.history,
                {
                  at: new Date().toISOString(),
                  state: issueEdit.state,
                  note: issueEdit.resolution,
                  bugLink: issueEdit.bugLink,
                },
              ],
            }
          : i,
      ),
    });
    if (ok) {
      draft.clearDraft();
      close();
    }
  }
  return (
    <Dialog
      title={readOnly ? "问题记录与 Bug 交接" : "问题复查与 Bug 交接"}
      onClose={close}
      footer={
        !readOnly && (
          <>
            <button onClick={close}>关闭</button>
            <button
              disabled={!issueEdit.title.trim()}
              className="primary"
              onClick={() => void saveReview()}
            >
              保存复查
            </button>
          </>
        )
      }
    >
      <section
        className="issue-check-context"
        aria-label="关联检查项与当前结果"
      >
        {associatedItem ? (
          <>
            <dl>
              <div>
                <dt>关联检查项</dt>
                <dd>{associatedItem.title}</dd>
              </div>
              <div>
                <dt>当前结果</dt>
                <dd className={"status " + associatedItem.status}>
                  {statusNames[associatedItem.status]}
                </dd>
              </div>
            </dl>
            <p className="hint">
              问题处理状态与检查结果分别保存，修改问题不会自动修改检查结果。
            </p>
          </>
        ) : (
          <p className="hint">
            {issue.itemId
              ? "关联检查项已不在本轮清单中。"
              : "本轮问题，未关联具体检查项。"}
            修改问题不会改变检查结果。
          </p>
        )}
      </section>
      {readOnly ? (
        <section>
          <h3>{issue.title}</h3>
          <p>{issue.detail}</p>
          <p>
            处理状态：
            {
              { open: "待复查", "follow-up": "待跟进", resolved: "已解决" }[
                issue.state
              ]
            }
          </p>
          {issue.resolution && <p>复查说明：{issue.resolution}</p>}
          {issue.bugLink && <p className="mono">禅道：{issue.bugLink}</p>}
        </section>
      ) : (
        <>
          <DraftNotice
            {...draft}
            discard={() => {
              draft.clearDraft();
              close();
            }}
          />
          <label className="field">
            现象
            <input
              value={issueEdit.title}
              onChange={(e) =>
                setIssueEdit({ ...issueEdit, title: e.target.value })
              }
            />
          </label>
          <label className="field">
            记录
            <textarea
              value={issueEdit.detail}
              onChange={(e) =>
                setIssueEdit({ ...issueEdit, detail: e.target.value })
              }
            />
          </label>
          <label className="field">
            处理状态
            <select
              value={issueEdit.state}
              onChange={(e) =>
                setIssueEdit({
                  ...issueEdit,
                  state: e.target.value as Issue["state"],
                })
              }
            >
              <option value="open">待复查</option>
              <option value="follow-up">待跟进</option>
              <option value="resolved">已解决</option>
            </select>
          </label>
          <label className="field">
            本次复查说明
            <textarea
              value={issueEdit.resolution}
              onChange={(e) =>
                setIssueEdit({ ...issueEdit, resolution: e.target.value })
              }
            />
          </label>
          <label className="field">
            禅道 Bug 链接（人工上报后粘贴）
            <input
              value={issueEdit.bugLink}
              onChange={(e) =>
                setIssueEdit({ ...issueEdit, bugLink: e.target.value })
              }
            />
          </label>
        </>
      )}
      <details>
        <summary>历次问题复查 {issueEdit.history.length} 条</summary>
        {issueEdit.history.map((entry, index) => (
          <p key={index}>
            {new Date(entry.at).toLocaleString()} · {entry.state} · {entry.note}{" "}
            {entry.bugLink}
          </p>
        ))}
      </details>
    </Dialog>
  );
}

export function ItemReviewDialog({
  run,
  reviewFor,
  mark,
  close,
  readOnly = false,
}: {
  run: Run;
  reviewFor: string;
  mark: (id: string, status: CheckStatus, note?: string) => Promise<boolean>;
  close: () => void;
  readOnly?: boolean;
}) {
  const formId = useId();
  const draft = useDraft(
    "item-review:" + run.id + ":" + reviewFor,
    {
      status: run.items.find((i) => i.id === reviewFor)?.status ?? "unchecked",
      note: "",
    },
    itemReviewDraft,
  );
  return (
    <Dialog
      title={readOnly ? "检查结果记录" : "修改检查结果"}
      onClose={close}
      footer={
        !readOnly && (
          <>
            <button onClick={close}>关闭</button>
            <button className="primary" type="submit" form={formId}>
              保存检查结果
            </button>
          </>
        )
      }
    >
      {!readOnly && (
        <DraftNotice
          {...draft}
          discard={() => {
            draft.clearDraft();
            close();
          }}
        />
      )}
      <div className="timeline">
        {run.items
          .find((i) => i.id === reviewFor)
          ?.reviews.map((r) => (
            <article key={r.id}>
              <span className={"status " + r.status}>
                {statusNames[r.status]}
              </span>
              <small>{new Date(r.at).toLocaleString()}</small>
              <p>{r.note || "仅反馈结果"}</p>
            </article>
          ))}
      </div>
      {!readOnly && (
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void mark(
              reviewFor,
              String(form.get("status")) as CheckStatus,
              String(form.get("note") || ""),
            ).then((ok) => {
              if (ok) {
                draft.clearDraft();
                close();
              }
            });
          }}
        >
          <label className="field">
            检查结果
            <select
              name="status"
              value={draft.draft.status}
              onChange={(e) =>
                draft.setDraft((d) => ({
                  ...d,
                  status: e.target.value as CheckStatus,
                }))
              }
            >
              {Object.entries(statusNames).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            修改说明（选填）
            <textarea
              name="note"
              rows={3}
              value={draft.draft.note}
              onChange={(e) =>
                draft.setDraft((d) => ({ ...d, note: e.target.value }))
              }
            />
          </label>
        </form>
      )}
    </Dialog>
  );
}

export function FinishRunDialog({
  run,
  update,
  close,
  finished,
}: {
  run: Run;
  update: Update;
  close: () => void;
  finished: () => void;
}) {
  const formId = useId();
  const draft = useDraft(
    "finish:" + run.id,
    { conclusion: "" },
    conclusionDraft,
  );
  return (
    <Dialog
      title="结束并整理本次测试"
      onClose={close}
      footer={
        <>
          <button type="button" onClick={close}>
            继续测试
          </button>
          <button className="primary" type="submit" form={formId}>
            保存并结束
          </button>
        </>
      }
    >
      <DraftNotice
        {...draft}
        discard={() => {
          draft.clearDraft();
          close();
        }}
      />
      <p>
        共 {run.items.length} 项，未检查{" "}
        {run.items.filter((i) => i.status === "unchecked").length} 项，失败{" "}
        {run.items.filter((i) => i.status === "failed").length} 项；待处理问题{" "}
        {run.issues.filter((i) => i.state !== "resolved").length} 个。
      </p>
      <p className="hint">
        结束不等于通过。未检查、待判断和阻塞项按原状态保留。
      </p>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          const text = String(
            new FormData(e.currentTarget).get("conclusion") || "",
          ).trim();
          if (!text) return;
          void update({
            ...run,
            finishedAt: new Date().toISOString(),
            conclusion: text,
          }).then((ok) => {
            if (ok) {
              draft.clearDraft();
              finished();
            }
          });
        }}
      >
        <label className="field">
          本次结论与后续事项
          <textarea
            name="conclusion"
            required
            rows={4}
            value={draft.draft.conclusion}
            onChange={(e) => draft.setDraft({ conclusion: e.target.value })}
          />
        </label>
      </form>
    </Dialog>
  );
}

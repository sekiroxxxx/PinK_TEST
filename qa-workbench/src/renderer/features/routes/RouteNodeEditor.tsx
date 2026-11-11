import { useEffect, useRef, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { useDraft, DraftNotice } from "../../components/useDraft";
import {
  routeGroups,
  type ActionDescription,
  type RouteNode,
} from "../../../shared/routeTree";

import { nodeFormSchema } from "./editorState";
import { ManualCheckFields } from "../ManualCheckFields";
export function RouteNodeEditor({
  scope,
  node,
  kind,
  parent,
  nodes,
  actions,
  close,
  save,
  path = [],
}: {
  scope: string;
  node?: RouteNode;
  kind: "step" | "group";
  parent: string;
  nodes: RouteNode[];
  actions: ActionDescription[];
  close: () => void;
  save: (node: RouteNode, parent: string) => void;
  path?: string[];
}) {
  const [iteration, setIteration] = useState(0);
  const [next, setNext] = useState({ parent, actionId: "manual" });
  return (
    <NodeForm
      key={iteration}
      scope={scope}
      node={node}
      kind={kind}
      parent={next.parent}
      initialAction={next.actionId}
      nodes={nodes}
      actions={actions}
      close={close}
      save={save}
      path={path}
      again={(parent, actionId) => {
        setNext({ parent, actionId });
        setIteration((n) => n + 1);
      }}
    />
  );
}
function NodeForm({
  scope,
  node,
  kind,
  parent,
  initialAction,
  nodes,
  actions,
  close,
  save,
  again,
  path,
}: {
  scope: string;
  node?: RouteNode;
  kind: "step" | "group";
  parent: string;
  initialAction: string;
  nodes: RouteNode[];
  actions: ActionDescription[];
  close: () => void;
  save: (node: RouteNode, parent: string) => void;
  again: (parent: string, actionId: string) => void;
  path: string[];
}) {
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current
      ?.querySelector<HTMLElement>(kind === "step" ? "textarea" : "input")
      ?.focus();
  }, []);
  const step = node?.kind === "step" ? node : undefined;
  const known = actions.find(
    (a) => a.id === (step?.operation?.actionId || initialAction),
  );
  const actionId =
    step?.operation?.actionId || known?.id || actions[0]?.id || "manual";
  const values =
    step?.operation?.values || (step ? { instruction: step.action } : {});
  const defaults = Object.fromEntries(
    (known?.fields || []).map((f) => [
      f.key,
      values[f.key] ?? f.options?.[0] ?? "",
    ]),
  );
  function instructionFor(value: {
    actionId: string;
    values: Record<string, string>;
    actionText?: string;
  }) {
    if (value.actionText !== undefined) return value.actionText;
    if (value.actionId === "manual") return value.values.instruction || "";
    const description = actions.find((a) => a.id === value.actionId);
    const inputs = [...(description?.summary.matchAll(/\{([^}]+)\}/g) || [])];
    return inputs.some((match) => value.values[match[1]]?.trim())
      ? description!.summary
          .replace(/\{([^}]+)\}/g, (_, key: string) => value.values[key] || "")
          .trim()
      : step?.action || "";
  }
  const draft = useDraft(
    "route-node:" + scope + ":" + (node?.id || "new-" + kind + "-" + parent),
    {
      title: step?.titleMode === "auto" ? "" : node?.title || "",
      target: node?.target || "",
      parent,
      actionId,
      values: { ...values, ...defaults },
      expected: step?.expected || "",
    },
    nodeFormSchema,
    (value) => ({
      title: value.title,
      target: value.target,
      parent: value.parent,
      instruction: instructionFor(value),
      expected: value.expected,
    }),
  );
  const [restored] = useState(draft.hasDraft);
  const d = draft.draft;
  const [error, setError] = useState("");
  const groups = [{ id: "", title: "链路最外层" }, ...routeGroups(nodes)];
  // Old action-form drafts remain readable. Human cases now edit prose directly;
  // only an explicit edit replaces old operation metadata, never opening a case.
  const instruction = instructionFor(d);
  const name = d.title.trim() || instruction.trim().slice(0, 100);
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (kind === "group") {
      if (!d.title.trim()) {
        setError("请填写分组名称。");
        return;
      }
      save(
        {
          kind: "group",
          id: node?.id || crypto.randomUUID(),
          title: d.title.trim(),
          target: d.target.trim(),
          children: node?.kind === "group" ? node.children : [],
        },
        d.parent,
      );
    } else {
      if (!instruction.trim()) {
        setError("请写下这个步骤怎么操作。");
        return;
      }
      save(
        {
          kind: "step",
          id: node?.id || crypto.randomUUID(),
          title: name,
          titleMode: d.title.trim() ? "custom" : "auto",
          target: d.target.trim(),
          action: instruction.trim(),
          expected: d.expected.trim(),
          ...(step?.operation && instruction.trim() === step.action
            ? { operation: step.operation }
            : {}),
        },
        d.parent,
      );
    }
    draft.clearDraft();
    if (
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("name") ===
      "continue"
    )
      again(d.parent, d.actionId);
    else close();
  }
  return (
    <Dialog
      title={
        (node ? "编辑" : "添加") + (kind === "group" ? "步骤分组" : "步骤")
      }
      onClose={close}
    >
      <form ref={form} onSubmit={submit} className="route-node-form">
        {(draft.hasDraft || draft.storageError) && (
          <DraftNotice
            {...draft}
            savedHint={restored ? "已恢复未完成编辑" : undefined}
            discard={() => draft.clearDraft()}
            discardLabel={
              kind === "group" ? "丢弃本次步骤分组编辑" : "丢弃本次步骤编辑"
            }
          />
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {kind === "step" ? (
          <ManualCheckFields
            value={{
              title: d.title,
              action: instruction,
              expected: d.expected,
            }}
            automaticTitle={instruction.trim().slice(0, 100)}
            requireAction
            change={(field, value) =>
              draft.setDraft({
                ...d,
                [field === "action" ? "actionText" : field]: value,
              })
            }
          />
        ) : (
          <label className="field">
            分组名称
            <input
              autoFocus
              required
              value={d.title}
              onChange={(e) => draft.setDraft({ ...d, title: e.target.value })}
            />
          </label>
        )}
        <details open={kind === "group"}>
          <summary>更多设置</summary>
          <p className="route-context">
            {[
              ...path,
              groups.find((g) => g.id === d.parent)?.title || "链路最外层",
            ].join(" / ")}
          </p>
          {!node && (
            <label className="field">
              放入
              <select
                value={d.parent}
                onChange={(e) =>
                  draft.setDraft({ ...d, parent: e.target.value })
                }
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            {kind === "group" ? "本组" : "本步骤"}测试对象（可选）
            <input
              value={d.target}
              placeholder="留空沿用上层对象或当前测试工程"
              onChange={(e) => draft.setDraft({ ...d, target: e.target.value })}
            />
          </label>
        </details>
        <footer className="dialog-actions">
          <button type="button" onClick={close}>
            关闭
          </button>
          {!node && kind === "step" && (
            <button type="submit" name="continue" className="author-next">
              添加并继续
            </button>
          )}
          <button className="primary" type="submit">
            {node ? "更新" : "添加"}
            {kind === "group" ? "分组" : "步骤"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

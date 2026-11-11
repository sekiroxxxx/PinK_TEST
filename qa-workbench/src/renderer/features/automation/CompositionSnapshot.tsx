import { useEffect, useState } from "react";
import type { RecordedAutomation } from "../../../shared/automation";
import { Dialog } from "../../components/Dialog";
import { CaseCanvas } from "../structured/CaseCanvas";
import { flatten, authoringTree, type EditNode } from "../structured/authoring";
import { displayValue } from "../structured/contract";
import { automationModule } from "./modules";

export function CompositionSnapshot({
  snapshot,
  path,
  close,
}: {
  snapshot: NonNullable<RecordedAutomation["composition"]>;
  path: string[];
  close: () => void;
}) {
  const [nodes, setNodes] = useState<EditNode[]>([]),
    [selection, setSelection] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const module = automationModule(snapshot.moduleId);
    if (!module) {
      setError("当前没有可读取此快照的模块，原始结果与报告仍可查看。");
      return;
    }
    void module
      .load({ document: snapshot.definition })
      .then((loaded) => {
        const nodes = authoringTree(
          loaded.adapter,
          snapshot.definition,
          snapshot.presentation?.nodeLabels,
        );
        if (live) {
          setNodes(nodes);
          setSelection(
            loaded.originNode?.(snapshot.definition, path) ||
              nodes[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [snapshot]);
  const current =
    flatten(nodes).find((node) => node.id === selection) || nodes[0];
  return (
    <Dialog title="本轮执行链路" wide onClose={close}>
      <p className="hint">
        本轮已冻结的组合定义 · 只读，当前用例库的修改不会影响这里。
      </p>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : nodes.length ? (
        <CaseCanvas
          scope={"record:" + JSON.stringify(path)}
          nodes={nodes}
          selection={selection}
          select={setSelection}
        >
          <h2>{current?.title}</h2>
          <p className="hint">{current?.note}</p>
          <dl className="snapshot-fields">
            {current?.fields?.map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{field.display || displayValue(field.value)}</dd>
              </div>
            ))}
          </dl>
        </CaseCanvas>
      ) : (
        <p role="status">正在读取本轮快照…</p>
      )}
    </Dialog>
  );
}

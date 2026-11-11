import type { Mount } from "../../../shared/content";
import { Dialog } from "../../components/Dialog";
import type { AutomationModule } from "./modules";

export function sourceLabel(source: Mount) {
  switch (source.sourceName) {
    case "共享合同原生用例":
      return "内置用例";
    case "共享合同原生用例节选 · 仅模拟执行":
      return "内置用例节选";
    case "通过接入模块新建":
      return "新建用例集";
    default:
      return source.sourceName;
  }
}

export function AutomationCaseManager({
  modules,
  sources,
  busy,
  error,
  close,
  create,
  copy,
  compose,
  view,
}: {
  modules: AutomationModule[];
  sources: Mount[];
  busy: boolean;
  error: string;
  close: () => void;
  create: (module: AutomationModule) => void;
  copy: (module: AutomationModule, source: Mount) => void;
  compose: (module: AutomationModule, source?: Mount) => void;
  view: (source: Mount) => void;
}) {
  return (
    <Dialog
      title="用例管理"
      wide
      onClose={close}
      footer={
        error ? (
          <p role="alert" className="case-manager-error error-text">
            {error}
          </p>
        ) : undefined
      }
    >
      {modules.map((module) => {
        const owned = sources.filter(
          (source) => source.editor?.moduleId === module.id,
        );
        return (
          <section
            className="automation-case-manager"
            key={module.id}
            aria-label={module.name + "用例管理"}
          >
            <div className="case-manager-heading">
              <h3>{module.name}</h3>
              <div className="toolbar">
                <button disabled={busy} onClick={() => compose(module)}>
                  新建组合链路
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => create(module)}
                >
                  新建用例集
                </button>
              </div>
            </div>
            {owned.length ? (
              <ul className="case-manager-list">
                {owned.map((source) => (
                  <li key={source.id}>
                    <div>
                      <strong>{source.name}</strong>
                      <small>{sourceLabel(source)}</small>
                    </div>
                    <div className="toolbar">
                      <button disabled={busy} onClick={() => view(source)}>
                        查看用例
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => copy(module, source)}
                      >
                        复制已保存版本
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => compose(module, source)}
                      >
                        用于新组合
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">此工具还没有用例集。</p>
            )}
          </section>
        );
      })}
      <details className="connection-options">
        <summary>查看说明</summary>
        <p>新建和复制使用对应工具的编辑规则，完成后进入用例编辑。</p>
        <p>复制只使用已保存内容，原用例和未保存草稿保持不变。</p>
      </details>
    </Dialog>
  );
}

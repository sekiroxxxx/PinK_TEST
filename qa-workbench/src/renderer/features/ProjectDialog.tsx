import { useDraft, DraftNotice } from "../components/useDraft";
import { projectDraft } from "./draftSchemas";
import type { Environment, Project, State } from "../../shared/model";
import { Dialog, PathInput } from "../components/Dialog";

const newProject = (): Project => ({
  id: crypto.randomUUID(),
  name: "",
  description: "",
});
const newEnvironment = (projectId: string): Environment => ({
  id: crypto.randomUUID(),
  projectId,
  name: "",
  version: "",
  softwarePath: "",
  projectPath: "",
  materialsPath: "",
  notes: "",
});
export function ProjectDialog({
  state,
  save,
  close,
}: {
  state: State;
  save: (state: State) => Promise<boolean>;
  close: () => void;
}) {
  const initialProject =
    state.projects.find((p) => p.id === state.selectedProjectId) ??
    newProject();
  const draft = useDraft(
    "project:" + state.selectedProjectId + ":" + state.selectedEnvironmentId,
    {
      project: initialProject,
      environment:
        state.environments.find(
          (e) =>
            e.id === state.selectedEnvironmentId &&
            e.projectId === initialProject.id,
        ) ?? newEnvironment(initialProject.id),
    },
    projectDraft,
  );
  const { project, environment } = draft.draft;
  const lastVersion =
    state.environments.find((e) => e.id === environment.id)?.version || "";
  const setProject = (project: Project) =>
    draft.setDraft((d) => ({ ...d, project }));
  const setEnvironment = (environment: Environment) =>
    draft.setDraft((d) => ({ ...d, environment }));
  const environments = state.environments.filter(
    (e) => e.projectId === project.id,
  );
  function chooseProject(value: string) {
    const p = state.projects.find((p) => p.id === value) ?? newProject();
    setProject(p);
    setEnvironment(
      state.environments.find((e) => e.projectId === p.id) ??
        newEnvironment(p.id),
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!project.name.trim() || !environment.name.trim()) return;
    const projects = [
      ...state.projects.filter((p) => p.id !== project.id),
      {
        ...project,
        name: project.name.trim(),
        lastOpenedAt: new Date().toISOString(),
      },
    ];
    const env = {
      ...environment,
      version: lastVersion,
      name: environment.name.trim(),
      projectId: project.id,
      lastUsedAt: new Date().toISOString(),
    };
    if (
      await save({
        ...state,
        projects,
        environments: [
          ...state.environments.filter((e) => e.id !== env.id),
          env,
        ],
        selectedProjectId: project.id,
        selectedEnvironmentId: env.id,
      })
    ) {
      draft.clearDraft();
      close();
    }
  }
  return (
    <Dialog title="测试项目与环境" onClose={close} wide>
      <form onSubmit={submit}>
        <DraftNotice
          {...draft}
          discard={() => {
            draft.clearDraft();
            close();
          }}
        />
        <div className="form-grid">
          <label className="field">
            选择项目
            <select
              value={
                state.projects.some((p) => p.id === project.id)
                  ? project.id
                  : ""
              }
              onChange={(e) => chooseProject(e.target.value)}
            >
              <option value="">＋ 新建项目</option>
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            选择环境
            <select
              value={
                environments.some((e) => e.id === environment.id)
                  ? environment.id
                  : ""
              }
              onChange={(e) =>
                setEnvironment(
                  environments.find((env) => env.id === e.target.value) ??
                    newEnvironment(project.id),
                )
              }
            >
              <option value="">＋ 新建环境</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            项目名称
            <input
              required
              maxLength={300}
              value={project.name}
              onChange={(e) => setProject({ ...project, name: e.target.value })}
              placeholder="例如：我的项目"
            />
          </label>
          <label className="field">
            环境名称
            <input
              required
              maxLength={300}
              value={environment.name}
              onChange={(e) =>
                setEnvironment({ ...environment, name: e.target.value })
              }
              placeholder="例如：本机开发环境"
            />
          </label>
        </div>
        <div className="last-version">
          <span>上次版本</span>
          <strong>{lastVersion || "尚未填写"}</strong>
          <small>本次版本在开始测试前确认。</small>
        </div>
        <details>
          <summary>路径与补充信息</summary>
          <label className="field">
            项目说明
            <input
              value={project.description}
              onChange={(e) =>
                setProject({ ...project, description: e.target.value })
              }
            />
          </label>
          <PathInput
            label="被测程序位置（可选）"
            kind="file"
            value={environment.softwarePath}
            onChange={(softwarePath) =>
              setEnvironment({ ...environment, softwarePath })
            }
          />
          <PathInput
            label="测试工程目录（可选）"
            value={environment.projectPath}
            onChange={(projectPath) =>
              setEnvironment({ ...environment, projectPath })
            }
          />
          <PathInput
            label="私有材料清单位置（可选）"
            kind="file"
            value={environment.materialsPath}
            onChange={(materialsPath) =>
              setEnvironment({ ...environment, materialsPath })
            }
          />
          <label className="field">
            环境备注
            <textarea
              rows={2}
              value={environment.notes}
              onChange={(e) =>
                setEnvironment({ ...environment, notes: e.target.value })
              }
              placeholder="填写环境信息，不在此保存密码或密钥"
            />
          </label>
        </details>
        <footer className="dialog-actions">
          <button type="button" onClick={close}>
            关闭
          </button>
          <button className="primary" type="submit">
            保存并使用
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

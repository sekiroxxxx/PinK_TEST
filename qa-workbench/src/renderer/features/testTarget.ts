import type { Environment, Project } from "../../shared/model";

export function editorName(path = "") {
  return (
    path
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/\.exe$/i, "") || "未选择编辑器"
  );
}
export function targetLabel(project?: Project, environment?: Environment) {
  if (!project) return "选择测试目标";
  return `${editorName(environment?.softwarePath)}${environment?.version ? " " + environment.version : ""} → ${project.name}`;
}

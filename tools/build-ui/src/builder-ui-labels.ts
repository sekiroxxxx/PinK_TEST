/** Exact package labels for the existing web-desktop path; no fuzzy or selector fallback. */
export function builderUiLabels(kind: string, label: string): string[] {
  const aliases: Record<string, string[]> =
    kind === "button"
      ? {
          查看构建记录: ["View build history"],
          编译与打包结果: ["Build & Package Results"],
          构建: ["Build", "build"],
        }
      : kind === "platform"
        ? { "Web 桌面端": ["Web Desktop"] }
        : kind === "status"
          ? { 成功: ["Success"] }
          : {};
  return [label, ...(aliases[label] ?? [])];
}

export function configurationUiTitles(platform: string, title: string): string[] {
  return platform === "web-desktop" && title === "Web 桌面端" ? [title, "Web Desktop"] : [title];
}

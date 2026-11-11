type CheckContent = { title: string; action: string; expected: string };

// Used by manual definitions and checks recorded during a test. Each caller
// retains its own draft, validation and save scope.
export function ManualCheckFields({
  value,
  change,
  automaticTitle,
  requireAction = false,
  maxTitleLength,
}: {
  value: CheckContent;
  change: (field: keyof CheckContent, value: string) => void;
  automaticTitle?: string;
  requireAction?: boolean;
  maxTitleLength?: number;
}) {
  return (
    <>
      <label className="field">
        {automaticTitle === undefined ? "名称" : "名称（可选）"}
        <input
          autoFocus={automaticTitle === undefined}
          required={automaticTitle === undefined}
          maxLength={maxTitleLength}
          value={value.title}
          placeholder={
            automaticTitle === undefined
              ? "例如：检查资源导入结果"
              : automaticTitle || "留空时根据操作自动命名"
          }
          onChange={(event) => change("title", event.target.value)}
        />
      </label>
      <label className="field">
        操作
        <textarea
          aria-label="检查项操作"
          rows={3}
          required={requireAction}
          placeholder="写下要做什么、如何操作"
          value={value.action}
          onChange={(event) => change("action", event.target.value)}
        />
      </label>
      <label className="field">
        预期
        <textarea
          aria-label="检查项预期"
          rows={3}
          placeholder="写下怎样的表现算符合预期"
          value={value.expected}
          onChange={(event) => change("expected", event.target.value)}
        />
      </label>
    </>
  );
}

import { useEffect, useState } from "react";
import type {
  SettingsDirectory,
  SettingsInput,
  WorkbenchSettings,
} from "../../shared/settings";
import { Dialog } from "../components/Dialog";
import { hasHostAccess, localServiceMode } from "../browserBridge";

export function SettingsDialog({
  close,
  saved,
  backup,
}: {
  close: () => void;
  saved: (settings: WorkbenchSettings) => void;
  backup: () => void;
}) {
  const [settings, setSettings] = useState<WorkbenchSettings>();
  const [value, setValue] = useState<SettingsInput>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        if (!window.qa.getSettings)
          throw new Error(
            "桌面接入已更新，请重启开发窗口后打开设置。原数据和草稿仍保留。",
          );
        const settings = await window.qa.getSettings();
        if (live) {
          setSettings(settings);
          setValue({
            outputDirectory: settings.outputDirectory,
            moduleRoot: settings.moduleRoot,
            nodePath: settings.nodePath,
          });
        }
      } catch (error) {
        if (live) setError(String(error));
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  function pick(field: keyof SettingsInput, kind: "file" | "directory") {
    void perform(async () => {
      const path = await window.qa.pickPath(kind);
      if (path)
        setValue((value) => (value ? { ...value, [field]: path } : value));
    });
  }
  function open(kind: SettingsDirectory) {
    void perform(() => window.qa.openSettingsDirectory(kind));
  }
  return (
    <Dialog
      title="设置"
      onClose={() => {
        if (!busy) close();
      }}
    >
      {!hasHostAccess && (
        <p className="notice">
          本机服务未连接，网页暂不能修改本机设置。请运行 npm run dev:web:live
          后刷新。
        </p>
      )}
      {localServiceMode && (
        <p className="notice">
          网页已连接本机服务。个人记录、用例和草稿仍保存在当前浏览器；以下目录用于真实测试输出与本机服务设置。
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {!value || !settings ? (
        !error && <p role="status">正在读取设置…</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              saved(await window.qa.saveSettings(value));
            });
          }}
        >
          <fieldset className="settings-fields" disabled={busy}>
            <section className="settings-section">
              <h3>测试输出</h3>
              <label className="field">
                默认测试输出目录
                <input
                  required
                  value={value.outputDirectory}
                  readOnly={!hasHostAccess}
                  placeholder="选择或填写本机目录"
                  onChange={(event) =>
                    setValue({ ...value, outputDirectory: event.target.value })
                  }
                />
              </label>
              <div className="settings-path-actions">
                <button
                  type="button"
                  disabled={!hasHostAccess}
                  onClick={() => pick("outputDirectory", "directory")}
                >
                  选择目录
                </button>
                <button
                  type="button"
                  disabled={
                    !hasHostAccess ||
                    value.outputDirectory !== settings.outputDirectory
                  }
                  onClick={() => open("output")}
                >
                  打开目录
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    !hasHostAccess ||
                    value.outputDirectory === settings.defaultOutputDirectory
                  }
                  onClick={() =>
                    setValue({
                      ...value,
                      outputDirectory: settings.defaultOutputDirectory,
                    })
                  }
                >
                  恢复默认
                </button>
              </div>
              <p className="hint">
                保存后用于新计划，旧记录、已准备和正在运行的测试保持原位置。
              </p>
            </section>
            <section className="settings-section">
              <h3>自动化工具</h3>
              <label className="field">
                工具目录
                <input
                  required
                  value={value.moduleRoot}
                  readOnly={!hasHostAccess}
                  placeholder="选择或填写自动化工具目录"
                  onChange={(event) =>
                    setValue({ ...value, moduleRoot: event.target.value })
                  }
                />
              </label>
              <div className="settings-path-actions">
                <button
                  type="button"
                  disabled={!hasHostAccess}
                  onClick={() => pick("moduleRoot", "directory")}
                >
                  选择目录
                </button>
                <button
                  type="button"
                  disabled={
                    !hasHostAccess || value.moduleRoot !== settings.moduleRoot
                  }
                  onClick={() => open("module")}
                >
                  打开目录
                </button>
              </div>
              <p className="hint">
                请选择可信的 PinK-Test 目录，保存时校验共享合同。
              </p>
              <details>
                <summary>高级：Node.js 程序位置</summary>
                <label className="field">
                  Node.js 24 或更新版本
                  <input
                    value={value.nodePath}
                    readOnly={!hasHostAccess}
                    placeholder="留空使用默认 Node.js"
                    onChange={(event) =>
                      setValue({ ...value, nodePath: event.target.value })
                    }
                  />
                </label>
                <div className="settings-path-actions">
                  <button
                    type="button"
                    disabled={!hasHostAccess}
                    onClick={() => pick("nodePath", "file")}
                  >
                    选择程序
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!hasHostAccess || !value.nodePath}
                    onClick={() => setValue({ ...value, nodePath: "" })}
                  >
                    使用默认
                  </button>
                </div>
              </details>
            </section>
            <section className="settings-section">
              <h3>{localServiceMode ? "本机服务数据" : "本机数据"}</h3>
              <code className="path-block">{settings.dataPath}</code>
              <div className="settings-path-actions">
                <button
                  type="button"
                  disabled={!hasHostAccess}
                  onClick={() => open("data")}
                >
                  打开数据目录
                </button>
                <button type="button" onClick={backup}>
                  备份与恢复
                </button>
              </div>
              <p className="hint">
                个人 JSON 备份不含真实测试输出目录，请另行保留。
                {localServiceMode && "备份与恢复仍操作当前浏览器的个人记录。"}
              </p>
            </section>
            <footer className="dialog-actions">
              <button type="button" onClick={close}>
                {!hasHostAccess ? "完成" : "取消"}
              </button>
              {!!hasHostAccess && (
                <button className="primary" type="submit">
                  {busy ? "正在保存…" : "保存设置"}
                </button>
              )}
            </footer>
          </fieldset>
        </form>
      )}
    </Dialog>
  );
}

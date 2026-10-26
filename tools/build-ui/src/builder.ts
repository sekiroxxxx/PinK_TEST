import type { Page } from "playwright-core";
import { Cdp } from "./cdp.js";
import { randomUUID } from "node:crypto";
import { readHistory, type HistoryView } from "./history-page.js";
import { readForm, type FormView } from "./configuration-page.js";
import {
  errorMessage,
  waitFor,
  type Configuration,
  type FieldValue,
  type Task,
  type TaskSnapshot,
  type TaskObservation,
} from "./common.js";
import {
  selectionLabel,
  type Platform,
  type SpecialField,
  type SpecialFieldContract,
} from "./profiles.js";
import { platformEntry } from "./platform-catalog.js";
import { fieldFingerprint } from "./existing-platforms.js";
import { readOpenpaasPage, assertExistingGameSelectable, type OpenpaasGame } from "./openpaas.js";
import { ConfigurationOperationError } from "./configuration-context.js";
import { builderUiLabels } from "./builder-ui-labels.js";

interface Probe {
  owner: string;
  openpaasGames?: OpenpaasGame[];
  snapshots: TaskSnapshot[];
  observations: Record<string, TaskObservation>;
  listener: (event: MessageEvent) => void;
}
type ProbeWindow = Window & { __pinkBuildUiProbe?: Probe };
interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface ConfigurationReadiness {
  openedAt: number;
  readyAt?: number;
  timeoutMs: number;
  states: Array<{ at: number; state: string; missingField?: string; optionCount?: number }>;
}

export class ConfigurationReadinessError extends Error {
  constructor(
    message: string,
    readonly evidence: ConfigurationReadiness,
  ) {
    super(message);
  }
}

/** Current Windows Builder UI adapter. No product commands or build RPCs are invoked. */
export class Builder {
  private readonly probeOwner = randomUUID();
  private configurationGenerationValue = 0;
  private probeAttempted = false;
  private readiness?: ConfigurationReadiness;
  private expectedConfigurationTitle?: string;
  private revealedBatchLabel?: string;
  private fingerprintKeys = new Set<string>();

  get configurationGeneration(): number {
    return this.configurationGenerationValue;
  }

  async configurationIdentity() {
    const instance = await this.cdp.configurationNode();
    const title = await this.cdp.dom((document) => {
      const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
      if (!close?.getClientRects().length) return "";
      return close.parentElement?.querySelector("span")?.textContent?.trim() ?? "";
    });
    return { title, generation: this.configurationGeneration, instance };
  }

  readinessEvidence(): ConfigurationReadiness | undefined {
    return this.readiness ? structuredClone(this.readiness) : undefined;
  }

  private constructor(
    private readonly page: Page,
    private readonly cdp: Cdp,
    private readonly hostName: string,
    private readonly signal: AbortSignal,
    private readonly configurationTimeoutMs: number,
  ) {}

  static async open(
    page: Page,
    endpoint: string,
    signal: AbortSignal,
    category = "X-Device",
    configurationTimeoutMs = 120_000,
    readOnly = false,
  ): Promise<Builder> {
    // The activity tabs avoid the toolbar menu overlapping editor Webviews.
    if (!readOnly) await page.keyboard.press("Escape");
    const tab = page.getByRole("tab", { name: category, exact: true });
    if ((await tab.getAttribute("aria-expanded")) !== "true") await tab.click({ timeout: 60_000 });
    await waitFor(
      `展开 ${category} 构建分类`,
      async () => ((await tab.getAttribute("aria-expanded")) === "true" ? true : undefined),
      30_000,
      signal,
    );
    const target = await waitFor(
      "可见 Builder Webview",
      async () => {
        const response = await fetch(`${endpoint}/json/list`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error("读取 Chromium 目标列表失败");
        const targets = (await response.json()) as Target[];
        const visible: Array<{ target: Target; name: string }> = [];
        for (const target of targets) {
          if (target.type !== "iframe") continue;
          const url = new URL(target.url);
          if (url.searchParams.get("extensionId") !== "SUD.pink-builder") continue;
          const name = url.searchParams.get("id");
          if (!name) continue;
          const host = page.locator("iframe").filter({ visible: true });
          for (const element of await host.all()) {
            if ((await element.getAttribute("name")) === name) visible.push({ target, name });
          }
        }
        if (visible.length > 1) throw new Error("多个 Builder Webview 同时可见，无法唯一选择");
        return visible[0];
      },
      60_000,
      signal,
    );
    const cdp = await Cdp.connect(target.target.webSocketDebuggerUrl);
    try {
      await waitFor(
        "Builder 内部 UI 容器加载",
        () =>
          cdp.evaluate(() => {
            const frame = document.querySelector<HTMLIFrameElement>("#active-frame");
            const content = frame?.contentDocument;
            if (!content) return undefined;
            return Array.from(content.querySelectorAll<HTMLButtonElement>("button")).some(
              (button) =>
                button.getClientRects().length > 0 &&
                [
                  "查看构建记录",
                  "编译与打包结果",
                  "View build history",
                  "Build & Package Results",
                ].includes(button.innerText.trim()),
            )
              ? true
              : undefined;
          }),
        60_000,
        signal,
      );
      return new Builder(page, cdp, target.name, signal, configurationTimeoutMs);
    } catch (error) {
      cdp.close();
      throw error;
    }
  }

  private async point(
    kind:
      | "button"
      | "platform"
      | "checkbox"
      | "select"
      | "native-select"
      | "text"
      | "option"
      | "enum-option"
      | "close"
      | "history-search"
      | "history-filter"
      | "history-option"
      | "batch"
      | "section"
      | "case-hover"
      | "case-control",
    label: string,
    uiLabel?: string,
    choiceLabel?: string,
    safeEdges = false,
  ) {
    return this.cdp.evaluate(
      (kind, label, uiLabel, choiceLabel, safeEdges, acceptedLabels) => {
        const matches: Array<{ element: HTMLElement; chain: HTMLIFrameElement[] }> = [];
        function scan(doc: Document, chain: HTMLIFrameElement[]) {
          const selectors = {
            button: "button",
            section: '[role="button"][tabindex]',
            "case-control": label,
            "case-hover": label,
            platform: ".platform-card, .pk-card",
            checkbox: `[data-option-key="${CSS.escape(label)}"] [role="checkbox"]`,
            select: `[data-option-key="${CSS.escape(label)}"] [role="combobox"]`,
            "native-select": `[data-option-key="${CSS.escape(label)}"] select`,
            text: `[data-option-key="${CSS.escape(label)}"] input:not([type="hidden"]):not([type="checkbox"])`,
            option: '[role="option"]',
            "enum-option": '[role="option"][data-pink-enum-value]',
            close: 'button[aria-label="Close"]',
            batch: "button.pk-batch-header",
            "history-search": "input[placeholder]",
            "history-filter": 'button[data-slot="dropdown-menu-trigger"]:not([aria-label])',
            "history-option": '[role="menuitem"]',
          };
          const selector = selectors[kind];
          const customRows = uiLabel
            ? Array.from(doc.querySelectorAll<HTMLElement>('[data-slot="field"]')).filter(
                (row) =>
                  row.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ===
                  uiLabel,
              )
            : [];
          const customSelector =
            kind === "native-select"
              ? "select"
              : kind === "checkbox"
                ? '[role="checkbox"]'
                : 'input:not([type="hidden"]):not([type="checkbox"])';
          const inCaseDocument =
            (kind !== "case-control" && kind !== "case-hover") ||
            doc === document.querySelector<HTMLIFrameElement>("#active-frame")?.contentDocument;
          const elements = !inCaseDocument
            ? []
            : uiLabel
              ? customRows.flatMap((row) =>
                  choiceLabel
                    ? Array.from(row.querySelectorAll<HTMLLabelElement>("label"))
                        .filter((item) => item.textContent?.trim() === choiceLabel)
                        .flatMap((item) =>
                          Array.from(item.querySelectorAll<HTMLElement>(customSelector)),
                        )
                    : Array.from(row.querySelectorAll<HTMLElement>(customSelector)),
                )
              : Array.from(doc.querySelectorAll<HTMLElement>(selector));
          for (const element of elements) {
            const text =
              kind === "button" ||
              kind === "section" ||
              kind === "option" ||
              kind === "batch" ||
              kind === "history-option"
                ? element.innerText.trim()
                : kind === "enum-option"
                  ? element.getAttribute("data-pink-enum-value") === label
                    ? label
                    : undefined
                  : kind === "platform"
                    ? element
                        .querySelector(".platform-card-title, .pk-card-foot")
                        ?.textContent?.trim()
                    : label;
            if (!acceptedLabels.includes(text ?? "") || element.getClientRects().length === 0)
              continue;
            const style = doc.defaultView!.getComputedStyle(element);
            if (style.visibility !== "visible" || style.pointerEvents === "none") continue;
            if (
              kind !== "case-hover" &&
              element instanceof doc.defaultView!.HTMLButtonElement &&
              element.disabled
            )
              continue;
            if (kind !== "case-hover" && element.getAttribute("aria-disabled") === "true") continue;
            matches.push({ element, chain });
          }
          for (const frame of doc.querySelectorAll<HTMLIFrameElement>("iframe")) {
            if (frame.getClientRects().length === 0) continue;
            if (doc.defaultView!.getComputedStyle(frame).visibility !== "visible") continue;
            // Only the same-origin nesting actually verified for this package is supported.
            if (!frame.contentDocument) continue;
            scan(frame.contentDocument, [...chain, frame]);
          }
        }
        scan(document, []);
        if (matches.length > 1) throw new Error(`UI 目标不唯一：${label}`);
        const match = matches[0];
        if (!match) return null;
        match.element.scrollIntoView({ block: "center", inline: "center" });
        const rect = match.element.getBoundingClientRect();
        const candidates = safeEdges
          ? [
              [0.5, 0.5],
              [0.2, 0.5],
              [0.8, 0.5],
              [0.2, 0.8],
              [0.8, 0.8],
            ]
          : [[0.5, 0.5]];
        for (const [rx, ry] of candidates) {
          let x = rect.left + rect.width * rx,
            y = rect.top + rect.height * ry;
          const hit = match.element.ownerDocument.elementFromPoint(x, y);
          if (!hit || !match.element.contains(hit)) continue;
          let covered = false;
          for (const frame of [...match.chain].reverse()) {
            const rect = frame.getBoundingClientRect();
            x += rect.left + frame.clientLeft;
            y += rect.top + frame.clientTop;
            if (frame.ownerDocument.elementFromPoint(x, y) !== frame) {
              covered = true;
              break;
            }
          }
          if (!covered) return { x, y };
        }
        return null;
      },
      kind,
      label,
      uiLabel,
      choiceLabel,
      safeEdges,
      builderUiLabels(kind, label),
    );
  }

  async click(
    kind:
      | "button"
      | "platform"
      | "checkbox"
      | "select"
      | "native-select"
      | "text"
      | "option"
      | "enum-option"
      | "close"
      | "history-search"
      | "history-filter"
      | "history-option"
      | "batch"
      | "section"
      | "case-control",
    label: string,
    uiLabel?: string,
    choiceLabel?: string,
    beforeInput?: () => Promise<void>,
    safeEdges = false,
  ): Promise<number> {
    let previousPoint: { x: number; y: number } | undefined;
    const point = await waitFor(
      `可点击的 ${label}`,
      async () => {
        const current = await this.point(kind, label, uiLabel, choiceLabel, safeEdges);
        if (kind !== "platform") return current ?? undefined;
        const stable =
          current &&
          previousPoint &&
          Math.abs(current.x - previousPoint.x) < 1 &&
          Math.abs(current.y - previousPoint.y) < 1;
        previousPoint = current ?? undefined;
        return stable ? current : undefined;
      },
      30_000,
      this.signal,
    );
    const host = this.page.locator(`iframe[name="${this.hostName}"]`);
    const box = await host.boundingBox();
    if (!box) throw new Error("Builder Frame 不可见");
    const x = box.x + point.x;
    const y = box.y + point.y;
    const hit = await this.page.evaluate(
      ({ x, y, name }) => {
        const element = document.elementFromPoint(x, y);
        return element?.getAttribute("name") === name;
      },
      { x, y, name: this.hostName },
    );
    if (!hit) throw new Error(`工作台覆盖了目标控件：${label}`);
    this.signal.throwIfAborted();
    await beforeInput?.();
    const clickedAt = Date.now();
    // A write is performed exactly once, without a retry after uncertain delivery.
    await this.page.mouse.click(x, y);
    return clickedAt;
  }

  async installProbe(
    specialFields: SpecialFieldContract[] = [],
    observeOpenpaas = false,
    caseKeys: string[] = [],
  ): Promise<void> {
    this.fingerprintKeys = new Set(
      specialFields.filter((field) => field.fingerprint).map((field) => field.key),
    );
    const install = (
      document: Document,
      specialFields: SpecialFieldContract[],
      observeOpenpaas: boolean,
      caseKeys: string[],
      owner: string,
    ) => {
      const window = document.defaultView as ProbeWindow;
      if (window.__pinkBuildUiProbe) throw new Error("该 Builder 已有工具观察器，请先结束原运行");
      const probe: Probe = { owner, snapshots: [], observations: {}, listener: () => {} };
      probe.listener = (event) => {
        const message = event.data as {
          source?: string;
          kind?: string;
          ok?: boolean;
          result?: unknown;
        };
        if (
          observeOpenpaas &&
          message?.source === "host" &&
          message.kind === "response" &&
          message.ok === true &&
          message.result &&
          typeof message.result === "object" &&
          !Array.isArray(message.result) &&
          "games" in message.result &&
          Array.isArray(message.result.games)
        ) {
          const games = message.result.games as Array<{ id?: unknown; codeVersion?: unknown }>;
          if (
            games.every(
              (game) =>
                typeof game.id === "string" &&
                /^\d+$/.test(game.id) &&
                (game.codeVersion === undefined || typeof game.codeVersion === "string"),
            )
          )
            probe.openpaasGames = games.map((game) => ({
              id: game.id as string,
              codeVersion: (game.codeVersion as string | undefined) ?? "",
            }));
          // Never retain the response's account token, environment or game names.
        }
        if (
          message?.source !== "host" ||
          message.kind !== "response" ||
          message.ok !== true ||
          !Array.isArray(message.result)
        )
          return;
        const tasks = message.result as Task[];
        if (
          tasks.length === 0 &&
          !Array.from(document.querySelectorAll<HTMLElement>("button")).some(
            (button) =>
              button.getClientRects().length > 0 &&
              ["编译与打包结果", "Build & Package Results"].includes(button.innerText.trim()),
          )
        )
          return;
        if (
          !tasks.every(
            (task) =>
              task &&
              typeof task.id === "string" &&
              typeof task.platform === "string" &&
              typeof task.state === "string",
          )
        )
          return;
        const at = Date.now();
        for (const task of tasks) {
          const observation = (probe.observations[task.id] ??= { firstSeenAt: at });
          if (task.state === "waiting") observation.waitingAt ??= at;
          if (task.state === "processing") observation.processingAt ??= at;
          if (["success", "failure", "cancelled", "generated"].includes(task.state))
            observation.terminalAt ??= at;
        }
        probe.snapshots.push({
          at,
          tasks: tasks.map((task) => ({
            caseOptions: Object.fromEntries(
              caseKeys.map((path) => {
                let value: unknown = task.options;
                for (const part of path.split("."))
                  value =
                    value && typeof value === "object"
                      ? (value as Record<string, unknown>)[part]
                      : undefined;
                return [path, value];
              }),
            ),
            id: task.id,
            platform: task.platform,
            state: task.state,
            progress: task.progress,
            outputName: task.outputName,
            createdAt: task.createdAt,
            groupId: task.groupId,
            groupCreatedAt: task.groupCreatedAt,
            completedAt: task.completedAt,
            message: task.message?.slice(0, 1200),
            displayName: task.displayName,
            parentTaskId: task.parentTaskId,
            childTaskIds: task.childTaskIds,
            observation: { ...probe.observations[task.id] },
            specialOptions: specialFields.some((field) => field.key.split(".")[1] === task.platform)
              ? Object.fromEntries(
                  specialFields
                    .filter((field) => field.key.split(".")[1] === task.platform)
                    .map((field) => {
                      let value: unknown = task.options;
                      let present = true;
                      for (const key of field.key.split(".")) {
                        if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) {
                          present = false;
                          value = undefined;
                          break;
                        }
                        value = (value as Record<string, unknown>)[key];
                      }
                      if (
                        field.arrayChoices &&
                        present &&
                        Array.isArray(value) &&
                        value.every((item) => typeof item === "string")
                      )
                        value = JSON.stringify([...value].sort());
                      if (field.redact && present) {
                        value =
                          typeof value === "string"
                            ? value
                              ? "[redacted:nonempty]"
                              : "[redacted:empty]"
                            : undefined;
                      }
                      return [
                        field.key,
                        {
                          present,
                          ...(typeof value === "boolean" ||
                          typeof value === "string" ||
                          typeof value === "number"
                            ? { value }
                            : {}),
                        },
                      ];
                    }),
                )
              : undefined,
            // Retain only this suite's inputs, never unrelated platform credentials.
            options:
              task.options &&
              Object.fromEntries(
                [
                  "name",
                  "buildPath",
                  "outputName",
                  "startScene",
                  "scenes",
                  "debug",
                  "sourceMaps",
                  "mangleProperties",
                  "inlineEnum",
                  "experimentalEraseModules",
                  "useSplashScreen",
                  "bundleCommonChunk",
                  "md5Cache",
                  "mainBundleIsRemote",
                  "server",
                  "mainBundleCompressionType",
                  "skipCompressTexture",
                  "packAutoAtlas",
                  "startSceneAssetBundle",
                  "nativeCodeBundleMode",
                  "wasmCompressionMode",
                  "overwriteProjectSettings",
                  "nextStages",
                  "buildStageGroup",
                ]
                  .filter((key) => Object.hasOwn(task.options!, key))
                  .map((key) => [key, task.options![key]]),
              ),
          })),
        });
        if (probe.snapshots.length > 24) probe.snapshots.shift();
      };
      window.__pinkBuildUiProbe = probe;
      window.addEventListener("message", probe.listener);
    };
    this.probeAttempted = true;
    await this.cdp.dom(install, specialFields, observeOpenpaas, caseKeys, this.probeOwner);
  }

  async snapshots(): Promise<TaskSnapshot[]> {
    const snapshots = await this.cdp.dom((document) => {
      const probe = (document.defaultView as ProbeWindow).__pinkBuildUiProbe;
      if (!probe) throw new Error("任务观察器丢失，Frame 可能已重建；本次执行无法继续取证");
      return probe.snapshots;
    });
    return snapshots.map((snapshot) => this.fingerprintSnapshot(snapshot));
  }

  async latestSnapshot(since?: number): Promise<TaskSnapshot | undefined> {
    const snapshot = await this.cdp.dom((document, since) => {
      const probe = (document.defaultView as ProbeWindow).__pinkBuildUiProbe;
      if (!probe) throw new Error("任务观察器丢失，停止后续提交");
      const latest = probe.snapshots.at(-1);
      return latest && (since === undefined || latest.at >= since) ? latest : undefined;
    }, since);
    return snapshot ? this.fingerprintSnapshot(snapshot) : undefined;
  }

  private fingerprintSnapshot(snapshot: TaskSnapshot): TaskSnapshot {
    for (const task of snapshot.tasks) {
      for (const [key, value] of Object.entries(task.caseOptions ?? {})) {
        if (/(?:password|appkey|xxteaKey|appid)$/i.test(key) && typeof value === "string")
          task.caseOptions![key] = fieldFingerprint(value);
      }
      for (const key of this.fingerprintKeys) {
        const field = task.specialOptions?.[key];
        if (field?.present && typeof field.value === "string")
          field.value = fieldFingerprint(field.value);
      }
    }
    return snapshot;
  }

  async home(beforeInput?: () => Promise<void>): Promise<void> {
    await this.closeConfiguration(beforeInput);
    if (await this.point("button", "编译与打包结果"))
      await this.click("button", "编译与打包结果", undefined, undefined, beforeInput);
  }

  async historySnapshot(readOnly = false): Promise<TaskSnapshot> {
    if (
      readOnly &&
      (await this.cdp.dom((document) =>
        Boolean(
          document.querySelector('[data-option-key="name"] input, button[aria-label="Close"]'),
        ),
      ))
    )
      throw new Error("配置弹窗正在打开；历史只读检查不会关闭或保存用户配置，请先正常关闭弹窗");
    // The real history page mounts and requests its own tasks; the observer only reads responses.
    await this.home();
    const openedAt = await this.click("button", "查看构建记录");
    return waitFor("历史页面的任务基线", () => this.latestSnapshot(openedAt), 30_000, this.signal);
  }

  async baseline(readOnly = false): Promise<Task[]> {
    const snapshot = await this.historySnapshot(readOnly);
    if (snapshot.tasks.some((task) => ["waiting", "processing"].includes(task.state))) {
      throw new Error("当前存在活动构建任务，本轮不混入既有队列");
    }
    await this.home();
    return snapshot.tasks;
  }

  async configuration(
    platform?: Pick<Platform, "id" | "label">,
    fieldKeys: string[] = ["debug"],
    onState?: (state: ConfigurationReadiness["states"][number]) => void,
  ): Promise<Configuration> {
    await this.home();
    this.configurationGenerationValue++;
    this.expectedConfigurationTitle = platformEntry(
      platform?.id ?? "web-desktop",
    ).configurationTitle;
    const openedAt = await this.click("platform", platform?.label ?? "Web 桌面端");
    return this.readConfiguration(fieldKeys, openedAt, onState);
  }

  async openConfigurationPage(label: string, beforeInput?: () => Promise<void>): Promise<FormView> {
    await this.home(beforeInput);
    this.configurationGenerationValue++;
    await this.click("platform", label, undefined, undefined, beforeInput);
    return this.configurationPage();
  }

  async configurationPage(): Promise<FormView> {
    let previous = "";
    let stableAt = Date.now();
    return waitFor(
      "配置页字段加载稳定（允许校验提示和禁用的构建按钮）",
      async () => {
        const view = await this.cdp.dom(readForm);
        if (view.state === "no-options") throw new Error("配置加载失败：该平台暂无可配置参数");
        if (view.state !== "form") {
          previous = "";
          return undefined;
        }
        const signature = JSON.stringify(view);
        if (signature !== previous) {
          previous = signature;
          stableAt = Date.now();
          return undefined;
        }
        return Date.now() - stableAt >= 600 ? view : undefined;
      },
      this.configurationTimeoutMs,
      this.signal,
    );
  }

  async openpaasPage() {
    return waitFor(
      "OpenPaaS账号的已有游戏列表及UI联动稳定",
      async () => {
        const ui = await this.cdp.dom(readOpenpaasPage);
        const games = await this.cdp.dom(
          (document) => (document.defaultView as ProbeWindow).__pinkBuildUiProbe?.openpaasGames,
        );
        if (!ui || ui.disabled || !games) return undefined;
        if (!games.length) throw new Error("当前账号没有已有游戏；不会创建游戏");
        if (ui.ids.length !== games.length || games.some((game) => !ui.ids.includes(game.id)))
          return undefined;
        return { ...ui, games };
      },
      this.configurationTimeoutMs,
      this.signal,
    );
  }

  async selectOpenpaasGame(id: string, beforeInput?: () => Promise<void>): Promise<void> {
    const before = await this.openpaasPage();
    assertExistingGameSelectable(before, id);
    await this.click(
      "native-select",
      "packages.openpaas.appid",
      "OpenPaaS 游戏",
      undefined,
      beforeInput,
    );
    // Numeric typeahead goes directly to an existing ID. Do not traverse the create option.
    await beforeInput?.();
    await this.page.keyboard.type(id, { delay: 20 });
    await beforeInput?.();
    await this.page.keyboard.press("Enter");
    await this.page.keyboard.press("Tab");
    await waitFor(
      "已有游戏选择及代码版本联动回读",
      async () => {
        const after = await this.openpaasPage();
        const expected = after.games.find((game) => game.id === id);
        return after.id === id && expected && after.codeVersion === expected.codeVersion
          ? true
          : undefined;
      },
      this.configurationTimeoutMs,
      this.signal,
    );
  }

  async formCheckbox(key: string, value: boolean): Promise<void> {
    const before = await this.configurationPage();
    const field = before.fields.find((field) => field.key === key);
    const checkbox = field?.controls.find((control) => control.type === "checkbox");
    if (!checkbox || checkbox.disabled) throw new Error(`字段不可编辑：${key}`);
    if (checkbox.value !== value) await this.click("checkbox", key);
    const after = await this.configurationPage();
    if (
      after.fields
        .find((field) => field.key === key)
        ?.controls.find((control) => control.type === "checkbox")?.value !== value
    )
      throw new Error(`字段UI回读不一致：${key}`);
  }

  async readConfiguration(
    fieldKeys: string[],
    openedAt = Date.now(),
    onState?: (state: ConfigurationReadiness["states"][number]) => void,
    purpose: "build" | "ui" = "build",
  ): Promise<Configuration> {
    let last = "";
    let stableSince = Date.now();
    const evidence: ConfigurationReadiness = {
      openedAt,
      timeoutMs: this.configurationTimeoutMs,
      states: [],
    };
    this.readiness = evidence;
    const record = (state: string, missingField?: string, optionCount?: number) => {
      const previous = evidence.states.at(-1);
      if (
        previous?.state !== state ||
        previous?.missingField !== missingField ||
        previous?.optionCount !== optionCount
      ) {
        const entry = { at: Date.now(), state, missingField, optionCount };
        evidence.states.push(entry);
        onState?.(entry);
      }
    };
    return waitFor(
      "配置及构建按钮就绪",
      async () => {
        try {
          const snapshot = await this.cdp.dom(
            (document, fieldKeys, expectedTitle, purpose) => {
              const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
              const modal = close?.parentElement?.parentElement;
              if (!modal || modal.getClientRects().length === 0)
                return { state: "awaiting-dialog" };
              const title = close!.parentElement?.querySelector("span")?.textContent?.trim();
              if (expectedTitle && title && title !== expectedTitle)
                throw new Error(`配置页平台身份不一致：预期${expectedTitle}，实际${title}`);
              const hasPrompt = (texts: string[]) =>
                Array.from(modal.querySelectorAll<HTMLElement>("div")).some(
                  (element) =>
                    element.getClientRects().length > 0 &&
                    element.children.length === 0 &&
                    texts.includes(element.textContent?.trim() ?? ""),
                );
              if (hasPrompt(["该平台暂无可配置参数", "No options available for this platform"]))
                return { state: "no-options" };
              if (hasPrompt(["加载参数中…", "正在加载选项…", "Loading options..."]))
                return { state: "loading-options" };
              const optionCount = modal.querySelectorAll("[data-option-key]").length;
              const input = (key: string) =>
                modal.querySelector<HTMLInputElement>(`[data-option-key="${key}"] input`);
              const path = Array.from(
                modal.querySelectorAll<HTMLInputElement>('[data-option-key="buildPath"] input'),
              );
              const scene = modal
                .querySelector('[data-option-key="startScene"] button')
                ?.textContent?.trim();
              if (!input("name") || path.length !== 2 || !scene || !input("startScene")?.value)
                return {
                  state: "awaiting-fields",
                  missingField: "name/buildPath/startScene",
                  optionCount,
                };
              if (purpose === "build" && modal.querySelector('[role="alert"]'))
                return { state: "validation-error", optionCount };
              const fields: Record<string, boolean | string> = {};
              for (const key of fieldKeys) {
                const row = modal.querySelector<HTMLElement>(
                  `[data-option-key="${CSS.escape(key)}"]`,
                );
                if (!row || row.getClientRects().length === 0)
                  return { state: "awaiting-fields", missingField: key, optionCount };
                const interactive = row.querySelector<HTMLElement>(
                  '[role="checkbox"],[role="combobox"],input:not([type="hidden"]):not([type="checkbox"])',
                );
                if (
                  !interactive ||
                  interactive.getAttribute("aria-disabled") === "true" ||
                  (key !== "server" &&
                    interactive instanceof document.defaultView!.HTMLInputElement &&
                    interactive.disabled)
                )
                  return { state: "controls-disabled", missingField: key, optionCount };
                const checkbox = row.querySelector('[role="checkbox"]');
                if (checkbox) {
                  const value = checkbox.getAttribute("aria-checked");
                  if (value !== "true" && value !== "false")
                    throw new Error(`无法读取复选框：${key}`);
                  fields[key] = value === "true";
                } else {
                  const control = row.querySelector<HTMLInputElement>(
                    'input:not([type="checkbox"])',
                  );
                  if (!control) throw new Error(`无法读取字段值：${key}`);
                  fields[key] = control.value;
                }
              }
              const selectedScenes = Array.from(
                modal.querySelectorAll<HTMLInputElement>(
                  '[data-option-key="scenes"] input[type="checkbox"]:checked',
                ),
              ).map((checkbox) => {
                let parent: HTMLElement | null = checkbox.parentElement;
                while (parent && !parent.innerText.includes("db://")) parent = parent.parentElement;
                return parent?.innerText.trim() ?? "";
              });
              return {
                state: "form",
                optionCount,
                configuration: {
                  name: input("name")!.value,
                  buildPath: path[0].value,
                  outputName: path[1].value,
                  startScene: scene,
                  startSceneId: input("startScene")!.value,
                  debug: input("debug")?.checked ?? false,
                  selectedScenes,
                  fields,
                },
              };
            },
            fieldKeys,
            this.expectedConfigurationTitle,
            purpose,
          );
          if (snapshot.state !== "form" || !snapshot.configuration) {
            record(snapshot.state, snapshot.missingField, snapshot.optionCount);
            last = "";
            if (snapshot.state === "no-options")
              throw new Error("配置加载失败：页面显示该平台暂无可配置参数");
            if (snapshot.state === "validation-error")
              throw new Error("构建配置存在校验提示，停止提交");
            return undefined;
          }
          if (!(await this.point("button", "构建"))) {
            record("controls-disabled", "构建", snapshot.optionCount);
            last = "";
            return undefined;
          }
          const value = JSON.stringify(snapshot.configuration);
          if (value !== last) {
            last = value;
            stableSince = Date.now();
            record("stabilizing", undefined, snapshot.optionCount);
            return undefined;
          }
          if (Date.now() - stableSince < 600) return undefined;
          evidence.readyAt = Date.now();
          record("ready", undefined, snapshot.optionCount);
          return snapshot.configuration;
        } catch (error) {
          if (errorMessage(error).includes("CDP 请求超时：Runtime.evaluate")) {
            record("renderer-unresponsive");
            last = "";
            return undefined;
          }
          throw error;
        }
      },
      this.configurationTimeoutMs,
      this.signal,
    ).catch((error: unknown) => {
      if (this.signal.aborted) throw error;
      const state = evidence.states.at(-1);
      throw new ConfigurationReadinessError(
        `${errorMessage(error)}；配置状态：${state?.state ?? "unknown"}${state?.missingField ? `；未就绪项：${state.missingField}` : ""}`,
        evidence,
      );
    });
  }

  async closeConfiguration(beforeInput?: () => Promise<void>): Promise<void> {
    this.configurationGenerationValue++;
    if (!(await this.point("close", "Close"))) return;
    await this.click("close", "Close", undefined, undefined, beforeInput);
    await waitFor(
      "关闭配置弹窗",
      () =>
        this.cdp.dom((document) =>
          document.querySelector('[data-option-key="name"] input') ? undefined : true,
        ),
      10_000,
      this.signal,
    );
  }

  async setField(key: string, value: boolean | string): Promise<boolean> {
    if (
      key === "sourceMaps" &&
      (typeof value !== "string" || !["false", "true", "inline"].includes(value))
    )
      throw new Error("Source Map目标值无效");
    const before = await this.readConfiguration([key]);
    if (before.fields[key] === value) return false;
    if (typeof value === "boolean") await this.click("checkbox", key);
    else if (key === "server") {
      await this.click("text", key);
      await this.page.keyboard.press("ControlOrMeta+A");
      if (value) await this.page.keyboard.insertText(value);
      else await this.page.keyboard.press("Backspace");
      await this.page.keyboard.press("Tab");
    } else {
      await this.click("select", key);
      if (key === "sourceMaps")
        await this.click(
          "enum-option",
          JSON.stringify(value === "inline" ? value : value === "true"),
        );
      else await this.click("option", selectionLabel(value));
    }
    const after = await this.readConfiguration([key]);
    if (after.fields[key] !== value)
      throw new Error(
        `字段回读不一致：${key}，期望 ${JSON.stringify(value)}，实际 ${JSON.stringify(after.fields[key])}`,
      );
    return true;
  }

  async specialLayout(fields: SpecialField[]): Promise<{
    variant: "generic" | "vivo-custom";
    fields: SpecialField[];
    uiUncovered: string[];
  }> {
    if (!fields.some((field) => field.key.startsWith("packages.vivo-mini-game.")))
      return { variant: "generic", fields, uiUncovered: [] };
    const custom = await this.cdp.dom((document) => {
      if (document.querySelector('[data-option-key="packages.vivo-mini-game.package"]'))
        return false;
      const labels = Array.from(document.querySelectorAll('[data-slot="field-label"]')).map(
        (label) => label.textContent?.trim(),
      );
      if (
        !document.querySelector('input[buttontext="private.pem 路径"]') ||
        ![
          "游戏包名",
          "屏幕方向",
          "使用调试秘钥库",
          "private.pem 路径",
          "certificate.pem 路径",
        ].every((label) => labels.includes(label))
      )
        throw new Error("未知 vivo 专属表单结构");
      for (const key of ["appid", "appkey", "separateEngine"])
        if (document.querySelector(`[data-option-key="packages.vivo-mini-game.${key}"]`))
          throw new Error("vivo 自定义表单字段集合发生变化");
      return true;
    });
    if (!custom) return { variant: "generic", fields, uiUncovered: [] };
    const labels: Record<string, string> = {
      package: "游戏包名",
      deviceOrientation: "屏幕方向",
      useDebugKey: "使用调试秘钥库",
      privatePemPath: "private.pem 路径",
      certificatePemPath: "certificate.pem 路径",
    };
    const uiUncovered = fields
      .filter((field) =>
        ["appid", "appkey", "separateEngine"].includes(field.key.split(".").at(-1)!),
      )
      .map((field) => field.key);
    return {
      variant: "vivo-custom",
      uiUncovered,
      fields: fields
        .filter((field) => !uiUncovered.includes(field.key))
        .map((field) => {
          const key = field.key.split(".").at(-1)!;
          return labels[key]
            ? {
                ...field,
                uiLabel: labels[key],
                ...(key === "deviceOrientation" ? { nativeSelect: true } : {}),
              }
            : field;
        }),
    };
  }

  async expandSection(label: string, beforeInput?: () => Promise<void>): Promise<void> {
    const expanded = await this.cdp.dom((document, label) => {
      const headers = Array.from(
        document.querySelectorAll<HTMLElement>('[role="button"][tabindex]'),
      ).filter((el) => el.innerText.trim() === label && el.getClientRects().length > 0);
      if (headers.length !== 1) throw new Error(`折叠分组不唯一：${label}`);
      return Boolean(headers[0].parentElement?.querySelector("input"));
    }, label);
    if (!expanded) await this.click("section", label, undefined, undefined, beforeInput);
  }

  async setSpecialField(field: SpecialField, input?: FieldValue): Promise<boolean> {
    if (field.redact) throw new Error(`不写入私密字段：${field.key}`);
    const before = await this.readSpecialFields([field]);
    if (before[field.key] === field.expected) return false;
    if (field.type === "boolean") {
      await this.click("checkbox", field.key, field.uiLabel, field.choiceLabel);
    } else if (field.nativeSelect) {
      const index = await this.cdp.dom((document, field) => {
        const rows = field.uiLabel
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-slot="field"]')).filter(
              (row) =>
                row.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ===
                field.uiLabel,
            )
          : Array.from(
              document.querySelectorAll<HTMLElement>(
                `[data-option-key="${CSS.escape(field.key)}"]`,
              ),
            );
        if (rows.length !== 1) throw new Error(`原生下拉控件不唯一：${field.key}`);
        const options = Array.from(rows[0].querySelectorAll<HTMLOptionElement>("select option"));
        const index = options.findIndex(
          (option) => option.value === field.expected && !option.disabled,
        );
        if (index < 0) throw new Error(`原生下拉值不存在：${field.key}`);
        return index;
      }, field);
      await this.click("native-select", field.key, field.uiLabel);
      await this.page.keyboard.press("Home");
      for (let step = 0; step < index; step++) await this.page.keyboard.press("ArrowDown");
      await this.page.keyboard.press("Enter");
      await this.page.keyboard.press("Tab");
    } else {
      const combo = await this.cdp.dom(
        (document, key) =>
          Boolean(
            document.querySelector(`[data-option-key="${CSS.escape(key)}"] [role="combobox"]`),
          ),
        field.key,
      );
      if (combo) {
        await this.click("select", field.key);
        await this.click("enum-option", JSON.stringify(field.expected));
      } else {
        await this.click("text", field.key, field.uiLabel);
        await this.page.keyboard.press("ControlOrMeta+A");
        if (String(input ?? field.expected))
          await this.page.keyboard.insertText(String(input ?? field.expected));
        else await this.page.keyboard.press("Backspace");
        await this.page.keyboard.press("Tab");
      }
    }
    const after = await this.readSpecialFields([field]);
    if (after[field.key] !== field.expected)
      throw new Error(
        `专属配置回读不一致：${field.key}，期望 ${JSON.stringify(field.expected)}，实际 ${JSON.stringify(after[field.key])}`,
      );
    return true;
  }

  async readSpecialFields(fields: SpecialFieldContract[]): Promise<Record<string, FieldValue>> {
    let last = "";
    let stableSince = Date.now();
    let missingField: string | undefined;
    return waitFor(
      "专属选项基准就绪",
      async () => {
        const snapshot = await this.cdp.dom((document, fields) => {
          const values: Record<string, FieldValue> = {};
          for (const field of fields) {
            const rows = field.uiLabel
              ? Array.from(document.querySelectorAll<HTMLElement>('[data-slot="field"]')).filter(
                  (row) =>
                    row.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ===
                    field.uiLabel,
                )
              : Array.from(
                  document.querySelectorAll<HTMLElement>(
                    `[data-option-key="${CSS.escape(field.key)}"]`,
                  ),
                );
            if (rows.length > 1) throw new Error(`专属控件不唯一：${field.key}`);
            const row = rows[0];
            if (!row || row.getClientRects().length === 0) return { missingField: field.key };
            if (field.arrayChoices) {
              const selected: string[] = [];
              for (const choice of field.arrayChoices) {
                const choices = Array.from(row.querySelectorAll<HTMLLabelElement>("label")).filter(
                  (label) => label.textContent?.trim() === choice,
                );
                if (choices.length !== 1)
                  throw new Error(`数组候选控件不唯一：${field.key}/${choice}`);
                const checked = choices[0]
                  .querySelector('[role="checkbox"]')
                  ?.getAttribute("aria-checked");
                if (checked !== "true" && checked !== "false")
                  throw new Error(`数组候选不可读：${field.key}/${choice}`);
                if (checked === "true") selected.push(choice);
              }
              values[field.key] = JSON.stringify(selected.sort());
            } else if (field.type === "boolean") {
              const choices = field.choiceLabel
                ? Array.from(row.querySelectorAll<HTMLLabelElement>("label")).filter(
                    (label) => label.textContent?.trim() === field.choiceLabel,
                  )
                : [row];
              if (choices.length !== 1) throw new Error(`专属复选框标签不唯一：${field.key}`);
              const value = choices[0]
                .querySelector('[role="checkbox"]')
                ?.getAttribute("aria-checked");
              if (value !== "true" && value !== "false")
                throw new Error(`无法读取专属复选框：${field.key}`);
              values[field.key] = value === "true";
            } else if (field.nativeSelect) {
              const select = row.querySelector<HTMLSelectElement>("select");
              if (!select || select.selectedOptions.length !== 1)
                throw new Error(`无法读取专属原生下拉框：${field.key}`);
              values[field.key] = field.type === "number" ? Number(select.value) : select.value;
            } else {
              const input = row.querySelector<HTMLInputElement>('input:not([type="checkbox"])');
              if (!input) throw new Error(`无法读取专属控件：${field.key}`);
              if (field.redact)
                values[field.key] = input.value ? "[redacted:nonempty]" : "[redacted:empty]";
              else if (field.type === "number") {
                if (input.type !== "number" || !Number.isFinite(input.valueAsNumber))
                  throw new Error(`专属数字类型不一致：${field.key}`);
                values[field.key] = input.valueAsNumber;
              } else values[field.key] = input.value;
            }
          }
          return { values };
        }, fields);
        if ("missingField" in snapshot) {
          missingField = snapshot.missingField;
          last = "";
          return undefined;
        }
        for (const field of fields.filter((field) => field.minimum !== undefined)) {
          const value = snapshot.values[field.key];
          if (typeof value !== "number" || !Number.isFinite(value) || value < field.minimum!)
            throw new Error(`当前字段不满足用例前提：${field.key} >= ${field.minimum}`);
        }
        for (const field of fields.filter((field) => field.fingerprint)) {
          const value = snapshot.values[field.key];
          if (typeof value !== "string") throw new Error(`摘要字段类型不一致：${field.key}`);
          snapshot.values[field.key] = fieldFingerprint(value);
        }
        missingField = undefined;
        const key = JSON.stringify(snapshot.values);
        if (key !== last) {
          last = key;
          stableSince = Date.now();
          return undefined;
        }
        return Date.now() - stableSince >= 600 ? snapshot.values : undefined;
      },
      60_000,
      this.signal,
    ).catch((error: unknown) => {
      if (missingField) throw new Error(`${errorMessage(error)}；专属字段未显示：${missingField}`);
      throw error;
    });
  }

  async assertSpecialHidden(fields: SpecialField[]): Promise<void> {
    if (!fields.length) return;
    await waitFor(
      "条件控件隐藏",
      async () => {
        const hidden = await this.cdp.dom(
          (document, fields) =>
            fields.every((field) => {
              const rows = field.uiLabel
                ? Array.from(document.querySelectorAll<HTMLElement>('[data-slot="field"]')).filter(
                    (row) =>
                      row
                        .querySelector(':scope > [data-slot="field-label"]')
                        ?.textContent?.trim() === field.uiLabel,
                  )
                : Array.from(
                    document.querySelectorAll<HTMLElement>(
                      `[data-option-key="${CSS.escape(field.key)}"]`,
                    ),
                  );
              if (rows.length > 1) throw new Error(`条件控件不唯一：${field.key}`);
              if (!rows.length || !rows[0].getClientRects().length) return true;
              if (field.choiceLabel) {
                const choices = Array.from(
                  rows[0].querySelectorAll<HTMLLabelElement>("label"),
                ).filter((label) => label.textContent?.trim() === field.choiceLabel);
                if (choices.length > 1) throw new Error(`条件候选不唯一：${field.key}`);
                return !choices.length || !choices[0].getClientRects().length;
              }
              return false;
            }),
          fields,
        );
        return hidden ? true : undefined;
      },
      this.configurationTimeoutMs,
      this.signal,
    );
  }

  async checkMobileWebGPUHint(enabled: boolean): Promise<{
    previewProtocol: "http:" | "https:" | "unavailable";
    warningRequired: boolean;
    warningVisible: boolean;
  }> {
    let last = "";
    let stableSince = Date.now();
    return waitFor(
      "WebGPU预览提示联动",
      async () => {
        const snapshot = await this.cdp.dom((document, enabled) => {
          const row = (label: string) => {
            const rows = Array.from(
              document.querySelectorAll<HTMLElement>('[data-slot="field"]'),
            ).filter(
              (item) =>
                item.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ===
                  label && item.getClientRects().length > 0,
            );
            if (rows.length !== 1) throw new Error(`Web手机提示行不唯一：${label}`);
            return rows[0];
          };
          const qr = row("预览二维码");
          const preview = row("预览地址");
          if ([qr, preview].some((item) => item.textContent?.includes("Loading...")))
            return undefined;
          const url = preview.querySelector<HTMLAnchorElement>("a[href]")?.href;
          const protocol = url ? new URL(url).protocol : "unavailable";
          if (!["http:", "https:", "unavailable"].includes(protocol))
            throw new Error("未知预览URL协议");
          const warningRequired = enabled && protocol === "http:";
          const warningVisible =
            Boolean(
              qr.querySelector(
                'a[href="https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts"]',
              ),
            ) &&
            Boolean(qr.textContent?.includes("启用 WebGPU 时无法使用本地 HTTP 服务器在手机上预览"));
          if (warningRequired !== warningVisible) return undefined;
          return {
            previewProtocol: protocol as "http:" | "https:" | "unavailable",
            warningRequired,
            warningVisible,
          };
        }, enabled);
        if (!snapshot) {
          last = "";
          return undefined;
        }
        const key = JSON.stringify(snapshot);
        if (key !== last) {
          last = key;
          stableSince = Date.now();
          return undefined;
        }
        return Date.now() - stableSince >= 600 ? snapshot : undefined;
      },
      this.configurationTimeoutMs,
      this.signal,
    );
  }

  async successText(outputName: string, platform: string): Promise<string | undefined> {
    return this.cdp.dom(
      (document, outputName, platform, batchLabel) => {
        let scope: ParentNode = document;
        if (batchLabel) {
          const headers = [
            ...document.querySelectorAll<HTMLButtonElement>("button.pk-batch-header"),
          ].filter((header) => header.innerText.trim() === batchLabel);
          if (headers.length !== 1) throw new Error("本次成功卡片的批次无法唯一对应");
          scope = headers[0].closest('[data-slot="collapsible-section"]')!;
        }
        const cards = Array.from(scope.querySelectorAll<HTMLElement>(".pk-card-main")).filter(
          (card) =>
            Array.from(card.querySelectorAll<HTMLImageElement>("img.pk-card-icon")).some((icon) =>
              icon.src.includes(`/platforms/${platform}/`),
            ) &&
            Array.from(card.querySelectorAll("span")).some((span) =>
              span.textContent?.trim().endsWith(` - ${outputName}`),
            ),
        );
        if (cards.length > 1) throw new Error("结果页存在同名任务卡片，无法唯一复核");
        const text = cards[0]?.querySelector<HTMLElement>(".pk-card-status")?.innerText.trim();
        return text === "成功" ? text : undefined;
      },
      outputName,
      platform,
      this.revealedBatchLabel,
    );
  }

  async showHistory(): Promise<void> {
    const home = await this.cdp.dom((document) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) =>
          button.getClientRects().length > 0 && button.innerText.trim() === "查看构建记录",
      ),
    );
    if (home) await this.click("button", "查看构建记录");
  }

  async readHistory(): Promise<HistoryView> {
    return this.cdp.dom(readHistory);
  }

  async isHistoryOpen(): Promise<boolean> {
    return this.cdp.dom((document) => Boolean(document.querySelector(".pk-build-inner")));
  }

  async searchHistory(value: string): Promise<void> {
    await this.click("history-search", "历史搜索");
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    if (value) await this.page.keyboard.insertText(value);
  }

  async filterHistory(label: string): Promise<void> {
    const view = await this.readHistory();
    if (view.filter === label) {
      if (view.filterExpanded) await this.page.keyboard.press("Escape");
      return;
    }
    if (!view.filterExpanded) await this.click("history-filter", "历史筛选");
    await this.click("history-option", label);
    await waitFor(
      "历史筛选选中且菜单关闭",
      async () => {
        const current = await this.readHistory();
        return current.filter === label && !current.filterExpanded ? true : undefined;
      },
      10_000,
      this.signal,
    );
  }

  async revealTask(task: Task): Promise<void> {
    this.revealedBatchLabel = undefined;
    await this.showHistory();
    const at = task.groupCreatedAt ?? task.createdAt;
    if (at === undefined) throw new Error("本次任务缺少批次时间，无法复核 UI");
    const batch = await waitFor(
      "本次唯一记录批次",
      async () =>
        this.cdp.dom((document, at) => {
          const date = new Date(at);
          const month = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
          const day = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
          const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
            .map((part) => String(part).padStart(2, "0"))
            .join(":");
          const matches = Array.from(
            document.querySelectorAll<HTMLButtonElement>("button.pk-batch-header"),
          ).filter((button) => {
            const monthHeader = button.closest('[data-slot="collapsible-section"]')?.parentElement
              ?.parentElement?.firstElementChild;
            const labels = Array.from(button.querySelectorAll("span")).map((span) =>
              span.textContent?.trim(),
            );
            return (
              monthHeader?.textContent?.trim().startsWith(month) &&
              labels.includes(day) &&
              labels.includes(time)
            );
          });
          if (matches.length > 1) throw new Error("本次记录批次时间存在歧义，停止 UI 复核");
          const button = matches[0];
          return button
            ? {
                label: button.innerText.trim(),
                expanded: button.getAttribute("aria-expanded") === "true",
              }
            : undefined;
        }, at),
      15_000,
      this.signal,
    );
    if (!batch.expanded) await this.click("batch", batch.label);
    this.revealedBatchLabel = batch.label;
  }

  /** Tool-owned, read-only DOM inspection for reviewed case controls. */
  async caseDom<Args extends unknown[], Result>(
    fn: (document: Document, ...args: Args) => Result,
    ...args: Args
  ): Promise<Awaited<Result>> {
    return this.cdp.dom(fn, ...args);
  }

  async caseHover(selector: string, verify?: () => Promise<void>) {
    await verify?.();
    const point = await this.point("case-hover", selector);
    if (!point) throw new Error("阶段提示目标不可见或被覆盖");
    const box = await this.page.locator(`iframe[name="${this.hostName}"]`).boundingBox();
    if (!box) throw new Error("Builder Frame 不可见");
    const x = box.x + point.x,
      y = box.y + point.y;
    if (
      !(await this.page.evaluate(
        ({ x, y, name }) => document.elementFromPoint(x, y)?.getAttribute("name") === name,
        { x, y, name: this.hostName },
      ))
    )
      throw new Error("工作台覆盖阶段提示目标");
    await verify?.();
    // A new tooltip trigger may mount under the old pointer position; create a real enter.
    await this.page.mouse.move(0, 0);
    await this.page.mouse.move(x, y);
  }

  private async assertCaseKeyboardFocus(selector: string): Promise<void> {
    await waitFor(
      "构建配置控件取得键盘焦点（未发送按键）",
      async () => {
        const outer = await this.page.evaluate(
          (name) =>
            document.activeElement?.tagName === "IFRAME" &&
            document.activeElement.getAttribute("name") === name,
          this.hostName,
        );
        const inner = await this.cdp.dom((document, selector) => {
          const control = document.querySelector(selector);
          return control !== null && document.activeElement === control;
        }, selector);
        return outer && inner ? true : undefined;
      },
      3_000,
      this.signal,
    );
  }

  /** Diagnostic-only observations: no field values, document text or focus-changing actions. */
  async caseInputObservation(selector: string) {
    const outer = await this.page.evaluate(
      (name) => ({
        hasFocus: document.hasFocus(),
        visibility: document.visibilityState,
        activeTag: document.activeElement?.tagName,
        expectedFrameFocused: document.activeElement?.getAttribute("name") === name,
      }),
      this.hostName,
    );
    const inner = await this.cdp.dom((document, selector) => {
      const control = document.querySelector<HTMLElement>(selector);
      const rect = control?.getBoundingClientRect();
      return {
        hasFocus: document.hasFocus(),
        visibility: document.visibilityState,
        targetPresent: !!control,
        targetTag: control?.tagName,
        targetRole: control?.getAttribute("role"),
        targetFocused: document.activeElement === control,
        activeTag: document.activeElement?.tagName,
        targetVisible: !!control?.getClientRects().length,
        targetDisabled:
          control?.getAttribute("aria-disabled") === "true" ||
          (control as HTMLInputElement | null)?.disabled === true,
        targetHit: rect
          ? control === document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          : false,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
      };
    }, selector);
    return { capturedAt: new Date().toISOString(), outer, inner };
  }

  async caseText(
    selector: string,
    value: string,
    beforeInput?: () => Promise<void>,
  ): Promise<void> {
    let phase = "text.click";
    try {
      await this.click("case-control", selector, undefined, undefined, beforeInput);
      phase = "text.focus";
      await this.assertCaseKeyboardFocus(selector);
      phase = "text.select-all";
      await beforeInput?.();
      await this.page.keyboard.press("ControlOrMeta+A");
      phase = "text.input";
      await beforeInput?.();
      if (value) await this.page.keyboard.insertText(value);
      else await this.page.keyboard.press("Backspace");
      phase = "text.blur";
      await this.page.keyboard.press("Tab");
    } catch (cause) {
      const observations = await this.caseInputObservation(selector).catch(() => ({
        unavailable: true,
      }));
      throw new ConfigurationOperationError(
        cause instanceof ConfigurationOperationError ? cause.code : "input",
        `配置文本输入失败：${phase}（输入值已省略）`,
        cause instanceof ConfigurationOperationError ? cause.disposition : "failed",
        { cause, diagnostic: { phase, observations } },
      );
    }
  }

  async caseSelect(
    selector: string,
    index: number,
    beforeInput?: () => Promise<void>,
  ): Promise<void> {
    await this.click("case-control", selector, undefined, undefined, beforeInput);
    await this.assertCaseKeyboardFocus(selector);
    await beforeInput?.();
    await this.page.keyboard.press("Home");
    for (let i = 0; i < index; i++) await this.page.keyboard.press("ArrowDown");
    await beforeInput?.();
    await this.page.keyboard.press("Enter");
    await this.page.keyboard.press("Tab");
  }

  async close(): Promise<void> {
    this.configurationGenerationValue++;
    try {
      if (this.probeAttempted)
        await this.cdp.dom((document, owner) => {
          const window = document.defaultView as ProbeWindow;
          const probe = window.__pinkBuildUiProbe;
          if (probe && probe.owner !== owner)
            throw new Error("观察器已不属于本次运行；禁止释放其他执行器的监听");
          if (probe) window.removeEventListener("message", probe.listener);
          delete window.__pinkBuildUiProbe;
          if (window.__pinkBuildUiProbe) throw new Error("本次观察器未释放");
        }, this.probeOwner);
    } finally {
      this.cdp.close();
    }
  }
}

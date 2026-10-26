import { isDeepStrictEqual } from "node:util";
import type { CaseControl } from "./case-form.js";
import type { CaseValue } from "./finalized-cases.js";
import { ConfigurationContext, ConfigurationOperationError } from "./configuration-context.js";
import type { FormView } from "./configuration-page.js";
import { assertOpenpaasBuildReady, type OpenpaasPageState } from "./openpaas.js";
import { ConfigurationStages, type StagePort } from "./configuration-stages.js";

/** Existing UI adapters implement this port; it deliberately has no build or task mutation. */
export interface ConfigurationPort extends Partial<StagePort> {
  inspect(field: string): Promise<CaseControl | null>;
  read(field: string): Promise<CaseControl>;
  set(field: string, value: CaseValue, input?: string, enumLabel?: string): Promise<boolean>;
  restoreControl(field: string, original: CaseControl): Promise<void>;
  alerts(field: string): Promise<string[]>;
  primaryBuildEnabled(): Promise<boolean>;
  reopen(): Promise<void>;
  cancelFileChoice(field: string): Promise<void>;
  clearAllScenes?(): Promise<void>;
  ready?(): Promise<void>;
  expandSection?(label: string): Promise<void>;
  googleIcon?(file: string): Promise<void>;
  openpaasPage?(): Promise<OpenpaasPageState>;
  selectOpenpaasGame?(id: string): Promise<void>;
  configurationPage?(): Promise<FormView>;
}

export interface ConfigurationFamily {
  parent: string;
  enabled: CaseValue;
  children: string[];
}
export interface ConfigurationAssertion {
  phase: string;
  field: string;
  passed: boolean;
}

/** UI dependencies, shared by preparation and recovery rather than tied to FORM sample IDs. */
export function configurationFamilies(fields: string[]): ConfigurationFamily[] {
  const found = new Map<string, ConfigurationFamily>();
  for (const field of fields) {
    const prefix = field.startsWith("packages.")
      ? field.split(".").slice(0, 2).join(".") + "."
      : "";
    const candidates: ConfigurationFamily[] = [
      {
        parent: prefix + "useDebugKeystore",
        enabled: false,
        children: [
          "keystorePath",
          "keystorePassword",
          "keystoreAlias",
          "keystoreAliasPassword",
        ].map((key) => prefix + key),
      },
      {
        parent: prefix + "useDebugKey",
        enabled: false,
        children: [prefix + "privatePemPath", prefix + "certificatePemPath"],
      },
      {
        parent: prefix + "encrypted",
        enabled: true,
        children: [prefix + "xxteaKey", prefix + "compressZip"],
      },
      { parent: prefix + "globalAdapter", enabled: false, children: [prefix + "globalVariable"] },
      {
        parent: prefix + "resizeableActivity",
        enabled: false,
        children: [prefix + "maxAspectRatio"],
      },
      { parent: "md5Cache", enabled: true, children: ["md5CacheOptions.handleTemplateMd5Link"] },
      { parent: "binGroupConfig.enable", enabled: true, children: ["binGroupConfig.threshold"] },
      {
        parent: "packages.google-play.customIcon",
        enabled: "custom",
        children: ["packages.google-play.customIconFile"],
      },
      { parent: "nativeCodeBundleMode", enabled: "wasm", children: ["wasmCompressionMode"] },
    ];
    for (const family of candidates)
      if (family.parent === field || family.children.includes(field))
        found.set(family.parent, family);
  }
  return [...found.values()];
}

export const configurationEqual = (a: unknown, b: unknown) =>
  isDeepStrictEqual(Array.isArray(a) ? [...a].sort() : a, Array.isArray(b) ? [...b].sort() : b);

/** Raw control values stay in memory. Do not put snapshots/recovery records in public reports. */
export interface ConfigurationSnapshot {
  readonly context: ConfigurationContext;
  readonly revision: number;
  readonly fields: Readonly<Record<string, CaseControl | null>>;
  readonly button: boolean;
}
export interface ConfigurationRecord {
  readonly session: ConfigurationContext["session"];
  readonly platform: string;
  readonly initial: Map<string, CaseControl | null>;
  readonly restore: Map<string, CaseControl>;
  readonly prompts: Map<string, string[]>;
  readonly families: ConfigurationFamily[];
  readonly button?: boolean;
  mutated: boolean;
  restorationTrace: Array<{
    phase: string;
    field?: string;
    startedAt: string;
    finishedAt?: string;
    state: "running" | "passed" | "failed";
  }>;
}

/** Independently callable operations over a verified modal, without a case/profile dependency. */
export class ConfigurationOperations implements ConfigurationPort {
  private readonly records = new Set<ConfigurationRecord>();
  readonly stages: ConfigurationStages;

  constructor(
    protected contextValue: ConfigurationContext,
    protected readonly port: ConfigurationPort,
    private readonly rebind: () => Promise<ConfigurationContext>,
  ) {
    this.stages = new ConfigurationStages(
      () => this.context,
      port,
      (action) => this.mutate(action, false, false),
    );
  }

  get context(): ConfigurationContext {
    return this.contextValue;
  }

  get platform(): string {
    return this.context.platform;
  }

  check(phase: string, field: string, passed: boolean): ConfigurationAssertion {
    if (!passed)
      throw new ConfigurationOperationError(
        "assertion",
        `配置断言失败：${phase}/${field}（值已省略）`,
        "failed",
      );
    return { phase, field, passed };
  }

  private field(field: string): void {
    if (
      field.startsWith("packages.") &&
      !field.startsWith(`packages.${this.platform}.`) &&
      !field.startsWith("packages.localization-editor.")
    )
      throw new ConfigurationOperationError(
        "precondition",
        `配置字段属于其他平台：${field}`,
        "blocked",
      );
  }

  async inspect(field: string): Promise<CaseControl | null> {
    this.field(field);
    await this.context.verify();
    const control = await this.port.inspect(field);
    await this.context.verify();
    return control && structuredClone(control);
  }

  async ready(): Promise<void> {
    if (!this.port.ready)
      throw new ConfigurationOperationError("precondition", "缺少配置联动就绪适配", "blocked");
    await this.context.verify();
    await this.port.ready();
    await this.context.verify();
  }

  async expandSection(label: string): Promise<void> {
    if (!this.port.expandSection)
      throw new ConfigurationOperationError("precondition", "缺少配置分组展开适配", "blocked");
    await this.context.verify();
    await this.port.expandSection(label);
    await this.context.verify();
  }

  async googleIcon(file: string): Promise<void> {
    if (this.platform !== "google-play" || !this.port.googleIcon)
      throw new ConfigurationOperationError(
        "precondition",
        "Google 图标操作缺少对应平台适配",
        "blocked",
      );
    // Capture the exposed original file before the existing adapter replaces it.
    await this.set("packages.google-play.customIcon", "custom");
    await this.mutate(() => this.port.googleIcon!(file));
  }

  async openpaasPage(): Promise<OpenpaasPageState> {
    if (this.platform !== "openpaas" || !this.port.openpaasPage)
      throw new ConfigurationOperationError(
        "precondition",
        "缺少 OpenPaaS 已有游戏观察适配",
        "blocked",
      );
    await this.context.verify();
    const result = await this.port.openpaasPage();
    await this.context.verify();
    return result;
  }

  async selectOpenpaasGame(id: string): Promise<void> {
    if (this.platform !== "openpaas" || !this.port.selectOpenpaasGame)
      throw new ConfigurationOperationError(
        "precondition",
        "缺少 OpenPaaS 已有游戏选择适配",
        "blocked",
      );
    await this.mutate(() => this.port.selectOpenpaasGame!(id));
  }

  async assertOpenpaasReady() {
    if (!this.port.configurationPage)
      throw new ConfigurationOperationError(
        "precondition",
        "缺少 OpenPaaS 必填项页面观察",
        "blocked",
      );
    await this.context.verify();
    const result = assertOpenpaasBuildReady(
      await this.port.configurationPage(),
      await this.openpaasPage(),
    );
    await this.context.verify();
    return result;
  }

  async read(field: string): Promise<CaseControl> {
    this.field(field);
    await this.context.verify();
    const control = await this.port.read(field);
    await this.context.verify();
    return structuredClone(control);
  }

  async alerts(field: string): Promise<string[]> {
    this.field(field);
    await this.context.verify();
    const alerts = await this.port.alerts(field);
    await this.context.verify();
    return [...alerts];
  }

  async primaryBuildEnabled(): Promise<boolean> {
    await this.context.verify();
    const enabled = await this.port.primaryBuildEnabled();
    await this.context.verify();
    return enabled;
  }

  async snapshot(fields: string[]): Promise<ConfigurationSnapshot> {
    await this.context.verify();
    const context = this.context,
      revision = context.revision;
    const values: Record<string, CaseControl | null> = {};
    for (const field of fields) values[field] = await this.inspect(field);
    const snapshot = {
      context,
      revision,
      fields: values,
      button: await this.primaryBuildEnabled(),
    };
    await this.assertSnapshotCurrent(snapshot);
    return snapshot;
  }

  async assertSnapshotCurrent(snapshot: ConfigurationSnapshot): Promise<void> {
    await this.context.verify();
    if (snapshot.context !== this.context || snapshot.revision !== this.context.revision)
      throw new ConfigurationOperationError("snapshot", "配置快照已过期，必须重新回读", "stop");
    for (const [field, original] of Object.entries(snapshot.fields)) {
      const actual = await this.inspect(field);
      if (
        original === null
          ? actual !== null
          : actual === null ||
            !configurationEqual(actual.value, original.value) ||
            actual.kind !== original.kind ||
            actual.disabled !== original.disabled ||
            actual.protocol !== original.protocol
      )
        throw new ConfigurationOperationError(
          "snapshot",
          "配置回读后页面值或控件状态发生变化，停止使用旧快照",
          "stop",
        );
    }
    if (snapshot.button !== (await this.primaryBuildEnabled()))
      throw new ConfigurationOperationError("snapshot", "配置回读后构建按钮状态发生变化", "stop");
  }

  async assertValues(
    snapshot: ConfigurationSnapshot,
    expected: Record<string, CaseValue>,
  ): Promise<ConfigurationAssertion[]> {
    await this.assertSnapshotCurrent(snapshot);
    return Object.entries(expected).map(([field, value]) =>
      this.check(
        "readback",
        field,
        !!snapshot.fields[field] && configurationEqual(snapshot.fields[field]!.value, value),
      ),
    );
  }

  async assertPrompt(
    field: string,
    expected: { kind: "none" | "contains"; text?: string },
  ): Promise<ConfigurationAssertion> {
    if (expected.kind === "contains" && !expected.text)
      throw new ConfigurationOperationError("precondition", "提示断言缺少预期文本", "blocked");
    const prompts = await this.alerts(field);
    return this.check(
      "prompt",
      field,
      expected.kind === "none"
        ? prompts.length === 0
        : prompts.some((p) => p.toLowerCase().includes(expected.text!.toLowerCase())),
    );
  }

  async assertState(
    field: string,
    expected: { visible?: boolean; disabled?: boolean },
  ): Promise<ConfigurationAssertion[]> {
    const control = await this.inspect(field),
      results: ConfigurationAssertion[] = [];
    if (expected.visible !== undefined)
      results.push(this.check("visible", field, !!control === expected.visible));
    if (expected.disabled !== undefined)
      results.push(
        this.check("disabled", field, !!control && control.disabled === expected.disabled),
      );
    return results;
  }

  async record(
    fields: string[],
    families = configurationFamilies(fields),
    button?: boolean,
  ): Promise<ConfigurationRecord> {
    const initial = new Map<string, CaseControl | null>(),
      restore = new Map<string, CaseControl>(),
      prompts = new Map<string, string[]>();
    for (const field of new Set([
      ...fields,
      ...families.flatMap((f) => [f.parent, ...f.children]),
    ])) {
      const control = await this.inspect(field);
      initial.set(field, control);
      if (control) {
        restore.set(field, structuredClone(control));
        prompts.set(field, await this.alerts(field));
      }
    }
    const record: ConfigurationRecord = {
      session: this.context.session,
      platform: this.platform,
      initial,
      restore,
      prompts,
      families: structuredClone(families),
      button: button ?? (await this.primaryBuildEnabled()),
      mutated: false,
      restorationTrace: [],
    };
    this.records.add(record);
    return record;
  }

  async captureExposed(record: ConfigurationRecord): Promise<void> {
    this.assertRecord(record);
    for (const [field, original] of record.initial) {
      if (original !== null || record.restore.has(field)) continue;
      const exposed = await this.inspect(field);
      if (exposed) record.restore.set(field, exposed);
    }
  }

  /** Runs one existing UI mutation. An attempted write invalidates snapshots even if it throws. */
  protected async mutate<T>(
    action: () => Promise<T>,
    rebindAfter = false,
    tracksFields = true,
  ): Promise<T> {
    if (tracksFields) for (const record of this.records) await this.captureExposed(record);
    const context = this.context;
    await context.verify();
    context.beginMutation();
    if (tracksFields) for (const record of this.records) record.mutated = true;
    let result: T;
    try {
      result = await action();
    } finally {
      context.endMutation();
    }
    if (rebindAfter) this.contextValue = await this.rebind();
    await this.context.verify();
    if (tracksFields) for (const record of this.records) await this.captureExposed(record);
    return result;
  }

  async set(field: string, value: CaseValue, input?: string, enumLabel?: string): Promise<boolean> {
    this.field(field);
    return this.mutate(() => this.port.set(field, value, input, enumLabel));
  }

  async restoreControl(field: string, original: CaseControl): Promise<void> {
    this.field(field);
    await this.mutate(() => this.port.restoreControl(field, structuredClone(original)));
  }

  async cancelFileChoice(field: string): Promise<void> {
    this.field(field);
    // The existing file adapter may reopen the modal to regain focus.
    await this.mutate(() => this.port.cancelFileChoice(field), true);
  }

  async clearAllScenes(): Promise<void> {
    if (!this.port.clearAllScenes)
      throw new ConfigurationOperationError("precondition", "场景全不选操作未适配", "blocked");
    await this.mutate(() => this.port.clearAllScenes!());
  }

  async reopen(): Promise<void> {
    await this.context.verify();
    this.context.invalidate();
    await this.port.reopen();
    this.contextValue = await this.rebind();
  }

  private assertRecord(record: ConfigurationRecord): void {
    if (record.session !== this.context.session || record.platform !== this.platform)
      throw new ConfigurationOperationError("context", "恢复记录不属于当前会话或平台", "stop");
  }

  /** Carry a case-owned recovery record into a verified reopening of the same platform. */
  async continueRecord(record: ConfigurationRecord): Promise<void> {
    this.assertRecord(record);
    await this.context.verify();
    this.records.add(record);
  }

  async restore(
    record: ConfigurationRecord,
    check: (phase: string, field: string, passed: boolean) => void = this.check.bind(this),
    reopen = false,
  ): Promise<void> {
    let phase = "verify-context",
      field: string | undefined;
    const stage = async <T>(
      nextPhase: string,
      nextField: string | undefined,
      action: () => Promise<T>,
    ): Promise<T> => {
      phase = nextPhase;
      field = nextField;
      const entry: ConfigurationRecord["restorationTrace"][number] = {
        phase,
        field,
        startedAt: new Date().toISOString(),
        state: "running",
      };
      record.restorationTrace.push(entry);
      try {
        const value = await action();
        entry.state = "passed";
        return value;
      } catch (error) {
        entry.state = "failed";
        throw error;
      } finally {
        entry.finishedAt = new Date().toISOString();
      }
    };
    const restoreField = (key: string) =>
      stage("restore-input", key, () => this.restoreControl(key, record.restore.get(key)!));
    try {
      this.assertRecord(record);
      await stage("verify-context", undefined, () => this.context.verify());
      this.records.delete(record);
      const restored = new Set<string>();
      // A changed physics/preset can expose native controls that the original preset hides.
      // Restore those observed values while they are still reachable, before switching back.
      const native = ["nativeCodeBundleMode", "wasmCompressionMode"];
      if (
        record.mutated &&
        native.some((key) => record.initial.get(key) === null && record.restore.has(key))
      ) {
        if (
          record.restore.has("wasmCompressionMode") &&
          record.initial.get("wasmCompressionMode") === null
        ) {
          await stage("expose-native-before-preset", "nativeCodeBundleMode", () =>
            this.set("nativeCodeBundleMode", "wasm"),
          );
          await this.ready();
          await restoreField("wasmCompressionMode");
          restored.add("wasmCompressionMode");
        }
        if (
          record.restore.has("nativeCodeBundleMode") &&
          record.initial.get("nativeCodeBundleMode") === null
        ) {
          await restoreField("nativeCodeBundleMode");
          restored.add("nativeCodeBundleMode");
        }
      }
      if (record.mutated && record.restore.has("engineModulesConfigKey")) {
        const presetFields = [
          "engineModulesConfigKey",
          "overwriteProjectSettings.includeModules.physics",
          "overwriteProjectSettings.includeModules.physics-2d",
          "overwriteProjectSettings.includeModules.gfx-webgl2",
          "overwriteProjectSettings.macroConfig.cleanupImageCache",
        ];
        for (const key of presetFields.slice(1))
          if (record.initial.get(key) === null && record.restore.has(key)) {
            await restoreField(key);
            await this.ready();
            restored.add(key);
          }
        for (const key of presetFields)
          if (record.restore.has(key) && !restored.has(key)) {
            await restoreField(key);
            await this.ready();
            restored.add(key);
          }
      }
      const restoreDebugLast =
        record.mutated &&
        record.restore.has("debug") &&
        record.families.some(
          (family) =>
            family.parent.endsWith(".encrypted") &&
            family.children.some((field) => record.restore.has(field)),
        );
      if (restoreDebugLast)
        await stage("unlock-encryption", "debug", () => this.set("debug", false));
      // The current initial scene is mandatory in the scene selection UI. Restore it first.
      if (record.mutated && record.restore.has("startScene")) {
        await restoreField("startScene");
        restored.add("startScene");
      }
      if (record.mutated && record.restore.has("mainBundleCompressionType")) {
        for (const field of ["mainBundleCompressionType", "mainBundleIsRemote"])
          if (record.restore.has(field)) {
            await restoreField(field);
            restored.add(field);
          }
      }
      for (const family of record.mutated ? record.families : []) {
        if (!record.restore.has(family.parent) || restored.has(family.parent)) continue;
        const children = family.children.filter(
          (field) => record.restore.has(field) && !restored.has(field),
        );
        if (!children.length) continue;
        await stage("enable-parent", family.parent, () => this.set(family.parent, family.enabled));
        for (const child of children) {
          await restoreField(child);
          phase = "verify-child";
          field = child;
          check(
            "restore-child-value",
            child,
            configurationEqual((await this.read(child)).value, record.restore.get(child)!.value),
          );
          restored.add(child);
        }
      }
      for (const key of record.mutated ? [...record.restore.keys()].reverse() : [])
        if (!restored.has(key) && (!restoreDebugLast || key !== "debug")) await restoreField(key);
      if (restoreDebugLast) await restoreField("debug");
      if (record.mutated && reopen) await stage("reopen", undefined, () => this.reopen());
      for (const [key, original] of record.initial) {
        field = key;
        phase = "verify-restored-control";
        const actual = await this.inspect(field);
        check(
          "restore-control",
          field,
          original === null
            ? actual === null
            : actual !== null &&
                configurationEqual(actual.value, original.value) &&
                actual.disabled === original.disabled &&
                actual.kind === original.kind,
        );
        if (original?.protocol)
          check("restore-path-protocol", field, actual?.protocol === original.protocol);
        if (original)
          check(
            "restore-prompts",
            field,
            configurationEqual(
              (await this.alerts(field)).sort(),
              [...(record.prompts.get(field) ?? [])].sort(),
            ),
          );
      }
      if (record.button !== undefined)
        await stage("verify-build-button", "build", async () =>
          check(
            "restore-build-button",
            "build",
            (await this.primaryBuildEnabled()) === record.button,
          ),
        );
    } catch (error) {
      if (error instanceof ConfigurationOperationError && error.disposition === "stop") {
        error.recovery = { phase, field };
        throw error;
      }
      throw new ConfigurationOperationError(
        "restore",
        "条件用例配置恢复失败；停止后续提交，保留当前现场",
        "stop",
        { cause: error, recovery: { phase, field } },
      );
    }
  }
}

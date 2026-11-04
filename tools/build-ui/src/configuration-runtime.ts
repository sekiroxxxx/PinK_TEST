import type { Builder } from "./builder.js";
import { CaseForm } from "./case-form.js";
import { ConfigurationOperationError, type ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations } from "./configuration-operations.js";
import { platformEntry } from "./platform-catalog.js";
import type { FormView } from "./configuration-page.js";
import type { ConfigurationTarget } from "./configuration-targets.js";
import { configurationUiTitles } from "./builder-ui-labels.js";
import type { BuildStep } from "./build-steps-contract.js";

/** Thin binding to existing Playwright adapters. No startup, build, SDK or preference writes. */
export class BuilderConfiguration extends ConfigurationOperations {
  private constructor(
    context: ConfigurationOperations["context"],
    private readonly adapter: CaseForm,
    rebind: () => Promise<ConfigurationOperations["context"]>,
  ) {
    super(context, adapter, rebind);
  }

  static async open(
    builder: Builder,
    session: ExecutionContext,
    platformId: string,
    signal: AbortSignal,
    target?: ConfigurationTarget,
    cardLabel?: string,
  ): Promise<BuilderConfiguration> {
    if (target && target.id !== platformId)
      throw new ConfigurationOperationError("context", "平台描述与请求平台不一致", "stop");
    const platform = target ?? platformEntry(platformId);
    const titles = target
      ? [platform.configurationTitle!]
      : configurationUiTitles(platformId, platform.configurationTitle!);
    const bind = async (view?: FormView) => {
      await session.verify();
      const page = view ?? (await builder.configurationPage());
      if (!titles.includes(page.title))
        throw new ConfigurationOperationError("context", "配置页平台身份不一致", "stop");
      const identity = await builder.configurationIdentity();
      if (identity.title !== page.title)
        throw new ConfigurationOperationError("context", "绑定时配置页身份发生变化", "stop");
      return session.bind(
        platformId,
        page.title,
        builder.configurationGeneration,
        () => builder.configurationIdentity(),
        identity.instance,
      );
    };
    await session.verify();
    const page = await builder.openConfigurationPage(cardLabel ?? platform.label, () =>
      session.verify(),
    );
    let configuration: BuilderConfiguration;
    const adapter = new CaseForm(
      builder,
      platformId,
      signal,
      () => configuration.context.verify(),
      () => session.verify(),
      target,
    );
    configuration = new BuilderConfiguration(await bind(page), adapter, bind);
    // Opening binds card -> modal identity. Field existence is a separate explicit observation.
    return configuration;
  }

  async ready(): Promise<void> {
    await this.context.verify();
    await this.adapter.builder.configurationPage();
    await this.context.verify();
  }

  async checkCapabilities(steps: readonly BuildStep[]) {
    await this.context.verify();
    const checks = await this.adapter.checkCapabilities(steps);
    await this.context.verify();
    return checks;
  }

  async expandSection(label: string): Promise<void> {
    await this.context.verify();
    await this.adapter.builder.expandSection(label, () => this.context.verify());
    await this.context.verify();
  }

  async googleIcon(file: string): Promise<void> {
    await super.googleIcon(file);
  }

  async openpaasPage() {
    return super.openpaasPage();
  }

  async selectOpenpaasGame(id: string): Promise<void> {
    await super.selectOpenpaasGame(id);
  }

  async close(): Promise<void> {
    await this.context.verify();
    this.context.invalidate();
    await this.adapter.builder.closeConfiguration(() => this.context.session.verify());
  }
}

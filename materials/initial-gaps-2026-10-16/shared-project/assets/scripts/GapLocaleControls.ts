import {
  _decorator,
  Button,
  Component,
  Label,
  ResolutionPolicy,
  view,
} from 'cc';
import { l10n, L10nLabel } from 'db://localization-editor/l10n';

const { ccclass, property } = _decorator;

@ccclass('GapLocaleControls')
export class GapLocaleControls extends Component {
  @property(Button)
  sourceButton: Button = null!;

  @property(Button)
  targetButton: Button = null!;

  @property(Button)
  excludedButton: Button = null!;

  @property(Label)
  statusLabel: Label = null!;

  @property(Label)
  completeLabel: Label = null!;

  @property(Label)
  missingLabel: Label = null!;

  protected onLoad(): void {
    view.setDesignResolutionSize(1280, 720, ResolutionPolicy.SHOW_ALL);
  }

  protected onEnable(): void {
    this.sourceButton.node.on(Button.EventType.CLICK, this.useSource, this);
    this.targetButton.node.on(Button.EventType.CLICK, this.useTarget, this);
    this.excludedButton.node.on(Button.EventType.CLICK, this.useExcluded, this);
  }

  protected onDisable(): void {
    this.sourceButton.node.off(Button.EventType.CLICK, this.useSource, this);
    this.targetButton.node.off(Button.EventType.CLICK, this.useTarget, this);
    this.excludedButton.node.off(
      Button.EventType.CLICK,
      this.useExcluded,
      this,
    );
  }

  protected async start(): Promise<void> {
    try {
      // Read the real plugin resource list and bundle. No locale, fallback or resource override.
      await l10n.createIntl({});
      if (!this.isValid) return;
      this.renderStatus();
    } catch (error) {
      if (this.isValid)
        this.statusLabel.string = `L10N init error: ${String(error)}`;
      console.error(error);
    }
  }

  private useSource(): void {
    void this.switchTo('zh-Hans');
  }
  private useTarget(): void {
    void this.switchTo('en');
  }
  private useExcluded(): void {
    void this.switchTo('zh-Hant');
  }

  private async switchTo(locale: string): Promise<void> {
    try {
      if (!l10n.isInitialized())
        throw new Error('L10N Runtime is not initialized');
      // A packaged build may restart the game through the real Runtime API.
      await l10n.changeLanguage(locale);
      if (this.isValid) this.renderStatus();
    } catch (error) {
      if (this.isValid)
        this.statusLabel.string = `L10N switch error: ${String(error)}`;
      console.error(error);
    }
  }

  private renderStatus(): void {
    if (!l10n.isInitialized()) {
      this.statusLabel.string = 'L10N Runtime is not initialized';
      return;
    }
    this.completeLabel.getComponent(L10nLabel)!.render();
    this.missingLabel.getComponent(L10nLabel)!.render();
    this.statusLabel.string = `Runtime locale: ${l10n.currentLanguage}; available: ${l10n.languages.join(', ')}`;
  }
}

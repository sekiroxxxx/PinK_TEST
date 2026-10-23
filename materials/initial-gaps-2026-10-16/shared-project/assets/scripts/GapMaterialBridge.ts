import {
  _decorator,
  Button,
  Component,
  director,
  JsonAsset,
  Label,
  resources,
} from 'cc';
import { BUILD_INPUT_MARKER } from './BuildInput';

const { ccclass, property } = _decorator;

@ccclass('GapMaterialBridge')
export class GapMaterialBridge extends Component {
  @property
  destinationScene = '';

  @property(Button)
  navigationButton: Button = null!;

  @property(Button)
  resourceButton: Button = null!;

  @property(Label)
  statusLabel: Label = null!;

  protected onEnable(): void {
    this.navigationButton.node.on(Button.EventType.CLICK, this.navigate, this);
    this.resourceButton.node.on(
      Button.EventType.CLICK,
      this.readResource,
      this,
    );
    this.statusLabel.string = BUILD_INPUT_MARKER;
  }

  protected onDisable(): void {
    this.navigationButton.node.off(Button.EventType.CLICK, this.navigate, this);
    this.resourceButton.node.off(
      Button.EventType.CLICK,
      this.readResource,
      this,
    );
  }

  private navigate(): void {
    this.navigationButton.interactable = false;
    director.loadScene(this.destinationScene, (error) => {
      if (error && this.isValid) {
        this.navigationButton.interactable = true;
        this.statusLabel.string = `Scene load error: ${error.message}`;
        console.error(error);
      }
    });
  }

  private readResource(): void {
    this.resourceButton.interactable = false;
    this.statusLabel.string = 'Loading resources/repair-target.json';
    resources.release('repair-target', JsonAsset);
    resources.load('repair-target', JsonAsset, (error, asset) => {
      if (!this.isValid) return;
      this.resourceButton.interactable = true;
      if (error) {
        this.statusLabel.string = `Resource load error: ${error.message}`;
        console.error(error);
        return;
      }
      this.statusLabel.string = JSON.stringify(asset.json);
    });
  }
}

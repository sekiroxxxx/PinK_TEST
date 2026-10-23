import {
  _decorator,
  Component,
  Label,
  Node,
  ResolutionPolicy,
  Vec3,
  tween,
  view,
} from 'cc';

const { ccclass, property } = _decorator;

const TARGET_POSITIONS = [
  new Vec3(0, -34, 0),
  new Vec3(250, 72, 0),
  new Vec3(-260, 60, 0),
  new Vec3(190, -122, 0),
  new Vec3(-180, -130, 0),
];

@ccclass('ClickGame')
export class ClickGame extends Component {
  @property(Label)
  scoreLabel: Label = null!;

  @property(Node)
  target: Node = null!;

  @property(Node)
  resetButton: Node = null!;

  private score = 0;

  protected onLoad(): void {
    view.setDesignResolutionSize(1280, 720, ResolutionPolicy.SHOW_ALL);
  }

  protected onEnable(): void {
    if (!this.scoreLabel || !this.target || !this.resetButton) {
      console.error('[ClickGame] Assign Score Label, Target, and Reset Button in the GameController Inspector before running the scene.');
      this.enabled = false;
      return;
    }

    this.target.on(Node.EventType.TOUCH_END, this.onTargetClicked, this);
    this.resetButton.on(Node.EventType.TOUCH_END, this.resetGame, this);
  }

  protected start(): void {
    this.resetGame();
  }

  protected onDisable(): void {
    this.target?.off(Node.EventType.TOUCH_END, this.onTargetClicked, this);
    this.resetButton?.off(Node.EventType.TOUCH_END, this.resetGame, this);
  }

  private onTargetClicked(): void {
    this.score += 1;
    this.scoreLabel.string = `Score: ${this.score}`;
    const nextPosition = TARGET_POSITIONS[this.score % TARGET_POSITIONS.length] ?? TARGET_POSITIONS[0];
    tween(this.target)
      .to(0.08, { scale: new Vec3(1.16, 1.16, 1) })
      .to(0.12, { scale: Vec3.ONE })
      .call(() => this.target.setPosition(nextPosition))
      .start();
  }

  private resetGame(): void {
    this.score = 0;
    this.scoreLabel.string = 'Score: 0';
    this.target.setScale(Vec3.ONE);
    this.target.setPosition(TARGET_POSITIONS[0]);
  }
}

# PinK 四组缺失材料 · macOS 交接

准备日期：2026-10-16。状态：**文件已准备，未在 PinK 中导入、预览或构建验证**。本包只补 P04、B02/B03、B07、R08 的材料；首轮 38 条、条件补测 24 条不变。完整操作和通过合同仍以 `PinK-Test/docs/pink-regression-cases.md` 为准；交付包附带 `references/pink-regression-cases.md`、材料方案及原始使用报告快照，便于 macOS 集中接收，不另维护第二套用例。

两轮历史结果和原失败预期保持原记录；本包不是新一轮结果。R07 删除现场、原 PNG/meta 备份及 B09 取消状态失败均未处理。

## 文件组成与共用方式

```text
initial-gaps-2026-10-16/
  shared-project/                  独立共享工程，初始无故障输入
    assets/main.scene              原有最小游戏场景，仅适配背景缺失引用
    assets/gap-a.scene             往返入口 A；也供 B07、R08 使用
    assets/gap-b.scene             往返目的 B，带返回 A 按钮
    assets/l10n-control.scene      真 L10N 文本、语言切换及状态
    assets/scripts/BuildInput.ts   健康构建输入
    localization-editor/translate-data/  三语言 Catalog 与 index
  inputs/
    build-failure/fault/BuildInput.ts
    build-failure/healthy/BuildInput.ts
    resource-repair/invalid/repair-target.json
    resource-repair/valid/repair-target.json
  material-identities.json         新工程/场景/组件/节点/Key 身份及来源
  source-assets.sha256.json        复用资产及 meta 的原件哈希
```

共用同一工程原件，按状态冲突派生工作副本即可，不需准备四套独立工程。P04 和 R08 可使用 `gap-a`/`gap-b`；B02/B03 使用单独的 `l10n-control` 场景，避免与小游戏行为混杂；B07 只在临时工作副本替换一个脚本。L10N 构建配置、任务历史、浏览器语言偏好由后续真实操作产生，本包没有预置成功任务或产物。

`shared-project` 不含 `library`、`temp`、`build`、`profiles`、`.pink`、旧扩展或 `node_modules`，也未复制账号/服务配置。故障件位于工程根目录之外，不会进入正常资产扫描。R08 的目标 `assets/resources/repair-target.json` 初始不存在。

## 来源与版本边界

- 实际复用 `D:/PinK-test/pink-game-demo-main/pink-game-demo-main` 的全部 `assets`、配对 meta、`ClickGame.ts`、`tsconfig.json` 及仅有版本字段的 `engine.json`/`project.json`。原工程文件保持不变。材料副本的图片、动画、脚本和 meta 保持原字节；原场景背景引用的 `7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941` 在源资产中不存在，副本 `main.scene` 和三个派生场景仅将该背景引用改为已有的 `rounded-panel` SpriteFrame。适配值记录在 `material-identities.json`，不把源工程已有问题带入健康材料。
- 三个补充场景沿用该工程的 Camera、Canvas、UITransform、Label 和按钮结构，补持久化按钮、文本节点及两份小业务组件；没有在 Runtime 自动补建缺失节点。
- 工程另设 UUID 和 PinK 工程 UUID。`creator.version: 3.8.8`、`pink.version: 1.127.0` 继承模板描述，**不是本包已在 Creator 3.8.8 或某版 PinK 上运行的证据，也不指定 macOS Host SDK**。Mac 使用后续批准的实际应用和 SDK，另记版本批次；本轮没有迁移或验证引擎兼容性。
- Catalog 路径和结构对照 `D:/PinK-test/l10n_007` 及当前 `pink-localization-editor` 的 Catalog repository；数据重新准备，不带入原项目译文或其他配置。
- L10N 调用与组件 UUID 对照当前源码 `pink-localization-editor/static/assets/l10n.ts`、`core/l10n-manager.ts`、`components/l10n-label.ts(.meta)`。工程通过 `db://localization-editor/l10n` 消费 **macOS 目标 PinK 随包 Runtime**，没有捆绑或安装另一版本 Runtime。源码对应的合同、组件身份在目标安装包上的兼容性尚未实机核对。
- 另外只读核对本机 Windows `PinK-win32-x64-2610121218-0.0.1.39` 随包 Runtime 文件，所用导出、方法/属性及 `L10nLabel` UUID 均存在且一致；没有启动该应用。这不能替代 macOS 目标包的实际挂载与运行证据。
- JSON 无效件对照当前 CLI 的 `src/core/assets/asset-handler/assets/json.ts`：导入时使用 JSON5 或 JSON 解析，缺失值对两者均无效。源码说明了预期错误位置，不能代替目标实包的导入错误证据。

## 四组材料的使用约定

以下是材料定位与初态说明，**本次不执行**；以后获准验证时结合原用例操作，不据此扩展测试数量。

### 1. 场景往返：P04

入口 `assets/gap-a.scene`，目的 `assets/gap-b.scene`。两者分别显示 `Scene GAP-A` / `Scene GAP-B`，持久化按钮 `Canvas/NavigationButton` 分别指向 `gap-b` / `gap-a`，调用真实 `director.loadScene`。

后续浏览器预览须让两场景可被加载；Web 构建时在面板纳入两场景并选择 A 作为入口，不能仅构建 A。游戏内依次点击 `Go to GAP-B`、`Go to GAP-A`。每个场景都可点击粉色目标使 `Score: 0 → 1`，点击 `Restart` 回到 0；切场景重新创建该场景，计数重新从 0 开始。本材料不规定跨场景保留计数，也不要求编辑器树跟随 Runtime。

导航失败会显示实际 `Scene load error`，不会自动重建目的场景或把失败伪装成返回成功。资源和交互仍需后续观察，文件存在不等于 P04 通过。

### 2. L10N 对照：B02/B03

入口 `assets/l10n-control.scene`；源语言 S=`zh-Hans`，目标 T=`en`，排除对照 U=`zh-Hant`。工程级 L10N 已启用，源语言已保存；平台构建选项尚未保存。这不是 B04 的全新配置材料，不拿它补验 B04。

| 可见节点              | Key                                    | zh-Hans                | en                    | zh-Hant                |
| --------------------- | -------------------------------------- | ---------------------- | --------------------- | ---------------------- |
| `Canvas/CompleteText` | `48c19f3a-60a9-4aab-8a41-31fa053b1f01` | `ZH_COMPLETE_完整对照` | `EN_COMPLETE_Control` | `TW_COMPLETE_排除對照` |
| `Canvas/MissingText`  | `48c19f3a-60a9-4aab-8a41-31fa053b1f02` | `ZH_FALLBACK_缺译回退` | **整个条目不存在**    | `TW_FALLBACK_排除對照` |

两个可见文本节点已保存真实 `L10nLabel` 绑定；index 记录场景/节点关联。`GapLocaleControls` 仅调用 `l10n.createIntl({})` 读取插件资源，以及用户按钮触发的 `changeLanguage`；初始化不传语言、回退或资源覆盖，不自动收集、翻译、补 Key 或写构建配置。`RuntimeStatus` 显示真实当前语言及可用语言列表。

以后验证 Web 构建时，通过面板选择 S/T、排除 U、默认 T、回退 S，并使用隔离浏览器存储，避免历史语言偏好覆盖首次默认值。首次应显示英文完整对照和中文缺译回退；`Switch: zh-Hans` / `Switch: en` 走真实 Runtime 切换，构建 Runtime 可以按其合同重启游戏，重启后继续核对语言与两文本。`Try: zh-Hant` 用于观察未打包语言不能切入；它不是业务翻译替代入口。

第三语言排除须另看真实任务语言配置、产物资源清单及有效数据。代码里出现按钮的 `zh-Hant` 字面量并不代表该语言数据已打包，也不能只凭画面或按钮状态认定排除成功。

**不要在 B03 前执行重新收集或全量翻译**，以免主动补齐缺 Key。若目标插件在打开、保存或编译时自动补齐，保留前后文件和实际结果，按材料/合同问题记录；不要改编译器或产物来伪造缺译。文件中 index 的空值只用于索引，目标英文是条目缺失，不是空字符串。

### 3. 构建失败与恢复：B07

健康输入 `shared-project/assets/scripts/BuildInput.ts`；故障和修复原件在 `inputs/build-failure/{fault,healthy}/BuildInput.ts`。`gap-a`/`gap-b` 已挂载 `GapMaterialBridge`，它实际导入该模块，并将导出的标记写到 `Canvas/MaterialStatus`，保证是业务入口依赖。

故障内容为 `export const BUILD_INPUT_MARKER: string = ;`，预期出现与 `BuildInput.ts` 缺少表达式相关的脚本解析/编译错误；具体诊断文案、导入时先报错还是 Builder 中报错，需记录目标实包行为，当前没有实际失败阶段或首错截图。

以后执行时，在临时工作副本中仅把 fault 文件的**内容**替换到上述工程内原路径，保留 `BuildInput.ts.meta`。等待目标处理更新，再通过 UI 提交 `web-desktop`，入口 `gap-a`，场景包含 A/B，记录任务 ID、终态、阶段和首个相关错误。保留失败证据后用 healthy 内容恢复同一路径及原 meta，等待真实更新，再提交新任务并运行，核对场景身份、`BUILD_INPUT_HEALTHY` 和交互。

若目标构建用了旧缓存仍成功，或只有导入警告而任务未失败，则 **B07 失败阶段未成立**，不能以故障文本存在、普通警告、主动取消或 Runtime 运行异常代替。保留现场后再判断材料是否需适配，本包未宣称已证实能触发目标版本的致命构建失败。不要预先清缓存、改产品构建器或制造假任务。

### 4. 无效资源与修复：R08

无效件 `inputs/resource-repair/invalid/repair-target.json` 内容 `{"message": }`；有效件位于 `valid` 同名文件，内容为 `{"message":"RESOURCE_REPAIRED","value":42}`。两者同为 `.json`，目标固定为工作副本的 `assets/resources/repair-target.json`，不是修复时另换一个名字。

以后先把无效件真实导入该目标，观察 JSON/JSON5 解析失败、目标路径及导入状态，保存首错。随后用有效件内容修复**同一路径**；如果已生成 meta，保留其 UUID，不附带另一个资源的 meta。按实际自动刷新/显式重导行为等待导入完成。

修复后的可使用观察位置是 `gap-a` 的 `Read repaired JSON` 按钮：业务通过 `resources.load('repair-target', JsonAsset)` 读取实际导入资源，在 `Canvas/MaterialStatus` 显示实际 JSON 内容。代码不内置修复值或成功文案。读取前释放此目标的旧 resources 缓存；加载错误会显示并输出实际错误，不改读其他文件。

后续导入成功但尚未实际读取，仍缺“可使用”证据；只观察加载失败也不能证明编辑器导入失败。JSON 同类型导入恢复不等于已覆盖损坏图片、音频或媒体解码专项。

## 已做检查与仍待实机确认

交付前只做文件静态检查：JSON/YAML 可读性、场景本地引用与自有资产 UUID/meta 配对、补充脚本语法、L10N Key/节点关联、故障/修复原件及打包完整性。故意无效的 JSON/TS 仅存在 `inputs`，不要求它们通过解析。

尚未检查目标 PinK 的场景导入、实际按钮布局与点击、场景加载、随包 L10N 挂载/UUID/API兼容、缺 Key 编译保持、Web 默认语言/切换/排除、真实构建失败和恢复、无效 JSON 导入和同目标修复。源工程也不因本次复制获得新的通过结论。

## 给 macOS 对话的启动提示词

```text
请接收 PinK 四组缺失材料 initial-gaps-2026-10-16，先阅读本包 README.md 和 material-identities.json，并结合之前交付的 38 条首轮、24 条条件补测用例及两轮原始结果。

本次仅准备材料，暂时不要启动 PinK、导入、预览、构建、重测或编写自动化。把 shared-project 保留为只读原件，后续在单独的新工作副本执行；inputs 必须保持在工程之外。不要覆盖旧 macOS 工程、R07 删除现场、原 PNG/meta 备份或已有任务证据。

材料仅对应 P04、B02/B03、B07、R08，不改变用例数量和原失败预期。Creator/pink 模板版本字段不是已验收目标版本，当前状态是 prepared-not-run。等用户明确授权执行后，再记录应用完整路径、PinK、Host实际SDK、Builder/L10N版本、材料副本路径和新的执行批次。

届时需通过真实 UI 和真实产物验证：A→B→A；L10N 选择 zh-Hans/en、默认 en、回退 zh-Hans、排除 zh-Hant，缺 Key 与完整 Key 分别观察；B07 只替换 BuildInput.ts 内容并保留 meta，在实际任务中确认失败后同路径恢复再提交；R08 在 assets/resources/repair-target.json 原路径由无效 JSON 修复为有效 JSON，并通过游戏按钮读取。实际条件未成立就保留证据，不用模拟或降低预期算通过；材料需要修正与产品问题分开记录。

两轮历史结果保持独立，不把定向复核结果加到首轮通过数。本轮文件准备不计入测试结果。
```

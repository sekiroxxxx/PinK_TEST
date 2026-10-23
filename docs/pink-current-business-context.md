# PinK 当前业务与自动化基础

PinK 回归自动化需要以当前产品的用户任务为对象，Creator 历史材料只提供业务参考。当前源码已经有 UI 冒烟、API 测试及 CI 接线，后续应先判断能否复用，不以“测试组尚未接入”推定所有工具都要从零开发。

这不改变用户确认的测试组基线：当前实际沿用的是 CLI 构建自动化。源码实现、CI 配置、真实运行和测试组采用是不同事实；本页不是首批测试清单，也不冻结技术选型。

## 来源与版本

| 来源 | 本次依据 | 解释边界 |
| --- | --- | --- |
| SUD-GLOBAL/pink-docs-public | 2026-10-14 读取 main 的 `9c0b6380c4cf5fd0bdae8093196ade3973852353`，重点为 `apps/docs/versions/1.127/zh` | 用户操作与预期的来源，不等于所有描述已经通过当前包验收 |
| 本地 PinK 源码 | `C:/Users/Administrator/Desktop/PinK-Clone/PinK`，分支 `codex/scene-first-open-script-sync`，HEAD `0e3397d3503b694f8b26d26c194c3a70edd3f7d2` | 工作位置不是发布包，也不能直接当作上游 main |
| 本地已解包扩展 | `.build/builtInExtensions/SUD.pink-builder`、`SUD.pink-localization-editor` 的清单 | 只能证明该本地缓存存在相应目录与清单，不证明本次运行实际激活或发布包包含相同内容 |

本地有其他任务未提交的 Cocos Host、Assets、Scene API 等改动。本页不把其中正在调整的扩展来源传递接口冻结为稳定合同。下文列出的核心冒烟、fixture、启动脚本、CI 配置及项目识别文件与本地 HEAD 没有差异。

手册来源固定到[所读提交](https://github.com/SUD-GLOBAL/pink-docs-public/tree/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh)。本机同名文档 checkout 的 HEAD 不同，没有用它替代远程版本。

## 用户任务与需要保护的业务结果

以下是理解 PinK 的业务入口，不代表全部进入自动化范围。

| 用户任务 | 手册与源码提供的上下文 | 对测试材料和判定的影响 |
| --- | --- | --- |
| 创建或打开工程 | 打开项目根目录、等待项目和资源初始化，再打开入口场景 | 工作台出现不等于项目就绪；需确认当前项目身份、资源与场景是否可用 |
| 使用资源编辑场景 | 图片导入、资源选择、Sprite 引用、层级与 Inspector 联动，保存后重新打开 | 预置资源用于准备时，不能宣称覆盖了导入操作；内存中的引用正确也不能代替保存结果 |
| 场景与动画编辑 | 场景节点、属性、Clip 编辑属于不同操作；Demo 的运行效果有独立脚本实现 | 看见效果不等于相关编辑模块已被验证；需要确认实际消费的是所编辑材料 |
| 预览游戏 | 保存场景和脚本，运行并检查事件、画面与业务状态 | 预览窗口打开只是启动结果，不能替代交互与状态检查 |
| 从面板构建 Web | 选择平台、入口、输出目录和选项，检查任务记录，再运行实际产物 | UI 配置、提交的任务参数、产物及运行结果需要分别对照；纯 CLI 构建不经过前两者的界面操作 |
| 与 Agent 协作修改 | 提供文件上下文、限定修改范围、检查差异、接受或拒绝，再运行验收 | 收到回复、发生文件修改、修改正确是不同结果，不能只判断回答文字是否出现 |
| 使用随包插件 | 产品通过内置扩展装配部分业务能力，项目材料与插件代码不在同一位置 | 需记录实际消费的扩展身份与版本，不通过旧 Creator 插件安装依赖代替 PinK 插件 |

对应手册：[打开项目](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/getting-started/open-existing.md)、[资源与 Sprite](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/asset-workflow/first-sprite.md)、[调试运行](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/debug-run/index.md)、[构建 Web](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/build-publish/index.md)、[AI 协作](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/ai-workflow/index.md)。

### 工程识别与就绪

`src/vs/platform/cocosProject/electron-main/cocosProjectMainService.pink.ts` 的静态工程识别读取 `package.json`，要求其中有 `pink` 或 `creator` 标记。该服务还提供补充 PinK 元数据及缺失工程文件的操作。因此，后续要区分初次打开旧工程与打开已初始化工程，不能要求两种情况下磁盘变化完全一致。

测试启动脚本 `scripts/pink-smoke.ts` 对指定工程另有自己的检查：根目录或 settings 下存在 `cocos.config.json`。这是当前工具的前置条件，不是产品工程识别规则。工具拒绝某份材料时，应先判断是否只是工具的检查条件不匹配。

既有测试专用的 `automationStatus.ts` 分别读取 PinK 生命周期、活动工程状态、Cocos Host 可用性和场景情况；场景引擎还需单独等待。无场景时产品可以正常就绪，不能把“场景一定已打开”当作所有测试的前置条件。

### 预览与构建不是同一个入口

`extensions/@pink-toolbar/src/extension.ts` 注册浏览器预览、编辑器内预览、模拟器预览和构建预览等入口。浏览器预览获取预览地址并打开；构建预览则创建 web-mobile 构建任务，等待成功与返回的预览地址，再启动调试。

`src/vs/platform/cocos/node/api/cocosHostBuilder.pink.ts` 维护任务队列及状态，调用 CLI 的 `createBuildTask` 和 `run`，保存结果并通知界面。这个调用链解释了为什么纯 CLI 成功不足以证明 PinK 构建面板和任务展示正确。它不意味着本次需要覆盖所有任务操作或全部预览方式。

### 教程 Demo 不能直接充当完整回归工程

[第一次 AI 修改](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/getting-started/first-game.md)以固定计分、目标移动和重置提供可观察的业务结果，适合参考“小任务有明确预期”的思路。但它是教程示例，不是测试项目的正式交付合同；手册也保留了公开下载尚未开放时的提示，不能把示例来源视为已经可用。

[场景与动画](https://github.com/SUD-GLOBAL/pink-docs-public/blob/9c0b6380c4cf5fd0bdae8093196ade3973852353/apps/docs/versions/1.127/zh/scene-animation/index.md)明确写到，当前点击效果由 `ClickGame.ts` 中的 tween 执行，Clip 只是可打开的编辑资源。因此即使点击效果正常，也不能据此判断 Clip 修改、保存和播放正确。这是“链路经过或展示某模块，不等于模块行为已验证”的直接例子。

## 源码已有的自动化能力

### 核心 UI 冒烟

入口为 `package.json` 的 `pink:smoke`，调用 `scripts/pink-smoke.ts --suite pink-core`。套件在 `test/smoke/src/areas/pink/core/core.pink.test.ts` 注册，使用 `test/pinkWorkspace` 的专用材料。

| 已有用例实现 | 真正检查的结果 | 不能据此声称 |
| --- | --- | --- |
| coreFlow | 选择预置图片，修改并重置导入选项，通过真实拖拽创建节点，再从 Inspector 改位置并读取 Scene 数据 | 已验证外部文件导入、导入选项保存落盘或游戏实际渲染 |
| hierarchyLifecycle | 对已准备节点改名、修改位置、删除，等待场景数据及选择同步 | 已验证所有节点编辑、撤销重做或全部组件 |
| sceneIsolation | 切换主辅场景，检查节点可见性及选择隔离，再切回原场景 | 已验证切换项目或所有多场景并发行为 |
| readinessContract | 关闭测试场景后，工程与 Host 仍就绪，再恢复场景 | 已验证初次安装、账号就绪或全部启动异常 |
| restartRecovery | 保存节点后重启，重新发现界面连接并读取保存的节点状态 | 已验证发布包升级迁移或跨机器恢复 |

这些是源码中已有的操作和断言，不是本轮执行通过的结果。该核心套件没有注册 Agent 对话、构建面板、L10N 或游戏产物运行用例。

### 材料隔离与结果依据

`test/smoke/src/main.ts` 把指定测试工程复制到运行目录，再向副本的 `.pink/settings.json` 写入 Cocos 环境路径。核心 fixture 按用例分场景，并通过 `.pink/automation.json` 的精确可丢弃标记和已登记场景限制写入。测试准备会清空并保存场景，不可直接作用于真实用户工程。

Bridge 负责准备材料及读取真实 Scene 数据；Driver 负责界面操作。用例以资源 UUID、节点身份和属性读取结果判断，不把截图作为默认通过依据。`harness/smokeArtifacts.pink.ts` 在用例断言后写 `result.json`，失败时尽力采集 `failure.json` 和 `failure.png`，诊断异常不覆盖原测试错误。失败截图主要用于定位问题，不是历史框架那种自动基准图比较。

源码入口：[核心套件](C:/Users/Administrator/Desktop/PinK-Clone/PinK/test/smoke/src/areas/pink/core/core.pink.test.ts)、[材料与安全规则](C:/Users/Administrator/Desktop/PinK-Clone/PinK/test/automation/extensions/pink-automation-bridge/src/automationWorkspace.ts)、[结果与失败诊断](C:/Users/Administrator/Desktop/PinK-Clone/PinK/test/smoke/src/areas/pink/core/harness/smokeArtifacts.pink.ts)。

### 其他测试与 CI 接线

PinK 源码还有 `extensions/pink-api-tests`，包含资源、Scene、Builder、配置、生命周期等 API 测试。它们调用 API，不能直接替代用户面板操作；例如 assets 样本既有真实复制操作，也有“函数存在”检查，覆盖要按具体断言看，不能按目录名计算。

`scripts/pink-smoke.ts` 还列出 animation-editor、animation-editor-skeletal、scene-editor 等套件。动画编辑器有自己的静态 Scene、Clip、SpriteFrame 材料及用例，例如原生菜单的关键帧复制粘贴和撤销检查。它们不是默认 pink-core 的同一覆盖范围；骨骼套件没有内置工程，需要外部材料。

当前 `.github/workflows/pr.yml` 的 macOS、Windows 常规 Electron 测试 job 调用对应 reusable workflow；其中启用了 `.github/actions/pink-api-test` 和 `.github/actions/pink-smoke-test`。后者编译运行器，再执行 `npm run pink:smoke -- --no-compile`，因此默认选择 pink-core。

旧的独立 Electron smoke jobs 确实被禁用，但不能据此认定 PinK 专用 smoke 没有 CI 接线。自动化 README 中的具体 job 名称也不能替代 workflow 调用链。当前可确认的是配置存在；任务是否实际触发、运行通过及产物是否保留，需要相应运行记录。

源码入口：[启动脚本](C:/Users/Administrator/Desktop/PinK-Clone/PinK/scripts/pink-smoke.ts)、[macOS 调用](C:/Users/Administrator/Desktop/PinK-Clone/PinK/.github/workflows/pr-darwin-test.yml)、[Windows 调用](C:/Users/Administrator/Desktop/PinK-Clone/PinK/.github/workflows/pr-win32-test.yml)、[PinK Smoke Action](C:/Users/Administrator/Desktop/PinK-Clone/PinK/.github/actions/pink-smoke-test/action.yml)。

### 随包插件与源码测试的边界

`product.overrides.json` 配置远程内置扩展来源，`build/lib/builtInExtensions.ts` 负责相关准备。本地扩展缓存中读取到 Builder 0.0.2 和 L10N 0.0.8 的清单，但没有以这份缓存推定测试组安装包版本或插件已激活。

后续测试项目不应自行附带旧 localization-editor 来获得同名运行时。涉及 L10N 的用例应核实测试目标 PinK 实际提供的插件与构建选项；当前核心 UI 冒烟不提供这部分覆盖。正在调整的 Host 扩展来源接口需待对应改动稳定后单独核对，不在本页决定 CLI 或插件如何改造。

## 对下一阶段的影响

历史调查与本轮 PinK 调查已足够支持代表性链路的落地设计。现在需要确认的，是首批链路的初始材料、真正被测操作、明确预期和目标 PinK 版本，而不是再泛查所有 Creator 功能。

已有核心 UI、动画专项和 API 测试应先与选定检查点对照：能直接复用的保留；只验证了局部行为的明确边界；确实缺失的再考虑补足。不因源码里已有某个框架就冻结它为新工具，也不因测试组需要一个新项目就复制一套已有基座。

当前仍影响实施的确认项：测试组使用开发版还是安装包、已选链路在该版本是否稳定、既有工具能否消费该目标版本，以及 Agent 所需的账号、服务与权限前提。本轮没有启动 PinK、调用模型、运行测试或修改产品源码与 CI。

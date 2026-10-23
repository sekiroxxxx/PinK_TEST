# Creator 历史自动化业务事实

## 结论与适用边界

Creator 来源材料包含不同层面的测试：外部操作编辑器界面的历史实现、编辑器内包或插件的测试入口、构建后运行游戏场景的测试，以及专项性能与内存数据采集。它们的入口、测试材料和判定对象不同，不能合并为一条已接入 PinK 的链路。

用户于 2026-10-14 明确确认：PinK 目前只有 CLI 构建自动化在使用，其他自动化未接入。下文的历史实现和测试平台记录不改变这一基线，也不意味着 PinK 本次必须迁移全部旧能力。

调查范围限定为 Creator 3.x。用户已明确排除 2.x 材料，不从中提取 PinK 的链路、用例、测试资源或设计依据。

本轮值得保留的结论是业务事实和验证边界，不是旧技术方案或新用例清单。代码存在证明实现过该机制，执行日志证明特定任务发生过该行为；两者都不能单独证明每版必跑或今天仍有效。

## 原始资料与定位

| 编号 | 原始资料 | 使用边界 |
| --- | --- | --- |
| A | `C:/Users/Administrator/Documents/WXWork/1688855233950622/Cache/File/2026-10/autotest_creator_edit-master.zip` | 2022 年编辑器自动化代码归档。下文 A 后的路径是 ZIP 内项目相对路径；关键摘录已核对与归档内容一致。 |
| B | `C:/Users/Administrator/Downloads/cocos-test-projects-3.8.7` | 本地测试工程快照，重点读取 `assets/auto-test-case`；目录名不证明其内容是干净的 3.8.7 基线。 |
| C | `C:/Users/Administrator/Documents/WXWork/1688855233950622/Cache/File/2026-09/cocos-test-projects/extensions/automation-framework` | 本地插件及依赖代码快照，只用于解释机制，不视为历史线上任务的精确源码版本。 |
| D | `C:/Users/Administrator/Documents/WXWork/1688855233950622/Cache/File/2026-10/Cocos Creator 3.x 编辑器测试用例.xlsx` | 人工业务预期及回归要求的来源；历史 Pass、优先级和自动化标记不等同于 PinK 当前覆盖。 |
| E | `C:/Users/Administrator/Downloads/cli、automation-framework自动化需求.pdf` | CLI 接入的历史需求，不作为需求已经全部交付的证明。 |
| F | `https://cctest.cocos.org` 的历史任务日志与结果接口 | 证明指定日期、任务及平台的执行；不据计划名称推定产品 GUI 自动化或 PinK 接入情况。 |
| G | `C:/Users/Administrator/Downloads/cocos-test-editor-3.8.8` | 编辑器测试项目合集，有实际场景、Clip、Prefab 和构建材料。外层目录名不代表内部工程的版本；本轮仅只读检查。 |

B 的 `package.json` 标记 Creator 3.8.4，声明 `automation-framework` 0.4.6、`localization-editor` 1.0.1，另有 `pink` 字段。C 的插件清单标记 0.11.0。不得把 B、C 和某个线上任务当成同一份版本一致的交付物。

### 官方仓库与已核对版本

下列 3.x 相关仓库于 2026-10-14 通过 GitHub 只读接口核对。链接固定到所读提交，默认分支只是当日入口，不是 PinK 选择该版本的决定。

| 官方来源 | 已核对分支及提交 | 业务定位与证据入口 |
| --- | --- | --- |
| cocos/cocos-test-projects | 默认 `v3.8.7`，`f1070f7e79a7bc107c40c436db40c8c923a0a146` | [工程树](https://github.com/cocos/cocos-test-projects/tree/f1070f7e79a7bc107c40c436db40c8c923a0a146)提供 Scene、资源和场景测试脚本。已有本地大工程可与此来源逐项对照，不据同名目录认定完全相同。 |
| cocos/cocos-test-projects | `v4.0.0-cli`，`bf3b3cfd1946a7d1f6f8c02a0980a8b479b13030` | [CLI 分支工程树](https://github.com/cocos/cocos-test-projects/tree/bf3b3cfd1946a7d1f6f8c02a0980a8b479b13030)是既有构建任务相关来源。该提交保留大量场景，但不含 `assets/auto-test-case` 下的 TypeScript 文件；不能把它当成测试组已装配好的自动化工程。 |
| cocos/cocos-test-editor | 默认 `v3.8.8`，`d97f7995bced6e3c471dd4cb308acdc25dc5ad09`；`v3.8.7` 同指此提交 | [README](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/README.md)说明专项工程、测试插件、PR Test 和编辑器内测试入口。其 `projects` 是小型材料的直接来源。 |

cocos-test-editor 为私有仓库，本次使用当前已登录账号的访问权限读取；匿名网页不可访问不等于仓库不存在。未克隆仓库、切换本地分支或执行远程脚本。另行提供的 cocos/test-cases 已检查部分为 2.x 材料，按用户要求排除，不继续调查或作为复用候选。

对 cocos-test-projects 的两份已读提交，递归树均完整返回，各有 275 个 Scene、67 个 Prefab、19 个 Clip；`v3.8.7` 的 `assets/auto-test-case` 下有 258 个 TypeScript 文件，包含辅助文件，不是 258 条用例。两份提交均没有 `extensions` 下的文件。B 的本地资产数量及微信装配工程不能直接替代远程提交的事实。

G 的 README、两个动画工程清单与该上游提交的对应文件在忽略换行差异后相同，但这只是抽查文件匹配，不证明本地全部内容对应该提交。G 的 `build-example/package.json` 有额外 PinK 字段，上游对应文件没有；它不能作为上游已接入 PinK 的依据。

### 新来源补充的业务区分

cocos-test-editor 的 [build-example 测试配置](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/build-example/test.config.js)选择 builder、preview、asset-db，动画工程选择 animator。README 中的编辑器 `--test` 入口调用编辑器或插件自身的测试代码。这与 2022 年外部 UI 驱动不是同一种执行入口；工程和配置存在，不证明对应测试实现已经取得、执行过或可在 PinK 运行。

### 本机实际持有的工程与素材

A 的 ZIP 只有框架与若干图片、FBX、glTF、Effect 素材，没有 `.scene`、`.prefab`、`.anim`。这不代表其他已提供材料也缺少完整的工程目录。

| 来源 | 工程及资产事实 | 版本与限制 |
| --- | --- | --- |
| B | 有工程清单、assets、settings；assets 中有 275 个 Scene、68 个 Prefab、19 个 Clip。`resources/test_assets` 同时提供图片、图集、模型、动画、Prefab 和业务脚本 | 清单标记 3.8.4；没有 extensions 目录，虽声明旧自动化和 L10N 插件依赖，不能视为开箱可运行 |
| G `projects/cocosAnimationTest` | 一份 Scene、一份 `res/box.prefab`、一份 `res/test.anim`；Scene 的 Prefab UUID 与该 Prefab 的 meta 一致 | 清单标记 3.4.0。Prefab 含粒子和网格组件，并非无外部依赖的普通方块；没有 TypeScript 业务脚本 |
| G `projects/test-for-animation` | 一份 `testAnimationEditor.scene` 和一份 `testAnimation.anim`，另有模型及纹理；`test.config.js` 选择 animator 包 | 顶层 version 为 3.3.1，creator.version 为 3.6.0。场景含大量组件与模式，不等于基础动画最小工程 |
| G `projects/build-example` | 13 个 Scene、2 个 Prefab、1 个 Clip、10 个 TypeScript 文件，以及构建配置和模板；`test.config.js` 选择 builder、preview、asset-db | 顶层 version 为 3.6.2，creator.version 为 3.8.7，另有 PinK 字段。插件测试选择配置不证明这些测试代码在 PinK 存在或已运行 |

另有 `Downloads/cocos-test-projects-3.8.4` 快照，清单标记 3.8.4；微信缓存的 `2026-09/cocos-test-projects` 清单中 creator.version 为 3.8.8。这两个目录带旧 automation-framework 和 localization-editor。上述目录均未发现 Git 元数据，不能确认原始分支或提交。

已核实的轻量材料候选包括 B 的 `resources/test_assets/prefab.prefab`（Label 节点，文件未见外部 UUID 引用）、`testAnim.anim`（position 轨道）、`image.png`，以及 `Monster.gltf` 配套的 `Monster0.bin`、`Monster.jpg`；`atlas.plist` 明确引用 `atlas.png`，`font.fnt` 明确引用 `font.png`。这些候选还需要保留各自 `.meta` 并核对目标版本导入，不能因文件存在就宣称迁移通过。

B 的 `simple.scene` 有一项 SpriteFrame UUID 未由本地 assets 的顶层 meta 索引解析；内置资源和子资源尚未完全核对。小型工程的全部引用闭合、旧 Clip 导入迁移、SDK 和 PinK 功能支持也没有运行验证。本轮没有在已检查材料根目录发现独立 HelloWorld 工程，不作全盘不存在的结论。

## 两个 3.x 仓库的职责与执行入口

下表对应上文固定提交。命令是历史入口说明，不是 PinK 的使用说明。

| 历史用途 | 测试项目如何准备 | 执行入口与依赖 | 实际判定或输出 |
| --- | --- | --- | --- |
| cocos-test-projects 场景运行测试 | 预置场景、资源、业务组件和 `assets/auto-test-case` 脚本；用例关联场景并查找节点或组件 | 脚本从 `db://automation-framework/runtime/test-framework.mjs` 导入运行能力；不是独立 Node 测试入口 | 方法可做数值断言、推进帧并截图；图片比较和报告依赖仓库外的框架与执行服务 |
| cocos-test-editor 编辑器内测试 | `build-example`、`test-for-animation` 等专项工程，配置需要执行的编辑器包 | 编辑器 `--project ... --test configPath=...`；具体测试依赖相应编辑器或插件实现 | 项目配置只选择测试范围；不能从材料仓库直接取得所有断言及汇总规则 |
| cocos-test-editor 构建性能辅助 | 从模板生成指定规模的资源、脚本、图集、纹理压缩材料及构建配置 | performance-test 面板生成工程并启动编辑器 `--metric --project ... --build ...` | 面板按子进程返回码判断构建成功；性能数据另见 `temp/metrics.log`，不是性能达标结论 |
| cocos-test-editor 内存专项采集 | 外层工具按任务清理并重建工程材料、设置初始场景和任务参数 | `auto-test` 的 `npm run start` 启动编译后的 `dist/main.js`；再启动编辑器，由 memory-tools 接收场景就绪通知执行任务 | 收集进程内存日志并生成 `memory_usage.xlsx`；已读采集与汇总代码没有自动判断泄漏的通过阈值 |

这两仓分别提供运行时材料与用例、编辑器专项材料及部分辅助工具，并不是下载后就完整具备调度、执行和判定的同一个产品。性能与内存项目在此用于理解历史职责，不纳入本次 PinK 回归范围。

### 编辑器测试配置与可观察结果

cocos-test-editor 根目录的 [test.config.json](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/test.config.json)把 PRTest 项目映射到 common、mac、win 的构建配置。它选择的是工程及平台配置，不是各业务用例的断言清单，也不证明 CI 当前正在消费它。它与工程内选择 builder、preview、asset-db 的 `test.config.js` 用途不同。

`build-example` 的 [构建配置](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/build-example/build-configs/buildConfig_web-mobile.json)指定起始场景 UUID、纹理压缩、自动图集、脚本选项及平台包参数。因此，测试输入包含资产、元数据和构建选项，不能只保留场景文件。

其构建插件的 [hooks.ts](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/build-example/extensions/cocos-build-template/source/hooks.ts)在生命周期中记录 hook 名称，并查询指定资源 UUID 是否包含于产物、对应导入路径及原始资源路径，写入 `temp/builder/test-extension-api-res.json`。这是一种输出结构化观察结果的做法：可以检查实际调用和资源处理结果，而不只看“构建成功”。但该文件由被测 hook 写出，仍需外部预期及断言读取；生成 JSON 不等于这些结果正确。

这个插件通过 `Editor.Message` 查询资源，还需编译和重新加载。其存在不能证明 PinK 或纯 CLI 应实现同名宿主接口，也不能直接替代 PinK 随包插件的测试。

### 从模板准备性能工程

performance-test 的 [panel.js](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/extensions/performance-test/panel.js)负责清空指定输出目录，再组合资源、脚本、图集、纹理压缩模板、默认场景、构建配置和项目清单；[create.js](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/extensions/performance-test/scripts/create.js)执行生成。值得保留的是“小型模板加明确规模参数形成专项输入”，而不是保存所有规模的巨型工程。旧生成器会清空输出位置，不能用于未隔离的用户工程。

“资源数量”也不能只看面板数字：生成器按资源类型平分数量、遍历模板文件，部分类型带配套资源，脚本又单独生成。描述专项工程规模时，需要说明计数对象与实际生成内容，不能把参数值当成最终资产总量。

[build.js](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/extensions/performance-test/scripts/build.js)启动的是 Creator 编辑器，不是当前独立 cocos CLI；面板把退出码 36 当作构建成功，再提示查看指标日志。这个退出码仅属于该旧调用合同，不能移植成 PinK 或独立 CLI 的成功规则。已读生成与启动代码没有性能基准比较和自动失败阈值。

### 内存专项的准备与执行分工

test-for-memory 的外层 [main.ts](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/test-for-memory/auto-test/src/main.ts)顺序执行任务，每项依次清理、准备、启动和采集。其 [BaseTask](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/test-for-memory/auto-test/src/base/base.ts)清理范围包括 assets、settings 及导入缓存；这不是普通“重试”，而是重建专用测试工程。

以资源重导入任务为例，外层从 template-assets 复制场景及 `.meta`、生成资源、设置初始场景，并把任务名和重复次数写入 memory-tools 的清单。编辑器内插件通过 [scene:ready 消息](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/test-for-memory/extensions/memory-tools/package.json)触发；[内部任务](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/test-for-memory/extensions/memory-tools/src/task/memory-Leakage/reimport-assets.ts)查询资源、重复重导入、采样内存，最后按配置退出编辑器。这清楚区分了“准备输入”和“在产品中执行被测动作”。

[taskMgr.ts](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/test-for-memory/extensions/memory-tools/src/base/taskMgr.ts)依赖 Creator 内部进程窗口标题识别场景、资源构建和脚本进程；[parseMetrics.ts](https://github.com/cocos/cocos-test-editor/blob/d97f7995bced6e3c471dd4cb308acdc25dc5ad09/projects/test-for-memory/auto-test/src/parseMetrics.ts)把 RSS、Heap、External 数据导出表格。这些进程假设不是 PinK 的合同，数据导出也不证明已判定内存回归。

外层 `runApp` 在子进程退出时继续采集，没有按退出码区分成功失败；内部找不到任务也会退出编辑器。因而“编辑器退出了”不足以证明任务完成。这一源码边界值得保留，但不是本轮已复现的线上误报。

## 编辑器 UI 自动化的业务上下文

### 实际入口与初始状态

A 的 `README.md` 和 `testcase.js` 说明：Mocha 启动 `CocosCreator.exe`，传入工程路径及编辑器测试参数，按模块登记和执行测试。代码涉及层级、资源、Inspector、动画和项目设置等；不是单纯运行游戏场景。

入口会等待场景打开、调整窗口、恢复默认布局、打开动画面板、获取焦点并切换中文。测试因此依赖明确的窗口、布局、语言和工程状态，旧元素名和坐标不是业务规则。

`com/ElementsInit.js` 的 `hierarchyInit`、`assetsInit` 会通过界面删除节点和资源；`projectInit` 会调整模块配置并重载。它们是有副作用的环境准备，不是可以直接对用户工程执行的只读检查。旧脚本本轮未执行。

### 操作与判定的真实边界

| 历史样本 | 实际操作和检查 | 能保留的业务含义 | 不能扩大解释为 |
| --- | --- | --- | --- |
| A `panel/Hierarchy/case1.js` | 创建节点、选择多个节点、复制粘贴，查询层级节点并检查指定位置的名称 | 编辑动作应产生可观察的层级结果 | 已验证节点全部属性、保存重开、Prefab 或构建结果 |
| A `panel/Inspector/case1.js` | 锁定 Inspector 后切换节点，检查锁定控件的 `pin` 状态 | 锁定状态有对应界面检查 | Inspector 内容始终不变或所有锁定行为均正确 |
| A `com/class/checkClass.js`、`com/Image.js` | 部分检查比较数值，部分捕获区域图并对照预期图；采集基准和比较是不同分支 | 正确结果可以来自状态、数值或图像，需匹配业务目标 | 截图一定比数值更可靠，或旧容差就是新需求 |

代码按 `action`、用例和参数读取数据库，结果写回 `test_result`。材料表明存在这套实现，但本轮没有证明它在当前 Creator 或 PinK 中仍然运行。旧模块用例也不能直接算成我们已经确认的端到端业务链路。

### 工程准备混合了创建和预置导入

A 的 UI 用例不是全部依赖一个提前制作好的完整工程，也不是全部从空工程用鼠标制作。

| 准备方式 | 历史代码中的实例 | 对验证范围的含义 |
| --- | --- | --- |
| 在界面中创建 | `panel/Assets/case1.js` 从菜单创建资源，随后剪切粘贴，再查询资源树 | 可检查实际走过的创建、移动和界面结果，但样本中的树节点名称检查不能替代文件内容或引用检查 |
| 把归档内资源导入工程 | `panel/Assets/case16.js` 使用归档根目录的 `12.png`；`case21.js` 使用 `test.gltf` | 静态材料也是运行前提，只有业务脚本不足以复现 |
| 用宿主接口准备，再通过 UI 检查 | 上述两个导入样本调用 `Editor.Message.request('asset-db', 'import-asset', ...)`，再操作属性或搜索 | 后续界面行为可以被验证，但没有经过系统文件对话框，不能声称覆盖了完整的人工导入入口 |

`case16.js` 继续把图片设置为 SpriteFrame、创建艺术字资源、拖入层级、修改显示文字并截图。这个样本体现了资源、属性、场景之间的业务衔接；它本身不构成 PinK 必须选择这条链路的决定。

样本说明，前置准备可以复用快捷方式，但必须与被测操作分开标记。材料的来源路径、导入后标识、节点初始位置和编辑器模式都会影响随后检查。

### 用例数据和代码需要成套匹配

A 的 `dao/selectTestCase.js` 按 `action_id` 取用例，`dao/selectParamClass.js` 按 `case_id` 取菜单等参数。因此，数据库不是单纯保存历史报告，也参与决定执行什么及如何操作。

归档的 `SQL/创建表并导入数据.sql` 中动作字典为 1 至 16，而 `testcase.js` 中动画和 Inspector 入口分别查询 17、20，另有入口查询 21、22。动作字典与入口不一致，不能把归档当成已经匹配好的可恢复运行快照。原业务、数据库参数、选择器依赖和检查代码应分别核对，不能仅凭面板目录下的文件数量判断覆盖。

### 操作成功和检查完成不能混同

A 的 `com/class/MouseClass.js` 查询元素坐标再执行键鼠操作，部分查找失败会重试后抛错。点击成功只说明操作已发出，不代表资源已创建或数据已保存。

`com/Screen.js` 调用异步截图和文件写入，但没有把内部完成链返回给外层；调用方又常用固定等待继续比较。这个快照不能作为“等待截图可靠完成”的实现范本。其 `YES` 分支采集候选图，比较分支读取 `imagediff/expect`；归档没有证明候选图由谁审核、怎样成为正式基准。采集当前输出与认可正确基准是不同职责。

## 构建与场景自动化的业务上下文

### 材料与测试计划是两件事

B 的测试工程提供场景、资源和 `.test.ts`。例如 `staticScene/simple.test.ts` 关联 `simple` 场景并采集画面；`dynamic/ui/button-click.test.ts` 在游戏中直接触发按钮回调，再截图。这类检查的对象是游戏运行时行为，不是编辑器面板，也不等同于真实输入命中检测。

C 中 `@cctest/framework/src/decorators.ts` 登记测试类、关联场景、测试方法及平台排除条件；`runner.ts` 从测试计划的 `testScripts` 和 `classNames` 选择执行对象。因此，“工程里有脚本”“脚本注册成功”和“本次计划实际执行”是不同事实。

### 场景测试不只有截图一种检查

上游固定提交中的 [simple.test.ts](https://github.com/cocos/cocos-test-projects/blob/f1070f7e79a7bc107c40c436db40c8c923a0a146/assets/auto-test-case/staticScene/simple.test.ts)加载关联场景、等待一帧并截图；[AsyncFunctionsTest.test.ts](https://github.com/cocos/cocos-test-projects/blob/f1070f7e79a7bc107c40c436db40c8c923a0a146/assets/auto-test-case/dynamic/scripting/AsyncFunctionsTest.test.ts)还调用业务组件，测量耗时并做数值断言。前者把主要预期交给图像比较，后者同时存在状态执行和数值预期。旧时间容差不是 PinK 已认可的标准。

[image-importer.test.ts](https://github.com/cocos/cocos-test-projects/blob/f1070f7e79a7bc107c40c436db40c8c923a0a146/assets/auto-test-case/dynamic/asset/image-importer.test.ts)只是运行既有场景、等待并截图，没有操作编辑器的图片导入入口。测试文件名不能代替实际验证对象。

其 [截图辅助函数](https://github.com/cocos/cocos-test-projects/blob/f1070f7e79a7bc107c40c436db40c8c923a0a146/assets/auto-test-case/dynamic/common/utils.ts)负责等待帧和调用外部框架采集，不执行基准比较。工程 [package.json](https://github.com/cocos/cocos-test-projects/blob/f1070f7e79a7bc107c40c436db40c8c923a0a146/package.json)声明旧 automation-framework 与 localization-editor 依赖，而该提交不包含 extensions 文件。测试工程、插件装配和结果服务必须分别识别；不能把源码材料仓库当成已装配好的执行环境。根目录 preview-template/test.js 也只打印预览插件加载提示，不是自动化执行或通过信号。

### 工程材料存在显式和隐含的对应关系

| 材料 | 已核实的对应关系 | 后续理解旧用例时要保留的上下文 |
| --- | --- | --- |
| 场景及节点 | `assets/auto-test-case/dynamic/ui/slider.test.ts` 按 `Canvas/New Slider`、`Canvas/New Sprite` 查找组件，直接修改进度并调用业务方法 | 节点路径、组件和初始值是前提；这个样本不验证拖动输入链路 |
| Bundle 资源 | `assets/cases/asset/test-bundle.meta` 把目录声明为 `TestBundle`；`assets/cases/asset/asset-bundle.ts` 按该名字加载纹理、音频和子场景 | 目录中的文件、导入元数据、Bundle 名称和构建设置共同决定材料是否可用，不能只复制场景或脚本 |
| 资源引用 | `assets/cases/scripting/asset_loading/LoadRes/LoadRes_example.ts` 按 `test_assets/atlas`、`test_assets/prefab` 加载资源 | 相对资源路径及引用关系属于测试输入，不应被随意重命名 |
| 随机效果 | `assets/auto-test-case/dynamic/particle/particle-2d-normal.test.ts` 在 `beforeClass` 中以场景名调用 `srandom`；C 的框架同时设置 JavaScript 和引擎随机源 | 部分粒子画面通过控制随机输入重复出现；并非整个工程的所有随机、网络或时间因素都已固定 |

这些材料用于让功能产生已知、可观察的结果。它们的旧名称和结构不是新项目必须照搬的格式，但相应的业务关系不能在缩小工程时无意丢失。

### 测试计划和构建配置分别控制不同事情

C 的 `src/panels/core/TestScripts.ts` 依据脚本文本中的测试注解发现候选；`TestConfig.ts` 把被选中的脚本、类名和图像阈值写入平台计划。`testConfig.json` 还包含平台、设备、构建配置文件位置及截图基准位置。构建配置则控制真正参与产物生成的平台、场景和选项。

`commandBuild.ts` 的 `setTestCaseAuto` 按平台索引筛出一个平台，并把运行服务器地址写入临时配置。运行器随后消费产物旁的 `testConfig.json`，以 `platforms[0]` 决定执行对象。工程中的其他旧配置文件不能替代这条实际消费链来证明本次测试已经启用。

测试材料、选中的计划和实际构建配置需要一致。候选脚本被发现，不等于已经选中、正确注册或进入产物；选了某个场景用例，也不保证对应场景和资源已经可加载。

### 构建接入需要准备运行材料

C 的 `src/builder.ts` 声明 `AutoTest` 选项。`src/hooks.ts` 中，关闭自动化时尝试移除测试运行资源与 `auto-test-case` 脚本；开启时把 `temp/testConfig.json` 复制到产物目录，部分原生平台还配置远程日志。

这说明旧体系不只是把游戏正常构建出来，还需要让产物带有运行测试所需的脚本和配置。上述职责来自旧实现，不构成要求 PinK 复用同名选项、路径或宿主接口的设计决定。

### 执行工具会修改工作状态并加工产物

C 的 `@cctest/bootstrap/src/builder/Builder.ts` 在 CI 分支删除构建目录及 `native`、`temp`、`library`、`profiles`，取消已有构建进程，并按平台修改构建阶段配置。对于远程 Bundle，还把服务器地址替换为本次任务的资源服务地址。

构建完成后，`disposePackage` 可能补入测试配置、移动远程资源、复制或打包可执行产物，再提供任务专属访问路径。所以，旧工具同时承担环境准备和产物交付，单独保留项目目录无法复现所有运行条件。这些破坏性操作只作为历史事实记录，本项目没有执行或继承它们。

`@cctest/scheduler/src/core/Scheduler.ts` 区分仅构建、仅运行、构建后运行。构建、启动和运行异常又有不同的重试阶段。一个任务存在构建日志，不足以判断它是否安排了后续执行；需要同时核对执行模式、产物去向和运行回报。

### 启动命令成功不代表测试开始

C 的 Web 启动器在 `PlatformImpls.ts` 中发出浏览器启动命令后返回，调度器另外等待运行器的 `platformStart`。运行器在场景启动前触发，暂停游戏、读取测试配置、连接结果服务，再发出开始消息。配置未加载成功时存在恢复普通游戏的分支，因此“画面打开了”不是自动化已启动的证明。

需分清产品进程启动、工程或场景就绪、运行器开始、业务检查结束四个时刻。旧工具用启动超时、运行超时和心跳处理无响应；这些机制的存在不意味着任意固定等待足以证明业务就绪。

### 同一场景内存在连续步骤

C 的 `@cctest/framework/src/runner.ts` 在一个测试类开始时加载关联场景、创建一个实例，再顺序执行该类的方法。可选的 `beforeCase`、`afterCase` 由用例提供，运行器不是在每个方法之前自动重建场景。

因此，旧 `testCase` 方法可能是同一业务过程的连续检查点，不能直接视为彼此独立的完整用例。后续理解旧脚本时，要核对前一步留下的对象、配置和游戏状态。

例如 B 的 `assets/auto-test-case/dynamic/asset/asset-bundle.test.ts` 依次处理加载 Bundle、加载资源、切换场景并返回、释放和销毁。其业务组件通过文字提示暴露状态，测试据此等待并截图。这里既有正向步骤，也有未加载 Bundle 时应出现提示的负向步骤，不能用一个统一的“没有成功就是故障”概括。

该样本的纹理等待逻辑又存在旧实现缺口：循环比较的是此前读取的一次文本值，部分失败路径只记录警告或没有结束 Promise。它提供了异步资源操作的业务线索，但不能原样继承为可靠的完成判断。

### 截图检查的是游戏渲染画面

C 的 `@cctest/framework/src/capture.ts` 把场景相机输出导向 RenderTexture，推进帧、读取像素并发送。它不是编辑器窗口截图，也不检查浏览器外壳或原生系统界面。该快照使用固定图像尺寸和帧推进逻辑；这些参数只描述旧实现，不能直接冻结为 PinK 的要求。

截图按类名、方法名、可选名称及序号命名，并关联任务、平台和脚本。截图顺序与命名变化可能改变基准匹配；已有基准不是只有一组无上下文的 PNG 文件。

C 的 `@cctest/localserver/src/core/collect-buffer.ts` 负责还原图片、获取平台配置的基准图、调用比较，并记录缺图或差异失败。`report-manager.ts` 汇总正常结束、图片失败、脚本清单及耗时等状态。构建成功、启动成功、脚本执行和视觉结果是分开的判定环节。

### 图像差异和执行缺失是不同结果

C 的 `@cctest/localserver/src/worker/patch.ts` 先检查图片是否存在、解码数据长度是否一致，再按像素比较并计算匹配比例。计划的 `difference` 经百分比换算后作为最低匹配比例，并不是同名的像素颜色差异参数。旧数字不能脱离算法含义解释为新用例的允许误差。

`collect-buffer.ts` 处理实际图缺少对应基准的情况；`report-manager.ts` 的 `setNowScript` 在 CI 模式下还尝试获取基准清单，检查基准要求的图片是否实际产生。因而“图片不一致”“缺实际图”“缺基准图”需要分别解释，不能都归因于产品画面变坏。

运行器捕获方法异常并上报 `scriptRunError`；整类的平台排除可上报 `SKIP`，方法级排除则在执行日志中跳过。脚本级统计不能直接当成每个方法的通过统计。

### 旧汇总结果也需要核对判定依据

C 的 `report-manager.ts` 在切换脚本时记录前一个脚本结束，延后处理图像和结果上传；测试结束消息还包含各方法的截图数量。业务方法返回、图像比较完成及报告写入，不是同一个完成时刻。

本地快照中的 `setScriptRunError` 会设置脚本 `status = FAIL`，但 `endPlatform` 的判断没有直接检查各脚本的 `status`；它主要检查正常结束、失败图片、清单和耗时。这里记录的是源码判定范围的缺口，不是已经复现的线上误报。不能据平台 PASS 推定每个业务断言通过，也不在本轮修复旧框架。

断点续跑也不是完整重跑。`runner.ts` 和 `app/http-framework.ts` 按之前运行到的脚本索引继续，调度器分别管理构建、启动和运行重试。理解一份历史结果时，需区分首轮执行、重试和续跑，不能自行推定所有内容都在干净状态下重新执行。

## 已观察的历史执行

以下记录于本次对话的 2026-10-14 调查中读取，事件发生于 2026-09-18。任务为 `d36caf32-3765-4934-9252-2ce4c11e183b`，计划为 `DAILY-BUILD-v4.0.0-cli`。

| 环节 | 指定任务中的证据 | 来源 |
| --- | --- | --- |
| 构建 | 平台 0 的日志引用 `cocos-cli-win-26091721-0.0.1-alpha.42`，14:15:32 记录 Web 构建成功 | [builder.log](https://cctest.cocos.org/autotest/jobImage/DAILY-BUILD-v4.0.0-cli/d36caf32-3765-4934-9252-2ce4c11e183b/0/logs/builder.log) |
| 启动产物 | 14:15:38 启动 Chrome，打开同任务产物的 `packages/web-desktop/index.html` | [bootstrap-boot.log](https://cctest.cocos.org/autotest/jobImage/DAILY-BUILD-v4.0.0-cli/d36caf32-3765-4934-9252-2ce4c11e183b/0/logs/bootstrap-boot.log) |
| 场景执行 | 14:15:49 运行器启动并加载场景，14:29:40 结束；平台 0 的脚本记录为 211 PASS、1 SKIP | [engine.log](https://cctest.cocos.org/autotest/jobImage/DAILY-BUILD-v4.0.0-cli/d36caf32-3765-4934-9252-2ce4c11e183b/0/logs/engine.log)、[脚本结果](https://cctest.cocos.org/autotest/engine/private/script_result/getByPage?jobId=d36caf32-3765-4934-9252-2ce4c11e183b&platformIndex=0&pageNum=1&pageSize=220) |
| 截图比较 | 同任务平台 11 的 `setMipRange.test.ts` 记录一张图片错误，并提供第四张截图的差异图 | [脚本详情](https://cctest.cocos.org/autotest/engine/private/script_result/getById?id=2100830094526312450) |

平台 0 和平台 11 是不同配置，不能把它们的通过与失败合成同一平台结论。212 是脚本记录数，不是所有方法或截图的总数。截图和差异图曾返回 HTTP 200，但没有据此作人工画面验收。

任务报告的版本标签为 `v4.0.0-alpha34`，构建日志的 CLI 路径为 alpha.42。两者不一致时，不能只凭报告标签认定实际包版本，也不能从目录名取得包内容哈希。

这些证据确认历史平台执行过“构建、启动、场景测试、截图比较”。它们不是 PinK 编辑器交互自动化的接入证明，也不证明这些步骤在 PinK 当前每周回归中使用。

## 不应直接继承的判断

- 用例名称不能替代实际检查。B 的 `localization.test.ts` 把 `clickEvents` 数组继续当作具有 `.clickEvents` 的对象判断，通常会走只截图的分支；不能据名称认定语言切换已测到。
- 多次运行同一预制场景不能替代资源导入、编辑、保存和重开的验证。准备好的材料不证明其制作流程正确。
- 历史截图阈值、数值容差、重试次数和等待帧数是旧实现参数，是否符合新用例的正确性要求要另行判断。
- 旧工程声明的插件安装依赖不自动成为新项目的必需依赖。旧 `localization-editor` 的存在不能证明新 L10N 必须采用旧宿主机制。
- 历史执行成功不证明所有平台、所有选项或所有业务行为均被覆盖，也不能据此决定 PinK 固定回归频率。

## 后续设计需要继续确认的业务事实

历史实现为职责讨论提供了以下上下文，不预设技术方案：

| 需要理解的事项 | 历史事实带来的约束 |
| --- | --- |
| 材料如何准备 | 确认资源、导入元数据、引用、初始模式和状态，区分前置注入与真正被测操作 |
| 本次执行什么 | 区分材料全集、候选发现、计划选择、平台变体、运行时注册与实际完成 |
| 工具做了什么 | 显式识别准备工程、改写配置、清缓存、加工产物和启动运行的副作用 |
| 什么时候检查 | 根据场景、资源和业务状态判断完成，不能只靠命令返回或固定等待 |
| 怎样解释结果 | 分开看构建、启动、方法异常、业务状态、图像差异、缺图、跳过和基础设施问题 |
| 怎样再次执行 | 确认连续步骤、共享状态、随机输入，以及重试或续跑是否改变检查前提 |

随着用户确认链路，再逐条核对这些上下文。优先查会影响测试材料或执行能力的前提，不在此逐行迁移旧用例，也不要求所有旧平台机制进入新项目。

仍需测试组或产品确认：重要历史基准的正确性由谁认可、哪些运行时测试仍有业务价值、哪些编辑器行为已经在 PinK 稳定交付。技术选型、目录架构和自动化实现不由这份历史记录决定。

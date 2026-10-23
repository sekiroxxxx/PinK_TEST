# QA 用例加载、材料与离线计划合同

2026-10-21：已接入现有四组工具并完成离线验证，随后完成五项真实样本，以及 web-desktop 冷启动和已有实例接入验收。离线计划仍不代表 UI 或构建通过；实机结果按具体用例区分，不改引擎设置、不验证产物。

## 步骤文件 v2：页面与构建生命周期（2026-10-23，仅离线验证）

沿用 `kind: pink-configuration-steps`，用 `schemaVersion: 2` 显式声明页面、提交和结果步骤。v1 的隐式打开、末尾恢复与关闭语义不变。v2 不修改前端格式或四组数据，依旧由 `-StepsFile` 进入原启动门面；版本、全部步骤及清理声明纳入计划哈希。

每例包含 `caseId/platform/steps/finally`，可选 `onFailure: continue/stop`。本批一份启动文件一个平台，一例至多一次提交，串行收尾（最多一个活动任务，未扩大原两项上限）；旧构建入口每组最多两项的调度不变。v2 构建暂只开放 web-desktop/web-mobile，其他平台的材料、专用表单和后续阶段仍走旧入口。`targets` 新标准平台只允许配置操作，example 方向继续暂停。

| 操作                             | 输入依赖                                                        | 输出与约束                                                                                       |
| -------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `config.open`                    | 用例平台、已核对的会话                                          | 返回以步骤 ID 引用的页面；普通步骤不得隐式关闭/接管已有配置页                                    |
| `config.close`                   | `page` 引用当前页面                                             | 确认关闭并使页面及其快照失效；不是配置恢复                                                       |
| `record/set/read/restore`        | 增加显式 `page` 引用                                            | 复用原配置操作、字段类型、联动与恢复；修改字段必须显式记录                                       |
| `read` + `scope: build`          | 当前页面及本例已修改字段                                        | 另收集名称、路径、输出名称、初始场景、场景集合和 Debug；从当前工程解析场景 UUID，不自动修改场景  |
| `build.submit`                   | 当前 `page`、最新构建 `snapshot`、健康观察器                    | 点击一次；按新任务、平台、输出名称、时间唯一关联，保存任务引用后核对入队参数；随后旧页面引用失效 |
| `build.wait`                     | 本例 `build.submit` 的步骤 ID，写入 `task`                      | 按关联 taskId 收集终态和耗时，页面关闭不影响观察；终态不等于通过                                 |
| `assert` + `check: build-result` | `task`、`result` 引用对应等待步骤，`expected: {state: success}` | 核对成功、终态参数及成功卡片。本批不扩展其他预期终态                                             |

`assert` 的值、提示和控件状态检查沿用 v1；值断言引用当前页面未过期的回读，提示/状态断言使用当前已绑定页面。不可引用其他用例的页面、记录或任务；重复提交、缺少等待/结果断言、未覆盖修改字段的构建快照均在连接前拒绝。

`finally` 只允许打开、恢复、关闭，必须先 `config.open` 绑定清理页面并声明关闭。普通步骤失败时，若本例页面仍有效则复用，关闭过则重新打开同平台；原值记录跨重开转交给新适配器。尚未取得记录不执行恢复，页面未打开也不制造无意义的清理点击。恢复失败保留现场，停止后续用例。

已唯一关联的任务不会因入队断言失败而被丢弃：执行器先收集其终态，再恢复配置。明确失败/参数不符且安全收尾后可继续；`onFailure: stop` 则在收尾后停止。无匹配、多匹配、点击响应不明、观察失效、任务消失或超时会停止后续提交，不重试、不取消；状态不明或身份失效时不写回配置。启动等待与 processing 后超时分开记录，使用现有 30 秒关联、30 分钟启动等待和 10 分钟构建观察上限；预览列明这些约束。

结果保留每步、任务 ID、原错误与清理错误、恢复状态、原因链及可用截图。`buildAttempted` 与 `buildSubmitted` 分别记录尝试和已唯一确认，未收齐另标 `taskMayStillBeRunning`。构建允许任务文件正常变化，但观察到未关联的新任务仍停止；引擎设置始终要求不变。恢复核对声明字段及已支持的联动，不把产品生成的输出名称变化当作全工程回滚失败。

可编辑样本：[基本构建链路](../tools/build-ui/fixtures/configuration-steps/build-v2-basic.json)、[增加关闭重开并修改配置的链路](../tools/build-ui/fixtures/configuration-steps/build-v2-edited.json)。离线预览不启动 PinK：

```powershell
# 在 tools/build-ui 目录
node dist/configuration-steps-cli.js --file fixtures/configuration-steps/build-v2-basic.json
node dist/configuration-steps-cli.js --file fixtures/configuration-steps/build-v2-edited.json
```

本批离线观察夹具调用真实加载器、编排器、配置操作、共用提交关联/终态跟踪及参数比较，覆盖 JSON 改变流程、关闭重开后的恢复记录、依赖拒绝、提交前失败、入队/终态差异、构建失败后继续、提交歧义/任务丢失/恢复失败停止和报告。实际 UI 控件与任务通知由夹具提供；类型检查和这些结果不代表 PinK 实机构建通过。本轮未启动/连接 PinK、提交构建、改引擎或前端。

## 配置步骤文件 v1（2026-10-23，离线验收）

新增独立格式 `kind: pink-configuration-steps`、`schemaVersion: 1`，由 `configuration-steps-contract.ts` 加载及校验，由 `configuration-steps.ts` 顺序执行。旧四组 `CasesFile`、FORM 和结果文件保持原合同；新文件不能直接传给旧 `-CasesFile`。前端本批不接入。

每份文件包含 `cases`，每项含唯一 `caseId`、已有适配或在 `targets` 中声明的 `platform` 和有序 `steps`。可选 `onFailure: continue/stop`，缺省为 `continue`；`stop` 表示本例失败后先完成恢复，再停止后续用例，不能关闭身份失效或恢复失败的强制停止。步骤 `id` 在本用例内唯一，引用不跨用例。完整可编辑示例：[基础步骤](../tools/build-ui/fixtures/configuration-steps/basic.json)、[修改后的步骤](../tools/build-ui/fixtures/configuration-steps/edited.json)。两份文件使用同一执行器；后一份增加 Debug 设置、提示及可编辑检查，并改变名称目标，没有新增执行分支。

| 操作                       | 输入与依赖                                                         | 输出 / 行为                                                                         |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `record`                   | `fields`；每例最多一份；必须早于修改                               | 记录句柄，以该步骤 `id` 引用；原值/提示/按钮只保留在内存                            |
| `set`                      | `field`、`value`，可选原始文本 `input`；字段须被之前的记录覆盖     | 调用现有 UI 设置和回读；输出 `changed`；相同值不算实际修改                          |
| `read`                     | `fields`                                                           | 生成绑定当前配置页和修改版本的快照；以该步骤 `id` 引用                              |
| `assert` / `check: values` | `snapshot` 引用之前的 `read`，`values` 只包含该快照字段            | 比较目标值；任何中间修改都会使旧快照不可用                                          |
| `assert` / `check: prompt` | `field`、`expected: {kind: none}` 或 `{kind: contains, text: ...}` | 使用现有提示断言                                                                    |
| `assert` / `check: state`  | `field`、`expected` 中的 `visible: true` / `disabled`              | 使用现有控件状态断言；本批禁止 `visible: false`，未识别到控件不能证明它隐藏或不存在 |
| `restore`                  | `record` 引用本例记录；必须是最后一步                              | 恢复记录内的字段及已支持的父子联动，再核对原值、状态和提示                          |

加载阶段检查格式、操作、字段能力、类型、平台归属、步骤唯一性、记录范围、快照来源与新旧、末尾恢复。字段名是稳定 key，不接受 CSS/XPath、JS、循环或分支。`set` 暂只接普通设置能力，场景解析、文件选择、已有游戏选择等专用步骤未接入该新格式。敏感值不能直接写入或比较；材料/场景引用保留在旧合同，新步骤暂拒绝未解析引用，不把对象当实际输入。只读敏感字段时结果脱敏。

可选 `targets` 只描述 PinK 已安装且在当前 UI 可见的新标准表单平台，不负责安装、注册平台或创建控件。每项包含 `id`、精确卡片名 `label`、精确配置页标题 `configurationTitle`、`category`（X-Device/X-Application）和 `fields`。字段必须属于 `packages.<id>.*`，声明 `kind`（string/number/boolean）及 `control`（text/number/boolean/enum）；枚举当前只支持字符串值。不允许覆盖内置平台或字段能力，也不允许通过声明开放秘密值输入。进入页面后再次核对标题、实际字段 key 和控件类型，候选不存在或实际控件不符时拒绝输入。特殊表单、新控件或新行为仍需适配，不能仅改描述就假定支持。

样本：[新增 Basic 平台](../tools/build-ui/fixtures/configuration-steps/new-platform-basic.json)设置 Staging 和诊断开关；[QA 修改版](../tools/build-ui/fixtures/configuration-steps/new-platform-edited.json)交换设置顺序、改为 Production 并增加可编辑断言。平台身份、字段及执行变化都来自文件，启动计划绑定这份描述。该合同不把新平台的配置验收等同于构建验收。

执行器先核对环境提供的 `ExecutionContext` 与打开后的平台上下文。配置页的身份核对、实际输入、联动恢复复用第一批操作层，不新增浏览器控制实现。执行顺序以文件为准，不再按组合名插入配置步骤；恢复只作用于显式记录字段及已有联动字段，并非工程或整个偏好文件备份。QA 仍需记录本例关心的其他联动字段。

失败处理固定为：

- 格式或依赖错误：在任何环境回调前拒绝整份文件。
- 前提受阻、断言失败或一般输入异常：跳过本例余下普通步骤；已取得记录则执行末尾恢复。恢复成功且身份仍可信，下一例继续；不重试失败输入。
- 快照失效：停止后续用例；当前身份仍有效时执行恢复。
- 程序/工程/窗口/平台上下文失效：停止，禁止向未知页面写入恢复值，结果标为 `restoration: unsafe`。
- 恢复失败：停止后续用例，分别保留最初失败与恢复错误；后续项为 `skipped`，不能算通过。

`loadConfigurationSteps(file)` 一次读入文件，保存原文件和规范化文档 SHA-256。执行使用独立副本：磁盘上的后续修改仅影响重新加载；加载对象被直接改写会被哈希/合同检查拒绝。`configurationStepsPlan` 输出离线顺序、依赖、恢复范围和失败规则。独立预览入口从 PinK-Test 根目录运行：

```powershell
node .\tools\build-ui\dist\configuration-steps-cli.js --file .\tools\build-ui\fixtures\configuration-steps\edited.json
```

仅传 `--file` 时仍为离线预览。可加 `--output <新文件路径>`；输出文件已存在时拒绝覆盖。加载/格式/输出错误退出码为 2；启动入口的真实执行方式见下一节。

实际编排通过 `runConfigurationSteps(loaded, {session, openConfiguration, evidenceKind})` 调用。`openConfiguration` 由调用方提供已核实的现有适配器（实机复用 `BuilderConfiguration.open`），不得绕过会话/平台身份核对。该函数本身没有启动或构建操作；启动由下节入口负责。结果 `kind: pink-configuration-steps-result`、`schemaVersion: 1`，包含每步结果、失败原因、清理触发方式、恢复结果、停止原因和源哈希；原始恢复记录不序列化，历史 schema 不改写。已有 HTML 报告器已适配新结果，展示断言/恢复/策略停止及跳过原因。

离线验证替代的只有外部 UI 观察与输入端口，实际调用加载器、编排器、上下文及配置操作层。验证文件修改导致顺序/目标/断言变化、非法依赖拦截、断言失败后恢复并继续、恢复失败停止、部分输入不重试、身份/快照失效停止、敏感值脱敏。不启动 PinK、不运行构建；这些结果不代表实际控件或产品校验通过。

## 步骤文件的启动入口（2026-10-23）

`run-build-ui.ps1 -StepsFile` 将新步骤文件接入原启动门面，内部复用 `startSession/findWindow`、完整程序/工程/窗口核对和 `BuilderConfiguration`。当前开放 web-desktop、web-mobile，以及文件 `targets` 声明的新标准平台；一份启动文件仅允许一个平台。旧参数及旧构建命令不变。步骤入口使用显式 `Pink/Project`，不与 `RunConfig`、旧组合筛选、材料或持久化参数混用，冲突参数直接拒绝。

```powershell
$pink = '<PinK 安装目录或 PinK.exe>'
$project = '<测试工程完整路径>'
$steps = '<步骤 JSON>'
# 先预览；结果目录应与实际执行一致
.\run-build-ui.ps1 -StepsFile $steps -Pink $pink -Project $project -Preview -PreviewFile '<新的计划.json>'
.\run-build-ui.ps1 -StepsFile $steps -Pink $pink -Project $project -ExpectedPlan '<计划.json>' -CheckPlan
.\run-build-ui.ps1 -StepsFile $steps -Pink $pink -Project $project -ExpectedPlan '<计划.json>'
```

启动计划 `pink-configuration-steps-launch-plan` v1 绑定步骤源、产品元数据、完整路径、端口、配置超时和结果目录；任一不一致需重新预览。预览/核验不连接 PinK。已有实例端口可用则核对后接入；未开放端口则要求正常退出，不强杀、不切换工程、不改引擎。实际执行继续读取 UI 回读与恢复结果，不提交构建。

结果目录自动保存计划、JSON 和 HTML。记录启动/接入方式、运行中工程与程序身份、执行器文件摘要、配置页操作前后值和任务/设置文件哈希；全页值不一致时停止下一例。失败退出码为 1，故意错误断言的开发验收也不会被改记为业务通过。最终恢复截图是收尾现场，不冒充失败瞬间截图。配置关闭前核对恢复；恢复或身份不可信时保留现场。

步骤错误保留底层原因链、发生阶段和每步起止时间。恢复记录另附阶段轨迹（字段恢复、联动父项、重开、按钮核对等）；页面打开失败也独立保留。失败时在清理前尝试采集页面身份、脱敏表单和截图；截图可能暴露敏感控件时省略并说明原因。采集失败不得阻止必要恢复。HTML 展示原因链、恢复阶段及现场入口，原值不序列化；这些诊断能力不会改变超时、添加重试或将恢复失败改记通过。

Web 手机端已用[基础 JSON](../tools/build-ui/fixtures/configuration-steps/web-mobile-basic.json)和[修改版 JSON](../tools/build-ui/fixtures/configuration-steps/web-mobile-edited.json)完成两次真实配置验收：修改顺序、目标、字段集合和断言，执行器摘要保持一致；每轮恢复原配置，不提交构建。具体报告和命令见[工具说明](../tools/build-ui/README.md#web-手机端只改-json-的实机验收2026-10-23)。example 新平台因当前 Builder 分类数据缺口已暂停，不能用 Web 手机端的通过结果代替新平台注册验收。

## 同一份用例

默认源为 `tools/case-catalog/public-combinations.json`，也可用 `-CasesFile` 加载 QA 导出的完整文档。展示生成器与执行器复用 `case-contract.ts` 中的校验、模板合并、字段引用与顺序合同；生成器把同一实现注入 HTML，而非另写浏览器版规则。

- `schemaVersion: 1` 是格式版本；`revision` 是自由修订标记，普通修改无需改执行代码。
- `templates[].values` 是公共目标，`platforms[].combinations[].values` 是平台覆盖；删除覆盖即恢复模板值。
- `excludedFields` 声明平台不适用的公共字段，不能同时配置该字段的目标值。
- `fieldTypes` 是已声明的字段合同，不由本轮目标值自动注册。QA 修改已有字段的目标；新控件、行为或平台仍需对应适配能力。
- `configurationOrder` 在已有操作阶段内调整赋值顺序；已知父项先于子项、Debug 最后等必要联动顺序仍由操作能力维护。不是任意脚本或工作流语言。
- `fieldCoverage.state=retain` 表示保留回读，不把当前值当作本轮修改。
- 条件场景使用机器字段 `executionEndpoint: build/ui`，不从中文说明推断终点。

引用示例：

```json
{
  "startScene": { "$scene": "primary" },
  "scenes": [{ "$scene": "primary" }],
  "packages.android.keystorePath": { "$material": "androidSigning.path" },
  "packages.android.keystorePassword": {
    "$material": "androidSigning.password"
  }
}
```

普通中文字符串是合法测试值。未知字段、非法类型、错误平台前缀、格式版本不兼容在启动前报错；私密口令不能直接写进公共用例。材料缺失是对应执行用例的受阻项，不覆盖其他用例结果。

## 私有材料

目录与填写示例见 [materials/build-ui](../materials/build-ui/README.md)。`local/` 保存本机清单与现成文件，已加入忽略规则；不将口令写入页面、公共用例、计划或日志。

`bindings` 按稳定名称绑定值；`bindings.*.path` 相对材料 JSON 所在目录解析，支持绝对路径。`-Materials` 继续兼容既有 `platformValues/scenarios/mixedPlatforms`，其中平台候选绑定只能替代用例明确的材料引用，不任意覆盖固定测试目标。

Android、华为 AGC、Google Play 的发布/混合基础例引用现成 `androidSigning`，调试例使用默认调试签名。PinK 当前没有创建密钥库功能，本期不增加创建操作。离线只验证引用、类型和文件可访问，不验证库口令/别名真实性或签名包安装。AGC 服务 JSON 仍独立检查解析和与用例包名匹配。

## 工程与启动配置

启动配置格式见 `materials/build-ui/run.example.json`；支持安装目录或 `PinK.exe` 路径、工程、用例文件、材料清单、组合、caseIds、端口及结果位置。启动配置中的相对路径以它所在目录为基准。显式 CLI 参数优先于启动配置。

离线预览只读安装包 `product.json` 和工程文件，不枚举/连接运行实例，不查询调试端口、不修改引擎。`startup.runtimeVerified=false`：安装包文件身份不能替代运行中工作台身份。执行器内置完整工程 URI 与程序路径核对，没有新增宿主接口或切换工程行为；web-desktop 已完成下文限定范围的实机启动与接入验收。

四组配置用例不要求工程已有 `temp/pink-builder/preferences.json`：仅当文件不存在（ENOENT）时按没有历史偏好处理，不创建或改写偏好文件。已有偏好的后续阶段检查保留；文件内容损坏或不可读取仍报错。其他旧入口行为不变，不把未知或损坏状态统一当空配置。

## 场景解析

从测试工程 `assets` 发现同时存在 `.scene` 与 `.scene.meta` 且具有 UUID 的候选，按路径稳定排序；孤立 meta 不参与，重复 UUID 报错。普通例使用 primary，多场景专项另需 secondary。没有场景/第二场景只阻塞相应例。

离线计划显示候选与 `runtimeConfirmed=false`，不假装观察过当前 UI。执行器进入配置页后，优先当前有效初始场景，否则使用稳定首个候选；本轮共享该选择，secondary 取另一个真实场景。最终 UI 回读、场景集合和任务比较使用同一份已解析值；不固定旧场景名或 UUID。

## 离线计划与前端

从 PinK-Test 根目录执行：

```powershell
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -Preview -PreviewFile .\results\qa-plan.json

# 离线核验同一计划，仍不连接或启动 PinK
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -ExpectedPlan .\results\qa-plan.json -CheckPlan

# 真正执行时必须携带同一计划；本批未运行此命令
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -ExpectedPlan .\results\qa-plan.json

# 独立读取执行器字段能力
.\run-build-ui.ps1 -FieldCapabilities

# 也可指定 QA 导出的文件；用例筛选仍使用 caseId
.\run-build-ui.ps1 -Plan four-groups -CasesFile '<导出的用例.json>' -Project '<工程>' -Materials '<私有材料.json>' -Groups publish -Cases 'review.publish.taobao-mini-game' -Preview

# 使用同一份导出文件更新静态展示页，不启动 PinK
node .\tools\case-catalog\generate.mjs --cases-file '<导出的用例.json>' --output '<展示页.html>'
```

计划 `kind=pink-build-plan`、`schemaVersion=1`、`phase=offline`，始终 `runtimeVerified=false`、`buildSubmitted=false`。记录用例源 SHA-256、修订、启动文件位置、每项 caseId/平台/组合/终点、脱敏目标、顺序、材料引用、受阻原因、场景候选和每批最多两项的分组。

状态仅为 `ready-for-runtime-preflight`、`blocked`、`not-applicable`，没有“构建通过”。存在受阻项时仍输出完整计划并返回退出码 1；格式或文件读取错误返回 2。输出文件的父目录须存在，未指定 `-PreviewFile` 则输出 JSON 到控制台。

前端导入完整用例时先校验成功再替换当前文档，导出当前完整文档；内存草稿、已导出文件、离线计划和真实运行结果必须分别表达。静态 HTML 不直接启动进程，真实执行仍交给现有本地脚本。运行结束 HTML 报告保持原机制。

## 桌面工作台与执行侧的接入边界

2026-10-21：用户确认展示、QA 编辑和导入导出由前端工作台负责，执行侧只消费用例、校验并正确执行。字段能力、内置完整工程身份核对及计划校验先完成离线验证，随后仅用 web-desktop 验证冷启动与已有实例接入。桌面应用与共享合同的正式发行方式仍由后续接入确定。前端整体架构由「PinK 测试工具前端设计」维护，本文件是构建链路输入输出合同的当前位置，不另维护前端布局方案。

### 现有格式继续使用

| 数据         | 当前格式与归属                                                        | 前端怎么使用                                                           |
| ------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 构建用例原文 | `CatalogDocument`，`schemaVersion: 1`；执行侧定义语义                 | 完整加载、编辑并保存原文；展示布局由构建专属前端视图决定               |
| 字段合同     | `fieldTypes`，已有 `kind/choices/sensitive`；共享 `caseContract` 校验 | 按已声明类型编辑普通值或引用；不复制校验逻辑，不把显示标签当字段键     |
| 私有材料     | 材料清单 `schemaVersion: 1`，`bindings`                               | 展示材料引用及就绪信息，由本地宿主处理私有文件与值；不混入公共用例导出 |
| 启动选择     | `RunConfiguration`，`schemaVersion: 1`                                | 由构建接入模块把选定环境、文件和真实执行 ID 形成启动配置               |
| 离线计划     | `pink-build-plan`，`schemaVersion: 1`，`phase: offline`               | 显示解析值、实例 ID、适用性及阻塞；不显示成运行通过                    |
| 执行结果     | 当前普通四组结果为 `schemaVersion: 6`，`result.json`                  | 展示用例结论、阶段、错误、任务 ID 和证据；原始文件保留                 |

`schemaVersion` 是各自文档的格式版本，`revision` 是用例内容修订；接入模块版本、执行器版本和被测 PinK 版本另记，不能混为一个“版本”。历史结果 schema3/4/5 需要模块显式声明读取支持，不静默按 schema6 解释。

构建用例目前必须保留四个模板及各平台的四个入口。执行侧尚未提供可替代这一结构的通用用例格式；其他链路不必使用四组和平台结构。工作台将链路/模块身份保存在自身的来源配置中，交由对应接入模块选择文档校验器；不要向当前严格校验的 `run.json` 添加 `chainId` 等未知字段。

### 原文、展示和执行实例分开

前端调用共享合同的 `validate` 校验原文，`normalize` 只得到继承合并后的显示投影。编辑时写回原文中的相应模板或平台覆盖，不能把投影整份替换回原文，否则继承关系会丢失。删除平台覆盖表示恢复模板，不表示目标变为空。

- `templates[].values` 保存公共目标；`platforms[].combinations[].values` 保存平台覆盖，稳定 ID 不因标题或排列变化而改变。
- `excludedFields`、`fieldCoverage.state=retain`、待确认项及条件场景必须保留含义。未指定、保留回读和明确的 `false`/空值是不同状态，不能统一填成控件默认值。
- 展示时可用字段中文名、分组、折叠和卡片；执行仍使用原有机器字段键，例如 `packages.taobao-mini-game.globalVariable`。
- 保存或导出需保留未编辑的数据，包括其他平台、变体、条件场景、元数据及未知的非执行扩展属性；公共用例不能混入工作台的选中状态、运行结果或私有材料。
- 平台和组合入口不一定对应单个可执行项。范围选择交给执行侧计划展开；变体和条件场景使用计划实际返回的 `caseId`，前端不自行拼 ID。
- 公共 UI、历史 UI 的说明索引目前不等同于本合同的可写执行用例。前端可另行展示，未有写回和执行合同的条目保持只读或明确标为人工检查，不能因文字可编辑就显示为自动化支持。

例如，QA 将名称改为普通测试字符串，保存到该组合的 `values.name`；选择“自动初始场景”则保存 `{"$scene":"primary"}`，不是将显示出来的场景名或旧 UUID 固定进用例；选择现成签名材料则保存 `{"$material":"androidSigning.path"}`，私有路径和口令由材料文件解析。淘宝的开关和值继续写到 `values` 中已声明的字段键。执行器读取这些数据并调用已有操作能力，不读取 HTML，也不理解编辑器控件布局。

### 字段编辑能力的当前上限

共享纯实现已经可以从 `tools/build-ui/dist/case-contract.js` 导入 `caseContract/createCaseContract`，提供 `validate/normalize/validateValue/reference/orderedKeys`。旧 HTML 通过生成器嵌入同一实现；新工作台接入不再要求使用该 HTML 或其生成器。合同随链路提供同版本编译文件是本轮建议，正式发行布局和版本声明待接入实施时确定，不复制源码维护两套规则。

当前 `fieldTypes` 不是完整的自动表单描述：没有统一的中文标签、控件布局、完整必填/显隐条件或运行时枚举查询接口。`choices` 只代表已声明的静态候选，不等于当前 PinK 控件候选。需要实际工程、模块、账号或服务才能确定的候选仍由运行时确认，离线计划不能伪造这些信息。

标签、布局及辅助提示归前端；字段类型、可执行范围、依赖条件和候选的合法性归对应链路。后续由构建接入模块列出编辑器实际缺少的具体字段能力，再按需补最小机器描述。本轮不新增通用表单语言或任意步骤脚本。QA 可微调已支持字段的值；新字段、特殊控件、新页面或新操作仍需适配，单独增加 `fieldTypes` 条目不代表获得操作能力。

执行器现已提供纯模块 `tools/build-ui/dist/field-capabilities.js`，导出 `describeFieldCapabilities/validateExecutableCatalog/assertSupportedValues`。前端基础语法与继承继续使用 `case-contract.js`；编辑及保存候选还应调用 `validateExecutableCatalog`，使前端与执行入口使用相同的能力限制。`-FieldCapabilities` 输出同一份元数据：`kind: pink-build-field-capabilities`、`schemaVersion: 1`、`capabilityVersion: "1"`、`runtimeVerified: false`，以及以下 `supportedFields[]` 描述。不把该描述混入用例或启动配置。

| 建议能力                | 归属与用途                                               | 当前状态                                                                                                               |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `supportedFields`       | 执行侧明确已适配字段，不能从任意用例的 `fieldTypes` 推断 | 已独立注册 223 个字段；用例新增未知字段、变更类型或降低敏感性会被拒绝                                                  |
| `editable`              | 执行器字段可设值能力                                     | 已导出；某用例是否保留、排除或待确认，前端还须结合该用例合同，不能只看此值                                             |
| `allowedReferenceKinds` | 每字段允许的材料/场景引用                                | 已导出；场景角色仅限 `startScene/scenes`，材料解析后仍验证目标类型与候选                                               |
| `availability`          | 字段适用范围与运行时前提                                 | 已声明 common/platform/l10n 范围、平台限定及 L10N 前提；`runtimeVisibility: must-be-confirmed`，尚无完整父子显隐表达式 |
| `candidates`            | 候选来源与状态                                           | Source Map 为静态合同候选；其他项标记 runtime-ui/not-observed，未新增动态查询接口                                      |

首批接入优先复用现有合同与构建专属适配器；能力未明确的字段不开放自动编辑承诺。其他链路通过自己的接入模块提供对应文档合同和必要能力，不修改工作台核心去识别其平台、页面或操作步骤。

### 保存、计划与运行

前端编辑草稿 → 共享合同校验 → 保存独立用例文件 → 使用该文件生成离线计划 → 确认范围和前提 → 启动同一份文件 → 展示结构化结果。原文、投影、计划和结果应能关联同一份来源。

保存发生文件冲突时前端不得静默覆盖。计划新增 `integrity: {algorithm: "sha256", sha256}`，绑定完整计划内容：源文件字节、脱敏目标及材料解析结果摘要、引用文件内容摘要、程序路径/版本/提交、工程路径/package/场景候选、字段能力、执行范围及超时。材料原始口令不输出到计划。结果输出目录不参与业务计划哈希。

四组实际运行必须提供 `expectedPlan`/`-ExpectedPlan`/`--expected-plan`；没有计划、计划被篡改、当前输入与计划不一致时，在连接或启动 PinK 前拒绝。执行器还核对实际已加载的用例/材料/实例范围，并在连接前再次校验当前文件。`-CheckPlan` 是纯离线入口，仅确认哈希匹配，输出 `kind: pink-build-plan-verification`、`state: matched`、`sha256`，以及 `runtimeVerified: false/buildSubmitted: false`。旧计划没有哈希，需要重新预览；预览会忽略旧 `expectedPlan` 生成新计划，避免无法更新。

运行开始后的用例编辑只影响下一轮，当前执行使用已读取的配置快照。计划哈希不是签名，也不保证运行期间工程、SDK 或外部服务永久不变；仍需要实际身份、UI 与任务参数核对。

当前 `RunConfiguration` 接受 `schemaVersion/pink/project/casesFile/materials/groups/caseIds/port/results/expectedPlan`；新增 `expectedPlan` 是可选路径，真正执行时必须通过配置或显式参数提供。路径相对启动配置文件解析，显式 CLI 参数优先；构建接入使用 `four-groups`。四组不再接受 `--agc-services` 额外覆盖，服务文件通过既定材料引用声明并进入计划；旧 profile 的该参数保留。进程参数使用数组传递，由桌面宿主启动指定执行器；渲染层不拼 shell 命令。当前运行时 Node 要求和执行器交付方式需在桌面打包时明确。

启动后仍由执行侧确认实际程序、工程、构建 Webview、配置页及字段前提。`findWindow` 按工作台 preload 提供的单文件夹 file URI 和程序 execPath 选择唯一窗口，不依赖标题；经 realpath 规范化后比较，Windows 忽略大小写，其他系统不强行忽略大小写。未打开工程、非 file URI、多根工作区、工程/程序不符和匹配歧义均拒绝；配置和提交前再次核对，身份变化停止后续提交。结果记录 `runtimeIdentity` 和 `planVerification`。已完成下文冷启动、接入及三种异常检查；未开工程、多根工作区等其他分支仍只有离线规则证据，不能据此声称所有启动现场均已实测。

前端读取 `cases[].outcome/stage/failure/task/checks/screenshot` 等原生事实；不根据日志关键词、进程退出码或“已提交任务”推断通过。stdout/stderr 目前只作为日志，尚无稳定实时事件协议；结果文件周期写入但未保证原子替换，中间读到不完整 JSON 不应覆盖上一份有效状态为测试失败。停止/取消能力未验证前不能用强杀进程替代。

离线预览退出码 `1` 可能伴随完整、有效且包含受阻项的计划，接入模块仍应读取并展示它；退出码 `2` 才表示格式或文件读取等错误。读取计划也要检查文档格式与来源，不能只依赖退出码。

历史报告和后续复核必须能关联同一次运行及任务，不改写原始结论，也不把只读复核统计成再次构建。原 HTML 报告暂作兼容出口；前端可直接展示 JSON，执行器不承接工作台布局、编辑状态和导航逻辑。

## web-desktop 冷启动与已有实例验收

1958 包 PinK 0.0.2.0，工程 `D:\PinK-test\l10n_007`，沿用当前 custom 引擎。仅两次 web-desktop 发布基础例，各自使用独立用例文件、启动配置和匹配计划：

| 场景                          | 实际结果                                                                                      | 证据                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户保存退出后冷启动          | `launch.mode=started`，PID 44960；完整身份、计划哈希、UI 回读、任务参数和成功卡片通过         | [冷启动报告](../results/2026-10-21-startup-acceptance-1792564691599/cold-results/2026-10-21T06-38-20-251Z/report.html)，任务 `task-1792564793297-0` |
| 接入同一已启动实例            | `launch.mode=attached`，同一 PID；同样完成构建成功核对                                        | [接入报告](../results/2026-10-21-startup-acceptance-1792564691599/attach-results/2026-10-21T06-41-29-659Z/report.html)，任务 `task-1792564902913-1` |
| 所选端口由其他进程持有        | 启动阶段按预期拦截，零提交                                                                    | [端口归属报告](../results/2026-10-21-startup-acceptance-1792564691599/foreign-port-results/2026-10-21T06-40-35-901Z/report.html)                    |
| PinK 已运行但配置的端口未开放 | 按预期拦截，未强制退出或重启，零提交                                                          | [未开放端口报告](../results/2026-10-21-startup-acceptance-1792564691599/unopened-port-results/2026-10-21T06-40-39-698Z/report.html)                 |
| 指定同名但不同路径的工程      | 接入后完整 URI 核对拒绝，未操作构建配置、零提交；指定目录为本轮最小身份夹具，未实际打开或构建 | [工程不匹配报告](../results/2026-10-21-startup-acceptance-1792564691599/wrong-project-results/2026-10-21T06-41-17-319Z/report.html)                 |

三份异常报告记录的是预期阻塞，不计作三次构建。全局与工程 `.pink/settings.json` 文件哈希均保持不变；不验证产物，不重跑其他平台。历史偏好缺失/旧入口拒绝缺失/损坏文件不忽略/已有后续阶段保留等行为有定向文件回归证据；本轮没有为验证缺失偏好而删除实际工程缓存。

## 五项真实样本验收

使用单独的 `qa-inputs-live-20261021` 用例修订，由启动配置加载五项发布基础例，每组最多两项。实机读取工作台的完整工程 URI 和程序路径，确认连接 1958 包的 PinK 0.0.2.0 与 `D:\PinK-test\l10n_007`。这是文件模拟修改后的加载验收，尚未验证前端点击修改及导出。

- web-desktop：运行时优先选择当前有效初始场景，UI 配置、任务参数、构建成功及成功卡片通过。
- Android、华为 AGC、Google Play：现成密钥库引用已进入 UI 和任务；三项构建成功。AGC 同时使用现有服务 JSON。不据此声称已验证签名产物或安装运行。
- 淘宝：全局适配关闭、全局变量 `localStorage,CANNON,LZString,protobuf`、初始场景分包关闭，UI 与任务参数核对通过；custom 引擎的 `buildEngineCommand` 因 Babel 缺少 filename 失败，保留真实失败，未修改 SDK。

首次执行器在启动时加载了旧 L10N 比较规则，把界面补出的未勾选 Catalog 与任务省略项判为差异。已修正为未勾选和省略等价，仍检查缺失或多出的已选语言及非法条目；新增一项定向回归检查。原始执行结果保留，修正后仅对同一批五个任务的入队快照、实时终态参数和历史卡片做只读复核，没有重复提交构建。

[复核结果及失败报告](../results/2026-10-21-qa-inputs-live-1792554937286/execution/2026-10-21T03-55-55-660Z/recheck-report.html)：四项通过、淘宝一项失败，五项均执行到终态；全局和工程引擎设置文件哈希均未变化。[原始执行报告](../results/2026-10-21-qa-inputs-live-1792554937286/execution/2026-10-21T03-55-55-660Z/report.html)保留首次误报证据。既有 2026-10-20 记录保持原结论，不将这五个样本扩展为全平台或全部组合通过。

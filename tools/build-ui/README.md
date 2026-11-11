# Windows PinK UI 构建工具

本工具使用指定 PinK 打包版及现有工程，通过真实 UI 配置、提交和观察构建，不验证产物、不安装 SDK、不调用 PinK 内部自动化基座。四组目录通过 `-CatalogFile` 转换为 v2；有序操作通过 `-StepsFile` 直接加载。每组最多2项：配置页就绪后逐个提交，取得唯一任务ID后继续组内下一项；本组终态、参数和卡片核对完成后才进入下一组。

需要 Windows、Node.js 24+ 和已能手动正常构建的工程及 SDK 环境。包和工程由启动参数显式指定，工具不修改引擎设置。1958 包及后续包的历史证据以各结果文件记载的版本、用例和范围为准，不替代当前版本的新入口验收。

## 预览与执行器身份

原生 Catalog 和步骤文件继续编译到现有 v2。新启动计划的 `executor` 保存合同能力版本、运行 JS 内容清单及 `implementationSha256`，纳入原计划哈希；执行前核对预览身份、当前进程加载身份和磁盘身份一致，运行结果复用同一身份。旧预览缺少身份时必须重新预览，历史结果文件不改写。

宿主通过 `dist/native-case-contract.js` 的 `getExecutorIdentity()` 取得已加载身份，通过 `verifyExecutorIdentity(expected)` 在准备/启动边界核对。原生能力描述的 `capabilityVersion` 为 `5`；身份对象为 `{kind:"pink-build-executor-identity",schemaVersion:1,capabilityVersion,implementationSha256,files}`，其中 `files` 为排序的 `[name,sha256]` 清单，覆盖 dist 顶层非测试运行 JS。宿主应先经过正式身份检查再使用直接缓存的 Catalog/字段合同，并核对 CLI 预览中的 `executor`；旧历史预览允许展示，不能作为新执行计划启动。

只修改用例 JSON 时重新预览即可。执行器代码更新后，已加载的 ESM 合同不能通过入口 URL 加查询参数替换；宿主须提示重新加载工作台后再预览，不自行重启服务或清理草稿。此身份检查不代表 PinK 实机或构建验收通过。

## 当前实例入口与执行能力

统一 v2 启动入口从运行实例的 Builder 活动容器标识发现入口，核对 `SUD.pink-builder` Webview 后读取实际首页和平台卡片，再把用例平台对应到唯一入口。平台用例不使用保存的分类显示名导航，不维护 PinK 版本到分类名称的映射。卡片有平台 ID 时按 ID 核对，否则使用已有目标描述中的精确卡片名与配置页标题合同；无法唯一对应会明确受阻，多个匹配或上下文身份失效仍停止后续操作。公共 UI 按其明确声明的代表平台对应唯一入口，不按分类名称或整组成员推断。

标准 `targets` 的必填项为 `id/label/configurationTitle/fields`；`category` 是可选非空显示文本，可以保留旧名称或填写新的分类名，不参与导航。`id` 仍是用例的平台绑定身份，卡片匹配和同类控件适配边界不变。不存在平台的探查仍需 `homeScope.readyLabels` 唯一对应完整就绪主页，不能用省略分类放宽缺失断言。

公共 UI 的规范目标为 `{"kind":"builder","representativePlatform":"web-desktop"}`，代表平台须已适配或在 `targets` 中明确声明。`builder.open/read/assert(builder-state)/home` 只操作该代表平台所在构建主页，不打开配置页、不扩大成所有平台检查。观察归属使用 `representativePlatform/entryKey`。

旧公共目标 `category:X-Device` 在加载时固定转换为代表平台 `web-desktop`，`category:X-Application` 转换为 `wechatgame`；此表仅用于输入兼容，不是运行时分类映射。未知旧分类、代表平台未声明或同时填写两个字段均拒绝，不猜选入口。加载与组装只返回规范化执行快照，不改原定义文件；旧历史报告继续按原分类展示。组合模板与参数化 flow 使用同一规则，v2 格式和现有步骤操作不变。本批只有离线验证，尚未新增实机证据。

首页须等嵌套文档完成并实际收到平台卡片后才建立路由；页脚先出现、卡片仍为空属于加载未完成，不能据此判定平台缺失。OpenPaaS 等待已有游戏时持续核对配置页归属；账号/已有游戏前提不足可受阻收尾，页面身份失效仍立即停止，不借机自动重试或放宽归属检查。

任务中的初始场景可由 SDK 在构建时从 UUID 解析为 `db://` 路径。入队和终态均用捕获时从当前工程 `.scene.meta` 独立发现的同一场景身份核对；不从任务自己声明的 `scenes` 推导预期，不接受未知、歧义或不同场景。入口发现遵守停止信号，长期 UI 适配器使用独立的安全收尾信号，使已确认归属的关页和恢复不会被普通停止请求本身拦截。

配置页打开并确认归属后、写入前，检查本轮标准控件与构建按钮的适配能力。前序配置可能改变显示条件时，检查记为延后，实际控件仍须在对应写入前通过原有适配器核对。标准目标仍使用现有 `targets` 字段描述，新同类平台、标准字段和枚举值通过用例描述及实际 UI 接入；全新页面机制或控件仍需适配。入口、控件不支持与 Catalog 的材料受阻分别记录在结果及 HTML 报告中；完整选择、顺序、计划完整性和安全收尾不变。此段描述实现机制，实际版本与平台通过情况以对应实机结果为准。

## 运行归属与前提判定

每次运行由内部 `ConfigurationRunSession` 持有停止订阅、CDP 连接、页面上下文、Builder 观察器和任务观察器。获取后立即登记；普通停止只中止后续步骤/入口准备，不取消已关联任务收集或已确认归属的安全收尾。用例操作仍负责页面关闭和其显式要求的恢复，身份丢失时保留现场，不恢复未知页面；普通构建不新增恢复。

任务观察只准备本轮 ready 构建或阶段 UI 用例实际绑定的入口，无关分类不安装或轮询观察器；每个参与入口仍从 UI 读取完整工程任务基线，不按平台过滤已有队列。首次打开、重新激活和安装监听前共用实际页面就绪检查：目标 Webview 唯一可见，内容文档完成加载、构建页入口可用，且没有等待替换的 `pending-frame`；活动栏展开或旧页面仍可见不能替代就绪。安装时记录嵌入文档的标准 CDP 节点身份，在历史页输入前后及基线返回主页后核对监听归属。初始化失败记录入口、平台、具体输入阶段、文档和 active/pending Frame 状态，后台读取失败保留同一底层错误链；安装后出现非预期替换仍停止，不自动重装观察器或重试构建。任务观察准备成功不等于构建或安全停止已实机通过，模拟文档切换的离线回归也不能替代实机验收。

成功卡片仍按本轮任务的批次时间、平台和输出名唯一核对。平台 ID 绑定到本轮已核对配置页的实际标题，再精确匹配卡片的“平台标题 - 输出名”；不从可由目录配置覆盖的图标 URL 推断平台 ID。缺少本轮标题绑定时停止，卡片超时记录期望标题、匹配数和实际状态。日期显示沿用当前 Builder 注入的 `locale` 及随包日期格式（包括英文月份缩写的句点），历史入口和成功标签复用已核对的中英文标签；同批次时间或同名卡片存在歧义时仍失败，不接受其他历史成功记录替代，也不把生成状态当作构建成功。

3D 物理字段 `overwriteProjectSettings.includeModules.physics` 的实际引擎候选沿用 SDK 机器值。打开配置页前按需复用 Builder 消息监听，严格识别页面自动取得的 `getEngineModules` 返回结构，只保存 `physics.options` 的机器值和当前显示标签；不主动调用接口、不读取 React 状态、不维护中英文翻译表。数据按当前文档及配置页打开周期隔离，旧响应序列不覆盖新结果；仅配置用例不因此启动任务基线或任务观察器。当前控件 `aria-controls` 对应的唯一列表内完成候选定位和点击，最后独立回读机器值。页面额外添加的 `inherit-project-setting` 分支仍按原适配单列，不计为此项元数据覆盖。

物理候选缺失或禁用时，只有原控件、原列表及其唯一 `select-content` 焦点容器仍可确认归属，才发送一次 Escape；核对列表关闭且机器值未改变。归属不明或清理失败保持停止。此实现的中英文与失败收尾离线回归使用模拟 UI 响应，不替代当前打包版的真实构建/安全停止验收。

运行收尾只执行一次：先释放任务观察器、使页面上下文失效、释放 Builder 观察器，再断开浏览器连接、排空检查点并写最终报告。某项释放失败仍继续其他释放，保留原始失败及底层清理原因；报告写出失败也必须释放本次停止监听，不重试 UI 或重复生成任务。这里只断开工具持有的连接，不关闭用户的 PinK 窗口。

原生步骤、组合和 Catalog 共用启动计划的 `steps.preflight` 完整有序清单，包含 `caseId/platform?/target?/title?/group?/status/gaps`。`status` 为 `ready/blocked/not-applicable`；`willSubmit` 只统计 ready 用例。组合的 `caseIds/sourceMap` 保留所有选择，不过滤受阻项；`preflight` 纳入新组装快照的映射哈希，旧组装映射仍沿用其原合同。

v2 用例可携带 `precondition:{status:"blocked"|"not-applicable",gaps:[{kind,reason}]}`，可选 `title/group` 仅用于展示。有完整步骤时仍校验全部操作、输入类型、引用及收尾；无操作链的明确保留项只能使用 `steps:[]/finally:[]`，不会伪造动作。材料引用未能解析会阻塞整条 flow，独立用例继续；普通受阻/不适用项不占构建组，`onFailure:stop` 的受阻项保留顺序停止边界，不发送 UI 请求。不适用项不当作通过。每组最多两项，不截取半条用例运行。

未知操作、错误类型、引用或步骤依赖属于定义错误，组合不产出可执行文档；缺材料、适用性及已声明的执行支持缺口保留为逐项前提。当前输出依赖仍限于同一 flow，跨用例输出是定义错误，不新增依赖语言。全受阻/不适用时只生成预检 JSON/HTML 报告，不启动或连接 PinK；部分可执行时仅为 ready 项准备 UI 和构建观察。编译得到的前提记录属于本轮快照，补齐材料后从原定义重新准备/预览，不在运行中自动解除，也不改写旧结果。前端展示清单、原因、来源和报告入口，不自行推断 readiness 或过滤原选择。

## 标准目标配置检查补充（2026-11-02）

沿用 `describeNativeCaseCapabilities().targetsSchema`、组合校验/组装及原生 v2 入口，不增加操作或 IPC。以下新增能力只有定向离线证据，尚待独立 QA 做真实 UI 复查；不表示新平台或候选已经实机通过。

纯 `platform.probe` 与对应 `assert(check=probe)` 链路允许 `finally: []`，不会为了收尾打开不存在的平台。平台缺失仍须 `homeScope.readyLabels` 对应范围完整就绪，否则受阻。任何打开配置页或修改配置的链路仍须原有打开/关闭收尾；记录、修改、恢复及上下文归属规则不放宽。例如下列 case 绑定到另行声明的 `qa-absent` 标准目标：

```json
{
  "caseId": "qa.platform.absent",
  "platform": "qa-absent",
  "steps": [
    { "id": "probe", "op": "platform.probe" },
    {
      "id": "expected",
      "op": "assert",
      "check": "probe",
      "observation": "probe",
      "expected": { "presence": "absent" }
    }
  ],
  "finally": []
}
```

标准枚举可显式声明混合标量。以下是 `targets[].fields.sourceMaps` 的字段描述，值 `false`、`true`、`"inline"` 保留各自机器类型：

```json
{
  "kind": "scalar",
  "control": "enum",
  "valueKinds": ["boolean", "string"],
  "locator": { "kind": "option-key", "key": "sourceMaps" },
  "scope": { "readyKeys": ["name", "buildPath"] }
}
```

`valueKinds` 必须显式列出至少两种不重复的 `string/number/boolean`，仅允许用于 `kind=scalar/control=enum`；旧单一 kind 不变。字段 Schema 通过 `oneOf` 提供单一类型和混合枚举两分支，前端消费其中的 `properties/required/valueKinds.items.enum`。显式描述字段的设置、候选选择、回读、独立预期和恢复均保留类型，不沿用旧平台字段的值转换；预期布尔 `false` 不等于字符串 `"false"`。新目标/扩展字段仍仅配置检查，不能提交构建，敏感字段和跨平台限制不变。

读取候选后，工具只清理自己打开的弹层：核对原触发器、`aria-controls` 关联列表及焦点归属，发送一次 Escape，等待展开状态与原列表可见性均关闭，并核对配置值未因关闭变化。不会重试输入、选择替代候选或点击其他控件来关闭；无法安全确认时仍报告 `standard-enum.dismiss` 并停止后续操作。配置检查计划继续要求 `willSubmit=false`。

## 组合用例入口（2026-10-28）

保存与本轮准备分别调用 `await validateCaseComposition(definition, selection?)`，返回 `{valid,definitionSha256,contextChecked:false,diagnostics,deferredChecks}`，不返回可执行 assembly。省略 selection 校验全部实例；传入时应用本轮覆盖/主步骤选择后校验。空定义可以保存，显式空选择仍报错。作者态只展开符号定义，复用原步骤生成器和依赖校验；不会读取工程、材料文件或 PinK。材料/场景角色、适用性及明确保留的执行支持缺口进入 deferredChecks，不能当作可运行；未知操作、错误类型/引用/静态依赖仍是错误。未实例化片段先检查结构、符号和引用循环，参数绑定后的生命周期检查明确保留待核对。原始 Catalog 中有明确受阻/不适用声明但尚无操作链的样本只作保留项，不可改写其不存在的操作输入或预期。

`listNativeCaseReferences(document)` 是纯定义清单，返回 `{documentSha256,items:[{caseId,platform?,target?,title,origin}]}`。origin 提供 kind、sourcePath 和对应 combinationId/scenarioId/familyId/sampleId；清单不证明可执行。FORM-C01.s01 的 web-desktop 正式身份是 FORM-C01.s01.web-desktop，样本别名不作为唯一 case-ref。创建引用、Catalog 运行选择共用清单展开规则，前端直接执行和插入组合都使用正式 caseId，不拼后缀；跨来源缓存须连同来源哈希保存。该接口只读取传入的内嵌定义，不混入本机外部表单样本。

宿主可沿现有 authorAutomation 转发 `validateComposition`（definition/selection?）和 `listCaseReferences`（document）；工作台桥接由前端工程负责。真实 preview 独立调用 `composeNativeCases(...,{project,materials})` 并冻结计划；前提缺口逐项保留为 preflight/precondition，不能因为保存通过就放宽运行条件。两个函数从 `dist/native-case-contract.js` 再导出；最初接入只有静态证据，后续变更和离线验证不替代独立 QA 的实机复查。

边界保留：前端把 Catalog 引用“创建独立副本”时仍调用 compose；若没有工程/材料上下文，含符号材料的副本可能受阻。本批不新增拆链或副本接口、不放宽校验，普通复制引用不受影响；由独立 QA 记录和复查。

宿主可从 `dist/native-case-contract.js` 导入 `describeCaseComposition/createCaseComposition/composeNativeCases/mapCompositionResults`。组合 JSON 支持有序分组、原生用例引用、参数化片段和显式动作链；本轮可选择实例、调整顺序和覆盖输入。定义中的依赖、断言及收尾不完整时只返回诊断，不生成可执行的部分结果；单项环境前提不足按上述 preflight 规则保留，不使其他独立用例消失。

组合定义先由 `composeNativeCases` 生成原生 v2，宿主另存 `cases.json` 和含 sourceMap 的 assembly 快照，再复用原启动/计划校验入口。CLI 不直接读取 `pink-case-composition`。原生用例引用按完整用例执行，局部操作选择仅用于显式 flow，before/finally 始终保留。

公共构建主页可使用 target-only 的 `builder.open/read`、结构化状态断言和 `builder.home`，只检查历史、全部构建入口的显示及禁用状态；不点击全部构建。公共项单独作为调度屏障，其他平台仍每组最多两项。历史记录专项未迁移为组合动作。

样本见 `fixtures/case-composition/reuse.json` 和 `selection.json`；正式 Schema、参数、快照哈希、独立复制及结果映射规则见[组合用例合同](../../docs/pink-build-case-input-contract.md#组合用例正式合同2026-10-28)。本批完成离线验证，未启动 PinK 或提交构建，新组合入口的实机能力仍待独立验收。

## 原生用例与仅配置入口（2026-10-27）

前端/宿主可用 `node dist/configuration-steps-cli.js --describe` 读取正式能力版本 2。`--input <JSON>` 识别 Catalog、步骤 v1/v2；原有 `--catalog/--file` 保留。普通组合加 `--endpoint ui` 由执行侧编译为配置检查与恢复，省略保持原构建语义。三类输入的启动计划均明确输出 `steps.execution.willSubmit`，配置检查宿主仍要求 false，不兼容缺字段的旧计划。

`dist/native-case-contract.js` 提供原生识别、校验、保存、加载、配置检查默认模板及能力描述。标准目标随用例保存，支持新平台及已有平台的新标准字段、运行时候选和结构化探查；新目标仅配置检查，未知控件仍受阻。正式字段、命令、顺序与材料边界见[当前输入合同](../../docs/pink-build-case-input-contract.md#原生用例与仅配置终点正式合同2026-10-27)。[标准目标样本](fixtures/configuration-steps/standard-target-v2.json) 是离线夹具样本，不代表该平台已安装或实机通过。

本批只做类型/编译及受控夹具的定向离线验证，未启动 PinK、提交构建或修改前端。CLI 的 `npm run build` 是工具 TypeScript 编译，不是 PinK 工程构建；新目标的真实 UI 验收仍待后续安排。

## QA 进度接入（2026-10-26）

执行中输出平台、组合、当前阶段和已处理数量；`PINK_BUILD_PROGRESS ` 行后是稳定 JSON，普通 `[progress]` 行供直接阅读。前端读取同一份 `result.json.progress` 或解析通知即可，状态与统计由执行侧给出。启动目录、计划、最终报告及失败证据的读取、停止方式见[进度与产出合同](../../docs/pink-build-case-input-contract.md#面向-qa-的执行进度与产出2026-10-26)。HTML 是报告入口，实时进度不依赖自动刷新 HTML。

当前共 16 个平台有基础成功证据，其中部分复用同版未受影响的样本；本批完成 Web 桌面发布、荣耀/OPPO/vivo/华为快游戏/淘宝/Facebook/Google Play 调试，以及双任务排队和前提受阻输出。OHOS 本批保留；OpenPaaS 当前未登录，须具备账号前提后再验。完整组合身份、来源和限制见[验证范围](../../docs/pink-build-case-input-contract.md#本批验证与当前基础范围)。这不是所有平台四组全部通过，也不是前端已完成真实执行接入。

## 配置恢复按用例选择（2026-10-26）

发布、调试、混合的普通构建组合结束后保留本次测试配置，不再自动记录原值、重开配置页和恢复。任务仍须唯一关联，收集终态并核对参数与卡片；不恢复不等于省略观察器释放、报告收尾或异常拦截。

需要保护初态的专项保留显式 `record` 与 `finally/restore`，包括持久化、反向校验、条件专项及阶段串联操作。四组目录的第四组仍生成恢复步骤；手写 v2 JSON 可通过是否声明这对步骤选择保留或恢复，不新增文件格式。声明 `record` 后，所有修改及已支持的联动字段必须先记录，末尾必须恢复；阶段关系仍需独立的 `stage.record/stage.restore`。

未声明恢复的结果为 `restoration: not-required`，不会宣称恢复通过。成功提交后不重新打开配置页；提交前失败且页面仍可信时只关闭当前页，保留已填写的测试值，下一例应明确设置自己的输入。身份、任务关联或观察不可信时仍停止，不自动重试。

此调整晚于下方固化基线；旧结果按当时规则保留，不改写通过状态。2026-10-26 已完成 [web-desktop 调试单例实机验收](../../results/2026-10-26-keep-config-acceptance-1793000489942/execution/2026-10-26T07-42-44.794Z-steps/report.html)：1949 包、原工程与 custom 引擎，配置页只打开一次，任务成功且参数/卡片匹配，测试配置保留，观察器与连接清理通过，无警告。该单例是保留策略证据，后续双任务关联修复和其他平台结果见上方 QA 进度接入章节；运行前仍须重新生成计划。

## Windows v2 试用基线（2026-10-26）

交付形态为可追溯的源码基线，版本以所交付 Git commit 为准。当前包级证据来自 PinK `2610231949 / 0.0.2.0`、已准备工程与 custom 引擎；完整构建路径的首批语言范围为中文。英文目前只补验 web-desktop 中断路径，普通成功卡片和历史批次日期仍有中文定位，不能按英文完整链路已支持交付。固化后的基础验收和进度接入结果见上方章节，冻结源码不等于 18 平台四组全部通过。

保留整个仓库中的工具源码、锁文件、用例目录和 fixtures；`dist/node_modules/results` 及 `materials/build-ui/local` 不入库。接收方准备 Node.js 24+ 后，在 PinK-Test 根目录执行以下准备命令；无需 PinK 源码或另装浏览器：

```powershell
npm ci --prefix .\tools\build-ui
npm run build --prefix .\tools\build-ui
```

将[材料示例](../../materials/build-ui/materials.example.json)复制到本机私有材料清单，并填写所选用例实际需要的材料。首次选一例，先预览与核验，再执行同一份输入；修改 JSON、材料、包、工程或选择范围后重新预览。以下变量替换为本机路径，最后一条会操作 PinK 并提交所选构建：

```powershell
$qaInput = @{
    CatalogFile = '.\tools\case-catalog\public-combinations.json'
    Cases = 'review.publish.web-desktop'
    Pink = 'C:\QA\PinK-package\PinK.exe'
    Project = 'D:\QA\test-project'
    Materials = '.\materials\build-ui\local\materials.json'
    ResultsRoot = '.\results'
}
New-Item -ItemType Directory -Force .\results | Out-Null
$qaPlan = '.\results\qa-web-desktop-plan.json' # 使用尚不存在的文件名
.\run-build-ui.ps1 @qaInput -Preview -PreviewFile $qaPlan
.\run-build-ui.ps1 @qaInput -ExpectedPlan $qaPlan -CheckPlan
.\run-build-ui.ps1 @qaInput -ExpectedPlan $qaPlan
```

有序步骤文件改用 `-StepsFile <文件>`，并去掉 `CatalogFile/Cases`；不要混用 `-RunConfig`。未启动 PinK 时工具启动指定包与工程；已有同版、同工程且开放调试端口的实例可接入。未开放调试端口、身份不符或已有活动队列时按原因受阻，不强制退出用户实例。执行期间保持窗口可操作，每台机器同一时间运行一条链路，避免手动修改配置。

结束查看本次目录的 `result.json/report.html`，同时检查用例结果、任务 ID、按用例要求的恢复及资源清理；Ctrl+C 请求安全停止并等待报告。缺材料、不适用和未实现分支保留原因，不计通过。旧 `-RunConfig/Profile/Suite` 不包含本批完整进程保护。下方日期章节记录演进过程；当前能力与准确限制以[输入合同](../../docs/pink-build-case-input-contract.md)为准。

固化时的基础验收安排为每个平台一个具备前提的用例，使用 v2 入口、每组最多两项，核对配置到任务终态、参数、按用例要求的恢复和报告。基础用例按平台实际条件选取，不机械使用同一发布组合；缺材料/不适用单列，提交不明、身份失效或必要恢复失败按现有规则停止。已验证的公共 UI、反向样本和全部组合不加入本批重复执行；实际结果与保留项见上方验证范围。

旧 `Profile/Suite` 入口继续保留：`existing` 沿用当前配置，`debug/release-a` 含18平台适用基础项，`release-b/release-c-local` 限原优先8平台。[首批定稿](../../docs/pink-build-ui-automation-design.md#首批交付范围定稿2026-10-19)及后面的日期章节记录历史范围；当前 v2 能力和保留缺口以[输入合同](../../docs/pink-build-case-input-contract.md#四组目录接入-v2-与专项步骤2026-10-24离线)为准。

统一 v2 入口使用左侧当前 Builder 活动容器标识与展开状态定位；旧版独立模式仍保留其分类入口合同。顶部分类菜单在连续执行时出现 Webview 遮挡，故不作为统一入口。启动时恢复最小化的指定 PinK 主窗口并请求前台显示，以使 Webview 正常渲染和接收输入。入口切换、配置和构建均为真实输入，不依赖固定坐标或新增快捷键。执行期间不要最小化窗口或同时操作配置。

2026-10-24：新 `-CatalogFile` 入口的 web-desktop 单例实机验收已通过，[报告](../../results/2026-10-24-catalog-v2-web-desktop-1792837002174/2026-10-24T10-27-00.517Z-steps/report.html)包含修改 JSON 后的真实配置、任务关联、成功判定及自动恢复。使用当前 1949 包、原工程和 custom 引擎；未验证产物或重跑其他平台。已补已知阶段 ID 小写文案适配；初次失败、人为中断与观察器清理记录、准确证据边界见[验收记录](../../docs/pink-build-case-input-contract.md#四组统一入口-web-desktop-实机验收2026-10-24)。

## Windows 停止与收尾（2026-10-26）

`-CatalogFile/-StepsFile` 执行中按 Ctrl+C 会请求停止。工具完成当前原子操作，不再进入新步骤；已唯一关联的任务仍按原上限等待收尾，再在身份和任务状态安全时恢复原配置。不自动重试点击、取消构建或强制结束 PinK。停止期间应等待最终报告，不要继续结束执行进程。旧 `Profile/Suite` 入口不包含这批进程保护。

启动进程与执行进程分开，Windows 下关闭启动进程也会通过断开通知请求执行进程收尾。拥有启动进程 IPC 的调用方可发送 `{ "type": "pink-steps-stop" }`，复用同一停止路径。直接强杀实际执行进程或断电无法继续内存恢复；结果保留为未完成，需核查现场。

连接前创建 `result.json/report.html`，JSON 随执行更新；最终报告包含中断、恢复和资源释放结果。`lifecycle: finished` 表示执行已结束，仍须查看用例、恢复及清理结果；中断不会变成通过。观察器仅释放本次所有权对应的监听，外来监听保留并拦截。完整合同及证据见[中断与安全收尾](../../docs/pink-build-case-input-contract.md#windows-中断与安全收尾2026-10-26)。

已用当前 1949 包、原工程和引擎完成 web-desktop 两项定向实机自检：配置修改后结束本次监管进程，以及任务 processing 时发送停止消息。均恢复配置、跳过后续用例并释放资源；后者任务收集到 success，仅提交一次。报告故意保留 `failed/stopped`，自检目标通过不等于中断用例构建通过。

随后已针对中间检查点警告复现并修复 Windows 并发读取导致的 JSON 替换 `EPERM`：只对该次文件替换限时等待，超过 1s 仍报错，旧 JSON 保留；最终快照等待此前诊断归集。修复后的 web-desktop 配置中断验收没有警告，配置和资源恢复通过，未提交或重复构建。旧警告缺少 errno，历史报告保持原样；准确证据见[检查点修复](../../docs/pink-build-case-input-contract.md#检查点替换警告修复2026-10-26)。

本次还修正工作台被后台商城嵌套 iframe 干扰的接入问题：Playwright 只接管工作台，Builder 沿用独立 CDP 连接；没有改第三方依赖或产品文件。英文文案适配仅核实 web-desktop 中断路径，不外推为其他平台和历史 UI 全部英文可用。

## 四组目录与步骤共用 v2 入口（2026-10-24）

`-CatalogFile` 接受现有四组用例文件，转换后与 `-StepsFile` 共用计划、启动、两项调度及报告。`-Cases/-Groups` 用于选择目录中的用例；原始步骤文件以 JSON 的 `cases/steps/finally` 顺序为准。旧 `-CasesFile/-Plan four-groups` 保持兼容，不会被静默切换执行语义。

```powershell
# 在 PinK-Test 根目录：以下两条只离线预览/核验，不连接 PinK；输出文件须尚不存在
.\run-build-ui.ps1 -CatalogFile .\tools\case-catalog\public-combinations.json -Cases review.publish.web-desktop -Pink '<待测包目录>' -Project '<工程目录>' -Materials '<私有材料清单.json>' -Preview -PreviewFile '<新计划.json>'
.\run-build-ui.ps1 -CatalogFile .\tools\case-catalog\public-combinations.json -Cases review.publish.web-desktop -Pink '<待测包目录>' -Project '<工程目录>' -Materials '<私有材料清单.json>' -ExpectedPlan '<同一计划.json>' -CheckPlan

# 执行时去掉 CheckPlan；使用相同输入与 ExpectedPlan，才进入启动/接入和 UI 链路
# FORM 只检查 UI：选择 -Groups conditional -Cases FORM-C06.s02（不附加基础构建）
# 字段和可组合操作清单；此命令不连接 PinK
.\run-build-ui.ps1 -FieldCapabilities
```

目录源、FORM 来源、材料及工程变化会使预览失效。缺材料、不适用或缺操作的条目保留在计划和报告里，不执行省略断言的草稿；全部不可执行时直接产出报告，不启动/连接 PinK。`ready` 仅指离线合同完整，不是实机通过。

此批把文件取消、字符串清空、场景保护、初态要求及跨修改/重开的保留值断言接成普通 v2 操作。已有 FORM 反向样本可以展开为可编辑步骤，仍不提交异常构建；敏感空值通过 `input.clear-field` 与 `assert/empty` 检查。发布加密引用 `nativeEncryption.key`，私有清单示例见 [材料目录](../../materials/build-ui/README.md)。其他适配范围和保留缺口见[当前合同](../../docs/pink-build-case-input-contract.md#四组目录接入-v2-与专项步骤2026-10-24离线)。本批仅离线验证，未修改前端或引擎，未启动 PinK/提交构建。

## v2 跨平台两项调度（2026-10-24，第三批记录）

`-StepsFile` 的同一份 v2 JSON 现在可含多平台 `cases`。按文件顺序每组最多两例：组内逐例配置、回读、唯一关联提交，走到 `build.wait` 暂挂；提交阶段结束后依次等待、核对及恢复，本组收尾后才开下一组。同平台重复会提前分组，避免配置和恢复基线互相覆盖；受阻或提前结束不补进第三项。等待后的 JSON 步骤仍按顺序执行。

当前实例的构建入口复用已有 Builder 和完整任务观察器，启动时统一核对基线，切换入口保留观察。每例通过自己的提交步骤引用和 taskId 核对入队/终态参数；任务与结果不能跨例串用。普通失败安全收尾后按 `onFailure` 继续或停止；提交无法唯一确认、身份/观察失效、超时或恢复失败立即停止新提交，不自动重试。已关联任务仍尽量收集，不安全时不恢复配置。

离线预览列出两项分组及屏障策略，并纳入哈希。结果 schema2 包含 `execution/groups`，保留用例与任务关联、分组时刻和实际队列观察；未观察到排队不冒作队列通过。该批先完成离线验证，随后[微信与 Web 手机跨分类实机验收](../../results/2026-10-24-v2-cross-platform-1792824582684/2026-10-24T07-11-45.981Z-steps/report.html)两例均通过配置、任务参数、成功卡片及恢复。详见[调度合同](../../docs/pink-build-case-input-contract.md#v2-跨平台两项调度2026-10-24第三批离线验证)，第四组迁移/材料缺口仍单列。

仅构建用例需要独立的“构建”按钮。v2 已支持显式阶段记录、连接/拆分、回读/断言和 `finally` 恢复；普通构建仍不自动解除用户串联，提交快照与点击前都检查仅构建范围，不能把复合按钮直接当作构建按钮点击。阶段专项样本见 [stage-controls-v2.json](fixtures/configuration-steps/stage-controls-v2.json)，准确初态、操作及失败合同见[阶段操作](../../docs/pink-build-case-input-contract.md#v2-阶段串联操作2026-10-24)。枚举目标使用实际 UI 候选值，例如当前微信横屏为 `landscapeRight`，Web 手机横屏为 `landscape`。下拉输入失败会关闭该控件的遗留弹层后保留原错误，供既有恢复步骤收尾；弹层不能安全关闭时停止后续操作，同时保留原错误与清理诊断。

## 步骤 JSON v2：打开、关闭与构建（2026-10-23，第一批记录）

新增 `config.open/config.close/build.submit/build.wait`，并扩展构建快照和结果断言；QA 可以在 JSON 中安排配置、关闭重开、提交、结果检查及 `finally` 恢复。v1 保持原行为。完整输入/依赖/失败合同见[步骤 v2](../../docs/pink-build-case-input-contract.md#步骤文件-v2页面与构建生命周期2026-10-23仅离线验证)。

样本：[基本链路](fixtures/configuration-steps/build-v2-basic.json)、[关闭重开与不同配置链路](fixtures/configuration-steps/build-v2-edited.json)。两份文件共用执行器，不按用例名分支。本批 v2 一例最多一次提交，串行收尾；构建限 Web 桌面/手机，材料及其他平台仍走旧入口。旧入口原有每组最多两项调度保持不变。

旧构建入口和 v2 复用 `build-operations.ts` 的单次提交/唯一关联、任务状态读取及成功判定；v2 等待复用既有观察器与超时计算。字段表示差异从四组流程移入 `build-task-values.ts`，旧入口继续使用同一比较函数。观察器归执行会话所有，不随配置页关闭释放；恢复记录可交给同会话同平台的新页面适配器。

已有离线验证：不同 JSON 改变页面/配置顺序、依赖与旧引用拒绝、真实场景元数据解析、输入断言失败不点击、入队和终态参数差异/明确构建失败后收集恢复并继续、提交无匹配/多匹配/响应不明不重试、任务丢失/两类超时/恢复失败停止、报告保留任务与清理错误；v1/原配置操作/字段比较及报告兼容检查通过。夹具只替代外部控件和任务通知，未连接 PinK，不是实机通过证据。前端未修改。

## 配置操作解耦（2026-10-23，第一批仅离线验证）

四组执行入口已使用共同的 `ExecutionContext`、`BuilderConfiguration` 和 `ConfigurationOperations`。程序/工程/窗口身份由已有工作台核对提供；配置页同时绑定平台标题、工具打开代次及标准 CDP DOM 节点身份。关闭、切换或重建后旧上下文失效，输入前再次核对身份；不启动或切换额外实例，不改引擎设置。

可独立调用的配置能力：`record` 记录原控件值/提示/按钮，`set` 使用现有 UI 适配设置与回读，`snapshot` 读取配置快照，`assertValues/assertPrompt/assertState` 检查值/提示/显隐禁用，`restore` 恢复并核对。`reopen` 换用新上下文；同会话同平台的恢复记录可保留，旧快照不能沿用。恢复会按已支持的父子关系先恢复可编辑子项，再恢复父项；不覆盖整个偏好文件。记录范围是操作前指定字段与已声明的关联字段，不是打开页面前的全工程备份。

下面是执行侧的 TypeScript 调用方式，**不是新用例文件格式**：

```ts
const original = await configuration.record(["name"]);
try {
  await configuration.set("name", "qa_editable_case");
  const snapshot = await configuration.snapshot(["name"]);
  await configuration.assertValues(snapshot, { name: "qa_editable_case" });
  await configuration.assertPrompt("name", { kind: "none" });
} finally {
  await configuration.restore(original);
}
```

四组现有配置步骤和反向用例均调用这层能力。反向控制器的记录/恢复已抽出；普通配置组合的联动排序、专项条件和组合级恢复仍保留原实现，通过共同操作层访问 UI。普通构建没有新增默认恢复行为。提交前补查快照是否仍属于当前配置页、是否被后续修改或页面外部改值影响；构建提交、唯一任务关联、队列、历史页操作和报告沿用已有流程，本批未将其改造成操作序列。

操作错误区分 `blocked/failed/stop`：前提缺失受阻，断言不符失败，身份/快照失效或恢复失败停止。停止后保留配置现场，已有报告机制继续记录原因；敏感原值和恢复记录只留在进程内，不加入公共报告。现有用例 JSON、四组入口及结果 schema 不变；后续新增的有限步骤格式见下节，前端编排尚未接入。

本批只编译工具并做离线观察夹具验证：正常组合、身份漂移、页面重建、旧快照拒绝、隐藏子项恢复、部分输入异常与恢复失败。夹具提供 UI 观察及输入端口，实际执行共同操作与控制器；不替代 PinK 实机验收。未连接/启动 PinK、提交构建、修改 SDK/引擎或验证产物。

## v2 保留值与平台操作（2026-10-24，第二批）

步骤 JSON 新增保留初值及断言、配置就绪/依赖准备、网络超时展开、隐藏前回读证据、Google 图标、OpenPaaS 已有游戏和 AGC 文件/包名检查。保留和隐藏值进入同一份提交快照，继续核对入队和终态参数；缺少观察不计通过。沿用现有输入、任务关联与失败恢复代码，细节见[当前步骤合同](../../docs/pink-build-case-input-contract.md#v2-保留值联动和平台专属操作2026-10-24第二批离线验证)。

四组转换预览已使用这些操作。第二批开放已登记的18平台，AGC/OpenPaaS 必须有专属提交前检查；当时仅单平台串行，跨平台调度现见第三批章节。第四组复杂专项及部分材料/输入合同缺口继续单列。旧四组入口保留，前端未改。本批仅离线验证，没有启动 PinK 或提交真实构建。

## v2 场景、材料与四组迁移预览（2026-10-24，第一批记录）

`-StepsFile` 已支持 `-Materials`。v2 的设置和断言可使用现有 `$scene` / `$material`；运行前绑定指定工程和材料，缺材料阻止该用例，输入变化使预览失效。场景恢复同时保护初始场景与场景集合，密码不进入计划或报告。v1 行为不变。

新增 Node `configuration-steps-cli --catalog` 离线转换预览，直接读取 `tools/case-catalog/public-combinations.json`，保留四组身份、终点、材料/适用性及尚未迁移的断言。只给合同完整的条目输出 v2 `document`，不会将遗漏专属检查的条目标成可执行。正式 18 平台四组仍有迁移缺口；目前不替换原四组入口。命令与边界见[输入合同](../../docs/pink-build-case-input-contract.md#v2-输入与四组迁移第一批2026-10-24仅离线验证)。

第一批仅离线验证，当时只读确认现场包为 `PinK-win32-x64-2610231949-0.0.2.0`，未验证新包 UI。当时未接入的专属操作及两项调度现见第二、第三批章节；前端未改。

## 配置步骤加载与编排（2026-10-23，第二批仅离线验证）

新增独立的 `pink-configuration-steps` v1 文件，支持 `record → set → read → assert → restore`。同一执行器按文件中的顺序、字段和目标执行；断言引用回读步骤，恢复引用记录步骤。正常链路、提示/可编辑检查可通过改 JSON 调整，已有四组文件继续使用原入口。

从工具目录预览任意该格式文件（不连接或启动 PinK）：

```powershell
node dist/configuration-steps-cli.js --file fixtures/configuration-steps/basic.json
node dist/configuration-steps-cli.js --file fixtures/configuration-steps/edited.json
```

已有已核实的配置环境时，调用执行函数：

```ts
const loaded = await loadConfigurationSteps(file);
const result = await runConfigurationSteps(loaded, {
  session,
  openConfiguration: (platform) => BuilderConfiguration.open(builder, session, platform, signal),
  evidenceKind: "runtime",
});
```

该执行函数由调用方提供 Builder 分类和既有会话；第二批离线检查注入 UI 观察端口，标记 `offline-fixture`。后续启动入口与 HTML 报告接入见下节，前端仍未接入；字段、材料、专用控件仍有明确能力边界，详见[步骤合同](../../docs/pink-build-case-input-contract.md#配置步骤文件-v12026-10-23离线验收)。

非法依赖在操作前拒绝。断言失败跳过后续普通步骤并恢复，成功恢复后下一例可继续；身份失效、快照失效或恢复失败停止后续用例。恢复失败保留最初错误；不重试输入。配置恢复只涵盖记录范围，不备份或覆盖整个偏好文件。

本批定向离线检查使用两份真实 JSON 和同一生产加载器/编排器/操作层，验证修改文件后的执行变化及必要失败分支；外部 UI 是观察夹具，不是 PinK 实机证据。没有启动 PinK、提交构建或修改前端。

## 步骤用例启动入口（2026-10-23）

从 PinK-Test 根目录使用 `run-build-ui.ps1 -StepsFile <JSON> -Pink <PinK.exe或目录> -Project <工程>`。先加 `-Preview -PreviewFile <新计划.json>`，实际执行时改为 `-ExpectedPlan <计划.json>`；加 `-CheckPlan` 仅离线核验。程序、工程、用例或启动条件变化会被拦截。完整命令见[启动合同](../../docs/pink-build-case-input-contract.md#步骤文件的启动入口2026-10-23)。

运行入口开放 web-desktop、web-mobile 及步骤文件 `targets` 声明的新标准表单平台，一份文件只运行一个平台，复用既有启动/接入、窗口核对和配置操作。用例可选 `onFailure: stop`：普通失败后先恢复，再停止后续例；默认恢复成功后继续，身份失效或恢复失败始终停止。结果自动生成 JSON/HTML，区分原始失败、恢复结果和后续跳过。旧四组及其他平台入口不变，不提交构建、不改引擎或前端。

实机验收使用 1958 包（0.0.2.0）、`D:\PinK-test\l10n_test_new`、当前 custom 4.0.0-beta.0 选择。基础文件和[验收修改版](fixtures/configuration-steps/acceptance.json)通过同一启动入口执行，执行器摘要同为 `3c04a7f109b5baaea7b07e84cb0cabf9b37c7ad0324f5fc5e77963e756477104`：

- [基础链路](../../results/2026-10-23-steps-acceptance-1792743908717/2026-10-23T08-29-34.104Z-steps/report.html)：名称真实修改、回读、断言、恢复通过。
- [修改版及失败处理](../../results/2026-10-23-steps-acceptance-1792743908717/2026-10-23T08-30-25.784Z-steps/report.html)：新增内联枚举关闭与名称修改通过；一项故意错误断言失败后恢复，下一例通过；另一项故意错误断言按 `onFailure: stop` 恢复后停止，后续哨兵跳过。原结果保持失败和退出码 1，符合开发验收预期，不改记业务全通过。
- [首次未通过记录](../../results/2026-10-23-steps-acceptance-1792743908717/2026-10-23T08-25-14.604Z-steps/report.html)：冷启动身份核对及设置/回读/断言通过，恢复步骤失败并停止。随后通过 UI 恢复原名称，定向恢复检查及入口补验通过；该次底层恢复原因未被原错误包装保留，未复现，不能声称已经根因修复。

有效两轮 `configurationRestored=true`；持久化名称为原 `l10n_test_new`，`inlineEnum=true`，`debug=true`。任务文件始终不存在，项目/全局引擎设置哈希未变。初次进入配置页由产品创建了默认偏好文件，保留该文件，不能声称工程所有文件字节不变。没有提交构建、验证产物或运行其他平台；剩余身份失效等故障分支继续引用既有离线证据。

### 恢复诊断与新平台配置（2026-10-23）

首次恢复失败的旧包装丢失了底层错误，原始原因仍未确定。本批补齐错误 `cause`、每步时间、恢复阶段/字段，以及文本输入时的焦点、可见性和命中情况；失败现场在清理前采集，报告可以打开脱敏页面信息和可用截图。采集异常不阻止恢复，不新增自动重试。已完成[已有实例定向恢复](../../results/2026-10-23-restore-diagnostics-1792745449437/2026-10-23T08-50-50.613Z-steps/report.html)和[冷启动定向恢复](../../results/2026-10-23-restore-diagnostics-1792745449437/2026-10-23T08-57-00.043Z-steps/report.html)，两次均恢复成功，原故障未复现；不是原故障根因已修复的证据。

新平台通过 `targets` 声明分类、卡片名称、配置页标题及标准字段类型，按真实 UI 核对后使用现有元操作。示例文件为 [Basic](fixtures/configuration-steps/new-platform-basic.json) 和 [QA 修改版](fixtures/configuration-steps/new-platform-edited.json)。后者改变设置顺序、枚举目标并增加断言，执行器不按示例平台 ID 增加分支。新描述只支持普通文本、数值、布尔及字符串枚举，不能安装平台、添加操作或绕过控件验证，详见[输入合同](../../docs/pink-build-case-input-contract.md#配置步骤文件-v12026-10-23离线验收)。

当前线上首页会将 CLI 平台与产品静态平台目录取交集；dev 工具的内置首页仍按分类过滤。Basic 示例已注册，但当前宿主返回的平台缺少分类，因此两种首页都没有示例卡片。该方向已暂停，临时首页来源已恢复；两份 example JSON 没有完成实机配置验收。工具保留两种首页的卡片定位，不通过产品内部桥接代替点击。页面打开失败会保留 `openingFailure`，不把没有执行过的配置步骤记为失败操作。

### Web 手机端：只改 JSON 的实机验收（2026-10-23）

沿用已启动的 1958 包、`D:\PinK-test\l10n_test_new` 和当前 custom 引擎。只在步骤入口开放已有 web-mobile 适配，不新增控件或操作实现；以下两份 JSON 连续使用同一执行器摘要 `d3fddc008582e335c0d7c506e9ec063137bdc25581edbad7915718fb31d70045`，两次之间没有修改执行代码。

| 文件                                                             | 配置链路                                                                       | 结果                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [基础版](fixtures/configuration-steps/web-mobile-basic.json)     | 记录 → 修改名称 → 横屏 → 回读/值断言 → 恢复                                    | [通过](../../results/2026-10-23-web-mobile-steps-1792747711425/2026-10-23T09-28-38.025Z-steps/report.html) |
| [QA 修改版](fixtures/configuration-steps/web-mobile-edited.json) | 记录 → 开启嵌入调试工具 → 竖屏 → 新名称 → 回读/值断言 → 提示/可编辑断言 → 恢复 | [通过](../../results/2026-10-23-web-mobile-steps-1792747711425/2026-10-23T09-29-11.315Z-steps/report.html) |

两轮设置均为 `changed=true`，没有用“已等于目标”冒充修改覆盖。每次结束名称恢复为 `l10n_test_new`、方向为 `auto`、嵌入调试工具为 `false`，完整配置页值前后一致，任务和引擎设置文件哈希不变。未提交构建、未重跑 web-desktop，也未验证新的平台注册能力。此结果证明已支持字段/元操作可以由 JSON 改变顺序、目标与断言，不代表任意新 UI 能只改 JSON 自动适配。

从 PinK-Test 根目录执行，修改用例后重新预览；示例路径用实际本机路径替换：

```powershell
.\run-build-ui.ps1 -StepsFile tools/build-ui/fixtures/configuration-steps/web-mobile-edited.json -Pink '<PinK.exe>' -Project '<工程>' -Preview -PreviewFile '<新的计划.json>'
.\run-build-ui.ps1 -StepsFile tools/build-ui/fixtures/configuration-steps/web-mobile-edited.json -Pink '<PinK.exe>' -Project '<工程>' -ExpectedPlan '<计划.json>'
```

## 开发自检：真实失败后继续

独立于 QA 平台用例的[开发自检](fixtures/failure-continuation/README.md)复用正式 CLI，每次新建一个独立工程，只提交两个 web-desktop 用例：文件/目录冲突导致的可控真实构建失败，然后使用正常目录构建。核对错误原因、任务 ID、观察失败后继续提交、成功终态和报告/截图链接，不修改 SDK、引擎选择或用户工程。原执行器仍返回失败退出码并报告一失败、一通过；外层自检根据真实结果判断是否符合预期，不改写业务结论。

## 运行结果与错误报告

[提交关联自检](fixtures/failure-continuation/README.md#提交未能唯一确认自检)使用 `developer-selfcheck.js --submission-ambiguity all`，分别验证零匹配、多匹配和点击后响应不明。原 CLI 停止后项且不重试，开发入口只读确认实际任务收尾后才开始下一独立场景；不向 QA 常规入口加入故障注入。多个匹配的错误现列出候选 ID，报告根据已有 `taskMayStillBeRunning` 明确提示关联/收尾尚未确认，不把点击时间当唯一任务确认。

开发自检另提供三类参数不一致模式，见[差异自检说明](fixtures/failure-continuation/README.md#三类参数不一致自检)。真实 UI 变化和仅在自检子进程内注入的任务观察副本差异分开记录；不修改 PinK 的持久任务或比较器，不把受控差异当产品缺陷。正式结果新增入队参数核对 `queued`、终态核对 `collect` 的明确阶段记录，已有失败阶段不被后续收集覆盖。三类分项证据与首轮夹具时机错误、终态定向补验分别保留，不声称有一份重跑全套后全绿的报告。

构建入口正常结束、用例失败、前提受阻或响应停止信号收尾后，在本次结果目录自动生成 `result.json` 和 `report.html`，控制台打印两条路径。报告列出失败、受阻、未执行、已停止及结果未收齐的用例，展示环节、原因、任务 ID、截图和原始结果入口；运行级错误与清理提示单列。没有截图时明确写出省略原因或文件缺失，不生成失效的截图链接。敏感配置不嵌入报告，口令、令牌等诊断文本会脱敏。

HTML 可离线打开，连同同目录的 JSON/截图一起交付。报告生成不触发 PinK 或构建，不会自动打开浏览器；生成失败会在控制台提示并让本次命令返回非零。进程被强杀、断电或结果目录不可写时无法保证收尾报告，已保存的 JSON 可以事后补生成。

在 `tools/build-ui` 目录可复用已有结果生成报告：

```powershell
npm run report -- --result '<结果目录>/result.json'
# 已有多次尝试的人工汇总：按每项 evidence 引用补出环节与截图，不重跑或重新判定结果
npm run report -- --result '../../results/2026-10-20T11-50-49-879Z/acceptance-summary.json'
```

普通结果生成 `report.html`；现有汇总生成 `acceptance-summary-report.html`，原始 JSON 不改写。自动链路报告只代表本次命令选定的用例；工具不会自行合并不同执行批次或用重试覆盖原结果。

## QA 用例加载与离线预览

### 第四组表单反向样本

反向样本沿用现有 `four-groups` 与 UI 检查/恢复终点，默认构建不自动加入。公共部分由 web-desktop 代表，平台独有提示分别定义。页面完整导出的 `formValidation` 与执行器使用同一份数据；外部 JSON 缺少该部分会拒绝借用本机样本。普通修改不需要改执行器；新控件操作仍需适配。

```powershell
# 仅列出/预览，不启动或连接 PinK；完整 ID 也可从用例页取得
.\run-build-ui.ps1 -Plan four-groups -Groups conditional -Cases 'FORM-C01' -ListCases
.\run-build-ui.ps1 -Plan four-groups -Groups conditional -CasesFile '<QA完整导出.json>' -Cases 'FORM-C01.s01.web-desktop' -Preview
```

`execution` / `executionByPlatform` 定义五种固定 UI 操作：`field-input`、`parent-visibility`、`required-choice`、`cancel-file`、`scene-clear-all`。输入时显式检查提示为无错误或包含指定文本；加载校验仅在 `trigger=reopen` 时关闭重开。`after` 核对明确的联动值和禁用状态（如返回调试签名），`unchanged` 核对测试动作前、准备完成后的保留字段（如 AGC 文件取消时的包名），最终恢复仍使用准备前原值。然后核对主构建按钮当前仍可用，恢复原值、控件类型/禁用状态和原提示。该分支没有构建点击动作，不验证“点击后是否拒绝”。

`prepare` 声明经批准的临时初态，可与目标字段相同；执行前先记录原值和路径协议，准备后逐项回读，再执行 `setup` 和目标操作。未声明准备时，初态同值仍受阻；为原本缺失的空字段明确声明非空准备时，可建立临时初态并在结束恢复原提示；非空且已有错误的字段仍不覆盖，签名其他字段不齐时受阻。临时输入由用例明确定义，结束只恢复本例字段；压缩先恢复再恢复远程开关，隐藏子项显现后、写入测试值前记录原值，在可见时恢复后返回原父项；显隐保留断言比较测试动作前的临时基准，恢复仍使用准备前原值。提示/回读失败且恢复成功可以继续，恢复失败停止后续提交。`result.json` 复用 `finalized.formValidation` 保存样本哈希、逐项断言和恢复状态；错误沿用原 HTML 报告。样本、提示及前提内容均纳入计划哈希校验，修改后应重新预览。

错误口令/坏 JSON 等缺材料分支及复杂复合操作通过 `executionBlocker` 保留，不能算执行覆盖。加载和控制器已有离线开发检查；平台专属实机范围见下方 8 项及本批 18 项记录，其他专属样本仍待验收。

2026-10-22 仅对 web-desktop 公共反向样本做实机验收，接入 1958 包已启动窗口及其实际工程 `cocos-test-projects-pink`，沿用 custom 引擎。首轮 32 项中 22 项通过、10 项受阻：7 项尚未适配，3 项因当前值已等于目标，不能计修改覆盖。初轮发现 `project://` 的预期写错：当前 UI 本地判空包含协议根，应提示“此项为必填项”；修正后只补验该项，原失败记录保留，其他通过项未重跑。详见[验收汇总与原始结果](../../results/2026-10-22-public-form-acceptance-1792654018488/acceptance-summary-report.html)。

后续仅补验其中 8 项非 L10N 样本，全部通过；复用原 22 项后，公共样本为 **30 项通过、2 项 L10N 受阻**。[最新汇总](../../results/2026-10-22-public-eight-recheck-1792656676890/acceptance-summary-report.html)保留原始失败/受阻及两项定向补验。路径补协议切换，场景区分初始场景与 Bundle 自动勾选；Zip 预期改为强制远程且禁止取消，CCONB 关闭时阈值仍可编辑，均按当前实现基线判定。原 22 项与本批先通过的 6 项未重复运行。定向补验后偏好文件中本轮字段与原值一致，全局/工程引擎设置文件未变，任务列表没有新增记录。

实际操作后的恢复检查全部通过，已观察到“提示断言失败 → 恢复成功 → 后续用例继续”。上述公共样本批次当时没有触发恢复失败，停止分支当时只有离线证据；后续本批18项中的实际恢复失败及停止记录见下文。没有提交构建；末次只读确认仍为原有一项历史任务，工程及全局引擎设置文件哈希未变。

2026-10-22 随后仅验收 8 项平台专属反向样本：Windows 可执行名非法/空值 2 项，微信和抖音 AppID 空值/非空错误文本各 2 项，淘宝全局变量空值/隐藏返回 2 项，全部通过。每组最多 2 项，未提交构建、未修改引擎，之前通过的公共样本未重跑。[本批原始报告](../../results/2026-10-22-platform-eight-1792659733452/execution/2026-10-22T09-05-46-391Z/report.html)与[恢复核对](../../results/2026-10-22-platform-eight-1792659733452/after.json)分别保留执行与文件证据。各例恢复原字段、提示及显隐；任务文件和全局/工程引擎文件未变，已有平台配置未变。产品首次修改时新增了四个平台的默认偏好条目，偏好文件整体字节不相同；默认条目保留，恢复结果按原字段、提示和显隐判定。该8项批次未覆盖其他平台专属样本、恢复失败停止和L10N；后续18项范围见下文。

2026-10-22 又完成 Android、Google Play、AGC 的 15 项签名反向 UI，以及 AGC 文件取消、路径清空、包名不一致 3 项，共 **18 项通过**。[分项汇总](../../results/2026-10-22-native-form-1792660577977/acceptance-summary-report.html)保留首次失败及仅针对未通过/未执行项的补验；没有重跑之前通过项。临时初态使用现成密钥库、私有凭据和 JSON，结束恢复原字段及原提示；[文件与恢复核对](../../results/2026-10-22-native-form-1792660577977/after.json)确认任务、引擎、材料和已有平台配置未变，产品新增三个平台的默认偏好条目。Google Play 路径缺项虽然计算错误，但当前视图未渲染，按已批准的当前实现基线检查无提示，同时保留产品校验缺口；不把此项通过解释为必填防护正确。签名口令真实性、异常构建、坏 JSON/空对象和 L10N 未验证。

本批实际触发过取消文件选择后的恢复失败，工具停止了后续两项；原失败报告保留在汇总引用中。修正了 Windows 对话框子层级查找和取消按钮类型/唯一性，取消后确认关闭及控件就绪，再重开配置页恢复；表单输入与原生下拉在发送按键前核对工作台 iframe 和内层控件焦点。恢复过程中的编辑器误输入已通过 UI 撤销，并与磁盘内容核对一致，未保存编辑器文件。恢复现场后只补验未通过项。因此“恢复失败停止后项”已有这一实际故障的实机证据，不能外推为所有断连/超时故障均通过。

2026-10-22 随后仅验收 OPPO、vivo、荣耀、华为快游戏的 `FORM-Q01`，**36 项全部通过，每平台 9 项**：包名、版本名、版本号、运行时版本清空各 1 项，版本号 `0`、`-1`、`1.5`、`abc` 各 1 项，版本名 `qa-version` 1 项。仅为被测字段声明临时合法非空初态，复用现有 UI 适配，每组最多 2 项。空值显示通用必填提示，vivo 包名显示自定义非空提示；非空特殊版本文本不提示错误，主构建按钮始终可用。这是已批准的当前实现基线，不证明平台版本合法性或提交后的防护。没有提交构建、修改 SDK 或引擎，之前通过项未重跑，PEM 缺材料与 L10N 保留。[本批报告](../../results/2026-10-22-quick-form-1792663578813/execution/2026-10-22T10-07-01-480Z/report.html)；[配置恢复与文件核对](../../results/2026-10-22-quick-form-1792663578813/after.json)。末次核对任务及引擎文件未变，所有原有配置值已恢复。vivo 打开时自动避让的输出名已通过 UI 恢复；产品新增 OPPO、华为快游戏默认偏好，以及 vivo/荣耀原来缺省的语言键和荣耀空 AppID，故偏好文件整体不字节相同。没有执行 L10N 分支。

2026-10-21 已接通指定用例文件、私有材料引用、本机启动配置和脱敏计划预览。共享校验器同时供展示生成器与执行器使用；公共模板可继承、平台可覆盖，不再按固定日期修订号拒绝普通修改。场景为当前工程自动角色；签名使用现成材料；淘宝正常构建输入已修订，显隐检查移到第四组。**本批只做离线验证，未启动 PinK 或构建；旧执行结果不代表新输入通过。**

在 PinK-Test 根目录：

```powershell
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -Preview -PreviewFile .\results\qa-plan.json
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -ExpectedPlan .\results\qa-plan.json -CheckPlan
.\run-build-ui.ps1 -FieldCapabilities
.\run-build-ui.ps1 -Plan four-groups -CasesFile '<QA导出的用例.json>' -Project '<工程>' -Materials '<私有材料.json>' -Groups publish -Cases 'review.publish.taobao-mini-game' -Preview
```

`-CasesFile` 加载完整用例；`-Cases` 仍按 caseId 选择。`-Preview` 在任何启动或连接代码之前返回，只读取文件；材料缺失仅阻塞引用它的用例，完整计划仍输出。状态 `ready-for-runtime-preflight` 表示下一步可做运行时检查，不能当作实际版本/工程已连接、签名已有效或构建通过。父目录须存在；有受阻项返回 1，格式错误返回 2。

填写 [材料与启动示例](../../materials/build-ui/README.md)，接口与前端对接见 [QA 输入合同](../../docs/pink-build-case-input-contract.md)。静态展示页使用同一份文件重新生成；运行不依赖页面 localStorage 或内存草稿。旧批次/旧 schema 结果不改写。

执行侧已新增独立的 223 字段能力清单、完整工程 URI/程序路径核对及计划哈希校验。前端使用 `dist/field-capabilities.js` 的能力描述和 `validateExecutableCatalog`，用例不能自行注册新能力。四组真实执行必须先预览，再带 `-ExpectedPlan`；也可在启动 JSON 中填写 `expectedPlan` 路径。计划过期或内容被改动时，在连接 PinK 前拒绝。`-CheckPlan` 仅离线核验，不启动程序。web-desktop 已完成一次冷启动和一次同实例接入构建，以及端口归属、所选端口未开放和同名不同路径工程的拦截，详见输入合同中的启动验收记录；其他平台没有重跑。

四组配置用例允许历史 `temp/pink-builder/preferences.json` 不存在，不再要求先人工打开构建页面生成缓存；仅对 ENOENT 按无历史值处理。已有后续阶段检查、损坏文件和其他读取错误仍保留，旧入口行为不变。

## 四组定稿入口

`-Plan four-groups` 从 `tools/case-catalog/public-combinations.json` 读取本次定稿，复用现有启动、UI 输入、两项分组、唯一任务关联和统一结果收集。发布、调试、混合均覆盖 18 平台的配置定义；调试使用 Bullet，混合使用 Cannon 并由工程/平台适用清单选用。普通字段只在目标不同的时候输入，完成最终回读后直接构建，不做逐平台保存重开。第四组按定义区分 UI 检查与正向构建，使用代表平台，不机械复制为 18 份。

交付时须同时携带 `tools/build-ui` 与 `tools/case-catalog/public-combinations.json`，保持在 PinK-Test 中的相对位置；执行定义直接读取这份定稿，不另复制一套配置矩阵。

2026-10-20 已在 1958 包、当前 custom 引擎与 `l10n_007` 工程上完成 web-desktop 的发布、调试、混合各一个基础用例：UI 配置和回读、入队/终态参数及成功卡片均已核对，未验证产物。发布/调试的原运行遇到历史结果收集错误，修复后复用原任务[补完只读收集](../../results/2026-10-20T11-37-47-284Z/read-only-collection.json)，[原失败记录](../../results/2026-10-20T11-37-47-284Z/result.json)保留；混合用例使用修复后的完整入口[正常通过](../../results/2026-10-20T11-40-52-520Z/result.json)。期间修正了字段合同选择、下拉候选就绪等待和名称映射、默认预设显式选择，以及历史快照传输和按批次定位成功卡片。

随后完成其余 17 平台的发布、调试、混合 **51 个唯一基础用例**的本机试运行；web-desktop 未重跑。适配修复仅补验证未通过项，按最后一次有效结果及只读补核去重，不累计尝试次数：

| 组合 | 用例 | 通过 | 失败 | 受阻 |
| ---- | ---- | ---- | ---- | ---- |
| 发布 | 17   | 11   | 6    | 0    |
| 调试 | 17   | 14   | 0    | 3    |
| 混合 | 17   | 15   | 1    | 1    |
| 合计 | 51   | 40   | 7    | 4    |

[本轮合并结果](../../results/2026-10-20T11-50-49-879Z/acceptance-summary.json)引用[首轮](../../results/2026-10-20T11-50-49-879Z/result.json)、[适配补验证](../../results/2026-10-20T12-21-23-319Z/result.json)、[最后 6 项 UI 补验证](../../results/2026-10-20T12-40-50-510Z/result.json)及[鸿蒙 NEXT 两项只读补核](../../results/2026-10-20T12-21-23-319Z/read-only-collection.json)，原记录未改写。[本机材料绑定](../../results/2026-10-20T11-50-49-879Z/materials.json)只记录适用清单及 API/ABI 候选，不包含 AGC JSON 内容或账号凭据。

- 构建故障：微信、抖音、支付宝、OPPO、淘宝发布，以及抖音混合，共 6 项出现 Babel `filename` 错误；未修改引擎或 SDK 来绕过。另有 OHOS 发布因本机 SDK 目录未配置失败。这 7 项的 UI/入队/终态参数已复用本次快照按字段合同复核匹配，构建失败仍不算通过。
- 环境与材料受阻：OHOS 调试、混合原始记录为隐藏 Zip 子项适配受阻；修复后因同机发布已证实 SDK 目录缺失，未继续提交。Android、Google Play 调试所需的另一 API 候选在当前 UI 不存在（均只有 35），保留受阻，不强填 36。当前没有据证据判为整项不适用的基础用例。
- 适配修复涵盖原生字段定位、禁用状态识别、隐藏子项操作顺序、候选文字定位与稳定回读、API 显式选择及已明确的默认值合同。Google Play 关闭 GLES 2/3 会清空并隐藏 GLES2，结果按父项联动和任务参数核对，不冒充直接点击了隐藏控件。
- 每组最多 2 项，多个分组已观察到排队后转入构建；全局/工程引擎选择文件与 web-desktop 配置保持不变，所有任务已收尾。只到构建成功，不验证产物或运行；OpenPaaS 的普通构建按钮仍按产品流程自动执行内部上传，工具未另点上传。

本轮没有执行局部变体、第四组或公共 UI 专项，以上结果不能外推为全部选项已验收。以下为通用入口使用示例：

```powershell
# 只读列出设计和受阻原因；不连接 PinK
.\run-build-ui.ps1 -Plan four-groups -ListCases
.\run-build-ui.ps1 -Plan four-groups -Groups publish -Cases 'review.publish.web-desktop' -ListCases

# 将来执行一个已定稿发布用例；不运行其他平台或公共保存专项
.\run-build-ui.ps1 -Pink '<1958包的PinK.exe>' -Project '<测试工程>' -Plan four-groups -Groups publish -Cases 'review.publish.web-desktop' -Preview -PreviewFile '.\results\desktop-plan.json'
.\run-build-ui.ps1 -Pink '<1958包的PinK.exe>' -Project '<测试工程>' -Plan four-groups -Groups publish -Cases 'review.publish.web-desktop' -ExpectedPlan '.\results\desktop-plan.json'

# 选组和材料；每组最多2个任务，提交后等待本组收尾再继续
.\run-build-ui.ps1 -RunConfig '<本机启动配置.json>' -ExpectedPlan '<同一配置生成的计划.json>'
```

基础 ID 直接沿用展示页的 `review.<publish|debug|mixed>.<平台ID>`；同组局部变体追加 `.variant-1` 等稳定序号。第四组沿用场景 ID；有多个代表平台的场景追加 `.<平台ID>`，如 `conditional.validation.aspect.android`。`-Cases` 只选择列出的项，不隐式补跑前序构建。`-Groups` 默认四组均纳入清单；没有混合适用清单时混合项记录 applicability 受阻，清单明确排除的平台记录 not-applicable。

### 材料与环境绑定

`-Materials` 是具体值与身份的 JSON，不是脚本或流程语言。普通名称、版本、URL、超时按定稿输入，不允许任意覆盖固定目标。示意结构如下；数值/文件必须替换为测试机真实且适用的内容：

```json
{
  "mixedPlatforms": ["web-desktop"],
  "platformValues": {
    "android": {
      "publish": { "packages.android.apiLevel": 35 },
      "debug": {
        "packages.android.apiLevel": 36,
        "packages.android.appABIs": ["arm64-v8a", "armeabi-v7a"]
      },
      "mixed": { "packages.android.apiLevel": 35, "packages.android.appABIs": ["armeabi-v7a"] }
    }
  },
  "scenarios": {
    "conditional.windows.generator": { "values": { "packages.windows.vsData": "<真实G1>" } },
    "conditional.resources.bundles": {
      "bundles": [
        { "name": "<B0>", "root": "db://assets/<B0>", "uuid": "<实际UUID>" },
        { "name": "<B1>", "root": "db://assets/<B1>", "uuid": "<实际UUID>" }
      ]
    },
    "conditional.engine.presets": {
      "presetIds": ["defaultConfig", "<真实P1>"],
      "values": { "overwriteProjectSettings.includeModules.physics-2d": "inherit-project-setting" }
    },
    "conditional.native.candidates": {
      "initialValues": { "packages.android.apiLevel": 35 },
      "values": { "packages.android.apiLevel": 36 }
    },
    "conditional.validation.agc-json": {
      "invalidJson": ["<内容为左花括号的文件>", "<内容为空对象的文件>"]
    }
  }
}
```

- API/ABI 等占位引用未绑定时单列 material 受阻，不向输入框填写说明文字；环境齐全与候选已绑定分别判定。UI/任务数字或数组必须一致，AGC 36→35 不视为正常转换。
- 签名、图标、应用身份和第二已有游戏，通过对应场景的 `values` 绑定定稿声明的字段；凭据不进入预览、截图或结果明文，材料清单本身由测试组保护。路径输入使用真实键盘；AGC 取消选择分支另使用 Windows UI Automation 点击唯一 PinK 文件对话框的 Cancel，不操作其它应用。
- L10N 语言区必须已经启用、初始化且具备真实 zh-Hans/en Catalog，缺条件不自动启用或改 Catalog。**`conditional.l10n.gate` 的跨页面项目启用/恢复仍为 ui-adapter 受阻**，不会以已有启用状态冒充转换通过；其它语言选择、缩减、清空恢复、默认/回退保存与构建已有执行处理。
- 材料受阻、适用性未指定、初态不符、操作适配受阻分别记录；普通配置或已关联任务失败继续不相关用例。连接失效、提交是否生效不明、任务超时未收尾、恢复失败时停止后续提交。
- 第四组 UI 异常样本只做输入、提示和恢复，绝不提交错误配置；第四组正向任务收尾后只恢复本例修改。前三组保留本次目标配置，历史文件不改写。

结果使用 schema6，保留每项组别、终点、脱敏最终快照、任务参数核对、恢复状态和具体受阻类型；有受阻项时不会给整轮通过。保存/历史专项仍独立选择，未加入全部构建、重建、取消、移除、产物或运行检查。工具不修改引擎设置。

## 旧版合并集合（保留定向回归）

旧版整轮使用 `acceptance`，复用同一执行器，共 **52 项、每组最多 2 项**。压缩模式随平台组合配置，不单独增加一轮。它已合并原九项本地选项和十项专属最终配置；不要再把 `existing-local-seven`、D/A/B/C 批次、`local-options-nine`、`special-options-ten` 逐套追加到本轮。旧命令保留用于定向回归，旧结果不改写。

| 顺序     | 范围      | 合并检查                                                                                                                     |
| -------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 调试     | 18 平台   | 各平台适用 D 公共配置、压缩差异和已列明专属值                                                                                |
| 发布     | 18 平台   | A 公共配置；Web 桌面 Source Map 关闭与公共开关；Web 手机 WebGPU 开启；淘宝全局文本；新增十平台专属最终配置                   |
| 选项变化 | 原 8 平台 | B 压缩/专属变化；Web 桌面 Source Map 独立；OPPO 分离引擎开启；淘宝 Wasm/Brotli 与全局适配开启                                |
| 选项返回 | 原 8 平台 | C-local 返回；Web 桌面 Source Map 内联；Web 手机 WebGPU 关闭；OPPO 分离引擎关闭；淘宝 asmjs/压缩关闭、全局适配关闭及文本清空 |

新增 ID 为 `acceptance.<debug|release|variant|return>.<平台ID>`，对应新的合并目标。旧 caseId 仅在 `sourceCaseIds` 中说明设计来源，不自动累计为旧用例所有分支通过。每条结果保留逐字段回读、真实变化、保留项、任务参数和终态；无实际变化的普通目标配置允许通过，不能据此声称验证了某次切换。

先离线查看将执行的用例，不启动或连接 PinK：

```powershell
.\run-build-ui.ps1 -Plan acceptance -ListCases
.\run-build-ui.ps1 -Plan acceptance -ListCases -Cases 'acceptance.return.web-mobile'
```

实际执行（本次优化未运行）：

```powershell
.\run-build-ui.ps1 -Pink 'C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe' -Project 'D:\PinK-test\l10n_007' -Plan acceptance -AgcServices 'C:\Users\Administrator\Downloads\agconnect-services.json'
```

单项重跑增加 `-Cases 'acceptance.return.web-mobile'` 等选择。选择器不会自动补跑依赖构建；只有集合含 AGC 时才提供服务 JSON 参数。

**初态按用例目的区分：**

- 普通目标配置按实际初态判断条件子项，先操作父项，再编辑出现的子项；当前已等于目标时只回读。原生加密最终配置不再要求先关闭加密来制造一次变化。
- Web 手机 WebGPU 返回要求当前开启；OPPO 返回要求当前分离引擎开启；淘宝三项仍分别要求所列文本和适配初态，验证真实变化。`requiresInitialFrom` 标明整轮的初态来源，单项仍先回读当前 UI；不满足记受阻，不重置账号、签名或整份偏好。
- 失败用例不自动重试；普通失败继续后续项。后项依赖的配置未形成时由初态检查阻塞该项；连接中断、提交生效不明或未收尾任务超时仍停止提交。

**公共 UI 独立选择，不成为默认验收前置。** 保存/重开专项只选代表平台：`run-config-ui.ps1 ... -Platforms web-desktop -Mode exercise`。18 平台的配置身份、就绪、选项回读直接随上述构建项检查，不再先逐平台做一次 inspect/exercise。平台自定义交互差异另由对应组合/专项覆盖。历史只读独立执行，须引用版本匹配的成功/失败记录；不为造历史记录额外构建。

三个 MD5/CCONB/多场景计划用例、缺材料分支和当前 UI 不适用项不进入本集合。52 项不代表全部 UI 分支已实现；共享保存等 UI 全面专项仍有待实现部分。终点保持构建成功，不改引擎设置、不验证产物；OpenPaaS 正常构建内部阶段保留。

本次只完成定义、入口、离线预览、类型/编译和定向自动检查；未做合并链路的实机验证，原 1958/旧版结果均不改记为新组合通过。

## 测试组可用范围与命令（2026-10-20）

**18个平台均已提供对应构建入口。** 配置页检查分别使用17平台通用模式和OpenPaaS专属模式，不是一个`all`命令覆盖全部。以下区分已实现能力与版本证据；AGC已有一次1958构建验证；OHOS新专属组合已提交，UI/入队参数通过，但本机SDK目录不存在导致失败；OpenPaaS按正常构建按钮的新口径已单独通过，其他平台未重跑。

当前目标为1958包、现用custom SDK及`l10n_007`工程。七平台existing基础构建及AGC单平台在1958已有成功证据；原优先八平台组合保留旧版结果，未在1958重复验收。可以交付已实现入口供测试组使用，不承诺全部选项覆盖或每个组合都成功；淘宝B轮已知失败继续保留。

在`C:\Users\Administrator\Desktop\PinK-Test`的PowerShell中先定义参数，下面命令为使用示例，本次未执行：

```powershell
$PinKArgs = @{
    Pink = 'C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe'
    Project = 'D:\PinK-test\l10n_007'
}
```

### 逐平台入口

构建列中的参数接在`.\run-build-ui.ps1 @PinKArgs`后。配置页列中的`inspect`表示`.\run-config-ui.ps1 @PinKArgs -Platforms <该行ID> -Mode inspect`；只检查已实现的身份、就绪及字段回读。

| 平台              | ID                    | 配置页           | 已开放的构建参数                                                 | 交付状态与证据范围                                                        |
| ----------------- | --------------------- | ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| OHOS（传统鸿蒙）  | `ohos`                | inspect          | `-Profile existing -Platform ohos`                               | 已接入；新专属组合UI/入队参数通过，本机SDK目录不存在导致失败              |
| 鸿蒙 NEXT         | `harmonyos-next`      | inspect          | `-Profile existing -Platform harmonyos-next`                     | 1958基础构建已通过                                                        |
| 华为 AGC          | `huawei-agc`          | inspect          | `-Profile existing -Platform huawei-agc -AgcServices <JSON路径>` | 1958首次基础构建已通过；文件输入/包名及入队、终态参数核对通过             |
| Android           | `android`             | inspect          | `-Profile existing -Platform android`                            | 1958基础构建已通过                                                        |
| Web 桌面          | `web-desktop`         | inspect          | `-Profile debug -Platform web-desktop`                           | D/A/B/C-local及九项中的适用分支有旧证据；另支持existing；不算1958组合复验 |
| Web 手机          | `web-mobile`          | inspect          | `-Profile debug -Platform web-mobile`                            | 已实现组合及适用选项有旧证据；1958组合未重跑                              |
| Windows           | `windows`             | inspect          | `-Profile existing -Platform windows`                            | 1958基础构建已通过                                                        |
| OpenPaaS / 3000+  | `openpaas`            | 专属模式，见下方 | `-Profile existing -Platform openpaas`                           | 1958正常按钮链路已通过；默认内部流程由产品执行，按整项任务结果判定        |
| 微信小游戏        | `wechatgame`          | inspect          | `-Profile existing -Platform wechatgame`                         | 1958基础构建已通过                                                        |
| 抖音小游戏        | `bytedance-mini-game` | inspect          | `-Profile existing -Platform bytedance-mini-game`                | 1958基础构建已通过                                                        |
| 支付宝小游戏      | `alipay-mini-game`    | inspect          | `-Profile existing -Platform alipay-mini-game`                   | 1958原成功任务按修正合同只读复核通过，不重复构建                          |
| OPPO              | `oppo-mini-game`      | inspect          | `-Profile debug -Platform oppo-mini-game`                        | 已实现组合及适用选项有旧证据；1958组合未重跑                              |
| vivo              | `vivo-mini-game`      | inspect          | `-Profile debug -Platform vivo-mini-game`                        | 已实现组合有旧证据；隐藏控件不计覆盖，1958组合未重跑                      |
| 荣耀              | `honor-mini-game`     | inspect          | `-Profile debug -Platform honor-mini-game`                       | 已实现组合有旧证据；1958组合未重跑                                        |
| 华为快游戏        | `huawei-quick-game`   | inspect          | `-Profile debug -Platform huawei-quick-game`                     | 已实现组合有旧证据；1958组合未重跑                                        |
| 淘宝小游戏        | `taobao-mini-game`    | inspect          | `-Profile debug -Platform taobao-mini-game`                      | A等已有成功；B的Wasm/Brotli编译失败未消除，1958组合未重跑                 |
| Facebook 即时游戏 | `fb-instant-games`    | inspect          | `-Profile debug -Platform fb-instant-games`                      | 已实现组合有旧证据；1958组合未重跑                                        |
| Google Play       | `google-play`         | inspect          | `-Profile existing -Platform google-play`                        | 1958基础构建已通过                                                        |

上表保留原基础入口及其证据；现在18平台均可用`-Profile debug`或`-Profile release-a`配合同一平台ID。原优先8平台另支持`release-b`和`release-c-local`。AGC必须显式提供`-AgcServices`，通过UI选择服务文件及匹配包名；新增10平台其他专属值不改。组合会通过UI设置并保存明确的公共选项；初态、场景、条件控件或专属保留值不满足合同就报告受阻，不自动更换引擎、签名或账号。

### 18平台调试／本地发布基础组合

| 目标                                           | D调试压缩 / MD5     | A本地发布压缩 / MD5 | WebGL2                  |
| ---------------------------------------------- | ------------------- | ------------------- | ----------------------- |
| 微信                                           | merge_all_json / 开 | merge_all_json / 开 | on                      |
| 抖音                                           | merge_all_json / 开 | merge_all_json / 开 | off                     |
| 支付宝                                         | merge_all_json / 开 | merge_dep / 开      | off                     |
| Android、Google Play、Windows、NEXT、AGC、OHOS | none / 关           | none / 开           | off；原生后端保持当前值 |
| OpenPaaS                                       | subpackage / 关     | merge_all_json / 开 | on                      |
| 原优先8平台                                    | 沿原D合同           | 沿原A合同           | 沿原合同                |

D统一Debug开启、Bullet物理、跳过纹理压缩、自动图集关闭；A统一Debug关闭、Builtin物理、处理纹理压缩、自动图集开启。两者主包本地、server为空；微信/抖音/支付宝的首场景Bundle在D关闭、A开启；其余新增平台无该UI则不写。Source Map及其他公共模式仍由已有代表用例覆盖，不复制到18平台。不同NEXT引擎等导致控件不可用时明确受阻，不静默删除目标字段。构建成功不代表纹理/图集实际处理效果已验证。

```powershell
# 只补新增10平台；这两个命令各10项，每组最多2项
.\run-build-ui.ps1 @PinKArgs -Suite debug-additional -AgcServices "C:\Users\Administrator\Downloads\agconnect-services.json"
.\run-build-ui.ps1 @PinKArgs -Suite release-a-additional -AgcServices "C:\Users\Administrator\Downloads\agconnect-services.json"

# 按caseId选取所需项；按批次固定顺序执行，不重复其余平台
.\run-build-ui.ps1 @PinKArgs -Suite debug-additional -Cases 'debug.wechatgame,debug.windows'

# 测试组需要完整回归时选择；本次交付不默认重跑这两个全量批次
.\run-build-ui.ps1 @PinKArgs -Suite debug-all -AgcServices "C:\Users\Administrator\Downloads\agconnect-services.json"
.\run-build-ui.ps1 @PinKArgs -Suite release-a-all -AgcServices "C:\Users\Administrator\Downloads\agconnect-services.json"
```

每项独立`caseId=<profile>.<platformId>`，先记录专属值，再设置公共组合、等待联动、回读、直接构建；入队和终态均核对同一最终配置及原专属值。仅`-Persistence verify`要求真实修改及保存重开。AGC材料参数只在所选集合包含AGC时提供；普通组合不自动执行OpenPaaS的负向校验或游戏切换。

本批新增20条组合用例已接入工具及[平台用例页](../../docs/pink-build-cases.html)，静态检查及参数守卫检查通过。用户正常退出后，1958包加调试参数启动、沿用custom引擎，完成[微信D](../../results/2026-10-20T04-11-56-531Z/result.json)和[Android A](../../results/2026-10-20T04-13-19-935Z/result.json)各一次实机验证：公共UI配置、专属值保持、入队/终态参数、成功卡片均通过。两项采用直接构建，未检查保存重开；其余18条新增组合待按需执行，不能由两项推定全量通过。工具可交测试组试用，原8平台未重跑，引擎设置未改、不验证产物。

### 新增10个平台的专属组合

`-Plan special-options-ten` 使用设计表中的10个 `design.<平台ID>.local-change` 用例，分别沿本平台A公共背景配置专属最终状态；支持 `-Cases` 精确选择，组内逐项提交、每组最多2项，普通链路直接构建，不关闭重开。它与原 D/A、B/C、`local-options-nine` 是不同集合，不默认重跑其他集合。

```powershell
# 仅选择微信；已有失败证据，不自动重跑
.\run-build-ui.ps1 @PinKArgs -Plan special-options-ten -Cases design.wechatgame.local-change

# 其余9项集合；本轮均已执行。按需缩小Cases重测，不以微信成功为前置。
$RemainingSpecialCases = 'design.bytedance-mini-game.local-change,design.alipay-mini-game.local-change,design.openpaas.local-change,design.android.local-change,design.google-play.local-change,design.windows.local-change,design.harmonyos-next.local-change,design.huawei-agc.local-change,design.ohos.local-change'
.\run-build-ui.ps1 @PinKArgs -Plan special-options-ten -Cases $RemainingSpecialCases -AgcServices "C:\Users\Administrator\Downloads\agconnect-services.json"
```

字段合同包含分组复选框、原生下拉、保留API/ABI/Generator、加密子项和OpenPaaS网络超时展开。AGC沿用服务JSON及匹配包名；签名保持调试侧，不清除用户自定义签名。Google Instant要求当前API≥23。四个原生加密用例以加密关闭、子项隐藏为初态，开启后使用本地非生产密钥，结果仅保存摘要；初态不符报告失败/阻塞，不自动重置配置。缺材料、其他枚举及返回侧仍留在设计清单，未由这10个最终状态替代。

本批10个新专属组合均已执行：5项通过（OpenPaaS、Android、Google Play、Windows、鸿蒙NEXT），5项失败（微信、抖音、支付宝、AGC、OHOS）。微信沿用前一次失败；本次其余9项为5通过、4失败，无旧通过用例重跑。

[微信原结果](../../results/2026-10-20T07-04-06-028Z/result.json)、[其余平台批次](../../results/2026-10-20T07-10-32-731Z/result.json)、[OHOS续跑](../../results/2026-10-20T07-20-45-917Z/result.json)保留原始证据。微信/抖音/支付宝在SDK引擎脚本阶段报Babel缺filename；AGC任务最终成功，但API Level最终UI为36、任务为35，用例仍失败；OHOS在本机报`SDK directory  not exists`，不推定测试组环境也缺SDK。

单项明确构建失败不会阻断后续组。任务已经唯一关联时，参数核对失败也仅判当前用例失败，并继续收集其终态；已修正此前将这种差异提升为整批中断的规则。连接/观察异常、提交生效不明、未收尾任务超时和无法关闭配置等情况仍停止后续提交。本批AGC发生差异时运行的还是旧规则，因此原批次中OHOS保留not-run；修改后只独立续跑OHOS，没有重提AGC来验证该分支。类型检查、编译通过；原结果文件不改写。引擎设置未改，不验证产物，不自动重试失败项。

### 批次与配置页命令

```powershell
# 七平台基础构建：微信、抖音、支付宝、Android、Google Play、Windows、NEXT
.\run-build-ui.ps1 @PinKArgs -Suite existing-local-seven

# 原优先八平台调试组合；其他组合批次名见下文
.\run-build-ui.ps1 @PinKArgs -Suite debug-priority

# 17平台配置页检查，不提交构建，避免all包含OpenPaaS而报告incomplete
$ConfigPlatforms = 'ohos,harmonyos-next,huawei-agc,android,web-desktop,web-mobile,windows,wechatgame,bytedance-mini-game,alipay-mini-game,oppo-mini-game,vivo-mini-game,honor-mini-game,huawei-quick-game,taobao-mini-game,fb-instant-games,google-play'
.\run-config-ui.ps1 @PinKArgs -Platforms $ConfigPlatforms -Mode inspect

# OpenPaaS：已有游戏选择、版本名必填提示、回读及恢复；不新建游戏、不构建
.\run-config-ui.ps1 @PinKArgs -Platforms openpaas -Mode openpaas
```

原8平台发布批次名仍为`release-a-priority`、`release-b-priority`、`release-c-local-priority`；新D/A全量及补充批次见上节。本地九项选项使用`-Plan local-options-nine`，支持`-Cases`选项；批次也可按`<profile>.<平台ID>`筛选。B完整批次包含淘宝已知失败；九项返回用例有明确初态要求。新增可执行入口不等于新增构建结果，不要求为交付重跑旧组合。OpenPaaS按产品正常构建按钮处理，内部自动阶段不拦截，按整项任务最终结果判定。

### 剩余材料与接入事项

| 对象                 | 已有或本次补充                                                                                                                                                | 还需要什么                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AGC基础构建          | `C:\Users\Administrator\Downloads\agconnect-services.json`已收到，JSON可解析；`client.package_name=com.testcases.cocos`，app_id/api_key字段非空，敏感值不记录 | 已通过一次1958基础构建，UI文件路径/包名及入队、终态参数均匹配；非默认API/ABI和自定义签名等扩展分支另列，不把本次通过扩大为全选项覆盖 |
| OHOS基础构建         | 测试组已确认其环境齐全；工具单平台入口与UI合同已接入                                                                                                          | 测试组环境已确认齐全；本机新组合已执行，UI/入队参数通过，但SDK目录不存在导致任务失败                                                 |
| OpenPaaS正常构建按钮 | 当前账号和已有游戏可用；工具入口已接入                                                                                                                        | 不再要求修改SDK或阻止内部阶段；由产品完成默认流程，工具核对配置、任务参数及最终结果，不额外点其他阶段按钮                            |

AGC当前已通过UI选择提供的Downloads服务文件，包名由`com.cocos.game`设置为`com.testcases.cocos`并回读；构建钩子导入JSON到工程settings并采用同一包名。原7平台固定批次保持不变，AGC使用下节单独命令。默认调试签名分支不因这个JSON额外要求自定义keystore；只有另测自定义签名时才需材料。

以下只阻塞对应的扩展选项，不阻塞已经交付的本地基础链路；具体平台/用例归属仍见[材料清单M01～M07](../../docs/pink-build-combination-design.md#材料配置与受阻范围)：

- 远程/Zip：QA确认可访问的HTTP/HTTPS资源根URL及目录。
- 自定义图标：复用工程现有PNG候选，核清各平台尺寸、格式和UI路径合同，不先要求重做图片。
- 快游戏自定义签名：匹配的测试`private.pem`与`certificate.pem`；原生自定义签名：keystore、别名和密码本地提供，不写入文档。
- AppID/AppKey非空分支：按具体平台提供有效测试值和匹配包名，已有OpenPaaS账号不重复索取。
- 非默认runtimeVersion、插件/分离引擎：QA确认合法候选与匹配SDK/插件条件；已有通过分支不因材料整理重跑。

图集/纹理效果、产物运行、真机、上传/发布材料属于后续阶段，不作为本次“UI→构建成功”的统一交付门槛。公共UI完整专项、三个MD5/CCONB/场景合并用例及其余未覆盖的配置分支仍待实现，不缺文件的工作不写成QA缺材料。

## 准备一次

在本目录执行：

```powershell
npm ci
npm run build
```

依赖由本工具自身的 package.json 和锁文件管理，不引用 PinK 源码或其 node_modules，也不下载测试浏览器。版本固定为本次已验证的 Playwright 版本，不承诺其他 PinK/Playwright 组合兼容。

## OpenPaaS正常构建按钮

沿用当前账号、已选中的已有游戏和有效版本名，使用普通构建按钮，不套用配置专项的空值校验、游戏切换或关闭重开：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe" -Project "D:\PinK-test\l10n_007" -Profile existing -Platform openpaas
```

先核对平台身份、游戏确实属于当前账号的已有候选、版本名和方向；游戏ID在UI和任务中均只保存SHA-256摘要。没有有效选中游戏就说明具体前提，不新建游戏或替换为其他游戏。公共字段继续使用最终UI快照核对入队及终态，包上下文产生的代码版本不冒充UI原值。

按用户最新确认，构建内部自动执行的make/upload由产品管理，工具不修改SDK、过滤阶段或单独点击其他阶段按钮。`nextStages`在产品提供时如实保留，不从未提供推断没有内部阶段，不再因此报工具失败；最终整项任务失败仍判失败，不以脚本构建阶段结束代替整项成功。此口径仅调整OpenPaaS，不改变其他既有用例的已批准阶段约束。结果使用`caseId=existing.openpaas`及`openpaasBuild`记录入口和结果判定范围；不验证产物或运行效果。

[1958正常按钮结果](../../results/2026-10-20T03-17-57-375Z/result.json)：passed，任务`task-1792466287472-9`，Webview观察约43秒。已有游戏ID摘要、版本名、方向及公共参数的入队/终态核对和成功卡片通过；最终消息为`openpaas:onAfterUpload completed ✓`，说明默认上传已由产品执行。本次任务options未暴露nextStages数组，保留原始快照，不伪造阶段列表。只点击一次构建，SDK和引擎设置未改，其他平台未重跑，不验证产物。

## OHOS单平台基础构建

测试组已确认环境齐全，工具不安装或切换SDK，不因本机旧环境调查结果预先关闭入口。沿用测试机当前配置，命令为：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe" -Project "D:\PinK-test\l10n_007" -Profile existing -Platform ohos
```

复用现有UI配置→稳定回读→点击一次构建→按新taskId核对入队/终态参数→成功卡片链路，不加入固定七平台批次。专属合同为packageName、number型apiLevel、三个方向开关、encrypted及JobSystem；自定义控件按唯一标签定位，不按序号。此前1958完成这7项UI回读；本次`design.ohos.local-change`又完成包名、方向、加密及调度修改和入队参数核对，最终报本机SDK目录不存在，不能记为构建成功。执行中按实际UI校验和任务结果报告，不把测试机环境事实从当前机器推断过去。环境由测试组管理，其余选项、引擎设置、产物和后续阶段不在本次改动范围。

## AGC单平台服务文件构建

AGC单独开放existing入口，必须显式提供服务JSON，不加入固定的`existing-local-seven`批次。在PinK-Test根目录执行：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe" -Project "D:\PinK-test\l10n_007" -Profile existing -Platform huawei-agc -AgcServices "C:\Users\Administrator\Downloads\agconnect-services.json"
```

当前1958页面的服务文件控件是文本路径框，没有浏览按钮。工具以真实键盘填写文件路径和JSON的`client.package_name`，等待UI稳定并回读；其余选项沿用当前值，不切换引擎，不做保存重开专项。提交前再次检查材料SHA-256，文件改变即停止，不将JSON内的凭据写入报告。

结果沿用schema5和`caseId=existing.huawei-agc`：`agcServices`记录材料路径/摘要/包名、两个字段的修改前后UI值；随后用最终UI快照核对入队与终态的服务路径、包名、渲染、方向、Swappy、Input SDK、.so压缩及调试签名开关。其他未纳入合同的控件继续列为未覆盖。只点击构建，核对本次taskId及成功卡片；不执行生成、运行或上传，不验证产物。结束保留所选材料路径和匹配包名，产品构建钩子会将JSON导入工程settings；不删除或复原产品文件。

[1958首次AGC结果](../../results/2026-10-20T02-44-45-342Z/result.json)：passed，任务`task-1792464297679-7`，Webview观察构建约108秒。服务路径、包名和12个专属合同字段的入队/终态核对及本次成功卡片通过，没有后续阶段。只新增这一个任务，引擎设置及源JSON哈希前后不变；不验证产物。

## 七平台沿用当前配置的基础构建

在 PinK-Test 根目录执行，固定只选择微信、抖音、支付宝、Android、Google Play、Windows、鸿蒙 NEXT，按 2＋2＋2＋1 分组，不包含旧有8平台组合：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe" -Project "D:\PinK-test\l10n_007" -Suite existing-local-seven
```

单独补跑尚未通过的平台使用 `-Profile existing -Platform android` 等参数；多个剩余项用 `-Suite existing-local-seven -Cases 'existing.android,existing.google-play'`，按固定平台顺序重新组成最多两项的小组。不得用全批次重跑替代明确的单项续跑。沿用当前配置，不写选项、不保存重开、不自动调整SDK、API或材料。若PinK已启动但没有调试端口，先保存并正常退出，再运行命令。

每项检查平台身份、页面就绪、工程名称及当前单入口场景，回读Debug、MD5、主包远程、服务器、压缩模式及该平台已列入合同的可见专属字段，再直接点击一次构建。由新taskId分别核对入队参数、终态参数及成功卡片；AppID保存SHA-256摘要，仍比较精确身份。UI未纳入合同的字段在`existingConfiguration.uiUncovered`中列出，不算全选项覆盖。API/ABI等自定义区域尚未逐项核对，缺候选时不从偏好文件冒充UI回读。

结果沿用schema5：`caseId=existing.<平台ID>`，`existingConfiguration.values`为UI基线，`queuedTaskChecks/taskChecks`是逐字段核对。支付宝Wasm分包未勾选、鸿蒙NEXT未选的设备子项，按当前SDK合同允许省略false，记为`omitted-default`；其他缺失字段不据此放行。Google Play的自定义渲染和方向控件按分组及选项标签回读，不依赖位置。启动前检查已保存配置没有后续阶段链，提交和终态再次核对任务未包含后续阶段；只到构建成功，不验证产物。Windows的build自身会调用CMake配置工程，这属于当前产品build流程，不点击独立生成或运行按钮。OHOS和AGC使用各自单平台入口；OpenPaaS也使用单平台入口，不加入这个固定批次。

1958包与custom SDK的7个平台均已完成UI回读、入队/终态参数和成功卡片核对，每个平台只新增一次构建。证据分批保留：[微信/抖音及原支付宝误报](../../results/2026-10-19T12-28-03-623Z/result.json)、[支付宝原任务只读复核](../../results/2026-10-19T12-32-18-204Z-existing-observation/result.json)、[Android/Windows/鸿蒙NEXT及Google提交前受阻](../../results/2026-10-19T12-32-18-582Z/result.json)、[Google定向补测](../../results/2026-10-19T12-35-08-758Z/result.json)。原始failed状态不改写，不声称一份7项全选报告全绿；已通过的平台未重跑，旧版结果不作为新版通过证据。

## 首批配置页检查（18 个目标）

在 PinK-Test 根目录运行，默认 `inspect` 不修改选项、不提交构建：

```powershell
.\run-config-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007" -Platforms all
```

加 `-Mode exercise`，对公共字段 `mangleProperties` 做真实反向修改、回读、关闭重开检查，再经 UI 恢复初态并重开核对。两种模式均不点击构建。单平台可指定 `-Platforms web-desktop`；多个 ID 要加引号，例如 `-Platforms 'web-desktop,huawei-agc,vivo-mini-game'`。

目录包含 X-Device 的 ohos、harmonyos-next、huawei-agc、android、web-desktop、web-mobile、windows，以及 X-Application 的 openpaas、wechatgame、bytedance-mini-game、alipay-mini-game、oppo-mini-game、vivo-mini-game、honor-mini-game、huawei-quick-game、taobao-mini-game、fb-instant-games、google-play。按精确卡片名、独立弹窗标题、必需公共和专属字段合同核对身份；vivo、淘宝自定义控件另按唯一标签核对，不依赖卡片排序或固定坐标。

OpenPaaS使用下节独立模式；通用`inspect/exercise`不进入该页，避免把账号相关表单套用公共开关往返。因此`all`仍会报告这一项需要专属模式，整体incomplete/退出码1；不是OpenPaaS整个平台未实现或缺专用账号，也不声称存在18页同批通过结果。

配置页检查容许校验提示和禁用的构建按钮，例如 AGC 缺服务文件仍可以验证表单加载。构建资格单列：已有8平台组合和新增7平台的existing基础链路分别开放对应命令，仍需通过各自现场前提检查；其余平台保留SDK/材料/阶段原因，不能因为表单已加载就提交。此入口检查平台身份、完整加载、值可回读和一个公共字段的保存往返，**不代表所有控件、枚举、条件联动、验证规则和 UI 用例族全部通过**。平台专属交互仍由下面的 D/A/B/C-local 组合及后续用例承担。

结果位于 `results/<时间>-configuration/result.json`，独立 `kind=configuration-ui`、schemaVersion=1，按 `caseId=configuration.<平台>.<模式>` 保存脱敏字段、控件类型、可用性、校验信息、逐项检查、构建资格和恢复结果。不保存配置截图。tasks.json 前后哈希须不变；exercise 按 UI 恢复字段，产品首次保存可能补齐平台默认偏好，因此另记 preferences.json 字节是否相同，不覆盖原文件来伪造恢复。出现无法恢复的差异就停止后续平台。退出码 0 全通过、1 失败/受阻、2 参数/前提错误、130 用户停止。

### OpenPaaS配置检查（不构建）

当前适配1958包和现用custom beta.0 SDK，沿用已登录账号及已有游戏；需要初态已选中有效游戏、版本名非空，以便恢复原选择。执行期间不要手动操作配置：

```powershell
.\run-config-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610191958-0.0.2.0\PinK.exe" -Project "D:\PinK-test\l10n_007" -Platforms openpaas -Mode openpaas
```

检查名称/构建路径的必填标记和当前非空值，核对游戏列表响应与UI候选。存在多个候选时，通过原生下拉的数字ID键入选择另一个已有游戏；只有一个时回读该游戏，结果明确记录未发生身份变化。随后回读选中ID及代码版本，与被动观察到的游戏列表核对。不会遍历或选择“创建游戏”，不会调用产品写接口。

版本名临时清空→保存重开触发必填校验→检查提示→恢复原版本与游戏→再次回读。重开只用于这项加载时校验，不推广为普通构建前置。结果中游戏ID仅存SHA-256，令牌、密钥和私钥路径脱敏。页面会按产品逻辑刷新账号环境、自动保存/补齐偏好；恢复本次编辑值，不承诺整个preferences.json字节相同。

[1958专项结果](../../results/2026-10-20T02-08-37-001Z-configuration/result.json)已通过：两个已有游戏真实切换；版本名空值显示“此项为必填项”，原游戏及`0.0.1`恢复，tasks.json哈希未变、引擎设置未改。现场两个游戏的代码版本均为空，只证明这一联动分支；非空代码版本、空列表/权限失败、名称/路径的负向分支未执行。最初因探查遗留弹窗而在前置检查停止的记录保留，未新增构建。

本配置专项仍不提交构建。正常构建另用前述OpenPaaS单平台入口，按最新口径保留产品自动流程，不再因make/upload预先阻塞。OHOS和AGC分别使用自己的单平台构建入口。

## 历史页面只读检查

这是独立入口，不进入下面的配置/构建执行流程。在 PinK-Test 根目录运行：

```powershell
.\run-history-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007"
```

复用相同的连接、启动和真实输入能力；工程分类最多等待 180 秒就绪。只操作历史搜索、筛选和批次折叠，不打开配置，不提交、重建、取消或移除任务，不执行生成/运行，也不查看产物。若已有配置弹窗或活动任务，本次检查受阻，不处理用户任务。运行期间不要同时操作界面或修改任务。退出时尝试恢复历史页搜索、筛选和批次展开状态，保留 PinK 窗口。

默认引用已有 A 轮结果中的 web-desktop 成功任务及 B 轮结果中的淘宝失败任务；工程、PinK 版本/commit、任务ID/平台/输出名/终态/完成时间须与现场一致，不取“最新任务”替代。可用以下参数指定其他有效记录：

- `-SuccessResult` / `-FailureResult`：已有构建结果 JSON，默认分别为 `results/2026-10-16T12-34-21-975Z/result.json`、`results/2026-10-17T03-38-20-904Z/result.json`。
- `-SuccessPlatform` / `-FailurePlatform`：默认 `web-desktop` / `taobao-mini-game`；每份文件须有该平台唯一对应终态的任务。
- `-Port` / `-ResultsRoot`：沿用调试端口和结果目录规则。结果文件位于新的 `<时间>-history/result.json`，不会改写源结果。

当前检查：输出名及大小写搜索、两个代表平台名称搜索、无匹配与清空恢复、X-Device/X-Application 分类筛选、搜索与分类交集、批次折叠/展开、成功/失败标识及图标、淘宝错误摘要、未筛选历史的批次/记录总数、仅含 success/failure 的批次目标及成功失败数。当前包“全部平台”筛选项实际为英文 `All Platforms`，这是已核对的界面文本。

取消/generated 的成功失败统计口径、筛选后的统计、二级分组筛选和缺材料空历史不计通过；报告明确列出范围和跳过原因。现有分类合同覆盖优先8平台和OpenPaaS；现场出现其他平台时，对应分类集合核对受阻，不假定分类。

报告 `kind=history-ui-readonly`、独立 schemaVersion=1，保留逐项预期检查结果、源runId/taskId、截图与失败原因；其 schema 独立于已有构建结果3/4，不迁移旧文件。结束重新读取任务身份/状态，并比较 tasks.json、preferences.json 前后 SHA-256，以确认未产生新任务或修改构建数据。退出码0通过，1失败/受阻，2参数/输入错误，130用户停止。历史UI通过不改变淘宝原构建失败结论，不代表全部35组历史用例或平台完整链路通过。

## 一条命令运行

### 九项本地选项用例

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007" -Plan local-options-nine
```

这是独立用例集合，不能混用 Profile、Suite、Platform、ApplyProfile 或持久化专项。普通用例配置并稳定回读后直接构建。完整顺序和分组如下；每项保留独立 caseId、最终配置和 taskId，同平台任务也分别判定。

| 组  | caseId                                                     | 目标                                           |
| --- | ---------------------------------------------------------- | ---------------------------------------------- |
| 1   | `next.public.maps-off`、`next.public.maps-standalone`      | Web桌面五个公共开关往返；Source Map关闭、独立  |
| 2   | `next.public.maps-inline`、`next.web-mobile.webgpu-on`     | Source Map内联；Web手机WebGPU开启              |
| 3   | `next.web-mobile.webgpu-return`、`next.oppo.engine-return` | Web手机WebGPU关闭；OPPO分离引擎关闭返回        |
| 4   | `next.taobao.globals-text`、`next.taobao.globals-adapter`  | 淘宝全局变量文本；开启全局适配并确认文本框隐藏 |
| 5   | `next.taobao.globals-return`                               | 关闭适配，原文本再现后清空                     |

可用 `-Cases 'next.public.maps-off,next.public.maps-standalone,next.public.maps-inline'` 选择子集；仍按表中顺序、每组选中项最多两项执行，不按输入参数顺序重排。未选用例不运行；续跑时明确选择尚未完成项，工具不会根据历史结果自动跳过或复位。只选返回项时，现场必须已有对应初态。

Source Map的DOM回读为字符串 `"false"`、`"true"`、`"inline"`，关闭和独立选项的枚举元数据、任务值为布尔false/true，内联为字符串inline；按当前CLI schema核对类型，不照抄旧SDK配置里的字符串候选值。公共五开关为mangleProperties、inlineEnum、experimentalEraseModules、useSplashScreen、bundleCommonChunk。Web手机按唯一WEBGPU标签操作；淘宝按唯一“globalThis 全局变量适配”“全局变量”标签操作。淘宝隐藏项仅保存已确认初值及显隐证据，入队和终态核对保留文本，不把隐藏值伪装成DOM回读；返回用例重新显示并核对原文后清空。

有真实往返要求的用例先检查初态：Web桌面从默认五开关及inline开始，Web手机从WebGPU关闭开始，OPPO需已有separateEngine=true，淘宝从适配关闭且文本空开始。初态不符合记受阻，不自动复位或虚报本次修改；完成后OPPO保持false，再次全跑前需要确认初态安排。缺材料分支不混入这九项，OpenPaaS不属于这个固定集合，配置专项与已通过的普通按钮构建见前节；本集合不验证产物、运行或生成。

Web手机同时回读预览区域的联动提示：可用HTTP地址且WebGPU开启时应显示HTTPS要求，关闭后不显示；无可用预览地址时明确记录unavailable，不计该警告分支覆盖。工具不打开预览地址、配置预览服务或执行运行。实包结果及仍缺覆盖见[九项记录](../../docs/pink-build-combination-design.md#本地选项九项用例与合并构建2026-10-19)。

### 既有单平台和组合入口

在 PinK-Test 根目录执行：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007"
```

默认调试端口 9222；`-QueueTimeoutSeconds` 默认为 1800 秒，限制任务创建到首次观察到 processing 的启动等待；`-TimeoutSeconds` 默认为 600 秒，从首次观察到 processing 起计时。当前包没有可靠开始时间，启动等待包括排队、校验及首次进度前准备，两段均为 Webview 观察值，不是精确性能计时。`-ConfigurationTimeoutSeconds` 默认 120 秒，为每次配置回读的就绪等待上限；与任务的两个上限分别计算。可另用 `-Port`、`-ResultsRoot` 调整端口与结果目录。配置已打开或有活动构建时，不要同时人工修改或提交；工具遇到归属歧义停止，不重复点击。

单独运行 web-desktop 调试组合：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007" -Profile debug -Platform web-desktop
```

优先 8 平台调试组合，每 2 项一组：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007" -Suite debug-priority
```

分组顺序为 Web 桌面/Web 手机、OPPO/vivo、荣耀/华为快游戏、淘宝/Facebook。组内按此顺序提交，单平台命令为一项一组。也可用 `-Profile debug -Platform <上述 ID>` 单独执行其中一项。`-Suite` 选择整个调试批次；不混入其他组合或平台，不点击“全部构建”。

单独运行 web-desktop 的 A 轮本地发布及专属基准：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007" -Profile release-a -Platform web-desktop
```

8 平台 A 轮，每 2 项一组：

```powershell
.\run-build-ui.ps1 -Pink "C:\Users\Administrator\Downloads\PinK-win32-x64-2610121218-0.0.1.39\PinK.exe" -Project "D:\PinK-test\l10n_007" -Suite release-a-priority
```

A 轮采用 Builtin、Debug off、MD5 on、主包本地、服务器空；Web 两端无压缩，六个小游戏合并全部 JSON，可见时不跳过纹理压缩、自动图集 on、初始场景 Bundle on。只修改这些公共字段。专属字段按设计中的基准回读：初态、公共配置后的最终值、显式保存专项的重开值，以及本次任务白名单，当前 UI 共 60 个字段；vivo 自定义表单按字段标签及原生下拉框回读 9 项，未显示的 AppID/AppKey/分离引擎明确记为 UI 未覆盖（通用表单设计原为 12 项）。数值保留 number 类型，华为最低平台版本保留 string 类型。默认若现场专属值不同则受阻；显式-ApplyProfile仅写入已批准的非敏感目标，不重置图标、账号、签名或运行时版本。

发布组合的 AppKey 只记录 `[redacted:empty]` / `[redacted:nonempty]`；A 轮要求空值，非空侧留给材料分支。SDK 可选的空 AppID/AppKey/密钥路径在任务中省略时单独记 `omitted-empty`，其他字段必须实际提供且精确匹配。发布组合提交前失败不保存可能包含私密字段的配置截图，只保留脱敏回读及错误。签名只读路径，不读取私钥正文。

`release-a` 不执行 B/C/D/E 的专属非默认值、远程/Zip、分离引擎开启或真实纹理/图集处理专项。结果保留 M01～M07 的缺材料/前提待核实状态，不把 A 轮基准通过当作这些分支通过；未读产物证明实际纹理、图集或签名效果。

## B 轮非默认组合

单平台入口为 `-Profile release-b -Platform web-desktop`；8 平台入口为 `-Suite release-b-priority`，其他启动参数相同，每组最多 2 项。

B 沿用 A 的发布背景，Web 桌面改为 merge_dep，OPPO 改为 subpackage，其余压缩模式不变。一次构建合并以下可独立回读的变化：

| 平台     | B 轮专属变化                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| Web 桌面 | WebGPU on、分辨率 960×640                                                                                                  |
| Web 手机 | landscape、embedWebDebugger on                                                                                             |
| OPPO     | 非默认包名/版本名/版本号、landscape；separateEngine off                                                                    |
| vivo     | 非默认包名/版本名/版本号、landscape；当前自定义表单的 3 个隐藏项仍不操作                                                   |
| 荣耀     | 非默认包名/版本名/版本号、landscape、fullScreen off、minPlatformVersion=1081（number）、logLevel=warn                      |
| 华为     | 非默认包名/版本名/版本号、landscape、fullScreen off、minPlatformVersion="1104"（string）、logLevel=warn、separateEngine on |
| 淘宝     | landscape、wasmSubpackage on、separateEngine off；nativeCodeBundleMode=wasm 后通过出现的控件开启 Wasm 压缩                 |
| Facebook | landscape、embedWebDebugger on                                                                                             |

四个快游戏包名分别为 com.pink.qa.oppo/vivo/honor/huawei，版本名 1.0.1、版本号字符串 "2"；runtimeVersion 保留 2.0.0。未纳入变化的专属字段必须符合 A 基准；不重置图标、账号、签名或隐藏项。初态保存为脱敏回读，写入后精确核对全部适用专属值，使用最终配置快照直接提交，再比较入队与终态任务参数。保存重开专项需显式选择。文本和数字通过真实键盘输入；通用枚举按当前 UI 的 data-pink-enum-value 精确定位后真实点击，方向显示标签存在 Landscape/横屏差异；vivo 原生 select 通过真实鼠标与键盘选择，不向 DOM 或偏好文件写值。

淘宝 Wasm 压缩 UI 为勾选 true，任务合同为字符串 brotli，分别比较并记录。必须等待选 wasm 后条件控件实际出现，缺少控件就受阻，不通过接口补写。华为最低版本满足当前 SDK 的 >=1091 门槛；当前包的部分引擎分离初始化被注释，本地构建缺插件文件可能仅警告，因此通过只表示配置/参数/构建链路，不代表插件可用、RPK 打包或分离产物正确。

M01～M05、非默认 runtimeVersion、淘宝分离引擎等仍保留后续分支；不缺材料的返回侧由 C-local 单列。B 不检查产物和设备效果，不安装依赖材料，不触发 make/run/publish。2026-10-17 实包逐平台为 7 passed / 淘宝 1 failed（Web 手机适配后定向补测）；淘宝 wasm/brotli/分包组合在 SDK 引擎编译阶段报 Babel filename 错误，当前保留失败用例，完整批次仍会返回非零退出码。详细任务和证据见构建设计。

调试组合经可见控件设置 Bullet、WebGL2、Debug、MD5、主包远程、资源服务器、主包压缩、纹理压缩、图集及适用的初始场景 Bundle；等待异步模块选项加载，回读最终联动值和输出名后直接提交。Web 手机端的纹理/图集字段、隐藏的初始场景 Bundle 和 Polyfills 明确记为未覆盖。参数及平台差异见[组合设计](../../docs/pink-build-combination-design.md)。

调试和发布组合模式要求工程清单名称与构建名称一致，入口场景及唯一已选场景的 UUID 必须等于 `-SceneUuid`；默认沿用当前 l10n_007 的场景 UUID，可显式传入其他已准备的场景，不自动改造材料。它们会保存平台偏好，结束后保留已修改配置，并记录初态、最终值、可选的重开值和涉及的字段，不自动恢复或清空用户偏好。existing通常不编辑配置；AGC仅设置显式提供的服务文件路径及匹配包名。

没有运行实例时工具将 `-Project` 路径及调试参数一并交给 PinK 启动，随后核对目标工程窗口。指定包已在所选端口运行时连接原实例，并核对工程窗口。普通启动但未开放端口时，请保存并正常退出后再运行命令，工具不会强制关闭。若已有调试实例，需确保当前窗口确为传入工程；当前只用窗口标题核对名称，同名不同路径工程不在已验证范围内。

结束后保留 PinK、构建任务和输出，只释放调试连接与临时监听。Ctrl+C 停止工具的后续操作，正在运行的构建不会被自动取消；需要时由用户在 UI 处理。

## 重复执行与保存专项

普通组合默认 `-Persistence skip`，配置 → 等待联动稳定 → 回读 → 直接构建，中间不关闭重开。公共配置保存检查通过独立 `run-config-ui.ps1 -Mode exercise` 执行；若要同时检查某个组合的保存与构建，可显式加 `-Persistence verify`。该模式必须确实修改过合法字段；初态已等于目标时会受阻，不将同值重开记成保存修改通过。

A/B 保留未纳入本轮变化的专属值基准检查。需要重复执行并允许恢复已批准的非敏感专属目标时加 `-ApplyProfile`，例如从 B 返回 A：

```powershell
.\run-build-ui.ps1 -Pink <PinK.exe路径> -Project <工程路径> -Profile release-a -Platform web-desktop -ApplyProfile
```

该参数仅写入已审阅的 WebGPU、分辨率、方向、调试器、包名、版本、分离引擎、Wasm分包、最低版本、全屏和日志字段；不修改账号、签名、图标或 runtimeVersion。未批准字段基准不满足时仍受阻。所有组合结束后保留已配置偏好；工具不会为了制造通过偷偷重置用户初态。

## C 本地返回分支

单平台使用 `-Profile release-c-local -Platform web-desktop`，8 平台使用 `-Suite release-c-local-priority`，沿用每组最多 2 项。

- Web 桌面：R-L/merge_all_json，WebGPU false、1280×960；Web 手机：portrait、调试器 false。
- OPPO：merge_all_json 本地、分离引擎 true、元数据/方向回 A；vivo/荣耀/华为：已审阅的元数据/方向等回 A，华为分离引擎 false。
- 淘宝：在仍显示 Wasm 压缩时先真实取消并回读，再选 asmjs，Wasm 分包 false、方向 portrait；明确记录压缩关闭是本次观察到还是初态已隐藏。实际关闭后任务的压缩字段应缺省，不能按 UI false 比较。
- Facebook：portrait、调试器 false。专属字段仍逐项回读与任务核对。

这不是 OPPO Zip C04，也不覆盖远程→本地 C09；M01 缺材料继续保留。OPPO 引擎分离仅验证 UI/参数/本地 build，不执行生成、签名发布、运行或核验插件产物。D/E 收尾及其他材料分支不自动加入。

## 配置页就绪与分组

弹窗出现或构建按钮出现不代表配置已加载完成。工具读取实际加载提示，等待“加载参数中…”消失、所需字段和可操作控件出现、初始场景及路径完整、配置值稳定 600ms 且构建按钮可点击，再开始配置。终端会输出 loading-options、awaiting-fields、stabilizing、ready 等阶段，缺少的字段单独标明，不靠固定休眠判断成功。

出现“该平台暂无可配置参数”立即记录 no-options，作为当前 8 平台的配置加载失败；仍在加载或控件未就绪则等到配置上限。Runtime.evaluate 单次超时只重试只读回读，并标记 renderer-unresponsive；不会重复发送输入。超时或明确失败后停止后续提交，继续收集已关联任务。发布组合提交前保留不含值的加载状态、字段名和计时，不保存可能包含私密字段的配置截图。

每组最多 2 项，已终态的任务仍属于当前组，不提前补位加入第三项。本组所有已提交任务收尾并核对后才进入下一组；超时后仍可能运行的任务会阻止进入下一组。队列覆盖要求第二项在第一项完成前提交，并实际观察到 waiting、processing 及成功；第一项完成太快则记 not-observed，不能把构建通过冒作排队覆盖。

## 结果与检查

结果写入 PinK-Test 下 `results/<本轮时间>/result.json`，使用 schemaVersion 5（历史 schema3/4 文件保持原样），每项有独立 caseId，运行中顶层 outcome=running，结束后给出最终判定。`cases` 逐平台记录初态、组合预期、回读与重开值、涉及的字段、未覆盖字段、点击时间、任务关联时间、关联时状态、入队快照 queuedTask、最终 task、两次参数核对和 UI 成功复核。timing 记录首次 waiting/processing/终态的观察时间与启动等待/processing 耗时，timeout 区分 startup-wait 和 processing；execution 声明 groups-of-two、组上限和三个超时参数。cases.group 对应工具分组，groups 记录平台集合、组开始/关闭提交/收尾时间、结果与 queueCoverage，不是 PinK 任务自身的 groupId。configurationReadiness 保存初次及重开的加载阶段、就绪时间和失败证据，不包含输入值。发布组合使用 `specialConfiguration`（mode 区分 baseline/non-default，含表单 variant 与 uiUncovered；历史结果仍为 specialBaseline）、任务的脱敏 `specialOptions`、两个专属检查结果，以及 `coverage` 中当前轮次和未执行的后续分支。单平台保留顶层 configuration/task 等便捷字段。`finalConfiguration` 及 `specialConfiguration.final` 是提交、入队和终态校验的统一依据；普通链路来自配置完成后的回读，保存专项来自重开后的回读。`persistenceCheck.state` 明确 not-requested/not-run/passed/blocked/failed，普通模式 checks.persistence=false 表示未要求，不能当作失败。`confirmedChangedFields` 只记录控件确认已改变的项；`changedFields` 另保留尝试写入的范围。configuredEngine 记录配置中的引擎选择，不等同于已加载编译器指纹。提交或最终收集失败时尽力保存 `<平台>-failure.png`，超时只记录任务状态及超时类别，发布组合提交前配置截图除外。没有读取产物文件，也不把 `generated` 当作构建成功。

批次区分 submitted、passed、failed、blocked、stopped、not-run，只有全部单元通过才整体通过。开始前要求无活动任务；运行中允许本轮已关联任务等待或执行，不混入外部新任务。配置前受阻可继续其他平台；配置加载失败/超时、提交不明、入队参数不符、任务超时、观察中断或 UI 清理失败时停止后续提交。已关联任务在观察仍可靠时继续收集，不自动重试或取消；启动等待超时不能断言 PinK 未开始工作，结果保留任务可能仍运行的标记。配置结束及统一收集期间增量保存结果，每组再按分类打开历史页取得新快照、逐项检查成功卡片；全部结束后释放所有观察器。

退出码：0 为本次链路通过，1 为执行失败，2 为参数或前置输入错误，130 为用户停止。失败结果保留原始阶段和原因；界面结构或消息协议变更需要适配，不会用旧成功任务回退。

开发检查使用 `npm run check`、`npm run format:check`；实际构建验证使用上面的正常入口。当前不新增模拟成功测试，真实运行证据与类型/格式检查分别记录。

设计与已验证边界见 [构建设计](../../docs/pink-build-ui-automation-design.md)。

# QA 用例加载、材料与离线计划合同

2026-10-21：已接入现有四组工具并完成离线验证，随后完成五项真实样本，以及 web-desktop 冷启动和已有实例接入验收。离线计划仍不代表 UI 或构建通过；实机结果按具体用例区分，不改引擎设置、不验证产物。

## 组合用例正式合同（2026-10-28）

本批新增有限的用例组装层，复用原生加载、Catalog 编译、v2 依赖校验、两项调度和执行器。组合定义是编辑输入，不是新的执行协议：先组装成原生 v2，再保存、预览、校验计划并执行。能力总版本仍为 `2`；组合定义、组装结果和组合能力各自使用 schemaVersion `1`。本批只有离线证据，尚未完成新组合入口的 PinK 实机验收。

### 模块导出与文件

Node.js 24+ 宿主从 `tools/build-ui/dist/native-case-contract.js` 导入：

| 导出                                                                       | 合同                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `describeCaseComposition()`                                                | 返回组合结构 JSON Schema、选择 Schema、参数绑定、操作及公共页面边界；不读取文件或连接 PinK             |
| `createCaseComposition(document, {sourceId?})`                             | 校验原生 Catalog/v1/v2，复制为 sources，生成逐条原生用例引用；不编译或执行                             |
| `await composeNativeCases(definition, selection?, {project?, materials?})` | 解析引用、参数、覆盖和顺序，复用现有编译及依赖检查，返回组装结果；Catalog 的编译可能读取所选工程及材料 |
| `mapCompositionResults(assembly, rawResult)`                               | 核对派生文档和映射身份后，把原始 case/step 结果关联回引用实例；不把未执行项补成通过                    |

上述函数同时由 `describeNativeCaseCapabilities().composition` 描述。类型从同一模块再导出，包括 `CaseComposition`、`CompositionSelection`、`CaseAssembly`、`CompositionOrigin`、`CompositionDiagnostic` 及动作、片段、节点和参数类型。动作参数仍读取既有 `fields.steps.operations[].parameters` / `assertions[].parameters`；不在前端另建操作白名单。

`describeCaseComposition().schema` 为 draft 2020-12 结构 Schema，`.selectionSchema` 描述本轮选择；二者辅助编辑，绑定、控件合同和步骤生命周期以 `composeNativeCases` 的语义校验为准。**组合 JSON 不可直接传给 CLI `--input`**，宿主必须先组装，再将 `assembly.document` 另存为原生 `cases.json`，交给已有 `--file` / `--input` 和 `--expected-plan` 入口。

### 编辑描述与诊断补充（2026-10-29，源码待刷新）

本批只在源码增加可选描述和诊断字段，保持既有输入、执行、恢复、哈希和结果合同不变，能力总版本仍为 2。**没有刷新 dist**，前端读取当前已编译模块时尚不会获得这批新增字段；需在后续获准刷新编译产物后消费。本批只做类型、格式静态检查，不运行测试、执行器 CLI、PinK、构建或打包，不据此声称功能验收通过。

`describeNativeCaseCapabilities().fields.steps` 的编辑描述增加：

| 字段                                                  | 含义和限制                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operations[].targetKinds` / `allowedPhases`          | 目标为 platform/builder，位置为 before/steps/finally。restore、stage.restore、builder.home 仅 finally；config.open/close 可用于主链和收尾。before 仍按现有机制展开进原生 steps，放置合法不代表依赖成立                          |
| `assertions[].targetKinds` / `allowedPhases`          | builder-state 只适用 builder，其他检查适用 platform；均只在 before/steps。assert 操作本身可以用于两类目标，须继续按选中的检查类型过滤                                                                                           |
| `operations[].references` / `assertions[].references` | 每项包含 inputPath/type/source/scope/producers，可选 when。inputPath 相对动作 inputs，`*` 表示数组项；when 表示当前动作的分支条件。source=step-output 或 field-description，后者从本目标字段描述取候选，不是步骤输出            |
| `references[].producers`                              | `{operationId,when?}` 是可提供该引用类型的操作；producer.when 是生产操作条件。read(scope=build) 还可提供 build-configuration-snapshot，assert(check=hidden) 可提供 hidden-assertion。列表描述类型候选，不保证某个实例当前仍有效 |
| `referencePolicy`                                     | 步骤输出限同一 flow 实例，生产者须在展开后位于消费者之前；字段限当前 case 目标。页面寿命、快照修订、平台/任务归属仍交由原生校验；不能据类型候选直接判定通过                                                                     |

`describeCaseComposition()` 增加以下可消费字段：

- `templates`：模块拥有的工具模板数据，包含 id/title/description/parameters/definition。首批 configuration-check 为既有“名称配置→回读→独立预期→恢复关闭”片段加一处实例，builder-home 为既有公共主页检查；均不提交构建，不是原生用例自动拆链接口。
- `templates[].parameters`：key/title/required/schema/nodePath/inputPath，以及可选 candidates。参数位置先从模板 definition.nodes 按 nodePath 找到节点，再按 inputPath 读取和填写；初始值以 definition 为准。配置模板的三个参数为 platform/name/expectedName，公共模板为 category。设置值与预期分别维护，不能自动同步。
- `templatePolicy`：前端复制正式定义后，按已有组合数据规则处理根节点/片段 ID 冲突；重命名片段时同步 use.fragmentId。nodePath 相对模板自身，插入后须随节点映射更新。内置平台 candidates 是静态提示，不证明当前版本存在或可构建，也不排除已有标准目标描述；仍须 compose 和运行时核对。
- `parameters.bindings`：声明 `$param` 的片段参数作用域和 `$output` 的相对节点路径；输出引用是操作节点引用，不是返回对象的属性路径，跨 case 禁止。
- `selection.rules`：caseRef.atomic=true；flow 只选择 steps 的直接子动作或动作片段，before/finally 必带；多后代分组不能附加单例覆盖；重复实例须有独立 instanceId。
- `editableOverrides`：列出 arguments、values、expectedValues、stepInputs 的位置、适用节点和限制。arguments 仍按已绑定值的类型检查；offerReferenceKindExchange=false 表示编辑器本批不提供普通值与材料/场景引用互换，不表示新增了执行侧校验规则。stepInputs 不可覆盖 id/op。
- `diagnostics`：说明现有必需字段及新增可选 inputPath/missingReferences。已有 code/message/nodeId/instancePath/phase 均保留；phase 仍为粗粒度，不将其解释为精确运行阶段。

diagnostics 的 `inputPath:(string|number)[]` 相对 instancePath 定位的节点，或该实例的本轮覆盖项；例如动作参数为 `["inputs","snapshot"]`，实例参数为 `["arguments","name"]`。`missingReferences` 每项为 `{kind:"parameter"|"output",name?,instancePath?}`；参数缺失提供 name，输出缺失提供绝对动作实例路径。不包含秘密输入值。

本批只在组装器已明确掌握的位置补齐这些字段：缺少/错误参数、未选入的输出节点、未知操作及无法唯一匹配的步骤覆盖。不从中文异常消息推导缺依赖；未结构化的原生生命周期错误继续定位到动作或整个 flow，前端须保留原诊断显示。

例如只选断言、漏选其回读时，可以返回如下结构（说明格式，不代表本批实测）：

```json
{
  "severity": "error",
  "code": "dependency",
  "message": "输出引用的节点未进入本轮操作链",
  "nodeId": "expected",
  "instancePath": ["mobile", "check", "expected"],
  "phase": "native-validation",
  "inputPath": ["inputs", "snapshot"],
  "missingReferences": [
    { "kind": "output", "instancePath": ["mobile", "check", "read"] }
  ]
}
```

编辑仍直接调用已有 `authorAutomation(action:"compose")` 取得结构化结果；宿主 preview 独立重组装、冻结快照。无需新 IPC 错误协议或第二套结果映射。本批没有新增原生用例自动拆链、历史页面动作、动态候选探查或 UI 操作。

### 定义、复用与本轮选择

组合定义为 `{kind:"pink-case-composition",schemaVersion:1,sources,fragments,targets?,nodes}`。sources 是 `{id,document}` 的原生文档快照；targets 复用现有标准平台描述。

| 节点       | 内容及边界                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| `group`    | `id/nodes`，可嵌套；用于有序组织，不凭显示名称执行                                                           |
| `case-ref` | `id/sourceId/caseId`，引用完整原生用例；可声明 `endpoint:"ui"`，但只适用于 Catalog；不删原生前置、断言或收尾 |
| `flow`     | `id/target/before?/steps/finally/onFailure?`，组合现有动作，依赖仍须成立                                     |
| `use`      | `id/fragmentId/arguments?`，参数化引用；每处引用有独立实例路径，不共享运行中的页面或记录                     |

片段分 `kind:"nodes"` 和 `kind:"actions"`。前者包含 nodes，后者包含 before?/steps/finally?，只能分别用在节点或操作位置。动作格式是 `{id,kind:"action",moduleId:"pink-build",operationId,inputs}`；operationId 只能是执行侧已有操作。新控件或新业务行为仍需执行侧适配，不能通过 JSON 自授脚本、任意选择器或任意点击。

参数声明为 `{kind,default?,references?}`，kind 为 string/number/boolean/array/object/output；文件或场景参数需要允许对应的 `references:["material"|"scene"]`。输入中 `{$param:"name"}` 绑定参数，`{$output:"open"}` 引用当前片段作用域内的操作输出，跨子片段可用 `{$output:["child","read"]}`。既有 `$material/$scene` 保留给现有输入解析层处理；不新增表达式、分支或循环解释器。

本轮选择为 `{items:[{path,instanceId?,arguments?,values?,expectedValues?,stepInputs?,steps?}]}`：

- `path` 是包含每处 use 实例的节点 ID 路径；items 顺序就是执行顺序。选 group 会包含后代，用一次选择覆盖多个用例时不能同时附加参数或局部步骤覆盖。
- 省略 selection 时按定义顺序展开全部完整用例；空选择报错。重复运行同一路径必须给不同 instanceId。
- `arguments` 修改声明参数；`case-ref` 的 `values/expectedValues` 只覆盖已有可赋值/可断言字段，不能删除隐藏或专项检查。`stepInputs` 只覆盖一个唯一动作的输入，不能改 id/op。
- `steps` 仅用于显式 flow 的主步骤或动作片段引用，按给定顺序选择；before 和 finally 始终保留。缺依赖时返回定位诊断，不自动补动作或跳过断言。原生 case-ref 始终是原子用例，不能局部删步骤。
- 动作片段的清理在调用链末尾按逆调用顺序展开；嵌套片段先内后外，再执行 flow 自身 finally。最后仍经原生 v2 生命周期校验，非法恢复顺序不会进入执行。

共享引用与独立复制有区别：复制 use/case-ref 仍依赖同一来源；需要脱离来源时，先组装所选实例，再把生成的原生 v2 快照通过 `createCaseComposition(snapshot,{sourceId})` 保存为新来源。以后修改原片段不会改变该快照。

### 平台外的公共构建页面检查

显式 flow 支持 `{kind:"builder",category:"X-Device"|"X-Application"}` 目标，不借用某个平台身份。对应原生 v2 case 使用 `target`，省略 `platform`，不能同时提供两者。

首批公共操作仅为 `builder.open` → `builder.read` → `assert/check:"builder-state"`，finally 必须是一次 `builder.home`。读取固定的 history/build-all 两个入口；expected 支持 `{ready?:boolean,buttons?:{history?:{visible?,disabled?},"build-all"?:{visible?,disabled?}}}`，预期必须明确且为布尔值。

读取返回 `category/ready/view/buttons`；按钮提供 visible、disabled（不能唯一确认时为 null）、matchCount。页面未就绪或控件多匹配为 blocked，回读后现场漂移为 stop，可靠观察与预期不符为 failed。此入口只对已就绪主页作检查，不把加载中或定位不明当成“不存在”。不会点击“全部构建”、触发阶段执行或修改平台配置；历史搜索、筛选和记录检查仍在原专项入口，本批未迁移为可组合操作。

公共检查是调度屏障：前一组任务先收尾，公共检查单独执行，后续平台继续每组最多两项。计划、进度和原始结果携带 target；公共项不伪造 platform/platformLabel，消费者需允许这两个字段缺省。

### 派生快照、错误与结果映射

组装返回 `{kind:"pink-case-assembly",schemaVersion:1,definitionSha256,selectionSha256,documentSha256?,mappingSha256?,document?,caseIds,willSubmit,sourceMap,diagnostics}`。任一错误都会清空可执行集合和映射，并省略 document；不能拿成功的子集悄悄继续。diagnostics 提供 code/message/nodeId?/instancePath/phase，供编辑器定位；不是执行通过证据。

来源映射逐项提供派生 caseId、nodeId、instanceId、instancePath、可选 sourceId/sourceCaseId，以及每步的 stepId/nodeId/instancePath/phase/sourceStepId?。case/step ID 由模块命名空间化，防止同一片段多次引用时串用任务、记录或结果。

宿主须从定义、选择和环境重新组装，不接受渲染层自报的 document 或 sourceMap 作为执行事实。保存派生 `cases.json` 时，同时保存 assembly（包含 sourceMap）及本轮定义/选择快照；原生文件中不塞入编辑器字段。运行前仍重新预览并核对 expected-plan。

- `documentSha256` 是解析后原生文档的 valueHash，须与原始 result.json 的 `documentSha256` 一致；不是文件字节 sourceSha256，也不是 planSha256。
- `mappingSha256` 绑定 sourceMap、documentSha256、definitionSha256 和 selectionSha256；任何映射改动都需要重新组装。
- `mapCompositionResults` 拒绝未知或重复用例、未知步骤和身份不符的结果；只允许执行器已定义的中断及提交收集清理记录。它保留真实结果和失败，不把过程结束当作通过，也不合并历史通过。
- willSubmit 来自生成的 build.submit；它不是“已提交”。工程、材料绑定及启动身份仍进入原有计划合同，组装成功不代表运行环境已齐备。

### 离线样本与证据边界

样本为 `tools/build-ui/fixtures/case-composition/reuse.json` 和同目录 `selection.json`：同一配置检查片段用于 Web 桌面、Web 手机，平台公共主页检查单独成项；选择样本改变顺序并覆盖手机端名称。这份样本只配置和检查，willSubmit=false。

```js
import { readFile } from "node:fs/promises";
import { composeNativeCases } from "./tools/build-ui/dist/native-case-contract.js";

const definition = JSON.parse(
  await readFile(
    "./tools/build-ui/fixtures/case-composition/reuse.json",
    "utf8",
  ),
);
const selection = JSON.parse(
  await readFile(
    "./tools/build-ui/fixtures/case-composition/selection.json",
    "utf8",
  ),
);
const assembly = await composeNativeCases(definition, selection);
if (assembly.diagnostics.length)
  throw new Error("请按 diagnostics 修正用例，不能执行部分结果");
// 宿主将 assembly.document 保存为原生 cases.json，assembly 另存供结果映射。
```

组合定向检查覆盖参数化多次引用、操作片段、局部选择和依赖错误、预期失败后恢复/继续、清理失败后停止、嵌套清理、Catalog 原编译器复用、原生 v1/v2、独立快照和结果身份校验。外部 DOM/控件使用离线夹具；组装器、校验器、配置操作和执行调度调用实际实现。另核对固定公共按钮的真实读取函数在隐藏、加载、重复控件及弹窗存在时的判定。已有未受影响检查复用；没有连接 PinK、提交构建或验证产物，不能据此宣布新入口的实机链路通过。

## 原生用例与仅配置终点正式合同（2026-10-27）

当前能力版本为 `2`，继续采用原生 CatalogDocument/1、步骤 v1/v2。下方早期实施记录中的固定目标限制、字符串枚举限制和 v1 缺少 `execution` 的描述，以本节为准。本批仅离线验证，不启动/连接 PinK、不提交构建、不修改前端、SDK 或引擎设置。

### 原生加载、保存与顺序

Node.js 24+ 宿主继续调用 `tools/build-ui/dist/configuration-steps-cli.js`。新增 `--input <原生.json>` 自动识别；原有 `--catalog`、`--file` 保留，三个输入参数只能选一个。

| 输入              | 识别和路由                                                                        | 执行定义                                                                                   |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| CatalogDocument/1 | 无 kind，具有 templates/platforms/fieldTypes/conditionalScenarios；路由 --catalog | 保留四组和 variants；cases/groups 只筛选                                                   |
| 步骤 v1           | kind=pink-configuration-steps，schemaVersion=1；路由 --file                       | cases/steps 顺序，隐式打开和关闭；记录后末尾恢复，失败也恢复；启动限单平台，不支持材料引用 |
| 步骤 v2           | 同一 kind，schemaVersion=2；路由 --file                                           | cases/steps/finally 顺序，显式页面和恢复；跨平台每组最多两项，重复平台先收尾               |

不按文件名或 revision 猜格式，不在校验失败后降级重试。步骤不能套成旧四组或文字描述。步骤文件不接受 cases/groups/endpoint 改写范围或步骤。

宿主可导入 `dist/native-case-contract.js`：

| 导出                                                          | 输入 → 输出                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| identifyNativeDocument(value)                                 | 原生对象 → format/schemaVersion/cliArgument；仅识别，不证明语义合法                      |
| validateNativeDocument(value)                                 | 原生对象 → 上述标识及校验后 document；不转成另一格式                                     |
| serializeNativeDocument(value)                                | 校验并输出原生 JSON，保留顺序、目标、机器类型和引用                                      |
| loadNativeCases(file, options)                                | 路由现有加载器；选项 project/materials/cases/groups/endpoint，后三项仅用于 Catalog       |
| configurationCheckDocument({caseId,platform,values,targets?}) | 模块生成原生 v2 默认序列：打开→就绪→记录→按输入顺序设置/就绪→回读→断言→finally 恢复/关闭 |
| describeNativeCaseCapabilities()                              | 返回格式、目标 schema、动作参数、依赖及观察合同，不访问 PinK                             |

CLI `--describe [--output <新文件>]` 输出同一份 `kind=pink-native-case-capabilities/schemaVersion=1/capabilityVersion=2`。目标编辑读取 `targetsSchema`；v1 参数读取 `formats[]` 内自己的 capabilities；v2 读取 `fields.steps.operations[].parameters` 和 `assertions[].parameters`。参数是 JSON Schema 描述，引用附 x-reference；保存和执行语义仍调用模块校验，不复制前端白名单或恢复算法。

Catalog 可选 `executionOrder:string[]`：列出的确切展开 caseId 优先执行，其余保持原展开顺序；不改变选择范围。目录组织、折叠和拖动仅影响展示，除非同步修改原生定义。`--cases` 参数顺序不是执行排序，最终顺序和分组以预览计划为准。

### 同一组合仅配置检查

新增 `--endpoint ui`，仅覆盖 Catalog 普通发布、调试、混合组合及其变体；省略保持原构建语义。条件/反向专项沿用自身终点。执行侧在编译前选择终点，生成记录、配置、回读/断言和恢复，前端不删改构建步骤。

UI 终点不生成构建快照、提交、等待或构建结果断言，不统一要求 SDK 可构建、构建按钮启用、阶段仅连接构建或任务观察器。仍保留程序/工程/页面身份、范围就绪、唯一目标、控件类型、可编辑性，以及本次设置/恢复所需的场景、文件、账号和适用性。组合填写签名、JSON 或游戏选择时仍须对应材料；未开放与人工构建并发，任务文件非预期变化保护继续生效。

所有合法原生格式的启动计划明确提供 `steps.execution.willSubmit`：v1 校验后固定 false，v2/Catalog 按最终步骤计算。顶层 buildSubmitted=false 只表示尚未提交，不能证明以后不会构建。宿主继续要求 willSubmit===false，并拒绝构建操作；缺字段的旧计划重新预览，不放宽拦截。终点、源定义、目标、顺序、输入和环境进入现有哈希；运行仍须 expected-plan。

```powershell
# 在 PinK-Test 根目录；以下均离线
node .\tools\build-ui\dist\configuration-steps-cli.js --describe
node .\tools\build-ui\dist\configuration-steps-cli.js --input <用例.json>
node .\tools\build-ui\dist\configuration-steps-cli.js --catalog <四组.json> --cases review.publish.web-desktop --endpoint ui --pink <PinK.exe> --project <工程> --preview --output <新计划.json>
```

### 随用例携带的标准目标

Catalog 和步骤共用 targets[]，每项为 `id/label/configurationTitle/category/fields`，可选 homeScope、families。允许同类新平台，也允许已有平台补字段描述；fields 可为空以单独探查平台。打开页面只核对卡片→标题→配置实例，不预先读取全部声明字段。

| 内容     | 正式字段及限制                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份     | id 是用例绑定身份，不自动证明产品内部 ID。v2 声明目标的打开结果注明 identityEvidence.basis=declared-card-and-title/productPlatformIdVerified=false。新平台和描述扩展的字段尚无任务参数合同，仅支持配置检查        |
| 字段     | fields 的 key 是测试字段身份；值为 {kind,control,locator?,scope?}。kind=string/number/boolean，control=text/number/boolean/enum；枚举保持实际机器类型，不从标签猜布尔或数字                                       |
| 定位     | 缺省精确 data-option-key；或 locator={kind:option-key,key}、{kind:label,name}、{kind:role,role,name}。role 只允许 textbox/spinbutton/checkbox/combobox；不接受 CSS/XPath/JS。多匹配、复合或新控件不能取第一个兜底 |
| 字段范围 | scope={readyKeys:string[],section?:string}；section 必须唯一、展开且 aria-controls 可识别。不存在断言要求范围哨兵、标准表单就绪、无加载或未展开区块；不能只等时间或等待待查字段出现                               |
| 主页范围 | homeScope={readyLabels:string[]}；未声明或哨兵未就绪时零匹配是 undetermined。缺失结论仅限当前分类的声明 UI 范围，不代表全部筛选页或安装注册表                                                                     |
| 联动     | families=[{parent,enabled,children}]，复用已有平级父子记录/恢复。必须同平台且字段有能力；不能覆盖内置联动，不支持嵌套、循环或重复归属。准备用有序 set/ready，不引入表达式                                         |
| 候选     | 标准 select 和受支持 aria-controls 下拉读取实际候选；按机器值或精确标签唯一匹配、回读和恢复。静态候选仅作提示；若 Catalog 自己用 fieldTypes.choices 限定预期，QA 也须同步编辑该数据                               |
| 安全范围 | 读写前核对目标、实际类型、可编辑性，输入前再核对目标和候选。未知秘密字段不开放；既有签名、AGC、游戏选择继续用已有材料和专用适配。描述不能覆盖既有类型/敏感性或自授新行为                                          |

### 探查、候选及结果

下列为正式 v2 操作，参数及引用类型由 --describe 提供：

| 操作                   | 输入与输出                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| platform.probe         | 使用当前 case 的目标描述，须在配置页外；返回目标观察，不打开配置页                                     |
| config.probe           | page/field → 目标观察；不等待待查目标出现                                                              |
| config.candidates      | page/field → 候选观察；关闭自己打开的弹层，不选择候选                                                  |
| config.select          | page/field/candidate → {changed,selected:{value,label}}；匹配唯一、有实际机器值且可选，随后回读        |
| assert/check:probe     | observation/expected；检查 presence(present/absent)、visible、readable、writable、control              |
| assert/check:candidate | observation/candidate/expected；expected={present:boolean,disabled?:boolean}，禁用检查仅用于存在的候选 |

candidate 为 `{by:"value",value:string|number|boolean}` 或 `{by:"label",label:string}`。字符串 "false" 与布尔 false 不相等。无稳定机器值不能实际选择；虚拟列表未完整、缺适配或定位歧义不能用于不存在通过，不选默认值代替。

目标观察包含 `scopeReady/scopeComplete/matchCount/presence/visible/readable/writable/control?/reason?`。presence=present/absent/undetermined；不可观测的 matchCount/visible 为 null。reason=not-ready/ambiguous/unsupported/incomplete-scope。找到但控件不支持仍可确认存在，读写检查受阻。候选观察为 `{target,complete,items:[{value?,label,disabled}]}`，不暴露内部定位器。

断言须引用同例当前上下文中的未过期观察，并在断言前复核。可靠观察不符为 failed；未就绪、不完整、歧义或不支持为 blocked；身份/页面/快照失效停止。用例新增联动要求记录时父子原值均可读，不能先修改再把未知原值当作已保护；初态隐藏而无法可靠记录时，在写入前受阻。错误及恢复沿用 `steps[].output/error/diagnostic/evidence`、restoration、stopFollowingCases，进度与 HTML 协议不变。

### 离线证据与前端接入边界

定向验证调用真实原生加载/序列化、Catalog 编译、CLI 预览/哈希核验、配置操作、编排和恢复。[标准目标样本](../tools/build-ui/fixtures/configuration-steps/standard-target-v2.json) 以受控 DOM/输入夹具验证：同一执行器仅改 JSON 携带新平台、新字段、新候选，按标签选择、回读、缺失断言、失败后恢复并继续、恢复失败停止；另验类型保持、加载/隐藏/歧义/不支持区分和候选弹层清理。外部 DOM、输入和身份由夹具提供；既有入口只做受影响的定向回归。

这些不是新目标在真实 PinK 中已验收的证据。没有修改产品制造目标，Basic 示例旧离线可读也不升级成实机通过。前端可据此接入原生导入、编辑、模板、预览及结果读取，真实 PinK 代表样本验收后续另行安排；本轮不改前端、不跑构建。

## 面向 QA 的执行进度与产出（2026-10-26）

第一版展示以本次实际选择的“平台＋组合／用例”为单位。执行侧负责计划展开、任务关联、状态和统计，前端负责启动及展示；不从普通日志猜业务状态，也不把历史通过合入本次完成数。此处的产出指测试计划、运行结果及证据文件，不包含构建产物验收。

| 产出               | 归属与读取方式                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 预览计划           | `--preview --output <新文件>`；记录程序、工程、用例、材料摘要、范围与哈希，运行时传同一文件 `--expected-plan`                   |
| 本轮计划           | 运行目录 `plan.json`，保留本轮实际加载的计划                                                                                    |
| 运行结果与最新进度 | `result.json` 原子替换；原结果格式保留，新增 `progress`，其 `kind=pink-build-progress/schemaVersion=1`                          |
| 命令行进度通知     | 每条独立行以 `PINK_BUILD_PROGRESS ` 开头，后面是与已写检查点对应的 `progress` JSON；有意义的状态变化才输出，sequence 可以不连续 |
| 人可读日志         | 普通 stdout/stderr 及 `[progress]` 摘要；前端可保存，但不用它们判定通过                                                         |
| 最终 HTML          | 同目录 `report.html`，供直接打开；收到最终通知且执行进程退出后核对文件，不能仅凭进程退出码或提前出现的终态 JSON 判定报告已收尾  |
| 失败现场           | 结果及进度的 `cases[].evidence` 引用脱敏 DOM JSON、可用截图；未能采集有 `unavailable`，不是每例保证有截图                       |

`progress` 的稳定字段：`runId`、递增 `sequence`、`updatedAt`、`lifecycle(running/stopping/finished)`、`phase(preflight/connecting/executing/cleanup/finished)`、`outcome`、`summary`、`cases`、`issues(fatal/warnings)` 和 `artifacts(plan/result/report)`。产出路径为绝对路径；证据相对路径按本次结果目录解析。运行级故障或清理失败可与部分用例通过并存，不能仅看通过数量。

- `summary` 提供 `total/completed/pending/running/passed/failed/blocked/stopped/skipped/notApplicable`。completed 表示已经有处置结果，包含受阻、跳过与不适用，不能显示为“成功数”；全部处理完也不等于全部通过。预检受阻可以在运行前已有处置。
- `cases[]` 保留计划顺序，提供 `caseId/platform/platformLabel/title/group/groupLabel/batch/status/stage/startedAt/finishedAt/tasks/failure/evidence`。手写步骤没有公共组合时 group 可缺省，直接展示用例身份。status 为 `pending/running/passed/failed/blocked/stopped/skipped/not-applicable`；仅本例执行与必要收尾结束后才呈现终态。
- stage 是当前粗粒度环节，活动例使用 `configuring/submitting/queued/building/checking/restoring/cleanup`；任务已成功仍可能正在核对。tasks 只含本例已唯一关联的 `taskId/state/progress/collected`；progress 仅在观察到有效 0～1 数值时提供，缺值不推算构建百分比。运行耗时可从时间戳计算。
- 原始 `cases[].outcome` 是执行器结果字段，运行中应结合新增的 `cases[].lifecycle`，前端统一读取 `progress.cases[].status`，避免把尚在执行的候选结果当成通过。
- `failure` 包含 `code/reason/details`；details 复用已脱敏的步骤原因链，证据仍按步骤引用。它不携带原配置、密码或任务参数对象。
- stdout 按换行缓冲解析，不依赖一次 data 回调对应一条消息；只接受已支持的 kind/schemaVersion，并按 runId/sequence 拒绝混轮与倒序。普通日志独立显示。文件轮询可作为同一结果的读取方式，暂时读取失败时保留上一份有效状态。

前端从独立 Node.js 24+ 进程启动 `tools/build-ui/dist/configuration-steps-cli.js`，传参使用数组，支持 `--catalog/--cases/--groups/--materials/--pink/--project/--results/--preview/--output/--run/--expected-plan`；直接步骤使用 `--file`。不要调用旧 Profile/Suite 入口。可使用 Node IPC 通道向监管进程发送 `{type:"pink-steps-stop"}` 请求安全停止；收到请求后展示 stopping 并等待已关联任务收集与报告收尾，不直接 kill 执行进程。无运行目录或无初始通知的加载/计划校验错误由进程非零退出及 stderr 呈现为启动失败，不伪造业务用例通过。

详细 TypeScript 输出合同为 [run-progress.ts](../tools/build-ui/src/run-progress.ts)。执行侧已完成下列验证；前端真实启动、进度与结果展示仍由「PinK 测试工具前端设计」接入，接口完成不等于前端联调验收完成。

### 本批验证与当前基础范围

本批沿用 1949 包、`D:\PinK-test\l10n_test_new` 和原 custom 引擎。普通构建保留测试配置，只到构建成功；不改 SDK/引擎设置、不验产物。每组最多两项。

| 证据                                                                                                                           | 平台与组合                                                   | 实际结论                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [跨分类结果](../results/2026-10-26-backend-delivery-1793005004391/cross-category/2026-10-26T09-00-52.219Z-steps/report.html)   | Web 桌面发布＋荣耀调试                                       | 两项通过，命令行和 JSON 体现运行中、核对中、逐项完成；本组未观察到实际排队 |
| [短队列复核](../results/2026-10-26-backend-delivery-1793005004391/queue-regression/2026-10-26T09-08-29.399Z-steps/report.html) | OPPO、vivo 调试，另有一条 Web 桌面只读步骤保持双分类观察条件 | 两项构建通过，实际观察到 vivo 排队后开始；只读项通过。未重复 Web 桌面构建  |
| [剩余基础项](../results/2026-10-26-backend-delivery-1793005004391/remaining/2026-10-26T09-11-49.052Z-steps/report.html)        | 华为快游戏、淘宝、Facebook、Google Play 调试                 | 四项通过；淘宝当前轮次已构建成功，旧轮次失败不改写                         |
| [前提受阻输出](../results/2026-10-26-backend-delivery-1793005004391/blocked/2026-10-26T09-29-57.832Z-steps/report.html)        | Web 桌面混合，未提供适用清单                                 | 预检受阻，零连接、零提交，生成同一进度协议和报告；不是产品失败样本         |

三轮真实执行的通知序号严格递增，最后一条通知与最终 `result.json.progress` 一致；均无警告，任务已收齐、观察器清理通过、引擎设置未变。相邻 `*.stdout.log` 可供前端回放，其中普通日志与机器通知混合。手写步骤首轮曾在连接前因初始结果尚无 `steps` 字段而失败；已修复初始投影并补回归，随后才运行上述短队列，原 stderr 保留。

未受影响的基础证据继续复用：鸿蒙 NEXT、AGC、Android、Windows、抖音、支付宝的调试例来自[此前全平台轮次](../results/2026-10-26-all-platform-basics-1792997353791/execution/2026-10-26T06-53-38.087Z-steps/report.html)；Web 手机、微信来自[既有 v2 跨分类样本](../results/2026-10-24-v2-cross-platform-1792824582684/2026-10-24T07-11-45.981Z-steps/report.html)。后两项是原步骤样本身份，不伪装成完整公共组合通过。加上本批八个平台，共 16 平台有基础成功证据，不能外推为 18 平台四组全覆盖。

OHOS 按用户决定本批保留，其原任务的 `SDK directory not exists` 失败不改写。OpenPaaS 用户已确认当前未登录；只读响应也记录 `User did not consent to login.`，没有提交构建或代为登录。两者列为当前试用前提限制，不继续消耗本轮构建验证。

批量观察修复限定在工具：当前随包 Bridge 的 `webview:N` 请求序号用于过滤晚到旧响应，所选平台的任务状态取自其所属分类，不再把另一分类的旧 waiting 覆盖 processing。实际重新排队、任务消失和归属不明仍停止。离线回归覆盖错序与真实重排，短队列实机复核通过；旧失败轮次未保留完整消息时序，不反推每一条旧响应的具体顺序。

新增进度统计、手写初始结果、实际等待中的数值更新、失败后继续、受阻和停止聚合使用真实加载/编排/投影实现做定向离线验证，外部 UI/任务由夹具提供；这些错误分支没有为本轮重复提交异常构建。旧结果及报告 schema 不改写，v2 仅增加生命周期和进度字段。

## 按用例声明恢复（2026-10-26）

普通发布、调试、混合构建保留测试配置，转换器不再附加原值记录和恢复。第四组条件/反向专项保留恢复；持久化及阶段串联专项继续按显式步骤保护初态。此规则替代下文早期迁移中“默认恢复所有组合”的约定，历史结果不改写。

v2 沿用已有操作：没有 `record/restore` 时，`set`、联动准备、场景、图标及已有游戏选择可直接使用当前平台页执行；结果为 `restoration: not-required`。声明 `record` 时，修改前须记录目标及联动范围，场景修改须同时记录 `startScene/scenes`，且 `finally` 必须有对应 `restore`。`stage.record/stage.restore` 的合同不变。OpenPaaS 普通用例只要求目标为可选择的已有游戏；要求恢复的用例还须确认原游戏能安全选回。

普通构建成功后不为清理重开配置页；提交前失败且上下文可信时只关闭当前页，保留已设置值。任务收集、最多两项调度、失败后继续/停止、身份与任务范围检查、观察器清理和报告仍执行。恢复仅适用于明确声明的用例，不把跳过恢复当作恢复成功；修改步骤后须重新预览并核验计划。

2026-10-26 定向实机结果：[review.debug.web-desktop](../results/2026-10-26-keep-config-acceptance-1793000489942/execution/2026-10-26T07-42-44.794Z-steps/report.html) 通过。使用 `PinK-win32-x64-2610231949-0.0.2.0`、`D:\PinK-test\l10n_test_new`、原 custom 引擎，执行新的目录转换与计划核验；名称、输出名、物理覆盖、压缩、Source Map 等确有 UI 修改。任务 `task-1793000606513-9` 成功，入队和终态参数、成功卡片匹配。仅普通 `config.open` 执行一次，收尾打开/关闭均跳过，`restoration=not-required`；偏好保留 `qa_web_desktop_debug`、Debug 开启及外置 Source Map。最终队列为空、无残留探针、资源清理通过、无警告，引擎设置未变。未验证产物或重跑其他平台；提交前失败与恢复专项继续复用本次定向离线及既有实机证据，不把此单任务通过外推为双任务关联问题已解决或全平台验收完成。

## Windows 中断与安全收尾（2026-10-26）

`-CatalogFile` 和 `-StepsFile` 的实际执行共用启动监管进程与独立执行进程。Windows 下执行进程使用独立控制台组；Ctrl+C、停止消息或启动监管进程退出，都转为执行进程的停止请求。离线预览和计划核验不启动执行进程，也不连接 PinK。旧 `Profile/Suite` 入口未在本批迁移。

停止请求不直接中止正在进行的 UI 原子操作、已关联任务等待或恢复。当前操作完成后不再进入普通步骤和后续用例；提交步骤一旦开始，仍完成单次点击与唯一任务关联，不能把响应未明当作未提交重试。已唯一关联的任务按原有超时收集，再执行声明的 `finally` 恢复；身份、任务归属或观察不可信时沿用原安全拦截，不强行写回，也不自动取消任务。

连接前即写出 JSON 与 HTML，JSON 在步骤及提交关键点更新。结果增加 `lifecycle`（`running/stopping/finished`）、执行与监管进程 PID、停止来源/时间和 `cleanup` 资源释放结果；中断运行不会记为通过。任务参数、任务 ID、恢复及原失败证据保留；原始恢复记录仅存内存，不将敏感原值写入检查点。Builder 观察器由本次随机所有权标记约束，只清理本次监听；已有其他观察器不自动接管。

强制结束实际执行进程或断电后，内存恢复不能继续，只能保留最后检查点。`running/stopping` 或 `incomplete` 不代表已收尾；需先确认队列和配置现场，不能直接重跑。启动监管进程退出后的恢复能力与实际执行进程被强杀是两种情况。

离线验证已覆盖实际编排器的配置中断、已关联任务收集及恢复失败停止；进程夹具验证停止消息和监管进程被结束后，执行进程仍完成停止处理并正常退出，报告检查覆盖未完成及中断状态。这些夹具不替代 PinK 实机证据。

首轮[启动记录](../results/2026-10-26-windows-interruption-1792987034239/configuration/2026-10-26T03-59-47.474Z-steps/report.html)停在 Builder 容器就绪等待，两项均未执行。修正先前“无平台卡片”的判断：外层 DOM 文本不包含内层 `builder-home` iframe，不能据此判空；本轮截图和递归 DOM 已确认卡片存在。当前为英文 UI，原就绪检查只匹配中文。另确认后台商城嵌套 iframe 的自动接管会使 Playwright 工作台上下文失效；工作台连接现明确排除 iframe 自动接管，Builder 继续用原独立 CDP 客户端。工具仅补当前 web-desktop 路径的已核实英文文案，仍精确匹配、唯一选择并核对实际标题，不改产品语言或引擎设置，不宣称全平台英文适配完成。

1949 包、`D:\PinK-test\l10n_test_new` 和原 custom 引擎下，补验以下两条路径；未重复正常成功用例或其他平台：

| 定向自检                   | 停止点与实际结果                                                                                                                            | 证据                                                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置修改后结束启动监管进程 | 名称真实修改后，只结束本次监管 PID；独立执行进程收到 `parent-disconnect`，完成当前原子操作，恢复原名和阶段组，后续哨兵跳过；没有提交构建    | [JSON](../results/2026-10-26-windows-interruption-acceptance-1792988497915/configuration/2026-10-26T04-22-15.399Z-steps/result.json)、[HTML](../results/2026-10-26-windows-interruption-acceptance-1792988497915/configuration/2026-10-26T04-22-15.399Z-steps/report.html) |
| 已关联任务后请求停止       | `task-1792988652790-0` 为 processing 时发送停止消息；仍收集到 success，随后恢复原名、输出名和阶段组，后续步骤及哨兵不再执行；没有重试或取消 | [JSON](../results/2026-10-26-windows-interruption-acceptance-1792988497915/owned-task/2026-10-26T04-23-48.406Z-steps/result.json)、[HTML](../results/2026-10-26-windows-interruption-acceptance-1792988497915/owned-task/2026-10-26T04-23-48.406Z-steps/report.html)       |

两次均为 `lifecycle: finished`、`configurationRestored: true`、引擎设置哈希未变；任务观察器、Builder 监听和浏览器连接全部释放，额外只读核对未残留工具探针或配置弹窗，未残留本次执行进程。HTML 含停止原因、恢复、任务和截图入口。报告的 `failed/stopped` 是故意中断的业务结果，开发自检按上述恢复和停止目标验收通过，不将中断改写为普通构建通过。任务用例的普通成功断言被跳过，其 success 证据来自任务收集终态，不替代成功卡片专项；不验证产物。

配置中断那次出现一条“运行检查点写出失败”警告，最终 JSON/HTML 完整，警告原样保留。当时未保存底层异常，不能反推确定根因；后续已补检查点及资源释放错误的脱敏原因链和 HTML 展示。验收脚本也修正为等待最终 HTML 写出，不把先出现的终态 JSON 当作 HTML 已完成；这些报告诊断调整只做离线检查，没有重复上述实机用例。

### 检查点替换警告修复（2026-10-26）

后续定向排查确认一个实际可达原因：Windows 下普通 Node `readFile` 读取 `result.json` 时，`rename(result.json.tmp, result.json)` 会因短暂读取占用返回 `EPERM`。离线[并发读写复现](../results/2026-10-26-checkpoint-io-1792995127111/io-evidence.json)的 1000 次替换中有 709 次失败，读者未读到损坏 JSON；[无并发读者的对照](../results/2026-10-26-checkpoint-io-1792995127111/control-evidence.json)100 次均无错误。此前发布链本已串行，问题并非工具内部同时写同一个临时文件。旧 04:22 记录没有 errno，不能将本次复现的错误码补写成那次的确定事实。

修复限定在检查点发布器：保留调用时的快照、临时文件写入及原子替换；仅 Windows `rename` 的 `EPERM` 每 10ms 等待重试，单次替换最多等待 1s。不会重新执行 UI、不截断或删除旧 JSON；其他阶段/错误码立即报错，持续占用超限仍失败。错误记录区分 `write-json/replace-json/render-html`，保留系统错误码及原因链。发布队列内归集错误，最终快照前等待既有发布及诊断完成，避免迟到错误被最终快照遗漏；最终发布失败仍向 CLI 返回错误，不能算收尾成功。

新增真实文件系统回归验证并发读取、短暂及持续 Windows 文件锁、旧 JSON 保留，以及 HTML 写入失败后的诊断收集；没有模拟文件系统成功。只对 web-desktop 做配置中断复现及修复后验收，未执行任何构建。修复后的[JSON](../results/2026-10-26-checkpoint-fixed-1792995382631/configuration/2026-10-26T06-16-24.104Z-steps/result.json)与[HTML](../results/2026-10-26-checkpoint-fixed-1792995382631/configuration/2026-10-26T06-16-24.104Z-steps/report.html)确认：持续读取检查点时，中断后恢复原配置、停止哨兵、释放观察器和连接，`warnings` 为空、无 `checkpointErrors`；任务文件与引擎设置哈希未变，未遗留本次执行进程。故意中断的业务结果仍为 `failed/stopped`，不改写为构建通过。

## 四组统一入口 web-desktop 实机验收（2026-10-24）

使用当前 1949 包、`D:\PinK-test\l10n_test_new` 和原 custom 引擎，通过 `run-build-ui.ps1 -CatalogFile` 接入已开启调试端口的实例，仅选择 `review.publish.web-desktop`。在四组目录副本中修改名称、输出名为 `qa_v2_catalog_web_final_1792837516918`，重新生成并核验计划后执行；原始目录和其他平台不改写。[修改后的 JSON](../results/2026-10-24-catalog-v2-web-desktop-1792837002174/cases.final.json)与[启动计划](../results/2026-10-24-catalog-v2-web-desktop-1792837002174/launch-plan.final.json)保留原样。

最终[报告](../results/2026-10-24-catalog-v2-web-desktop-1792837002174/2026-10-24T10-27-00.517Z-steps/report.html)和[结果](../results/2026-10-24-catalog-v2-web-desktop-1792837002174/2026-10-24T10-27-00.517Z-steps/result.json)为 passed：名称及输出名均 `changed: true`；UI 配置、自动场景、入队/终态参数及成功卡片核对通过，任务为 `task-1792837676350-3`。`finally` 自动恢复并关闭配置页；恢复检查通过，持久化名称 `l10n_test_new`、输出名 `web-desktop-001`、Debug 开启、Source Map 为 inline，与原现场一致。程序/工程身份匹配，引擎设置哈希未变。只验到构建成功，不验证产物；不外推为其他平台或全部第四组已实机通过。

首轮在记录配置时发现小写 `run` 文案未适配，未修改配置或提交。随包 `StageButtons` 使用 `displayName || name`，因此执行侧补充五种已注册阶段的小写 ID 文案，未知文案仍拒绝。随后一次尝试因辅助检查切错分类而人为中断，该次任务已成功但未完成执行器收尾，不能计通过；[原配置恢复记录](../results/2026-10-24-catalog-v2-web-desktop-1792837002174/interrupted-recovery.json)保留。中断遗留的工具观察器使下一次在提交前被拦截；确认原执行器已退出、任务终态且没有活动任务后，仅清理工具监听，再完成上述最终运行。各尝试分目录保留，未伪造中断报告，也未修改 SDK 或引擎来绕过拦截。强制中断后的自动收尾不由本次成功证明。

## 四组目录接入 v2 与专项步骤（2026-10-24，离线）

`-CatalogFile` 读取原四组 JSON，经共同转换器生成 v2 步骤，再进入现有计划核验、启动、两项调度和报告。`-StepsFile` 直接读取有序步骤；两者共用执行器。旧 `-CasesFile/-Plan four-groups` 入口兼容保留，不把旧入口的执行证据算作新入口验收。前端无需更换用例数据格式，本批没有修改前端。

发布、调试、混合的基础项及变体已接入转换。自动场景、材料引用、字段顺序、保留值、隐藏子项、平台专用操作和任务参数核对复用现有实现；当时默认恢复记录范围，现按上方 2026-10-26 规则由用例声明。可转换不代表可以直接执行：工程、材料、混合适用清单仍分别核查。Android、OHOS、HarmonyOS NEXT、Windows 发布加密改为 `{"$material":"nativeEncryption.key"}`；密钥填在私有材料清单，Zip 变体继承同一引用。

第四组已接入现有图标、签名/PEM、AGC JSON、已有游戏切换、Windows 生成器、场景、淘宝适配及可执行 FORM 反向样本。FORM 编译为普通步骤，保留准备、提示、联动、按钮状态和恢复断言，没有增加整例执行的隐藏操作。选择 FORM 时沿用 `-Cases FORM-C06.s02` 等样本 ID；它们不会在未选择时混入默认基础组合。外部四组文件需携带完整 `formValidation`，不混用本机另一个版本的样本。

| 新增操作 / 断言                                     | 输入与依赖                                                                                                  | 结果与失败处理                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `config.require`                                    | 当前 `page`；`expected` 可检查按钮、可见/非空、无原错误、空值或合法原值、与目标不同、特定父项下子值必须为空 | 只读前提；不满足记受阻，不隐式改初态。`differs/emptyWhen.value` 支持材料/场景引用 |
| `input.clear-field`                                 | 当前页、已记录字符串 `field`                                                                                | 专用清空操作，含敏感字段；文件内不放秘密空值断言，配合 `assert/empty`             |
| `input.cancel-file`                                 | 当前页、已记录的注册文件控件                                                                                | 复用所属窗口的取消适配及页面重新绑定；核对路径未变                                |
| `input.clear-scenes`                                | 已记录 `startScene/scenes`，唯一受保护初始场景                                                              | 全不选后只保留禁用且选中的受保护场景；前提不能唯一确认则受阻                      |
| `assert/unchanged`                                  | `page/snapshot/fields`，同例同会话同平台的历史观察                                                          | 跨修改或重开比较原值，适合文件取消/联动保留；不替代提交前必须新鲜的构建快照       |
| `assert/empty`、`protected-choice`、`build-enabled` | 当前页及对应字段或按钮预期                                                                                  | 核对空值、选中禁用项和按钮状态，不提交异常构建                                    |
| `restore` 的 `reopen`                               | 清理页、本例 `record`                                                                                       | 显式要求恢复后重开核对；默认不重开，恢复失败停止后续用例                          |

完整操作能力由 `-FieldCapabilities` 的 `steps` 返回：操作名、输入、依赖、输出、允许的清理操作、断言和扩展边界。校验器使用同一操作/断言名表，拒绝未注册行为；字段、类型和平台归属仍由执行侧注册，不能用 JSON 填选择器或脚本绕过适配。

预览保留所有所选条目的 `ready/blocked/not-applicable` 及原因；只有具备完整操作与断言的条目进入可执行步骤。运行报告再按原选择顺序合并结果，未执行不算通过，全部受阻或不适用时在连接前输出报告。目录、内置 FORM 来源、材料和工程输入均绑定计划；运行前、普通打开配置页前、提交前复核，变化要求重新预览。

仍保留：L10N 跨页、Bundle/引擎专项及原目录未定义完整执行合同的边界；坏 JSON、错误签名等未提供样本的分支；缺账号/服务/候选等材料。FORM 中尚用明文 appid 准备或非法 appid 样本的四项继续标为输入合同受阻，不降级绕过敏感字段规则。新标准平台 `targets` 仍只开放配置操作，新控件/新行为和新平台构建还需注册适配。Windows 禁用按钮提示未显示的产品问题继续保留。

本批只做 TypeScript、计划/CLI 和操作编排的定向离线验证。真实加载器、转换器、配置操作和恢复器参与；UI 控件、任务通知及程序身份由夹具提供。验证目录修改使计划失效、受阻报告不连接程序、场景保护、父子显隐、文件取消重新绑定、签名清空脱敏，以及受阻/失败后继续和恢复失败停止。没有启动/连接 PinK、提交构建或修改引擎；不作为 18 平台实机迁移完成的结论。以下日期章节保留各批次的历史边界，以本节说明当前接入范围。

## v2 阶段串联操作（2026-10-24）

沿用 `pink-configuration-steps` / `schemaVersion: 2`、已有启动入口和报告，不新增执行文件格式或平台专用流程。样本为 [stage-controls-v2.json](../tools/build-ui/fixtures/configuration-steps/stage-controls-v2.json)，与普通配置、关闭重开等步骤使用同一页面上下文。

| 操作                     | 输入及输出                                                        | 依赖和失败处理                                                                                            |
| ------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `stage.record`           | `page`；输出原分组与可见阶段，原值留在会话内                      | 每例一份；必须在任何串联修改前记录，同会话同平台重开后可恢复                                              |
| `stage.read`             | `page`；输出有序分组、可见阶段、按钮及连接控件状态                | 只读当前配置页，不读取历史卡片替代；记录页面及 revision                                                   |
| `stage.link`             | `page/record/previous/stage`；输出转换后的状态                    | 两个相邻组按 ID 唯一定位，将后一组整体连接到前组；初态不符受阻，不同值回读冒充连接                        |
| `stage.unlink`           | `page/record/group/stage`；输出拆分后状态                         | 目标必须是该组内非首阶段；拆分保留尾部分组，不点击父执行按钮                                              |
| `stage.hint`             | `page/control/stage/contains`；输出实际提示                       | control 为 button/link/unlink；真实悬停并关联唯一打开的提示，未出现为断言失败，不把源码字符串当作 UI 证据 |
| `assert` / `stages`      | `snapshot`、`expected.groups`；可加 visible/disabled/linkDisabled | 只消费同页未过期的阶段快照，按顺序精确比较，不对阶段数组排序                                              |
| `assert` / `build-scope` | `page`、`expected.allowed`；输出是否允许仅构建                    | 复用真实提交范围判断；本操作本身不提交，允许和阻断样本可只测 UI                                           |
| `stage.restore`          | finally 中的 `page/record`，可加 `reopen: true`                   | 通过 UI 恢复原关系，要求重开则复核保存；先恢复阶段，再执行字段恢复断言；失败硬停止并保留原错误和恢复错误  |

阶段修改与字段修改共用 revision，但不标记非目标字段已被修改：只做串联时，字段 `restore` 核对原值而不重写输入，防止掩盖阶段操作的非预期副作用。`finally` 必须声明阶段恢复；不能在 finally 中提交、连接或拆分任意目标。

拆分图标嵌在原生阶段按钮内，父按钮禁用时不能直接点击。恢复尾部串联时，可以经已启用的连接入口先接入构建组，再拆分和重建原关系；没有安全路径则停止，不能执行阶段来解除禁用。阶段点击先等待真实悬停布局，再从同一控件内部选择没有被提示层覆盖的命中点，只发送一次点击，不在投递不明后重试。

打开页面或旧字段回读不会自动解除用户串联。真实提交生成快照时、最终点击前都要求 build 组无显式后续阶段，并将最终阶段分组纳入同一提交快照；关系变化使原快照失效。主按钮按配置页内的阶段结构识别，不能依赖复合按钮的整段文案等于“构建”。SDK 自身内部阶段不在本次修改范围。

阶段专项沿用完整任务基线和观察器；每次操作前后检查任务范围。意外出现新任务、身份失效或恢复失败时停止，不自动重试、取消或删除。`stage.restore` 内部每次转换也检查任务范围。分组继续使用每组最多两例，普通平台组合不重复公共 UI 专项。

样本明确要求当前微信原串联为 `build → run`，Windows/OPPO/OpenPaaS 为独立按钮；初态不符应修改 JSON 中的准备步骤或记录受阻，不能在记录前偷偷修改偏好。样本中的 Windows 禁用按钮提示是独立产品检查，失败不妨碍已完成的连接/拆分验收，也不自动降低为通过。实际结果以运行报告为准。

## v2 跨平台两项调度（2026-10-24，第三批离线验证）

同一份 v2 JSON 的 `cases` 现在可以包含不同平台。按文件顺序固定分组，每组最多两例、一例至多一个任务；同平台再次出现则提前分组，先等上一例恢复，避免共享偏好和原值记录互相覆盖。不因某例受阻或任务提前完成而补进第三例。v1 和原四组入口不改变。

执行顺序：第一例打开/配置/最终回读/唯一关联提交 → 第二例同样配置提交 → 本组依次执行 `build.wait`、终态断言及 `finally` → 下一组。执行器在 `build.wait` 暂挂用例，再按 JSON 继续，不省略等待之后声明的步骤。配置输入始终逐个执行。两类 Builder 保留各自观察连接，运行前核对同一份完整无活动任务基线；分类切换不重建观察器、不重新取基线。配置及卡片操作按平台路由到所属分类。

| 情况                                              | 后续行为                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 缺材料 / 前提受阻，尚未打开配置页                 | 记受阻，默认继续；`onFailure: stop` 停止新提交                                       |
| UI、入队或终态参数不符；任务明确失败              | 保留原失败，收集已关联任务，安全恢复；默认继续，`onFailure: stop` 停止新提交         |
| 同组已有另一任务提交后才发现失败                  | 另一已关联任务仍须收集和安全收尾；停止不能撤销此前的提交                             |
| 无匹配 / 多匹配 / 点击响应不明                    | 不重试点击、不再提交；仍尽量只读收集已知任务，未知任务不能算已关联；不写回不安全配置 |
| 身份失效、观察中断、任务丢失/重排、超时、恢复失败 | 停止后续提交；已知任务在身份和观察仍允许时继续收集，不进行不安全恢复                 |

等待及配置第二例期间都检查已归属任务和外部任务干扰。沿用现有超时口径：从任务创建/提交到首次 processing 的启动等待（含排队）30 分钟；首次 processing 后构建观察10分钟；提交唯一关联30秒。任务观察超时不重复等待同一任务，也不取消任务。

预览和执行共用 `buildStepScheduling/buildStepGroups`；分组、两项上限、同平台分组与屏障策略进入计划哈希，旧预览需重新生成。结果沿用 schema2，增加 `execution/groups`，记录成员 caseId/平台、任务 ID、提交关闭/组结束时刻及队列观察状态；原每步错误、底层原因、恢复和报告入口保留。只有第二项在其他本轮任务未终态时观察到 waiting，并随后观察到 processing 和终态，才记录队列 `observed`；两个构建成功本身不证明排队覆盖。

本批先完成工具编译、类型/格式和离线夹具验证，复用实际加载、配置操作、提交关联、等待、参数比较、恢复与任务观察器，覆盖跨分类路由/基线、两项屏障、同平台隔离、失败继续/停止、提交不明及安全收尾。随后已取得[微信与 Web 手机跨分类实机报告](../results/2026-10-24-v2-cross-platform-1792824582684/2026-10-24T07-11-45.981Z-steps/report.html)：两例任务、参数、成功卡片和恢复通过。第四组复杂专项和材料缺口仍保留，不因代表调度验收通过而视为全部平台或全部组合通过。

## v2 保留值、联动和平台专属操作（2026-10-24，第二批离线验证）

本批在步骤 v2 上补齐下列操作，复用既有配置适配器、AGC 解析、OpenPaaS 已有游戏选择、Google 图标输入及任务比较。没有增加通用脚本操作，也不修改前端或原四组数据。以下是当前合同；后面的第一批章节保留阶段记录。

| 操作 / 断言               | 输入和依赖                                          | 检查及失败处理                                                                                                            |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `retain`                  | 当前 `page`、`fields`，字段还未被本例直接修改       | 观察初值；不存在的控件记录 `not-observed-at-start`，不算覆盖；敏感初值只留在内存                                          |
| `assert / retained`       | 当前 `page`、前面 `retain` 的 `retained` ID         | 当前可见值须未改变；构建用例中已隐藏的值继续交给任务检查，UI 终点不能用“待任务核对”通过                                   |
| `read / scope: build`     | `retained` 可引用初值；`hidden` 可引用隐藏断言 ID   | 把保留值和隐藏前的值并入同一提交快照，入队及终态都核对；`includeInAll` 仅核对 UI，不冒充任务字段                          |
| `config.ready`            | 当前 `page`                                         | 复用配置页稳定检查；等待后的旧快照不能继续使用                                                                            |
| `config.prepare`          | 当前 `page`、`field/value`；须记录可能受影响的字段  | 注册了加密编辑前的 Debug 解锁、转入 Asmjs 前关闭压缩、离开分包模式的过渡。它只准备依赖，目标仍由后续 `set` 写入           |
| `config.expand`           | 当前 `page`、`section: network-timeout`             | 只适用于 OpenPaaS，复用现有网络超时分组展开                                                                               |
| `assert / hidden`         | 当前 `page`、`field`、先前回读的 `observed` ID      | 核对已注册父项状态及子项隐藏；子项再次写入或换页会使旧观察不可用。仅 Asmjs 的压缩可不传观察，明确推导为 false             |
| `input.google-icon`       | Google Play 页面、`file` 值或材料引用；记录图标模式 | 先显露并记录原文件，再复用图标输入；回读 custom 模式及文件显示，提交前核对文件摘要。任务比较 custom，不把文件路径当成模式 |
| `input.openpaas-game`     | OpenPaaS 页面、`value` 材料引用；记录 appid         | 仅选择当前账号已有数字 ID，核对代码版本联动；可用 `requireChange: true` 要求真实切换，不创建游戏。恢复也复用已有游戏选择  |
| `assert / agc-material`   | AGC 页面当前文件路径和包名                          | 复用 JSON 解析，包名必须等于 `client.package_name`；不能自动改目标包名。提交前再次核对路径、包名和文件摘要                |
| `assert / openpaas-ready` | OpenPaaS 页面                                       | 核对版本名必填、已有游戏及代码版本；由产品管理构建按钮后的内部阶段，不另点生成/上传                                       |

`retain` 和 `record` 职责不同：前者提供断言基线，后者提供恢复。直接写入保留字段会在加载时拒绝。子项隐藏前的值必须有真实观察；初态未出现的字段不推定默认值。数值文本、Source Map 和 L10N 映射的表示差异复用字段合同，L10N 跨页启用仍未接入。

恢复会先处理新显露、切回原预设后将无法操作的原生子项，再恢复预设和模块依赖以及其余原生、签名、加密和图标字段；涉及加密时最后恢复原 Debug。普通断言失败仍先收集已归属任务并恢复，按用例策略继续或停止；提交不确定、身份失效和恢复失败继续使用既有强制停止规则。AGC/图标等已核对材料变化会阻止提交，页面身份仍可信时恢复原配置，不重试点击。

已有游戏切换同时检查目标和原游戏是否能由现有安全选择方式定位。初态未选择游戏、原 ID 有歧义或无法恢复时，输入前即受阻；目标等于当前值时只核对，不计作修改，`requireChange` 会阻止这种初态。

四组转换器已将普通组合展开为这些步骤，Google 图标、现成签名文件、AGC 服务和已有游戏切换也可使用相应操作。发现一个源数据口径冲突：微信、抖音和淘宝的部分调试组合选择 Asmjs，却标记保留 `wasmCompressionMode`。转换结果保留该来源说明，另列 `derivedFromParent`，执行隐藏及任务 false 核对并恢复原值；不计作“保留值未变”，也不计作压缩开启覆盖。

第二批已开放登记的18平台及专属检查。AGC 和 OpenPaaS 缺少上述专属检查的构建步骤在加载时拒绝；最终任务快照强制包含服务文件/包名或游戏 ID/版本名。新标准平台仍只支持配置步骤。当时仅单平台串行；跨平台两项调度现已接入，规则见本文第三批章节。

仍单列的缺口：第四组其余复杂临时初态、FORM 反向样本和跨页专项尚未迁移；缺材料/混合组适用性不能被转换清除；Android、OHOS、HarmonyOS NEXT、Windows 部分发布用例中的内嵌 `xxteaKey` 仍需按 v2 既有规则改为材料引用，属于输入合同问题，不是缺少 UI 操作。

本批仅执行工具类型检查及定向离线检查：真实加载器、转换器、操作、恢复、任务关联和参数检查参与执行，界面控件与任务通知由夹具提供。验证了保留值 UI/入队/终态差异、联动和隐藏恢复、已有游戏与图标恢复，以及 AGC 包名/文件变化拦截。未启动或连接 PinK、未提交真实构建、未改引擎或前端；这些结果不代表新版 UI 或全平台实机通过。

## v2 输入与四组迁移第一批（2026-10-24，仅离线验证）

步骤 v2 现可在 `set.value` 和 `assert.values` 使用现有 `$scene` / `$material` 引用；v1 仍只接受原来的字面值。场景和材料解析复用四组工具，前端和原四组数据未改。此批不是 18 平台已迁移完成，也不是新版 PinK 的实机验收。

| 输入                                      | 解析和约束                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `{"$scene":"primary"}`                    | 从指定工程的真实 `.scene/.meta` 发现候选；打开目标配置页后，优先使用当前有效初始场景，否则取稳定排序的第一个真实场景 |
| `{"$scene":"secondary"}`                  | 使用与 primary 不同的真实场景；不足两个时受阻，不制造场景或换工程                                                    |
| `scenes: [{"$scene":"primary"}]`          | 用例使用 UUID 身份，执行时转换为 UI 的资源路径，任务快照仍使用 UUID                                                  |
| `{"$material":"androidSigning.path"}`     | 读取现有材料清单 `bindings.androidSigning.path`，相对路径相对清单目录解析；文件必须可访问                            |
| `{"$material":"androidSigning.password"}` | 密码只在内存解析和比较，不写入步骤文件、预览或结果；敏感字段不允许再用 `input` 明文覆盖                              |

材料清单继续用已有 schema1。`-StepsFile` 增加可选 `-Materials <清单.json>`；Node 文件预览也可传 `--project` 和 `--materials`，不用提供 PinK 路径或连接程序。材料清单摘要、引用文件内容摘要、工程路径、工程包摘要和场景候选身份都进入计划。启动前、普通打开配置页前及提交前复核输入；变化要求重新预览。缺材料在打开该例配置页前记为受阻，其他适用用例仍按既有规则继续。

场景修改必须同时记录 `startScene` 和 `scenes`。两个场景角色在每个用例第一次场景操作时确定，后续断言使用同一绑定；不会因刚修改了初始场景就重选 primary。恢复先恢复初始场景，再恢复场景集合。敏感回读脱敏，任务比较使用既有指纹合同。材料解析不代表签名、AGC 或 OpenPaaS 专用操作已接入 v2 启动入口。

```powershell
# 从 PinK-Test 根目录：只读取步骤、工程场景和材料，不连接 PinK
node tools/build-ui/dist/configuration-steps-cli.js --file '<v2步骤.json>' --project '<工程>' --materials '<材料清单.json>' --output '<新计划.json>'

# 四组迁移预览：沿用唯一用例源及旧选择规则；可加 --groups / --cases
node tools/build-ui/dist/configuration-steps-cli.js --catalog tools/case-catalog/public-combinations.json --project '<工程>' --materials '<材料清单.json>' --output '<新迁移计划.json>'
```

迁移计划保留 `caseId`、平台、业务组、终点、来源、保留回读字段、材料/适用性受阻项。具备完整操作与断言的简单用例生成可交给步骤加载器的 `document`；缺能力的条目只列输入与缺口，不生成省略检查后的可执行文件。`ready` 仅表示离线合同满足，不能作为 UI 或构建通过证据。当前正式四组含保留值、联动及专项合同，仍有迁移阻塞；原四组入口继续可用。

后续仍需接入：保留字段观察与任务核对、动态表单就绪及隐藏子项断言、AGC/OpenPaaS/Google 图标等专用操作、第四组临时初态和反向断言、跨分类会话及两项调度。v2 继续一例一任务、串行收尾；原四组每批最多两项不变。迁移后的步骤默认恢复记录范围；原普通四组保留配置的历史行为不会被自动视为相同。

此批离线验证使用真实加载器、材料/场景解析、配置操作与恢复器，外部 UI/任务由夹具提供。覆盖 JSON 改动、材料输入/脱敏、缺材料后继续、材料/场景变化拦截及转换缺口保留；未启动/连接 PinK、提交构建、改引擎或前端。只读确认现场已换为 `PinK-win32-x64-2610231949-0.0.2.0`，后续实机需以该包重新预览，旧 1958 包证据不能替代新版验收。

## 步骤文件 v2：页面与构建生命周期（2026-10-23 第一批记录）

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

前端按结果 `kind/schemaVersion` 读取原生事实：旧结果包含 `task/checks`，步骤 v2 使用 `cases[].tasks/steps/restoration`，不能只根据日志、进程退出码或“已提交任务”推断通过。2026-10-26 新增的 `PINK_BUILD_PROGRESS` 通知与 `result.json.progress` 是前端运行进度合同；其余 stdout/stderr 仍为日志，旧结果不补造实时事件。v2 检查点已采用串行临时文件原子替换，Windows 短暂读占用按限时规则处理；消费者保留上一份有效状态并等待最终 JSON/HTML，不因临时读取不可用生成产品失败。新入口的停止及安全收尾已有定向证据，仍不能将强杀实际执行进程视为正常停止；旧入口不继承这批保护。

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

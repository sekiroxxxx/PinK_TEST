# PinK 构建公共组合与 18 平台用例（定稿）

本稿替换此前“52 项＝18 调试＋18 发布＋原 8 平台变化/返回”的设计口径。前三组按**公共配置模板**划分；第四组为**条件与扩展场景集合**，不要求把所有特殊选项同时打开。WebGPU、方向、签名、加密等放进各平台对应组合，候选值较多时作为该组合的局部变体。原 8 平台不再是设计边界。

四组设计已同步新增工具入口 `-Plan four-groups`；2026-10-20 已完成 web-desktop 代表验证及其余 17 平台三组基础用例的本机试运行，通过、失败、受阻及证据统一见[工具说明](../tools/build-ui/README.md#四组定稿入口)。下表与页面标记仍为用例设计，不是出厂默认值或所有组合已通过的结果；旧记录不替新目标记通过。旧 `-Plan acceptance` 保留旧集合；本稿使用 `four-groups`。

## 2026-10-21 输入规则（已接入离线加载）

本节优先于下方旧的场景与签名口径。规则已同步到 schemaVersion 1 的公共用例和共享加载器，材料与场景使用结构化引用；仅完成离线计划验证，未启动 PinK 或提交构建。旧结果不替新输入记通过。加载、材料、启动配置与计划的实际合同见 [QA 输入合同](pink-build-case-input-contract.md)。

| 项目                                  | 修订输入与分组                                                                                                                                                                           | 前提与预期                                                                                                                                                                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 普通构建场景                          | 发布、调试、混合均从当前工程实际场景列表自动选一个有效场景；优先选择当前有效初始场景，否则按资源路径稳定排序取第一个。初始场景与包含场景使用同一真实 UUID，不绑定 `scene-2d` 或旧 UUID。 | 从当前工程 UI 候选与资产身份核对，排除失效/工程外场景；启动时解析一次，跨组合复用并记录路径与 UUID。无有效场景则受阻，不创建场景或假填 UUID。只保证选取与参数一致，不保证任意业务场景运行效果。                                                                        |
| 场景选项专项                          | 第四组代表平台从实际候选自动选两个不同场景，检查切换初始场景、包含/排除及任务参数。                                                                                                      | 少于两个场景只阻塞多场景分支，不阻塞普通构建。记录选择依据与初态，UI 检查后按约定恢复；不通过同值回读冒充切换。                                                                                                                                                        |
| Android / 华为 AGC / Google Play 签名 | 发布、混合组使用提供的自定义密钥库，`useDebugKeystore=false`；通过 UI 文件选择和三个凭据字段输入，调试组使用调试密钥库以覆盖另一分支。签名分支合入原组合，不额外重复一轮完整构建。       | 已收到 `android.keystore`（2199 字节），尚未验证格式、别名和口令匹配。文件路径与凭据作为测试机私有材料绑定；别名候选为 `android.keystore`，密码不写进用例页、公共样例或报告。AGC 仍独立需要匹配包名的服务 JSON。检查最终 UI 与任务参数时敏感值只留匹配结果，不留明文。 |
| 签名创建与异常                        | 第四组保留现有缺项、错误口令与返回调试签名的 UI 分支；PinK 当前没有创建密钥库功能，不纳入本期。                                                                                          | 已有库可复用，不要求每轮新建。仅绑定已有文件，不创建或覆盖密钥库。构建成功不等于验证签名包可安装，也不将 UI 口令输入当成密码真实性验证。                                                                                                                               |
| 淘宝正常构建                          | 前三组正常链路均关闭初始场景分包，使用 QA 给出的全局变量 `localStorage,CANNON,LZString,protobuf`；需要先确认当前 `globalAdapter` 联动与该输入的有效表示，不把隐藏字段强写成已覆盖。      | QA 图片说明这些是可运行工程的必填基准，本轮终点仍为构建成功，不据此声称产物可运行。原来 `PinkQATestGlobal`、空全局变量、开启初始场景分包的组合不能继续作为正常可用基准。                                                                                               |
| 淘宝边界分支                          | 原空值、全局适配显隐与初始场景分包的开关覆盖转到第四组条件/联动专项，不混入正常构建预期。                                                                                                | 先按当前 PinK 表单及 SDK 合同核清；未确认可运行性时只验证相应 UI/参数行为，不冒充正常构建或运行验收。                                                                                                                                                                  |

Windows 完成这批输入同步及必要的定向验证后，再用同一用例定义复刻 macOS：只绑定平台安装包、SDK、材料路径及该主机实际候选，保留同样的最多两项分组、唯一任务关联和 HTML 报告。macOS 的启动、文件选择和原生构建环境需要真实验证，Windows 证据不代替 macOS 通过；本轮未改 macOS 适配或启动任何构建。

## 第四组：产品表单反向校验（2026-10-22）

本节补产品表单校验，与参数差异、任务关联等开发自检分开。仍为原 29 条检查点，现将不同字段、错误输入和平台差异拆成独立样本；样本不是新增平台、完整组合轮次或构建任务。唯一设计源继续用 [form-validation-design.json](../tools/case-catalog/form-validation-design.json)，展示页读取同一份数据。每个样本有输入、前提、触发动作、预期提示、修正、按钮、任务行为、恢复和证据状态。FORM-M02 的三个平台仅为适用范围说明（applicability-only），不计新增反向输入或执行覆盖。

**已接入第四组显式样本加载与 UI 恢复分支；2026-10-22 公共反向样本30项通过、2项L10N保留；平台专属反向UI已分批通过8项及本批18项，精确范围和历史尝试见下文。** 原 29 条检查点、158 条样本身份不变。样本中的 `execution`（公共操作）或 `executionByPlatform`（同一输入的平台字段映射）定义字段、输入、有序前提、提示与触发；展示导出和执行器读取同一份内容，不解释中文步骤。普通三组构建和既有默认选择不自动加入这些样本。

公共样本批次未提交构建、未改引擎设置；其后的平台专属验收见下段。初轮路径协议根提示失败后已成功恢复并继续下一项；按当前 UI 本地判空规则修正该项预期后，单项补验通过，其他通过项复用未受影响的记录。随后只补验 8 项非 L10N：路径协议切换、远程 URL 临时初态、场景全选/取消保护、Zip 和分包远程联动、MD5 父子保留、CCONB 关闭后阈值编辑，均通过。`prepare` 明确临时输入，开始前记录原值，结束恢复并核对；没有声明准备的同值回读仍不算变化覆盖。初轮场景识别和 CCONB 预期有误，修正后仅补这两项，原记录保留。该公共样本批次未触发恢复失败，当时仅有离线覆盖；后续18项的实际停止记录见下文。[最新汇总与原始证据](../results/2026-10-22-public-eight-recheck-1792656676890/acceptance-summary-report.html)保留所有尝试；L10N 两项继续单列。

2026-10-22 随后仅验收 8 项平台专属反向样本：Windows 可执行名非法/空值 2 项，微信和抖音 AppID 空值/非空错误文本各 2 项，淘宝全局变量空值/隐藏返回 2 项，全部通过。每组最多 2 项，未提交构建、未修改引擎，之前通过的公共样本未重跑。[本批原始报告](../results/2026-10-22-platform-eight-1792659733452/execution/2026-10-22T09-05-46-391Z/report.html)与[恢复核对](../results/2026-10-22-platform-eight-1792659733452/after.json)分别保留执行与文件证据。各例恢复原字段、提示及显隐；任务文件和全局/工程引擎文件未变，已有平台配置未变。产品首次修改时新增了四个平台的默认偏好条目，偏好文件整体字节不相同；默认条目保留，恢复结果按原字段、提示和显隐判定。该8项批次未覆盖其他平台专属样本、恢复失败停止和L10N；后续18项范围见下文。

2026-10-22 又完成 Android、Google Play、AGC 的 15 项签名反向 UI，以及 AGC 文件取消、路径清空、包名不一致 3 项，共 **18 项通过**。[分项汇总](../results/2026-10-22-native-form-1792660577977/acceptance-summary-report.html)保留首次失败及仅针对未通过/未执行项的补验；没有重跑之前通过项。临时初态使用现成密钥库、私有凭据和 JSON，结束恢复原字段及原提示；[文件与恢复核对](../results/2026-10-22-native-form-1792660577977/after.json)确认任务、引擎、材料和已有平台配置未变，产品新增三个平台的默认偏好条目。Google Play 路径缺项虽然计算错误，但当前视图未渲染，按已批准的当前实现基线检查无提示，同时保留产品校验缺口；不把此项通过解释为必填防护正确。签名口令真实性、异常构建、坏 JSON/空对象和 L10N 未验证。

本批实际触发过取消文件选择后的恢复失败，工具停止了后续两项；原失败报告保留在汇总引用中。修正了 Windows 对话框子层级查找和取消按钮类型/唯一性，取消后确认关闭及控件就绪，再重开配置页恢复；表单输入与原生下拉在发送按键前核对工作台 iframe 和内层控件焦点。恢复过程中的编辑器误输入已通过 UI 撤销，并与磁盘内容核对一致，未保存编辑器文件。恢复现场后只补验未通过项。因此“恢复失败停止后项”已有这一实际故障的实机证据，不能外推为所有断连/超时故障均通过。

2026-10-22 随后仅验收 OPPO、vivo、荣耀、华为快游戏的 `FORM-Q01`，**36 项全部通过，每平台 9 项**：包名、版本名、版本号、运行时版本清空各 1 项，版本号 `0`、`-1`、`1.5`、`abc` 各 1 项，版本名 `qa-version` 1 项。仅为被测字段声明临时合法非空初态，复用现有 UI 适配，每组最多 2 项。空值显示通用必填提示，vivo 包名显示自定义非空提示；非空特殊版本文本不提示错误，主构建按钮始终可用。这是已批准的当前实现基线，不证明平台版本合法性或提交后的防护。没有提交构建、修改 SDK 或引擎，之前通过项未重跑，PEM 缺材料与 L10N 保留。[本批报告](../results/2026-10-22-quick-form-1792663578813/execution/2026-10-22T10-07-01-480Z/report.html)；[配置恢复与文件核对](../results/2026-10-22-quick-form-1792663578813/after.json)。末次核对任务及引擎文件未变，所有原有配置值已恢复。vivo 打开时自动避让的输出名已通过 UI 恢复；产品新增 OPPO、华为快游戏默认偏好，以及 vivo/荣耀原来缺省的语言键和荣耀空 AppID，故偏好文件整体不字节相同。没有执行 L10N 分支。

选择 `FORM-C01` 展开该检查点，或选择完整 ID `FORM-C01.s01.web-desktop`；第四组 `conditional` 下执行，终点固定为 UI 检查与恢复，不点击构建。UI 提示与主按钮状态分别核对；提示缺失记失败，恢复成功后可继续下一项；恢复失败沿用停止规则。没有明确准备时，初态同值仍受阻；用例明确为缺失空字段声明非空临时初态时可准备并恢复原提示。非空且已有错误的字段仍受保护，其他签名字段不齐则受阻。

本批支持字段输入、父项隐藏、受保护场景选择观察、取消文件选择及场景全不选五类固定操作。Android/Google/AGC 签名与比例提示分别定义，vivo PEM、Google Instant、Windows 可执行名、OpenPaaS 文本及淘宝显隐按各自字段适配。需要材料的错误口令/坏 JSON，以及 L10N 跨页切换、API 候选、对象组选项、游戏候选边界、CSS 交互防护和 SDK 内部结果等尚未适配的样本，通过 `executionBlocker` 和受阻分类保留，不算执行通过。OpenPaaS 缺 ID 样本始终禁止提交。

完整 QA 导出包含 `formValidation`；外部文件缺该部分时不借用本机样本。样本全文哈希进入离线计划；预览后改变输入、提示或操作需重新预览。证据记录样本身份、断言环节、是否通过与恢复状态，不保存口令或原始私密值。源码结论仍不代表实际入队、修正或构建阶段已验证。下方旧文若与本节冲突以本节为准；历史实测结果按原版本和输入保存。

### 每项预期的依据

| 类别                      | 本稿使用方式                                                           | 证据边界                                                               |
| ------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 产品需求 / 用户与 QA 要求 | 淘宝正常基准、只用已有游戏/密钥、不改引擎等已明确约束                  | 不把 QA 运行基准误写为产品已实现的 UI 必填校验                         |
| 接口 / 测试合同           | 区分 UI、宿主任务和 SDK；记录完整平台/工程身份、原值与恢复，不重复提交 | 关联不明必须停止；工具报错不是产品拒绝提交                             |
| 已批准的当前行为基线      | 每个样本的提示、转换、按钮和源码任务规则                               | 用于回归一致性，不是独立产品正确性要求；宽松或可疑行为不包装成合理设计 |

源码确认、历史局部实测、新样本未执行分别标记。缺应有提示或恢复失败可记用例失败；遇到已列疑似缺陷不得靠接受实际结果自动生成“正确预期”。产品要求调整另列，当前不修改产品。

### 四种行为必须分开

| 行为             | 当前结论                                                                                         | 样本验收终点                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| 即时提示         | 通用 required 随值计算“此项为必填项”，不 trim；各自定义区另有局部错误                            | 检查准确字段、提示原文、触发和恢复；红字不等于拒绝提交                  |
| 禁止某项 UI 操作 | 初始场景不可取消、空游戏占位不可选、调试状态加密受限、隐藏/禁用子项等                            | 检查实际控件/焦点/可操作性，不注入 DOM 制造非法状态；不能外推主按钮禁用 |
| 入队后修正       | 平台初始化/RPC 正常时，宿主先记录任务/入队，执行时再校验；公共字段 fixedValue 可写回             | 任务允许存在；先观察原始及修正后的参数，不要求无任务，不承诺最终成功    |
| 入队后失败       | 无 fixedValue 的非 warn 校验错误会将已入队任务标失败并停止 SDK 构建；部分错误更晚由 SDK 钩子抛出 | 与拒绝入队不同；将来获准提交才核 taskId/阶段/终态，本稿无此实机证据     |

1958 主构建按钮只按提交中状态统一禁用，不汇总全部字段错误。SDK 错误在加载时获取，编辑清除旧 SDK 错误，不保证逐次失焦重查；需要加载错误展示的专项才保存重开，普通组合不重复此操作。平台配置初始化或请求本身失败可在入队前中止，但这不是按表单值统一拒绝提交。

### 已从源码核清的规则与原 29 条分配

| 原条目        | 代表 / 平台                         | 已确认规则及样本边界                                                                                                                                                              |
| ------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FORM-C01      | Web 桌面                            | name 空值即时必填，纯空格不触发空值校验；公共默认修正不代表空白名称合理                                                                                                           |
| FORM-C02      | Web 桌面                            | 路径空/协议根/越界/非绝对路径分别检查；协议根由 UI 本地判空并显示必填；SDK 建议修正与任务执行另列，不能当即时自动应用                                                             |
| FORM-C03      | Web 桌面                            | 输出名空有 SDK 修正；实际特殊校验优先，不因 normalName 声明就断言 qa/bad 必被拒绝；输出名不在普通错误映射中                                                                       |
| FORM-C04      | Web 桌面                            | server 空值跳过非必填校验；非空仅检测 http 前缀，http-not-a-valid-url 也可通过该条；不验证可访问性                                                                                |
| FORM-C05      | Web 桌面                            | 分辨率/阈值按字段逐个输入 0、-1、1.5、空文本；空文本转 0，无额外 min/max/整数限制                                                                                                 |
| FORM-C06～C08 | Web 桌面                            | 初始场景与 Bundle 自动包含场景不可取消；Zip 强制远程并禁用远程开关，分包远程组合显示 SDK 错误；MD5 关闭隐藏并保留子项，CCONB 关闭时阈值仍可编辑。不可达不注入，不把显示保留当修复 |
| FORM-C09      | Web 桌面                            | L10N 未启用控件缺席正确；启用全取消不禁用默认/回退且不等于关闭 L10N。内部语言回落与最终产物另验                                                                                   |
| FORM-N01～N03 | Android / Google / AGC 分别         | 签名每字段缺项与每个比例样本独立；Android/Google 局部提示与 AGC 无相同提示分开；错误口令仅遮蔽输入/恢复，不能计认证覆盖                                                           |
| FORM-N04/N05  | Android / Google 分别               | ABI 空、真实低 API 各有局部提示；SDK required 不等于 API 门槛拦截。Google 即时校验包名；Android SDK 正则不等于局部即时提示                                                        |
| FORM-N06      | Android                             | 非调试开启加密后空 key 有局部错误；真正启用加密的 SDK encryptScripts 另会抛错，仍非拒绝入队                                                                                       |
| FORM-G01/G02  | Google                              | 后端/方向空集合提示；Instant 非空 remoteUrl 不以 http 开头时报错，空值不触发此条。不可编辑 GLES3 不后台改                                                                         |
| FORM-A01/A02  | AGC                                 | 文件取消保留；坏 JSON 在入队后 readJSON 解析失败；{} 在文件读取阶段不因缺包名拒绝。有 JSON 包名时 SDK 钩子覆盖任务包名，不是 UI 即时变化                                          |
| FORM-Q01/Q02  | OPPO / vivo / 荣耀 / 华为快游戏分别 | 各字段空值、版本边界各独立。required 通用控件随值提示；非空版本没有统一语义规则。vivo 包名/PEM 有明确局部错误，其余 PEM schema 没有相同 required                                  |
| FORM-O01～O03 | OpenPaaS                            | 版本空为通用 required；游戏为原生 select，不是独立搜索框，有候选时空占位禁用/隐藏；超时各字段各样本按字符串保存                                                                   |
| FORM-W01      | Windows                             | bad/name 由 SDK 格式规则处理；空 executableName 合法；不套包名必填                                                                                                                |
| FORM-H01      | Windows / OHOS / NEXT 分别          | 三个平台局部空加密密钥提示已确认；交互限制按调试状态，NEXT ARK 在 SDK 钩子关闭内部加密。NEXT ABI 显示归一化为 arm64-v8a，不保证原配置 [] 已修复；其他对象不套 Google 最少一项     |
| FORM-M01      | 微信 / 抖音分别                     | 通用 AppID 空为 required，非空非法文本不做账号真实性认证；SDK 默认修正受下述平台层级风险影响                                                                                      |
| FORM-T01      | 淘宝                                | 空全局变量当前无相同必填错误；运行要求不等于 UI 已校验。隐藏返回及恢复 QA 四变量/分包关闭分别检查                                                                                 |
| FORM-M02      | Web 手机 / Facebook / 支付宝        | 只检查已有真实控件/协议条件的适用边界，无独有必填规则不强造 AppID/签名或错误构建                                                                                                  |

### 技术风险、产品决定与材料分开

1. **平台 fixedValue 层级风险**：SDK 返回平台键（如 packageName）的修正值，但宿主 `jo` 将它写到顶层，而原值在 `packages.<平台>`。不能统一定义“平台错误自动修正成功”；后续 SDK 校验也可能使任务失败。源码已发现，尚未实机证明影响，不改产品、不用猜测终态使样本通过。
2. **NEXT ABI 显示/配置一致性风险**：取消唯一项可通过 onChange 写 []，视图归一化却回显 arm64-v8a；不是已经阻止空数组。记录显示、原始选项和任务三层差异，未实测，不后台注入。
3. **校验请求异常风险**：宿主执行时 checkBuildOptions 请求失败会回退空结果继续；这是异常处理风险，不把它当已验证安全拦截，不在本批增加故障模拟或修复。
4. **OpenPaaS 禁止缺 ID 提交**：SDK `ensureGameAndPackageContext` 在缺 ID 时可能自动调用 createOpenPaasGame；不能把它当“必然报错且无副作用”的反例。遵守只用现有游戏，不点击创建项，不用该异常做任务验收。
5. **产品 / QA 决定项**：按此前已批准当前实现回归，不再要求决定空格/URL空值/提示时机等源码事实。若要改成严格 URL、空白名称拒绝、所有错误必须阻止点击等，这是新的产品要求/缺陷处置，单列待决定；本轮不更改基线或产品。后续点异常构建的具体终点与安全范围也要单独确认，不自动扩围。
6. **材料 / 候选**：现成库/PEM与私有凭据、独立坏 JSON/空对象、有效已有游戏/账号、L10N Catalog、真实低 API 候选。普通错误文本不算缺材料；无候选只阻塞对应样本。文件存在不等于认证通过，不造游戏、密钥或删 SDK。

### 执行与证据边界

所有样本先记录合法初态，一次只引入一个错误；检查准确触发、提示、修正、按钮后恢复原值/父项/候选/显隐，错误应按规则消失，不追加正常构建。恢复失败、意外任务、身份/观察失效停止；恢复成功且状态可信可继续无关样本，不重试/取消用户任务。

现有比例、部分签名、OpenPaaS 版本重开只有原局部证据；数值/超时/版本/口令/文件路径多仅输入回读，不能自动算新样本提示或任务通过。开发自检“零匹配”是观察结果无法唯一关联，不是产品没创建任务；其真实任务和独立补核记录不改写，也不代替产品拒绝提交覆盖，不需重跑。

本稿不实际点击异常构建。将来获准提交时要区分主按钮是否送达、宿主是否已创建任务、入队/processing/校验失败阶段及后项处置；任务存在不是反例失败，构建失败也不自动代表反例通过。预期要在执行前固定，不能以实际错误回填预期。

规则定位维护在设计数据 `sources`；包括 1958 `PlatformConfigModal`、`TypedField`、`CocosHostBuilder.addBuildTasks/jo` 和当前 custom SDK validators/各平台配置、视图和钩子。源码读取、历史结果、新样本实测、产物和运行五层证据不互代。本轮只更新设计展示，未连接 PinK、修改执行器/SDK/引擎或运行测试/构建。

## 判定口径：不把展示项当已覆盖结果

| 页面标记      | 含义                                             | 能否计为已执行通过                              |
| ------------- | ------------------------------------------------ | ----------------------------------------------- |
| 明确检查      | 输入、启用条件和预期已定义；前提满足后才执行     | 本稿没有执行，不能计通过                        |
| 仅保留回读    | 保留当前基准、身份或隐藏值；不主动设置           | 可检查基准/非目标未变，不算修改、候选或边界覆盖 |
| 待补材料/候选 | 规则已定，尚需真实文件、账号、资源或环境候选绑定 | 只保留对应分支，不提交占位值或记通过            |

固定合法目标有检查意义：AGC JSON 绑定包名、NEXT 单一支持后端/ABI、Windows x64 并非“无覆盖”。普通目标当前同值只算目标确认；保存、切换与隐藏保留专项必须满足明确初态，不能把同值当真实修改。材料引用只在材料清单已绑定后有效，不能拿角色名当实际凭据或 UUID。

前三组操作顺序：先选择实际存在的 `defaultConfig` 并等待候选刷新，再设置 2D/3D/渲染覆盖、包装及宏；需要的模块不在预设中时不写隐藏控件，也不改工程设置制造条件。继承值核对 `inherit-project-setting` 及已确认的任务归一化，不宣称运行效果已验证。公共 UI/边界仍由代表平台覆盖，不扩大成每个平台保存重开。

## 公共组合

参考 [QA 总纲](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/qa-process.md#测试组合)及两份补充表；具体来源见文末原设计记录。源数据见 [公共组合与输入](../tools/case-catalog/public-combinations.json)，浏览见 [平台 → 用例](pink-build-cases.html)。

| 公共选项                                | 组合一：发布                    | 组合二：调试               | 组合三：混合            |
| --------------------------------------- | ------------------------------- | -------------------------- | ----------------------- |
| Debug                                   | 关                              | 开                         | 开                      |
| MD5                                     | 开                              | 关；微信/抖音/支付宝开     | 开                      |
| 3D 物理                                 | Builtin                         | **Bullet（physics-ammo）** | Cannon                  |
| WebGL                                   | WebGL2；抖音/支付宝/淘宝 WebGL1 | 同发布                     | WebGL1                  |
| 主包远程                                | 开                              | 关；微信/抖音/支付宝开     | 同调试                  |
| 资源服务器                              | 本例合法测试 URL                | 本地为空；远程用本例 URL   | 同调试                  |
| 初始场景资源 Bundle                     | 开（有控件的平台）              | 关                         | 开（有控件的平台）      |
| 纹理压缩                                | 开，即 skip=false               | 关，即 skip=true           | 关，即 skip=true        |
| 自动图集                                | 开                              | 关                         | 开                      |
| 2D 物理（模块具备时）                   | Builtin                         | Box2D                      | 继承项目设置            |
| 图片缓存清理宏                          | on                              | off                        | inherit-project-setting |
| 引擎预设基准                            | defaultConfig                   | defaultConfig              | defaultConfig           |
| Source Map（补充覆盖）                  | 关闭                            | 独立                       | 内联                    |
| 混淆属性名 / 内联枚举                   | 开 / 关                         | 关 / 开                    | 关 / 开                 |
| 实验性模块裁剪 / 插屏 / Bundle 公共脚本 | 开 / 关 / 开                    | 关 / 开 / 关               | 关 / 开 / 关            |

原生平台使用专用渲染后端，不以 WebGL 开关替代；WebGL 固定关闭。Web 手机无纹理压缩/自动图集控件，NEXT 无 Source Map，均记不适用。当前隐藏的 Polyfill 不通过 API 补写。2D 物理、缓存宏和基准预设已补明确输入；其余保留项不算变化覆盖；CCONB 16/32 与 MD5 子项由 Web 桌面组合内变体补齐，隐藏保留和提交规则已确认，异常数值边界另列第四组。

**已定口径**：调试组使用 Bullet，混合组保持 Cannon 并按工程和平台适用性选择，不把“18×3”或“18×4”当必跑数量。异常输入按当前实现检查，不新增业务限制。其余公共开关搭配属于本次补充设计，不冒充 QA 原文要求。

混合组先依据工程类别、所需能力及平台支持合同判定：确实不适用的注明原因；能力适用但缺文件/账号/环境候选的保留待补分支；预期应出现的字段缺失或实际任务错误仍按故障记录，不能用“不适用”掩盖。

## 测试输入，直接写进用例

| 输入                | 明确目标                                                                                                        | 边界                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 测试名称            | `qa_<平台ID连字符改下划线>_<publish/debug/mixed>`；第四组 `qa_<平台>_conditional_<场景短名>`                    | 如 `qa_web_mobile_publish`；不强制等于工程名           |
| 构建目录 / 输出名   | `project://build` / 同本例测试名称                                                                              | 自动避让产生的最终输出名统一用于任务核对；不写死旧编号 |
| 初始 / 包含场景     | `scene-2d`，UUID `2e58824f-0bca-4f31-a495-1eceb60b610f`；只选该场景                                             | 沿用当前工程，不把它称为原表 testlist                  |
| 远程根地址          | `https://example.com/pink-qa/<平台ID>/<组合ID>/`                                                                | 配置及参数测试值，不要求先部署服务、不宣称链接可访问   |
| 普通包名            | `com.pink.qa.<去连字符的平台ID>.<publish/debug/mixed>`                                                          | 如 `com.pink.qa.android.publish`；AGC 例外按 JSON 包名 |
| 版本名 / 版本号     | 快游戏三组 `1.0.1/2`、`1.0.0/1`、`1.0.2/3`                                                                      | 按当前字段类型输入；不要求 QA 提供普通版本文本         |
| OpenPaaS 版本与超时 | `0.0.1/0.0.2/0.0.3`；四项超时分别 `8000/9000/10000/11000`、`12000/13000/14000/15000`、`18000/19000/20000/21000` | 超时是文本控件；不虚构游戏 ID                          |
| 淘宝全局变量        | `PinkQATestGlobal` → 开适配后隐藏保留 → 关适配并清空                                                            | 先父项后子项；不写隐藏文本                             |
| JS 加密测试密钥     | `0123456789abcdef`                                                                                              | 固定非生产测试输入；仅父项启用时填写                   |
| 分辨率 / 自定义比例 | Web 桌面 `960×640 / 1280×960 / 960×640`；原生自定义比例 `2.2`                                                   | 合法普通输入，不列材料依赖                             |

本轮不访问远程服务；若某平台构建阶段确实请求该地址，再把**该分支**改为服务前提，不能笼统阻塞所有远程组合。API、ABI、Generator 只能从本机真实候选绑定；运行时版本是字符串必填输入，第四组直接定义 2.0.1，不再要求 QA 提供普通版本文本。仅验证配置与任务，不宣称设备兼容。

## 18 平台的公共压缩与专属配置

每个平台展示前三组固定搭配和第四组适用场景；本表仅列前三组。表中专属配置覆盖公共模板相应字段，未列字段保留。具体字段键、完整目标和条件见 HTML。`A0/A1` 是实际合法 API 候选，`G0/G1` 在 Windows 指 Generator、在 OpenPaaS 指当前账号已有游戏，互不串用。

| 平台 | 主包压缩：发布 / 调试 / 混合 | 发布专属 | 调试专属 | 混合专属 |
| --- | --- | --- | --- | --- | --- |
| 鸿蒙 `ohos` | none / merge_all_json / none | `packageName`=com.pink.qa.ohos.publish；`orientation.portrait`=开；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=关；`apiLevel`=本机配置页实际可用且当前 SDK 支持的 API 值；`encrypted`=开；`xxteaKey`=0123456789abcdef；`compressZip`=关；`JobSystem`=taskFlow | `packageName`=com.pink.qa.ohos.debug；`orientation.portrait`=关；`orientation.landscapeLeft`=开；`orientation.landscapeRight`=关；`apiLevel`=本机配置页实际可用且当前 SDK 支持的 API 值；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=none | `packageName`=com.pink.qa.ohos.mixed；`orientation.portrait`=关；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=开；`apiLevel`=本机配置页实际可用且当前 SDK 支持的 API 值；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=tbb |
| 鸿蒙 NEXT `harmonyos-next` | none / merge_all_json / none | `packageName`=com.pink.qa.harmonyosnext.publish；`orientation.portrait`=开；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=关；`encrypted`=开；`xxteaKey`=0123456789abcdef；`compressZip`=关；`JobSystem`=taskFlow；`jsEngine`=JSVM；`useGamepad`=开；`appABIs`=arm64-v8a；`renderBackEnd.gles3`=开；`deviceTypes.phone`=开；`deviceTypes.tablet`=关；`deviceTypes.pc_2in1`=关；`deviceTypes.tv`=关；`deviceTypes.wearable`=关；`deviceTypes.car`=关；`deviceTypes.default`=关 | `packageName`=com.pink.qa.harmonyosnext.debug；`orientation.portrait`=关；`orientation.landscapeLeft`=开；`orientation.landscapeRight`=关；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=none；`jsEngine`=V8；`useGamepad`=关；`appABIs`=arm64-v8a；`renderBackEnd.gles3`=开；`deviceTypes.phone`=关；`deviceTypes.tablet`=开；`deviceTypes.pc_2in1`=关；`deviceTypes.tv`=开；`deviceTypes.wearable`=开；`deviceTypes.car`=关；`deviceTypes.default`=关 | `packageName`=com.pink.qa.harmonyosnext.mixed；`orientation.portrait`=关；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=开；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=tbb；`jsEngine`=ARK；`useGamepad`=开；`appABIs`=arm64-v8a；`renderBackEnd.gles3`=开；`deviceTypes.phone`=关；`deviceTypes.tablet`=关；`deviceTypes.pc_2in1`=开；`deviceTypes.tv`=关；`deviceTypes.wearable`=关；`deviceTypes.car`=开；`deviceTypes.default`=开 |
| AppGallery Connect `huawei-agc` | none / merge_all_json / none | `packageName`=com.testcases.cocos；`orientation.portrait`=开；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=关；`renderBackEnd.gles3`=开；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=关；`swappy`=开；`inputSDK`=开；`isSoFileCompressed`=关；`resizeableActivity`=关；`maxAspectRatio`=16:9；`useDebugKeystore`=开；`apiLevel`=A0：当前 AGC 配置页实际合法 API 候选；`serviceConfigPath`=C:/Users/Administrator/Downloads/agconnect-services.json | `packageName`=com.testcases.cocos；`orientation.portrait`=关；`orientation.landscapeLeft`=开；`orientation.landscapeRight`=关；`renderBackEnd.gles3`=开；`renderBackEnd.gles2`=开；`renderBackEnd.vulkan`=关；`swappy`=关；`inputSDK`=关；`isSoFileCompressed`=开；`resizeableActivity`=开；`maxAspectRatio`=禁用并保持发布组 16:9；`useDebugKeystore`=开；`apiLevel`=A1：不同于基准的另一实际合法 API 候选；`serviceConfigPath`=C:/Users/Administrator/Downloads/agconnect-services.json | `packageName`=com.testcases.cocos；`orientation.portrait`=关；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=开；`renderBackEnd.gles3`=关；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=开；`swappy`=开；`inputSDK`=开；`isSoFileCompressed`=关；`resizeableActivity`=关；`maxAspectRatio`=2.2（通过自定义输入）；`useDebugKeystore`=开；`apiLevel`=A0：当前 AGC 配置页实际合法 API 候选；`serviceConfigPath`=C:/Users/Administrator/Downloads/agconnect-services.json |
| 安卓 `android` | none / merge_all_json / none | `packageName`=com.pink.qa.android.publish；`orientation.portrait`=开；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=关；`renderBackEnd.gles3`=开；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=关；`swappy`=开；`inputSDK`=开；`isSoFileCompressed`=关；`resizeableActivity`=关；`maxAspectRatio`=16:9；`useDebugKeystore`=开；`apiLevel`=A0：UI 实际候选中合法值；Instant 开启需 ≥23；`androidInstant`=开；`appABIs`=arm64-v8a；`encrypted`=开；`xxteaKey`=0123456789abcdef；`compressZip`=关；`JobSystem`=taskFlow | `packageName`=com.pink.qa.android.debug；`orientation.portrait`=关；`orientation.landscapeLeft`=开；`orientation.landscapeRight`=关；`renderBackEnd.gles3`=开；`renderBackEnd.gles2`=开；`renderBackEnd.vulkan`=关；`swappy`=关；`inputSDK`=关；`isSoFileCompressed`=开；`resizeableActivity`=开；`maxAspectRatio`=2.4；`useDebugKeystore`=开；`apiLevel`=A1：不同于 A0 的合法候选；TBB 需 ≥21；`androidInstant`=关；`appABIs`=当前实际支持的多个 ABI，至少包含 arm64-v8a；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=none | `packageName`=com.pink.qa.android.mixed；`orientation.portrait`=关；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=开；`renderBackEnd.gles3`=关；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=开；`swappy`=开；`inputSDK`=开；`isSoFileCompressed`=关；`resizeableActivity`=关；`maxAspectRatio`=2.2（通过自定义输入）；`useDebugKeystore`=开；`apiLevel`=A0：与发布组同一合法候选；`androidInstant`=关；`appABIs`=不同于发布组的另一合法单选；候选不足仅此分支受阻；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=tbb |
| Web 桌面端 `web-desktop` | none / merge_all_json / none | `useWebGPU`=开；`resolution.designWidth`=960；`resolution.designHeight`=640 | `useWebGPU`=关；`resolution.designWidth`=1280；`resolution.designHeight`=960 | `useWebGPU`=关；`resolution.designWidth`=960；`resolution.designHeight`=640 |
| Web 手机端 `web-mobile` | none / merge_all_json / none | `useWebGPU`=开；`orientation`=auto；`embedWebDebugger`=关 | `useWebGPU`=关；`orientation`=landscape；`embedWebDebugger`=开 | `useWebGPU`=关；`orientation`=portrait；`embedWebDebugger`=关 |
| Windows `windows` | none / merge_all_json / none | `renderBackEnd.gles3`=开；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=关；`encrypted`=开；`xxteaKey`=0123456789abcdef；`compressZip`=关；`JobSystem`=taskFlow；`executableName`=qaui_build；`targetPlatform`=x64；`vsData`=G0：当前已安装且 UI 可选的 CMake Generator | `renderBackEnd.gles3`=开；`renderBackEnd.gles2`=开；`renderBackEnd.vulkan`=关；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=none；`executableName`=；`targetPlatform`=x64；`vsData`=G0：当前已安装且 UI 可选的 CMake Generator | `renderBackEnd.gles3`=关；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=开；`encrypted`=关；`xxteaKey`=隐藏；不写入，保持/归一化按合同核对；`compressZip`=关；`JobSystem`=tbb；`executableName`=qaui_build；`targetPlatform`=x64；`vsData`=G0：当前已安装且 UI 可选的 CMake Generator |
| 3000+ 平台 `openpaas` | merge_all_json / subpackage / none | `versionName`=0.0.1；`deviceOrientation`=portrait；`appid`=G0：当前账号已有基准游戏；`networkTimeout.XMLHttpRequest`=8000；`networkTimeout.Websocket`=9000；`networkTimeout.uploadFile`=10000；`networkTimeout.downloadFile`=11000 | `versionName`=0.0.2；`deviceOrientation`=landscape；`appid`=G0：当前账号已有基准游戏；`networkTimeout.XMLHttpRequest`=12000；`networkTimeout.Websocket`=13000；`networkTimeout.uploadFile`=14000；`networkTimeout.downloadFile`=15000 | `versionName`=0.0.3；`deviceOrientation`=portrait；`appid`=G0：当前账号已有基准游戏；`networkTimeout.XMLHttpRequest`=18000；`networkTimeout.Websocket`=19000；`networkTimeout.uploadFile`=20000；`networkTimeout.downloadFile`=21000 |
| 微信小游戏 `wechatgame` | merge_all_json / merge_all_json / none | `orientation`=landscapeRight；`appid`=I0：当前工程已配置、对应平台的有效测试 AppID（回读身份，不造 ID）；`buildOpenDataContextTemplate`=开；`wasmSubpackage`=开；`separateEngine`=关；`highPerformanceMode`=开 | `orientation`=portrait；`appid`=I0：当前工程已配置、对应平台的有效测试 AppID（回读身份，不造 ID）；`buildOpenDataContextTemplate`=关；`wasmSubpackage`=关；`separateEngine`=关；`highPerformanceMode`=关 | `orientation`=landscapeRight；`appid`=I0：当前工程已配置、对应平台的有效测试 AppID（回读身份，不造 ID）；`buildOpenDataContextTemplate`=关；`wasmSubpackage`=关；`separateEngine`=关；`highPerformanceMode`=开 |
| 抖音小游戏 `bytedance-mini-game` | merge_all_json / merge_all_json / none | `orientation`=landscape；`appid`=I0：当前工程已配置、对应平台的有效测试 AppID（回读身份，不造 ID）；`buildOpenDataContextTemplate`=开；`wasmSubpackage`=开；`separateEngine`=关；`generatePreloadJsFileList`=开；`devToolsLaunchMethod`=full | `orientation`=portrait；`appid`=I0：当前工程已配置、对应平台的有效测试 AppID（回读身份，不造 ID）；`buildOpenDataContextTemplate`=关；`wasmSubpackage`=关；`separateEngine`=关；`generatePreloadJsFileList`=关；`devToolsLaunchMethod`=lite | `orientation`=landscape；`appid`=I0：当前工程已配置、对应平台的有效测试 AppID（回读身份，不造 ID）；`buildOpenDataContextTemplate`=关；`wasmSubpackage`=关；`separateEngine`=关；`generatePreloadJsFileList`=开；`devToolsLaunchMethod`=full |
| 支付宝 `alipay-mini-game` | merge_dep / merge_all_json / none | `deviceOrientation`=landscape；`wasmSubpackage`=开 | `deviceOrientation`=portrait；`wasmSubpackage`=关 | `deviceOrientation`=landscape；`wasmSubpackage`=关 |
| OPPO `oppo-mini-game` | merge_all_json / subpackage / none | `package`=com.pink.qa.oppominigame.publish；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.1；`versionCode`=2；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`separateEngine`=开 | `package`=com.pink.qa.oppominigame.debug；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.0；`versionCode`=1；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=portrait；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`separateEngine`=关 | `package`=com.pink.qa.oppominigame.mixed；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.2；`versionCode`=3；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`separateEngine`=关 |
| vivo `vivo-mini-game` | merge_all_json / subpackage / none | `package`=com.pink.qa.vivominigame.publish；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.1；`versionCode`=2；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入 | `package`=com.pink.qa.vivominigame.debug；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.0；`versionCode`=1；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=portrait；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入 | `package`=com.pink.qa.vivominigame.mixed；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.2；`versionCode`=3；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入 |
| 荣耀 `honor-mini-game` | merge_all_json / subpackage / none | `package`=com.pink.qa.honorminigame.publish；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.1；`versionCode`=2；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`minPlatformVersion`=1081；`fullScreen`=关；`logLevel`=warn | `package`=com.pink.qa.honorminigame.debug；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.0；`versionCode`=1；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=portrait；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`minPlatformVersion`=1080；`fullScreen`=开；`logLevel`=log | `package`=com.pink.qa.honorminigame.mixed；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.2；`versionCode`=3；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`minPlatformVersion`=1081；`fullScreen`=关；`logLevel`=warn |
| 华为快游戏 `huawei-quick-game` | merge_all_json / subpackage / none | `package`=com.pink.qa.huaweiquickgame.publish；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.1；`versionCode`=2；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`separateEngine`=开；`minPlatformVersion`=1104；`fullScreen`=关；`logLevel`=warn | `package`=com.pink.qa.huaweiquickgame.debug；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.0；`versionCode`=1；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=portrait；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`separateEngine`=关；`minPlatformVersion`=1103；`fullScreen`=开；`logLevel`=log | `package`=com.pink.qa.huaweiquickgame.mixed；`icon`=沿用随工程已存在的默认图标；`versionName`=1.0.2；`versionCode`=3；`runtimeVersion`=R0：回读当前已确认合法的运行时版本；`deviceOrientation`=landscape；`useDebugKey`=开；`privatePemPath`=禁用时保持原值，不输入；`certificatePemPath`=禁用时保持原值，不输入；`appid`=沿用当前测试应用身份（可空性按该平台校验）；`appkey`=沿用当前匹配测试凭据（不展示原文）；`separateEngine`=关；`minPlatformVersion`=1104；`fullScreen`=关；`logLevel`=warn |
| 淘宝 `taobao-mini-game` | merge_all_json / subpackage / none | `orientation`=landscape；`wasmSubpackage`=开；`separateEngine`=关；`globalAdapter`=关；`globalVariable`=PinkQATestGlobal | `orientation`=portrait；`wasmSubpackage`=关；`separateEngine`=关；`globalAdapter`=开；`globalVariable`=隐藏并保留发布组文本（不写隐藏项） | `orientation`=landscape；`wasmSubpackage`=关；`separateEngine`=关；`globalAdapter`=关；`globalVariable`= |
| Facebook 即时游戏 `fb-instant-games` | merge_all_json / merge_all_json / none | `orientation`=portrait；`embedWebDebugger`=关 | `orientation`=landscape；`embedWebDebugger`=开 | `orientation`=portrait；`embedWebDebugger`=关 |
| Google Play 商店 `google-play` | none / merge_all_json / none | `packageName`=com.pink.qa.googleplay.publish；`orientation.portrait`=开；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=关；`renderBackEnd.gles3`=开；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=关；`swappy`=开；`inputSDK`=开；`isSoFileCompressed`=开；`resizeableActivity`=关；`maxAspectRatio`=16:9；`useDebugKeystore`=开；`apiLevel`=A0：UI 实际候选中合法值；Instant 开启需 ≥23；`androidInstant`=开；`appABIs`=arm64-v8a；`adpf`=关；`googleBilling`=开；`customIcon`=沿用已有默认图标；`remoteUrl`=https://example.com/pink-qa/google-play/instant/；`orientation.upsideDown`=开 | `packageName`=com.pink.qa.googleplay.debug；`orientation.portrait`=关；`orientation.landscapeLeft`=开；`orientation.landscapeRight`=关；`renderBackEnd.gles3`=开；`renderBackEnd.gles2`=开；`renderBackEnd.vulkan`=关；`swappy`=关；`inputSDK`=关；`isSoFileCompressed`=关；`resizeableActivity`=开；`maxAspectRatio`=禁用并保持发布组 16:9；`useDebugKeystore`=开；`apiLevel`=A1：不同于基准的另一实际合法 API 候选；`androidInstant`=关；`appABIs`=当前实际支持的多个 ABI，至少包含 arm64-v8a；`adpf`=开；`googleBilling`=关；`customIcon`=沿用已有默认图标；`remoteUrl`=Instant 关闭：隐藏并保留，不写入；`orientation.upsideDown`=关 | `packageName`=com.pink.qa.googleplay.mixed；`orientation.portrait`=关；`orientation.landscapeLeft`=关；`orientation.landscapeRight`=开；`renderBackEnd.gles3`=关；`renderBackEnd.gles2`=关；`renderBackEnd.vulkan`=开；`swappy`=开；`inputSDK`=开；`isSoFileCompressed`=开；`resizeableActivity`=关；`maxAspectRatio`=2.2（通过自定义输入）；`useDebugKeystore`=开；`apiLevel`=A0：与发布组同一合法候选；`androidInstant`=关；`appABIs`=不同于发布组的另一合法单选；候选不足仅此分支受阻；`adpf`=关；`googleBilling`=开；`customIcon`=沿用已有默认图标；`remoteUrl`=Instant 关闭：隐藏并保留，不写入；`orientation.upsideDown`=关 |

原生、Web 和 Facebook 仅使用实际支持的主包三种模式；小游戏按平台支持分配分包。`主包 zip`、`wasmSubpackage`、`compressZip` 是三个不同检查点，不互相抵扣。WX/抖音的 `nativeCodeBundleMode` 为 Wasm / asmjs / both；淘宝为 Wasm / asmjs / Wasm，压缩为开 / 隐藏前关闭 / 关。它们随同各自公共组合执行，不独立命名为公共组合。

## 前三组保留的普通变体

普通父子联动、合法普通输入和公共压缩补充仍在原组；需要额外项目能力、特殊文件、账号候选或兼容环境的正向分支移到第四组。基础构建本身必需的 AGC JSON、有效游戏 G0 等仍是基础前提，不因迁移专项而取消。

| 平台 / 所属组                    | 普通变体           | 覆盖 / 待核合同                                                                                                                       |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 鸿蒙 / 组合一 · 发布             | 加密 Zip 开启      | 加密开启时 Zip false/true；关闭加密后子项消失且压缩复位；密钥仍用本例固定非生产值；关闭侧归入调试组合前的配置联动，不另建公共组合。   |
| 鸿蒙 NEXT / 组合一 · 发布        | 加密 Zip 开启      | 加密开启时 Zip false/true；关闭加密后子项消失且压缩复位；密钥仍用本例固定非生产值；关闭侧归入调试组合前的配置联动，不另建公共组合。   |
| 安卓 / 组合一 · 发布             | 加密 Zip 开启      | 加密开启时 Zip false/true；关闭加密后子项消失且压缩复位；密钥仍用本例固定非生产值；关闭侧归入调试组合前的配置联动，不另建公共组合。   |
| Web 桌面端 / 组合一 · 发布       | 合并依赖           | 补齐公共 merge_dep；其余公共与专属配置沿用本发布组合；                                                                                |
| Web 桌面端 / 组合一 · 发布       | MD5 子项与资源分组 | MD5 子项关闭、CCONB 开启与阈值 32；父项关闭只隐藏并保留子项；提交不自动清空。只在代表平台补。                                         |
| Web 桌面端 / 组合二 · 调试       | MD5 父项关闭       | 父项关闭后子项隐藏、分组关闭；先在父项开启时设置子项，再关闭父项；隐藏值保留与任务表示分开判定。                                      |
| Web 桌面端 / 组合三 · 混合       | MD5 子项与阈值返回 | MD5 子项开启、CCONB 阈值 16；与另两组对照；CCONB 16/32 为普通数值样本；异常边界单列，不验证产物分组效果。                             |
| Windows / 组合一 · 发布          | 加密 Zip 开启      | 加密开启时 Zip false/true；关闭加密后子项消失且压缩复位；密钥仍用本例固定非生产值；关闭侧归入调试组合前的配置联动，不另建公共组合。   |
| 微信小游戏 / 组合一 · 发布       | Wasm 压缩开启      | Wasm 包装下压缩开/关；先选择 Wasm，再操作压缩。                                                                                       |
| 抖音小游戏 / 组合一 · 发布       | Wasm 压缩开启      | Wasm 包装下压缩开/关；先选择 Wasm，再操作压缩。                                                                                       |
| OPPO / 组合一 · 发布             | 主包 Zip           | 公共 Zip 模式；保留发布组方向和分离引擎目标；从分包返回时先退出 subpackage，再填地址/开远程，最后选 Zip；本阶段不访问或验证远程服务。 |
| Google Play 商店 / 组合一 · 发布 | 第二包名入口同步   | 从第二入口修改包名并核对另一入口同步；普通测试包名不依赖新材料；只用正常 UI 改包名；自定义图标已移到第四组。                          |

## 组合四：条件与扩展

第四组沿用对应平台发布配置作为背景，按启用条件选择场景，不同时打开所有特殊能力，也不固定执行 18×4。下表是摘要；完整步骤、恢复和提交终点以 [展示页](pink-build-cases.html)及同源 JSON 为准。“明确检查”表示设计规则已固定，不表示本轮执行通过。

| 场景                              | 设计状态      | 适用平台                                                                 | 测试输入                                                                                                                                                                                                                                                                                                                                          | 已确认预期 / 剩余前提                                                                                                                                                                                                                            |
| --------------------------------- | ------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L10N 未启用 → 启用后的入口        | 明确检查      | Web 桌面代表；平台差异另补                                               | 初态=项目 L10N 未启用；启用后=开发语言 zh-Hans；等待项目与附加区就绪                                                                                                                                                                                                                                                                              | 三个语言配置控件不存在；不记为定位失败，不写隐藏字段。                                                                                                                                                                                           |
| L10N 双语言配置与构建             | 明确检查      | Web 桌面代表；平台差异另补                                               | 目标语言=zh-Hans、en 选中，其余实际候选取消；默认语言=en；回退语言=zh-Hans                                                                                                                                                                                                                                                                        | 入口可操作；未出现时核对启用/开发语言/加载状态。                                                                                                                                                                                                 |
| L10N 缩减目标与手动设置默认/回退  | 明确检查      | Web 桌面代表；平台差异另补                                               | 目标语言=仅 en，zh-Hans 取消，其余实际候选取消；默认 / 回退=en / en                                                                                                                                                                                                                                                                               | zh-Hans 的 value=false；默认仍 en、回退仍 zh-Hans，两个下拉仍保留这些候选，不要求自动修正。                                                                                                                                                      |
| L10N 空选择与恢复                 | 明确检查      | Web 桌面代表；平台差异另补                                               | 临时目标=全部实际候选取消；恢复目标=zh-Hans、en；默认 en，回退 zh-Hans                                                                                                                                                                                                                                                                            | map 中实际候选逐项 value=false；默认 en/回退 zh-Hans 保持，两个下拉不因空选择禁用；不要求“无目标语言”说明。                                                                                                                                      |
| 自定义密钥库                      | 明确检查      | AppGallery Connect                                                       | useDebugKeystore=False；keystorePath=KEYSTORE_QA.path；keystorePassword=KEYSTORE_QA.password；keystoreAlias=KEYSTORE_QA.alias；keystoreAliasPassword=KEYSTORE_QA.aliasPassword                                                                                                                                                                    | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义密钥库                      | 明确检查      | 安卓                                                                     | useDebugKeystore=False；keystorePath=KEYSTORE_QA.path；keystorePassword=KEYSTORE_QA.password；keystoreAlias=KEYSTORE_QA.alias；keystoreAliasPassword=KEYSTORE_QA.aliasPassword                                                                                                                                                                    | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| Generator 候选切换                | 待补材料/候选 | Windows                                                                  | vsData=G1：另一已安装且 UI 实际提供的 Generator                                                                                                                                                                                                                                                                                                   | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。；仅待环境候选绑定：另一已安装且 UI 提供的 Generator G1；仅一个候选时只阻塞切换侧。                                                                                                |
| 引擎插件开启                      | 待补材料/候选 | 微信小游戏                                                               | separateEngine=True；wasmSubpackage=False；nativeCodeBundleMode=wasm；wasmCompressionMode=False                                                                                                                                                                                                                                                   | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。；仅待兼容环境：发布且 separateEngine=true 时 SDK 要求 builtin 类型（或未提供类型）；当前 custom 不计发布插件正向通过，不自动切换引擎。                                            |
| 引擎插件开启                      | 待补材料/候选 | 抖音小游戏                                                               | separateEngine=True；wasmSubpackage=False；nativeCodeBundleMode=wasm；wasmCompressionMode=False                                                                                                                                                                                                                                                   | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。；仅待兼容环境：发布且 separateEngine=true 时 SDK 要求 builtin 类型（或未提供类型）；当前 custom 不计发布插件正向通过，不自动切换引擎。                                            |
| 自定义图标                        | 明确检查      | OPPO                                                                     | icon=ICON_QA：选取真实有效 PNG 文件                                                                                                                                                                                                                                                                                                               | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义签名                        | 明确检查      | OPPO                                                                     | useDebugKey=False；privatePemPath=SIGN_QA.privatePemPath；certificatePemPath=SIGN_QA.certificatePemPath                                                                                                                                                                                                                                           | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 运行时版本文本切换                | 明确检查      | OPPO                                                                     | runtimeVersion=2.0.1（非空字符串测试值，不宣称设备兼容）                                                                                                                                                                                                                                                                                          | 按字符串精确匹配；初态同值只算目标确认，不算版本切换。                                                                                                                                                                                           |
| 匹配应用身份                      | 明确检查      | OPPO                                                                     | appid=APP_QA.id；appkey=APP_QA.key                                                                                                                                                                                                                                                                                                                | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义图标                        | 明确检查      | vivo                                                                     | icon=ICON_QA：选取真实有效 PNG 文件                                                                                                                                                                                                                                                                                                               | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义签名                        | 明确检查      | vivo                                                                     | useDebugKey=False；privatePemPath=SIGN_QA.privatePemPath；certificatePemPath=SIGN_QA.certificatePemPath                                                                                                                                                                                                                                           | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 运行时版本文本切换                | 明确检查      | vivo                                                                     | runtimeVersion=2.0.1（非空字符串测试值，不宣称设备兼容）                                                                                                                                                                                                                                                                                          | 按字符串精确匹配；初态同值只算目标确认，不算版本切换。                                                                                                                                                                                           |
| 自定义图标                        | 明确检查      | 荣耀                                                                     | icon=ICON_QA：选取真实有效 PNG 文件                                                                                                                                                                                                                                                                                                               | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义签名                        | 明确检查      | 荣耀                                                                     | useDebugKey=False；privatePemPath=SIGN_QA.privatePemPath；certificatePemPath=SIGN_QA.certificatePemPath                                                                                                                                                                                                                                           | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 运行时版本文本切换                | 明确检查      | 荣耀                                                                     | runtimeVersion=2.0.1（非空字符串测试值，不宣称设备兼容）                                                                                                                                                                                                                                                                                          | 按字符串精确匹配；初态同值只算目标确认，不算版本切换。                                                                                                                                                                                           |
| 匹配应用身份                      | 明确检查      | 荣耀                                                                     | appid=APP_QA.id；appkey=APP_QA.key                                                                                                                                                                                                                                                                                                                | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义图标                        | 明确检查      | 华为快游戏                                                               | icon=ICON_QA：选取真实有效 PNG 文件                                                                                                                                                                                                                                                                                                               | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义签名                        | 明确检查      | 华为快游戏                                                               | useDebugKey=False；privatePemPath=SIGN_QA.privatePemPath；certificatePemPath=SIGN_QA.certificatePemPath                                                                                                                                                                                                                                           | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 运行时版本文本切换                | 明确检查      | 华为快游戏                                                               | runtimeVersion=2.0.1（非空字符串测试值，不宣称设备兼容）                                                                                                                                                                                                                                                                                          | 按字符串精确匹配；初态同值只算目标确认，不算版本切换。                                                                                                                                                                                           |
| 匹配应用身份                      | 明确检查      | 华为快游戏                                                               | appid=APP_QA.id；appkey=APP_QA.key                                                                                                                                                                                                                                                                                                                | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 引擎插件开启                      | 待补材料/候选 | 淘宝                                                                     | separateEngine=True；wasmSubpackage=False；nativeCodeBundleMode=wasm；wasmCompressionMode=False                                                                                                                                                                                                                                                   | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。；仅待兼容环境：发布且 separateEngine=true 时 SDK 要求 builtin 类型（或未提供类型）；当前 custom 不计发布插件正向通过，不自动切换引擎。                                            |
| 自定义图标                        | 明确检查      | Google Play 商店                                                         | customIcon=ICON_QA：真实 PNG 文件                                                                                                                                                                                                                                                                                                                 | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| 自定义密钥库                      | 明确检查      | Google Play 商店                                                         | useDebugKeystore=False；keystorePath=KEYSTORE_QA.path；keystorePassword=KEYSTORE_QA.password；keystoreAlias=KEYSTORE_QA.alias；keystoreAliasPassword=KEYSTORE_QA.aliasPassword                                                                                                                                                                    | 控件存在且可操作；缺前提只阻塞本场景，禁用态不算正向开启通过。                                                                                                                                                                                   |
| OpenPaaS 第二个已有游戏选择       | 明确检查      | 3000+ 平台                                                               | 初态游戏=G0；构建游戏=从真实候选选择 G1；版本名=0.0.4                                                                                                                                                                                                                                                                                             | 游戏 ID/名称/关联上下文对应 G1；不能输入任意虚构 ID。                                                                                                                                                                                            |
| AGC 服务 JSON 选择与包名关联      | 明确检查      | AppGallery Connect                                                       | 服务文件=C:/Users/Administrator/Downloads/agconnect-services.json；期望包名=com.testcases.cocos                                                                                                                                                                                                                                                   | serviceConfigPath 为所选路径；不要求选文件立即解析或自动改 UI 包名。                                                                                                                                                                             |
| 多场景与初始场景选择              | 明确检查      | Web 桌面代表；平台差异另补                                               | 包含场景=scene-2d + audio；初始场景=audio；scene-2d UUID=2e58824f-0bca-4f31-a495-1eceb60b610f；audio UUID=51aa1a3c-4184-422b-b643-fd09a9dcb82f                                                                                                                                                                                                    | 显示身份与 UUID 一致；初始场景属于包含集合。                                                                                                                                                                                                     |
| 多个真实 Bundle 的选择            | 待补材料/候选 | Web 桌面代表；平台差异另补                                               | B0=真实 Bundle 名称、root、UUID（有则记录）与依赖；B1=另一个真实 Bundle 身份与依赖；选择=外部 B0 → B0/B1 → B1；每步均保留内置 main/internal；任务表示=bundleConfigs 为空数组表示全部；显式选择记录含 name/root/uuid（如有）/output=true；最终目标=显式内置 main/internal 加 B1，排除 B0；不要求数组只有 B1                                        | 每步回读外部集合及不可取消的内置项；不能把 [] 当空选择。；仅待材料绑定：B0/B1 的真实名称、root/UUID 与依赖；选择及任务记录格式已经明确。                                                                                                         |
| L10N 默认/回退互换与保存          | 明确检查      | Web 桌面代表；平台差异另补                                               | 初态=目标 zh-Hans/en；默认 en，回退 zh-Hans；目标=默认 zh-Hans，回退 en；目标集合不变                                                                                                                                                                                                                                                             | 两项真实变化且均属于所选目标集合；非目标语言状态不变。                                                                                                                                                                                           |
| L10N 仅开发语言                   | 明确检查      | Web 桌面代表；平台差异另补                                               | 目标=仅 zh-Hans；其他实际候选全部取消；默认 / 回退=zh-Hans / zh-Hans                                                                                                                                                                                                                                                                              | 其他候选 value=false；默认/回退均 zh-Hans，但下拉仍可列出 en 等可用语言。                                                                                                                                                                        |
| L10N 全取消的构建前规则（不提交） | 明确检查      | Web 桌面代表；平台差异另补                                               | 初态=已启用且开发语言 zh-Hans；默认 en、回退 zh-Hans；目标语言=全部实际候选明确 value=false，包含 zh-Hans；不是省略 map，也不是空对象 {}；默认 / 回退=取消后保持 en / zh-Hans，不要求下拉禁用                                                                                                                                                     | 默认/回退仍可编辑且保留旧值；本场景不提交。                                                                                                                                                                                                      |
| 原生模块门槛与三种代码包装        | 明确检查      | Web 桌面代表；平台差异另补                                               | 模块前提=实际预设含 2D 模块，并通过 UI 选择 physics-2d-box2d，或材料清单指定的另一个原生模块；包装顺序=wasm → both → asmjs → both；压缩顺序=wasm/both 各检查关闭与开启；回 asmjs 前先取消压缩；最终 both + 开；任务期望=最终 nativeCodeBundleMode=both；UI true 对应 wasmCompressionMode=brotli                                                   | 无模块时不定位隐藏控件；有模块时实际提供 wasm/asmjs/both。无纯 JS 预设时不声称覆盖缺席侧。                                                                                                                                                       |
| 既有预设切换与继承/覆盖           | 待补材料/候选 | Web 桌面代表；平台差异另补                                               | P0=defaultConfig（须在实际候选中）；P1=材料清单中另一个真实既有预设 ID，不凭空新建；顺序=P0 → P1；等待模块加载；再设置 2D/3D/宏覆盖；恢复 P0                                                                                                                                                                                                      | 已存在覆盖仍保留；字段可见性按 P1 模块清单判断，不向隐藏控件写入。；仅待材料绑定：第二个真实预设 P1 和模块清单；切换保留覆盖、不自动清理的规则已经明确。                                                                                         |
| 其他物理后端候选                  | 待补材料/候选 | Web 桌面代表；平台差异另补                                               | 3D 候选=physics-physx；仅在当前 UI 确有该候选时；2D 候选=physics-2d-box2d-wasm；原生平台另核 physics-2d-box2d-jsb                                                                                                                                                                                                                                 | UI/提交记录所选模块键；不把引擎 fallback 声明直接当 task 选项自动改写。；仅待候选/材料绑定：当前 custom 引擎实际提供的 PhysX/Box2D 候选及预设依赖；SDK 的 JSB 原生条件和 Wasm 回退声明已确认，不能当作已验证的跨平台终态改写。                   |
| 分辨率与 CCONB 数值输入及恢复     | 明确检查      | Web 桌面端                                                               | 分辨率候选=1×1（正整数样本）、0、-1、1.5、空值；CCONB 候选=16、32（普通样本）、0、-1、1.5、空值；恢复=960×640；分组阈值恢复记录值                                                                                                                                                                                                                 | 控件通过 Number 转换写入数值；无 min/max 时不主动拒绝或截断负数、小数，不要求额外业务错误或禁用构建按钮。                                                                                                                                        |
| 比例输入边界                      | 明确检查      | 安卓、Google Play 商店、AppGallery Connect                               | 普通值=2.2；边界样本=0、-1、abc、空值；逐个输入后恢复 2.2；平台差异=Android/Google 检查提示；AGC 检查字符串回读，不要求同样提示                                                                                                                                                                                                                   | 2.2 无比例错误；0/-1 低于 1.33，abc 格式错误，空值必填错误。提示随表单值计算；不额外要求构建按钮禁用。                                                                                                                                           |
| 快游戏版本输入边界                | 明确检查      | 荣耀、华为快游戏、OPPO、vivo                                             | 版本号候选=1、2、3（普通样本）；0、-1、1.5、abc、空值；版本名候选=1.0.1（普通样本）；空值、非版本文本 qa-version                                                                                                                                                                                                                                  | 版本号保留字符串，包括 0、-1、1.5、abc；版本名 qa-version 不因语义格式被当前 SDK 规则拒绝。仅证明表单输入，不证明平台运行有效。                                                                                                                  |
| OpenPaaS 网络超时输入边界         | 明确检查      | 3000+ 平台                                                               | 四字段=XMLHttpRequest / Websocket / uploadFile / downloadFile；候选=8000（普通样本）；0、-1、abc、空值；恢复=逐项恢复本例记录的合法字符串                                                                                                                                                                                                         | 四项均按文本保存；不要求 UI 拒绝或转换为数字。空字符串不自动等同默认超时。                                                                                                                                                                       |
| 名称格式校验（android）           | 明确检查      | 安卓                                                                     | 非法样本=bad-name；恢复合法值=com.pink.qa.android.validation                                                                                                                                                                                                                                                                                      | Android 包名须符合 ^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$。非法文本不能计为 SDK 合法配置；当前通用 UI 不保证编辑后立即提示或阻断，不提交非法任务。                                                                                                        |
| 名称格式校验（windows）           | 明确检查      | Windows                                                                  | 非法样本=bad/name；恢复合法值=qa_build_01                                                                                                                                                                                                                                                                                                         | Windows 可执行名仅含字母、数字、下划线、连字符，允许空字符串。非法文本不能计为 SDK 合法配置；当前通用 UI 不保证编辑后立即提示或阻断，不提交非法任务。                                                                                            |
| AGC JSON 选择与解析边界           | 待补材料/候选 | AppGallery Connect                                                       | JSON_BAD 内容={；JSON_NO_SERVICE 内容={}；恢复文件=C:/Users/Administrator/Downloads/agconnect-services.json；恢复包名=com.testcases.cocos；附加步骤=打开选择器后取消                                                                                                                                                                              | 取消选择保留原值；选中文件更新路径，不要求立即解析、拦截或清空原包名。；仅待材料绑定：内容为 { 与 {} 的两个独立测试文件；当前规则不要求选文件立即报错或清空旧包名。                                                                              |
| 签名缺项与不匹配凭据              | 待补材料/候选 | 安卓、Google Play 商店、荣耀、AppGallery Connect、华为快游戏、OPPO、vivo | 缺项=关闭调试签名后临时留空一个实际必填签名字段；错误口令=仅 keystore 平台输入固定非生产值 qa_wrong_password；恢复=恢复匹配测试文件与原凭据；不展示原口令                                                                                                                                                                                         | Android/Google 自定义视图显示对应空项提示；AGC 当前仅检查可编辑与值，不要求相同提示；PEM 平台按其字段规则单列。；仅待材料绑定：匹配 PEM/keystore 与凭据。Android/Google 空项提示已明确；AGC 不套用相同提示；错误口令真实性不在本轮 UI 终点验证。 |
| API / ABI 实际候选与任务映射      | 待补材料/候选 | 安卓、Google Play 商店、AppGallery Connect、鸿蒙                         | API 基准=A0：材料/环境清单中的真实合法候选，不以当前读到什么就作为预期；API 切换=A1：另一真实合法候选；与 A0 的 UI 文本/内部值映射分别固定；API 约束=Android/Google 的 Instant≥23；Android TBB≥21；AGC SDK 复用 Android 校验函数，但其 UI 无 Instant/TBB；OHOS 独立。；ABI=仅 Android/Google 有实际 ABI 选择；arm64-v8a / 合法多选 / 另一合法单选 | API 显式选择后提交对应数字，ABI 为所选字符串数组；空 ABI 在 Android/Google 显示至少一项提示。；仅待本机候选绑定：A0/A1 与 ABI 实际可用列表；API 数字提交映射已明确，AGC 36→35 不是已确认的正常转换。                                             |

### 1958 源码确认的规则

| 配置               | 固定规则与检查点                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L10N               | 未启用/开发语言未初始化时不操作语言区。启用后下拉候选取可用语言与已配置 map 键的并集；取消目标只改 map，不收缩候选、不自动修正默认/回退。全部取消不禁用下拉，不等于跳过本地化。                                                                   |
| L10N 空目标        | 显式全 false 和省略/空 map 不同。已启用时仍进入 L10N；内部默认/回退不在选中集合时退回开发语言；显式 false 的开发语言键不会由补齐逻辑加入。只保留源码规则及 UI 恢复检查，不新增空目标任务或产物预期。                                              |
| AGC JSON           | 选文件写路径，不保证 UI 立即解析或改包名。前三组均主动填写匹配包名；钩子在构建前读取 JSON，非空 client.package_name 才覆盖包名。损坏 JSON 抛错；{} 可解析但包名为空，不覆盖旧值；不能要求 UI 必须立即拒绝或清空。                                 |
| Wasm               | 有原生模块时提供 wasm/asmjs/both。wasm/both 显示压缩；开写 brotli，关写 undefined，JSON 省略。隐藏不等于清除，切 asmjs 前先取消压缩。                                                                                                             |
| MD5 / CCONB        | MD5 父项关只隐藏子项且保留值，提交不因隐藏自动清空；CCONB 16/32 是普通样本，SDK 按阈值×KB 使用。未声明业务上下界；通用数值控件以 Number 转换，0/负值/小数不主动截断，清空转为 0。异常样本只检查 UI 与恢复，不提交构建。                           |
| 引擎预设           | 切换只改预设键并刷新模块，不自动清空已有覆盖。继承需明确选择 inherit-project-setting。                                                                                                                                                            |
| 原生 API / ABI     | 候选来自环境清单，显式 API 选择写对应数字，ABI 写字符串数组。AGC 没有已确认的 36→35 正常转换。Android/Google 的 API/空 ABI 条件提示与 OHOS 分开；AGC 内部复用部分 Android 校验不代表 UI 提供同名控件。                                            |
| 比例               | Android/Google：空值必填、非数值格式错误、数值低于 1.33 提示；Google 仅 Activity 关闭时校验。AGC 当前表单不做相同校验，Activity 开启时禁用比例并保留；Android 比例独立。                                                                          |
| 名称 / 版本 / 超时 | Android 包名与 Windows 可执行名有不同 SDK 格式规则，Windows 允许空。通用表单不保证编辑后统一失焦拦截或禁用构建。快游戏版本是字符串必填，无语义版本/整数范围规则；OpenPaaS 四项超时保留字符串，无数值化/范围校验。异常样本只做 UI 与恢复，不提交。 |
| 插件               | 微信/抖音/淘宝发布态启用插件时要求 builtin 类型（或未提供类型），当前 custom 不作为发布正向通过；微信额外有版本字符串禁用条件，不能套给抖音/淘宝。兼容分支需独立环境，不切当前引擎。                                                              |
| Bundle             | [] 表示全部；内置 main/internal 保留且不可取消。外部身份优先 UUID，否则 root；显式提交记录含 name/root/uuid（如有）/output。最终仅外部 B1 仍包含内置项。                                                                                          |
| Windows / NEXT     | Windows 编译参数固定 x64，不把 UI x86 后成功算 x86 编译。NEXT ARK 关闭加密并采用 ESM；旧表 MD5/远程禁用未确认为当前规则，AOT 无对应 UI 不补写。                                                                                                   |
| 内置服务           | 当前公共 schema 缺少完整控件声明，只有遗留处理/覆盖片段；不将其列为现有可点击字段，也不要求每个平台寻找。                                                                                                                                         |

来源为 1958 随包配置面板、L10N builder-view/entry，以及当前 SDK 平台 config、custom view、hooks；具体本地文件链接维护在 [JSON 来源](../tools/case-catalog/public-combinations.json)。按用户已确认口径，异常输入沿用当前实现，不额外新增产品限制；源码规则与真实 UI/任务执行证据分开。

## 保留回读、已定口径与待补前提

- 前三组的现有身份、默认图标、禁用签名、隐藏密钥、OHOS API 基准和 Windows Generator 基准仅保留回读，不算修改或候选切换覆盖。
- 公共 2D/缓存宏/基准预设、MD5 子项和 CCONB 普通 16/32 已有明确目标；前三组不主动操作 L10N。另一个预设、包装门槛、语言及材料分支在第四组。
- **三项口径已定**：调试组 Bullet（physics-ammo）；混合组按工程和平台适用性执行；异常输入按当前实现判定。前三组组合目标与第四组数值/版本/超时/比例场景据此固定，不再保留来源冲突或等待更强校验的决定项。
- **待材料/候选绑定**：两个真实 Bundle 与依赖、第二引擎预设/模块清单、环境实际 API/ABI/Generator 候选、匹配签名与应用身份、发布插件兼容环境。材料欠缺只阻塞对应场景，不改成规则未知或阻塞整个公共组。
- **不作为本轮执行义务**：空目标 L10N 构建、错误 JSON/口令构建、设备运行兼容、产物与签名发行。签名口令真实性不能由 UI 输入成功证明。

## 真正的材料前提

| 材料               | 需要绑定什么                                                                     | 影响范围                                                                |
| ------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| AGC 服务文件       | 已提供 agconnect-services.json，包名 com.testcases.cocos；测试机替换实际文件路径 | 三组明确填写匹配包名；错误样本另备 { 与 {} 的独立非敏感文件，本轮不创建 |
| OpenPaaS 账号/游戏 | 已登录账号的有效 G0；切换场景另需已有 G1                                         | 不新建游戏、不造 ID、无私钥填写项；缺 G1 不影响 G0 正向组合             |
| Bundle / 第二预设  | B0/B1 名称、root/UUID、依赖；P1 实际 ID 和模块清单                               | 仅资源/预设切换场景；不存在时不自动创建                                 |
| 真实环境候选       | 合法 A0/A1、ABI 集合、已安装 G1 Generator；插件分支的兼容引擎环境                | 不安装 SDK、不改 custom 设置；候选不足只阻塞切换侧                      |
| 文件与凭据         | 匹配 PEM/keystore、测试凭据、有效 PNG、所选 Catalog 与场景                       | 只影响对应第四组；不展示秘密，不修改原服务 JSON 或 Catalog              |
| 普通测试值         | 名称、合法包名、版本、2.0.1 运行时版本、超时、example.com URL 均已例内定义       | 不是材料缺口；只有构建实际访问服务时，该分支才增加服务前提              |

**合并安排**：正向图标/签名/应用身份/运行时文本在材料兼容时合入同平台第四组一次构建；语言双语与仅 en 的最终配置不同，分别提交，最多两项一组。前三组公共压缩及专属配置仍按原搭配，不新增组别。公共保存重开只由代表专项覆盖；空选择、异常输入及错误文件只做 UI 与恢复，不排入构建队列。

## UI 联动与执行安排（设计）

每次只走“配置输入 → 等待联动 → 最终回读 → 点击一次构建 → 核对唯一任务参数/终态/卡片”。普通组合直接提交，保存重开、名称校验、搜索、布局、历史搜索/筛选/折叠/统计等由公共 UI 专项在代表平台或已有记录上覆盖，不逐平台重复。

先父项后条件子项；需要关闭加密时在非调试态完成再打开调试。Google/AGC 的 Activity 开启后比例禁用，Android 比例仍能独立修改；Google GLES3 子项固定禁用，操作父组；淘宝隐藏文本先设置再隐藏，不后台补写。NEXT ARK 加密检查已确认限制侧，不把旧表其它限制套成当前禁用要求。以上规则在字段详情中保留。

确认后按组合批次组织可用平台，**每组最多两项**，逐项配置提交、组间等待收尾，再统一核对本组任务。代表平台补齐公共压缩额外模式：Web 桌面发布 `merge_dep`、OPPO 发布 `zip + remote + MD5`；平台专属变体尽量合并到已有公共配置，不额外重做公共 UI。已有合法 API/ABI/Generator 候选可以组合覆盖；缺候选只阻塞对应变体。

普通目标同值只做回读；需要真实变化的联动/保存专项必须记录初态，初态不满足不能声称变化通过。单项失败按原规则记录并继续不相关用例，连接失效等无法可靠观测时停止；不重建、不取消用户任务。OpenPaaS 只点击正常构建按钮，内部后续阶段由产品负责，按对应任务结果判定。

**交付边界**：四组定义已通过 `four-groups` 接入现有执行器，缺材料/候选与初态分支单列；前三组普通配置直接构建，第四组区分 UI 终点与构建终点。L10N 跨页面启用/恢复尚未适配，单列 ui-adapter 受阻，不冒充缺材料或已通过。当前试运行已覆盖各平台三组基础用例的处理，仍有真实构建失败和材料/环境受阻；变体与第四组未执行，不以历史结果证明新目标通过。

<details>
<summary>此前设计与历史执行依据（2026-10-20 本稿以前；不作为新组合目标）</summary>

以下保留旧批次、材料编号及结果，避免丢失溯源。旧文中的 52 项、A/B/C-local、原 8 平台、URL 必须另供材料等描述仅代表旧时方案；与上文冲突时以上文确认稿为准，不能按旧文替本稿记通过或直接执行。

# PinK 公共模式与平台专属用例设计

本页维护 Windows 构建成功阶段的参数、用例及平台差异。按测试组反馈和用户确认，当前覆盖方式为 **代表平台覆盖公共模式 + 各平台补专属选项和实现差异 + 必要联动补测**；R、D 是参数模板，不把“18 平台 × 两个组合＝36 次构建”当作固定计划。18个入口全部保留：D/A基础合同覆盖18平台，B/C-local仍限原8平台；基础回读、专属变化和实际执行证据分别维护。

当前D/A适用基础组合已接入18平台，B/C-local仍限原优先8平台；配置页基线、历史只读和九项本地选项的证据分别保留。新增10平台的当前值回读不等于专属变化通过：微信D与Android A已在1958包定向通过，其他新增D/A仍待执行。[其余10平台专属分支、公共复用与下一批安排](#其余10平台专属选项与条件分支2026-10-20定稿)维护当前缺口；以下旧版运行记录不倒填为新版通过。公共UI专项和三个代表平台合并用例仍待实现；新增10平台专属变化已实现并有独立结果，不据此宣布所有分支通过。本轮只校正用例数据、展示及说明，不改执行工具、不执行构建。

**OpenPaaS纳入18平台设计：补齐必填项、选择有效游戏ID并回读，不再将整个平台排除。** 2026-10-20已实现并验证1958包的专属配置模式；具体范围见下方OpenPaaS用例。通用配置专项仍不进入此页；普通构建已按用户新口径接入，内部自动阶段由产品负责，按本次任务最终结果判定，不修改SDK。

阶段、工具与已有单平台结果见[构建 UI 自动化设计](pink-build-ui-automation-design.md)。[现行业务用例](pink-regression-cases.md)仍维护 B01–B09、BC01–BC09 的完整定义；本页只细化其 UI、任务参数与构建成功部分，不据此宣布产物、运行、物理效果、图集或纹理效果通过。下文 C、Q、WD 等是本页的分支定位符，不替代业务用例编号。

## 合并验收集合（2026-10-20）

当前默认执行入口为 `run-build-ui.ps1 -Plan acceptance`，用例数据在 [acceptance-cases.ts](../tools/build-ui/src/acceptance-cases.ts)，与[执行说明](../tools/build-ui/README.md#默认验收合并组合2026-10-20)一致。页面默认组合由同一份数据生成；保留的旧批次供独立回归选用，不作为每轮串行追加的固定步骤。

执行顺序为调试 18 项 → 发布 18 项 → 原 8 平台选项变化 → 原 8 平台选项返回，共 52 项。原 `local-options-nine` 和 `special-options-ten` 的已实现目标已合入；不额外叠加 existing、原 D/A/B/C 或这两个独立计划。各平台 D/A 的适用字段继续保留，压缩模式就在组合中设置并核对。

| 合并位置               | 本组合目标                                                                                            | 初态要求                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Web 桌面发布/变化/返回 | Source Map 关闭/独立/内联，并合入原公共开关及对应压缩模式                                             | 普通目标配置，不要求机械执行前一份历史命令                                                                        |
| Web 手机发布/返回      | WebGPU 开启/关闭，合入平台方向与调试器配置                                                            | 返回侧要求当前已开启，整轮来源为发布项；单项按当前 UI 核对                                                        |
| OPPO 变化/返回         | 分离引擎开启/关闭，合入该平台 B/C 公共与元数据配置                                                    | 返回要求当前已开启，整轮来源为变化项                                                                              |
| 淘宝发布/变化/返回     | 填写文本 → 开启适配并隐藏保留文本 → 关闭适配清空文本；变化项同时 Wasm/Brotli，返回 asmjs 前先关闭压缩 | 保留三个真实变化用例的明确初态；不满足即受阻，不补写隐藏值                                                        |
| 新增十平台发布         | 复用已实现的专属选项最终目标，与该平台 A 公共选项合并                                                 | 作为目标配置，不宣称本次一定发生变化。条件子项按父项实读决定是否出现；账号、签名及 API/ABI/Generator 守卫继续保留 |

公共 UI 专项独立执行，保存/关闭重开由代表平台覆盖；各平台的身份、就绪、最终选项及任务参数随构建项检查，不再逐平台先做一轮公共开关往返。已实现的公共 exercise 只检查对应开关的保存恢复，不等于完整公共 UI 专项通过；历史只读继续使用版本匹配的已有记录。

普通目标配置可以从任一合法状态设置目标，当前同值只回读；变化专项记录初态并确认目标变化，初态不满足不能算通过。结果中的 `sourceCaseIds` 是设计沿用关系，不是给旧用例自动记通过；独立重跑不自动补前序构建。每项仍分别核对 UI、入队、终态参数与成功卡片。每组最多 2 项、普通失败继续、安全观察中断停止的既有规则保留。

三个待实现组合、材料分支和不适用项均未偷偷纳入执行。原 340 条目录源记录及历史证据保留，71 个原独立构建入口移出默认浏览组合，3 个计划组合继续在设计中保留。页面新增 52 个合并组合定义；本次只静态与离线验证，未连接 PinK、未提交构建，不能由旧结果推定新集合通过。

## 当前 UI 校正（1958 包，2026-10-20）

以 PinK `0.0.2.0 / 2610191958`（commit `c110e3c05dacc7eb67d6f9d4ff48fc20c6d10372`）和当前 custom SDK（CLI `0.2.0-beta.0`、engine `4.0.0-beta.0`）为准。实见目录为 X-Device 7 项、X-Application 11 项；不加入 SDK 目录中存在但当前 Windows UI 没有的 mac、ios 等平台。字段身份来自[17平台当前页](../results/2026-10-20T08-16-36-302Z-configuration/result.json)、[OpenPaaS展开记录](../results/2026-10-20-current-platform-audit/openpaas-and-platforms.json)和[当前卡片目录](../results/2026-10-20-current-platform-audit/platform-cards.json)，取证时的控件值不充当组合目标或出厂默认值。

| 平台/项目                            | 当前准确用例规则                                                                                   | 修正方式                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| OpenPaaS / 3000+ 平台                | 版本名、方向、已有游戏选择；展开网络超时后有四个文本输入。私钥路径及内部加密密钥被自定义视图隐藏   | 从当前字段清单移除私钥；游戏控件绑定 `packages.openpaas.appid`，不能当任意 AppID 文本输入。代码版本只随所选游戏回读，不作为可编辑字段 |
| vivo                                 | 包名、方向原生 select、调试秘钥库及两条签名路径是实际自定义控件。AppID/AppKey/分离引擎当前没有控件 | 合并重复映射；VI-Q05/VI-Q06 当前不适用。私钥/证书路径仍保留，调试签名开启时禁用，不套用 OpenPaaS 的移除规则                           |
| Web 桌面 MD5 子项                    | 完整路径 `md5CacheOptions.handleTemplateMd5Link`；位于 MD5 父项行内，无独立 data-option-key        | 三个计划用例修正路径。父项关闭隐藏子项、表单保留值；任务隐藏值表示仍待核清，这三项仍未实现/未执行                                     |
| Android / Windows / OHOS / NEXT 加密 | 调试模式限制加密交互；密钥/压缩仅在加密开启后出现；关闭加密清压缩。NEXT ARK 内部关闭加密           | 每个组合注明操作前提，禁用/保留值不算加密正向覆盖；不修改引擎选择                                                                     |
| 微信插件                             | 当前 beta 环境控件禁用                                                                             | 当前检查禁用与说明；开启侧要求兼容环境，不自动切换，不把抖音的规则套到微信                                                            |
| Google Play / AGC                    | 调试签名开启禁用四条凭据；Activity 开启禁用比例及自定义比例输入                                    | 按组合父值显示限制，父值沿用时先回读；Android 比例仍独立可编辑                                                                        |
| Google Play 控件身份                 | 两个真实包名入口共享一份 packageName；GLES 2/3 父开关与固定禁用的 GLES3 子项不同                   | 两个包名入口关联同步专项；不重复算作两个配置项，不点击固定子项代替父项                                                                |
| Google Play Instant / 淘宝全局变量   | Instant 关闭隐藏地址；淘宝全局适配开启隐藏文本、保留原值                                           | 条件出现后才操作，隐藏值不补写；固定目标与当前沿用值分开                                                                              |

OpenPaaS 的 `configuration.openpaas.inspect/exercise` 两条旧通用入口、vivo 的 `branch.VI-Q05/VI-Q06` 从当前可浏览清单移出，原 ID、步骤及历史证据仍留在目录源数据。OpenPaaS 当前使用专属 `design.openpaas.1～7`；通用入口的旧拦截不代表平台整体受阻。打开该页会由产品刷新游戏/账号上下文，不能要求偏好文件逐字节不变。

目录保持“平台 → 组合/专项 → 步骤与预期”。原 340 条目录记录含用例族、汇总及分支，74 个原组合含 3 个未实现设计；这些均不代表执行通过数。默认浏览与执行现已采用上节合并集合，历史记录继续保留。生成器拒绝无当前 UI 绑定的目标字段，排除当前不适用条目；当前可见不等于所有条件分支已实机验收。本次没有运行产品测试、没有修改历史结果，也没有提交构建。

## 参考规则与历史证据

参考[测试组 qa-process.md](https://github.com/cocos/3d-tasks/blob/master/tests/qa-process.md#测试组合)，2026-10-16 读取的文件 blob 为 `1385172cc54db6bd134ca79d994862538cdc599c`。原文按发布、调试、混合三组场景安排，并按工程和平台给出例外；普通工程主要执行前两组，物理工程另有要求。本页采用前两组的构建配置思路，保留实际 PinK 不支持、工程不适用和规则待确认的差异，不将历史 Creator 规则直接当作当前 PinK 合同。

| 证据         | 本页采用的范围与上限                                                                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 打包版       | PinK `0.0.1.39`，Builder 随包清单 `0.0.1`；当前中文 Windows UI                                                                                                                                                                                                                |
| 实际 SDK     | 最初取证日志为引擎 `4.0.0-alpha.34`、CLI `0.0.1-alpha.42`；2026-10-19 配置中的引擎选择为 `4.0.0-alpha.35`，当时源码核对来自该SDK；本节为历史样本，本轮10平台结论来自1958包所用custom beta.0 SDK。配置选择不等同于整个构建所消费编译器的运行时指纹，旧通过不改记为新版回归通过 |
| 测试工程     | `D:/PinK-test/l10n_007`，实际场景为 `assets/scene-2d.scene`、`assets/cases/audio/audio.scene`；本轮沿用，不制作新工程                                                                                                                                                         |
| 平台配置证据 | 2026-10-16 逐一从 UI 打开 18 个卡片，被动读取页面收到的配置/schema/校验响应并读取控件；未提交构建                                                                                                                                                                             |
| 初态来源     | 组合设计初始取证复用同包 UI 快照及未变更的偏好；下述默认值属于修改组合前的记录，不作为运行后的当前偏好                                                                                                                                                                        |
| 保存偏好     | 初始取证时仅 `web-desktop`、`openpaas` 有平台偏好；D 组合运行会经 UI 保存其他目标平台偏好，不清空或恢复                                                                                                                                                                       |
| 运行证据     | 原配置 web-desktop 已实包跑通；本轮 D 组合结果统一见[构建设计的实机记录](pink-build-ui-automation-design.md#调试组合工具与实机验证)，A 轮证据见下方记录，不扩大到其他 R 模式或其余 10 平台                                                                                    |

默认值需要区分三层：SDK 接口通过 `builder.getProject` 取得当前工程配置，平台偏好在其上覆盖，配置页再补齐场景及防撞输出名。不能把有保存偏好的页面称为纯出厂默认值，也不清理用户偏好来制造默认态。

修改组合前记录的共用初态为：名称 `l10n_007`、路径 `project://build`、Debug 开、MD5 关、主包远程关、资源服务器为空、主包压缩 `merge_dep`、跳过纹理压缩关、自动图集开。SDK 原始初始场景为空、场景列表为空；配置页实际补为 `scene-2d`，只选中该场景。输出名随已有任务和目录自动避让，不固定数字后缀。

## 两份新增QA材料的适用条件（2026-10-19）

本节是参考条件，不授权执行表格中的命令、账号登录、上传、安装、删除或环境改动。未复制原件或凭据到PinK-Test；原件位于用户本机缓存，交接时应由QA指定稳定共享位置。单元格范围仅用于查找原说明，不把历史参数照搬为当前PinK预期。

| 新材料                                                                                                                                     | 定位                                                                                     | 对本轮的补充及边界                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [各个平台流程原件](<C:/Users/Administrator/Documents/WXWork/1688855233950622/Cache/File/2026-10/CocosCreator 各个平台测试流程文档.xlsx>)   | Web Desktop A8:C13；Win32 A11:B11；微信 C21:C26；字节跳动 C15:D19；淘宝 B6:B15；vivo B15 | WebGPU/分辨率、原生渲染/调度/生成平台、插件和物理条件需各自覆盖；文档混有2.x/3.8.x和设备运行要求，不自动成为本阶段build前提 |
| [3.x原生流程原件](<C:/Users/Administrator/Documents/WXWork/1688855233950622/Cache/File/2026-10/CocosCreator3.x 原生平台测试流程文档.xlsx>) | 测试组合 A1处嵌入图及A31；Android A3:B7；harmonyos-next A10:B17；openharmony B10:B22     | 补充Cannon/2D Box2D、渲染后端/ABI、JSVM/V8/ARK和ARK例外；IDE编译、签名安装、真机运行另列下期，不纳入当前成功判定            |

- 新表组合二指定Cannon，现有D为Bullet（physics-ammo）；D成功不能标作新表组合二已完整通过。2D Builtin/Box2D、Cannon/PhysX候选按当前模块能力补UI/参数/build兼容；物理效果另需专用工程。
- NEXT需分别设计JSVM/V8/ARK。表中ARK对远程包、MD5、AOT、WebSocket server的限制是待当前SDK复核的适用矩阵；尚未核实的分支记待规则确认，不直接套全部R/D公共值，也不把未在UI出现的选项当成可点控件。
- Android当前自定义UI源码含ABI至少一项、TBB与API>=21、Instant与API>=23等校验；需核对真实候选和提示，不使用旧表API18/旧Node/旧IDE要求替代本版合同。API查询为空时，合法选择分支受阻，禁止伪造列表。
- 微信当前自定义UI按引擎版本是否为正式semver控制插件可用性；alpha.35快照为禁用。不能沿用旧表“Debug时隐藏”解释所有状态。禁用/提示可测，启用侧需匹配正式SDK；插件与Wasm包装、压缩还须分别核对。
- 原生build当前会生成原生工程；具体SDK、模板、CMake/VS要求应沿当前钩子及生成路径判断，不能一律当成make才需要，也不能把真机、签名安装或IDE运行要求全前移。Windows当前UI有x86/x64，但SDK `dist/core/builder/platforms/windows/src/hooks.js:onAfterInit` 将targetPlatform写为x64，不能只凭UI/入参声称x86支持；NEXT引擎矩阵仍待核。
- 淘宝旧表的方向/必须远程、微信/抖音的调试例外须区分运行约束与PinK本地build兼容。既有本地或方向入参证据不据旧表撤销，也不由本地build成功推定平台运行可用。抖音旧PhysX专属控件、华为旧自定义manifest、旧Link/Default模式等，先判当前UI是否提供。
- 原表中的URL、AppID和账号仅作为候选索引；有效性、平台绑定和测试用途需QA确认。不在设计文档复写密码/密钥，也不据表格自动连接外部服务。

## 发布 R 与调试 D

以下定义组合期望。平台差异表覆盖本表的通用值，未列字段不额外修改；当前工具记录所操作字段及任务参数白名单，不宣称快照包含所有专属字段。运行后的实际值以结果 JSON 为准，不能把上一组合修改后的值当作下一组合的默认值。

| 配置 / PinK 字段                                                 | 发布 R                                                                 | 调试 D                                                                             | 当前映射与材料边界                                                                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 名称、场景、输出                                                 | `l10n_007`；初始场景 `scene-2d`，场景列表只选该场景；`project://build` | 与 R 相同                                                                          | 复用当前已保存场景；替代参考文档的 `testlist`，不声称执行了原测试工程                                                                                          |
| Debug / `debug`                                                  | `false`                                                                | `true`                                                                             | 微信、抖音存在参考文档例外，见差异表；不将 D 自动改成关闭 Debug 后仍算调试覆盖                                                                                 |
| MD5 / `md5Cache`                                                 | `true`                                                                 | `false`                                                                            | D 的微信、抖音、支付宝改为 `true`；凡采用远程主包，MD5 保持开启                                                                                                |
| 主包远程 / `mainBundleIsRemote`                                  | 本地发布 R-L 为 `false`；Zip / 远程分支 R-S 为 `true`                  | `false`                                                                            | Debug 关闭不要求主包远程；主包 Zip 必须远程，小游戏分包必须本地。D 的微信、抖音、支付宝另有例外                                                                |
| 资源服务器 / `server`                                            | R-L 为空；R-S 为 QA 专用测试根 URL，记为 S                             | 空字符串                                                                           | 缺 S 只阻塞远程 / Zip，不阻塞本地发布。S 约定以 `/` 结尾，核对平台规范化；不填假地址、不沿用未知生产地址，不部署或核验远程产物                                 |
| 主包压缩 / `mainBundleCompressionType`                           | 按平台表；Web/原生采用无压缩，小游戏通常合并所有 JSON，支付宝合并依赖  | 按平台表；支持时小游戏分包，否则合并所有 JSON；微信、抖音、支付宝明确合并所有 JSON | 参考文档的 Zip→None、Subpackage→Merge All Json 分支须结合当前可选枚举；不能运行时悄悄替换不支持的值                                                            |
| 纹理压缩 / `skipCompressTexture`                                 | `false`，不跳过                                                        | `true`，跳过                                                                       | 与参考文档 CompressedTexture 的勾选方向相反；Web 手机端未显示控件，保留初态并标未覆盖                                                                          |
| 自动图集 / `packAutoAtlas`                                       | `true`                                                                 | `false`                                                                            | Web 手机端未显示控件，保留初态并标未覆盖；不能通过隐藏字段写入替代 UI 操作                                                                                     |
| 初始场景资源 Bundle / `startSceneAssetBundle`                    | 显示时 `true`                                                          | 显示时 `false`                                                                     | 当前仅微信、抖音、支付宝、OPPO、vivo、荣耀、华为快游戏、淘宝显示；其余 10 个记为 UI 不适用                                                                     |
| 3D 物理覆盖 / `overwriteProjectSettings.includeModules.physics`  | Builtin，对应 `physics-builtin`                                        | Bullet，对应 `physics-ammo`                                                        | 当前 UI 有物理系统控件，SDK 模块目录含两个 ID；执行时仍须核对实时下拉候选。当前场景未发现 RigidBody/Collider，覆盖仅限模块选项入参与构建兼容，不含物理功能验收 |
| 2D 物理覆盖                                                      | 保持 `inherit-project-setting`                                         | 保持 `inherit-project-setting`                                                     | 原文只要求在 2D/common 工程切换 Builtin/Box2D；当前工程不是该材料，不新增该分支                                                                                |
| WebGL 2.0 / `overwriteProjectSettings.includeModules.gfx-webgl2` | Web 与小游戏开启 `on`；支付宝、抖音、淘宝为 `off`                      | 与 R 相同                                                                          | `off` 对应本页 WebGL1 分支；原生目标保持当前 `off`，记录实际原生后端，不用 WebGL 开关冒充 Vulkan/GLES 覆盖。开启 WebGL2 不代表排除兼容后端                     |
| Polyfills / `polyfills.asyncFunctions`                           | 不操作                                                                 | 不操作                                                                             | 当前 18 个 schema 均隐藏 Polyfills，页面未显示；参考文档的“如果有”分支记为未覆盖，不能使用 API 强开                                                            |
| 其他字段                                                         | 保留并记录                                                             | 保留并记录                                                                         | Source Map、L10N 语言、WebGPU、原生代码包装、平台专属签名和版本等不随 R/D 额外变化；自动生成名称单独记录                                                       |
| 后续阶段                                                         | 构建按钮不链接生成、运行、上传或发布                                   | 与 R 相同                                                                          | 非OpenPaaS保持既定阶段限制；OpenPaaS正常按钮的内部自动阶段已核实并获确认，按整项任务最终结果判定，不额外点击阶段按钮                                           |

R 的“发布”指本组合的非 Debug 构建配置，不代表商店发布或生产签名。Android/AGC/Google Play 保留调试 keystore，快游戏保留调试密钥；不要求为了关闭 Debug 改成正式证书。本轮也不点击独立的“生成”“运行”“发布”按钮。

当前工程没有 `testlist`，未发现自动图集 `.pac` 或已配置纹理压缩的材料。本阶段仍可检查可见开关和任务参数并等待构建成功；不能宣称实际经历了图集合成或纹理压缩分支。完整图集、压缩纹理、物理功能材料继续由[材料设计草案](pink-test-project-design.md)及原业务用例维护，本轮不制作。

## 公共模式与 8 平台完整分支清单

### 判定、已有覆盖与字段范围

每个提交单元有独立的平台、参数模板、分支集合和最终预期。下述步骤是逐用例判定要求，不要求等上一项构建完成再提交下一项；批次调度与超时事实统一见[队列执行设计](pink-build-ui-automation-design.md#逐个提交与统一收集)。统一步骤为：**核对身份及任务基线 → 从左侧分类入口打开新配置 → 真实 UI 设置 → 等待联动并完整回读 → 保存专项按需重开 → 点击一次构建 → 唯一关联新任务 → 核对入参 → 任务和对应卡片成功**。配置保存不等于构建通过；组合通过也不等于产物效果通过。

状态使用“已通过”“待测”“缺材料”“待规则核实”“UI 未覆盖”“范围外”。待测不表示当前工具已实现；缺材料只阻塞对应分支，不能删项、静默换值或把部分通过记成整项通过。每次合并构建仍须逐字段保存预期、UI 值、任务值及差异。

交付同时标注实现状态和执行证据：**已实现**表示当前工具有对应动作及判定；**待实现**表示仅有设计或现有适配不足；**缺材料**只指已明确缺少的有效输入；**待合同/环境核实**不等同于缺材料。一个分支可以同时待实现、缺材料。旧版通过、失败、受阻和未执行分别保留；设计定稿不要求本轮重跑，已有代码也不自动算新版通过。

D 公共参数复用基线为 [2026-10-16 D 批次结果](../results/2026-10-16T10-27-46-357Z/result.json)，PinK `0.0.1.39`、上述 SDK / 工程，8/8 通过：

| 平台                | D 已核对的公共模式 | 已通过的其他公共入参                                                             | D 执行时专属状态              |
| ------------------- | ------------------ | -------------------------------------------------------------------------------- | ----------------------------- |
| `web-desktop`       | `merge_all_json`   | Bullet、WebGL2 on、Debug on、MD5 off、主包本地、服务器空、跳过纹理压缩、图集 off | 全部待测                      |
| `web-mobile`        | `merge_all_json`   | Bullet、WebGL2 on、Debug on、MD5 off、主包本地、服务器空                         | 全部待测；纹理/图集控件未覆盖 |
| `oppo-mini-game`    | `subpackage`       | 同 web-desktop，另有初始场景 Bundle off                                          | 全部待测                      |
| `vivo-mini-game`    | `subpackage`       | 同 OPPO                                                                          | 全部待测                      |
| `honor-mini-game`   | `subpackage`       | 同 OPPO                                                                          | 全部待测                      |
| `huawei-quick-game` | `subpackage`       | 同 OPPO                                                                          | 全部待测                      |
| `taobao-mini-game`  | `subpackage`       | 同 OPPO，但 WebGL2 off                                                           | 全部待测                      |
| `fb-instant-games`  | `merge_all_json`   | 同 web-desktop                                                                   | 全部待测                      |

上述 D 已有完整回读、重开、任务和卡片证据；不因整理新批次重复执行。原配置 web-desktop 结果只复用接入链路，不把旧初态 `merge_dep` 推定为已完成独立模式核对。D 批次当时未读取平台 `packages` 专属字段白名单，其“保留默认值”不能算专属基准通过；新增 A 轮使用独立字段预期及白名单读取，结果另列，不能倒填 D 的覆盖。

本清单的公共模式范围为上表 R/D 字段、5 种主 Bundle 压缩以及淘宝需要的条件 Wasm 压缩；平台专属设计按早期通用表单取证列出 63 个叶字段；A 轮实际 vivo 加载自定义表单，仅显示 9 项，AppID/AppKey/分离引擎 3 项记 UI 未覆盖，本次实际回读共 60 项。保留这 3 项的设计与材料分支，不使用 API 补写或用任务值代替 UI 证据。混淆属性名保留17平台exercise保存往返证据；本批Web桌面已补五个公共开关变化/返回及Source Map三态的UI、任务入参和构建成功。除既有mangle保存外，其他新字段独立保存专项未做；CCONB分组、引擎预设、缓存清理宏、2D物理及L10N附加字段仍有候选值专项缺口。旧60项只统计当时的专属字段白名单，不是全部可见控件总数。独立 Bundle 编辑、场景增删、原生代码包装的完整枚举也不在本轮已确认的模式清单中；不会把专属项完整覆盖写成整个构建面板全参数覆盖。

### 公共模式用例

R-L / R-S 的固定值来自前述 R 表，差异仅在主包远程及服务器；其他非目标公共字段保留记录。每个模式先选代表平台，平台能力或钩子不同才增加差异单元，代表结果不伪装成未执行平台的逐组合通过。

| 分支                | 模板、代表及独立预期                                                                          | 合并构建位置                                           | 已有覆盖 / 待测与前提                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 无压缩          | Web 桌面，R-L，`none`                                                                         | Web 桌面 A 轮                                          | A 轮 Web 两端已通过；Web 手机同时取得平台发布兼容证据，不要求 Facebook 再跑 none                                                                    |
| C02 合并依赖        | Web 桌面，R-L，`merge_dep`                                                                    | Web 桌面 B 轮；与非默认分辨率合并                      | B 轮 Web 桌面已通过 UI/任务参数及构建成功；无新增外部材料                                                                                           |
| C03 合并全部 JSON   | Web 桌面，R-L，`merge_all_json`                                                               | Web 桌面 C 轮；小游戏 A 轮也用此模式                   | D 在 Web 两端/Facebook 已通过；A 轮 R 在六个小游戏已通过，Web桌面R代表的C-local已通过UI/任务参数和构建成功                                          |
| C04 Zip             | OPPO，R-S，`zip`、远程 on、MD5 on、S 非空                                                     | OPPO C 轮；可合并方向/分离引擎返回分支                 | 缺 M01；其他四个支持 Zip 的平台不无差别重复，出现平台钩子差异再补                                                                                   |
| C05 小游戏分包      | OPPO，R-L，`subpackage`、远程 off、服务器空                                                   | OPPO B 轮，保持分离引擎 off，避免与新分离引擎分支混测  | D 在五个小游戏均通过；B 轮 OPPO 的 R 分包代表已通过。其他平台 D 的钩子差异证据保留                                                                  |
| C06 发布公共参数    | R-L；Debug off、MD5 on、Builtin，其余按 R 表与平台适用性                                      | 8 平台 A 轮；不额外做一遍同值“纯发布”                  | D 对应值已通过；R 的 A 轮 8 平台已通过。缺 S 不阻塞这一轮                                                                                           |
| C07 纹理、图集      | 可见时 R 的 `skipCompressTexture=false`、`packAutoAtlas=true`；Web 手机不操作                 | A 轮同时覆盖控件与入参；M05 补齐后再补实际处理路径构建 | D、A 轮 R 的适用 UI 与入参均已通过；Web 手机未覆盖。实际处理路径缺 M05，不能由无样本的成功填补                                                      |
| C08 初始场景 Bundle | OPPO R 为 true，与 D false 对照；其他四个平台 A 轮各自核对                                    | 五个小游戏 A 轮                                        | D false 已通过；A 轮 R true 在五个小游戏已通过。Web/Facebook 隐藏，不补写                                                                           |
| C09 远程 / 本地转换 | OPPO C04 后返回 C05 或 `merge_all_json` 本地，服务器清空、MD5 保持 R 值                       | OPPO D 轮可与专属返回分支合并                          | 待测，远程侧缺 M01；平台规范化的尾部 `/` 单独比较                                                                                                   |
| C10 条件 Wasm 压缩  | 淘宝，分离引擎 off；存在原生模块时经 UI 选 `nativeCodeBundleMode=wasm`，压缩开/关，再回 asmjs | 淘宝 B / C 轮；只在实际可见时设置                      | B 开启侧 UI、重开和入队 brotli 已通过；同次构建在引擎编译阶段 Babel filename 错误失败，未计构建成功。C-local关闭/回asmjs已定向补测通过，旧B失败保留 |

已知联动先集中检查 UI，再只为合法最终状态构建：

- L01 压缩与远程：Zip 必须远程、subpackage 必须本地。Zip→subpackage 先回 `merge_all_json`，关闭远程并清 S，再选 subpackage；反向先退出 subpackage、填 S 并开远程，再选 Zip。无效中间态不提交，产品自动校正的值按明确规则核对。
- L02 Wasm 控件：源码中存在原生模块且包装模式非 asmjs 才显示压缩；隐藏、出现及退出的 UI 检查可不构建，但要声明只覆盖 UI。隐藏后值保留或清除规则若未核实，不能自定预期；不读写隐藏控件补覆盖。
- L03 淘宝分离引擎与原生代码分包：钩子计算 `WASM_SUBPACKAGE = wasmSubpackage && !separateEngine`。两者同时选中不代表两条路径都生效；分别构建 TA02 与 TA03 的合法组合，不把一次同时开启算双覆盖。
- L04 文件与签名：自定义密钥必须先提供匹配文件，再关闭调试密钥；回到调试密钥时核对最终值，不假设产品必然清空文件路径。不进入 make、run 或上传以验证真正签名。

### 专属选项用例：Web 与 Facebook

专属字段的完整路径统一为 `packages.<平台 ID>.<字段>`。下列 A 轮基准已通过，B 非默认侧的实际结果见文末与构建设计，不缺材料的C-local返回已有逐平台成功证据；基准成功不代替整个选项变化覆盖，材料分支仍保留。文本候选、日志等级及版本候选执行前须经过当前 UI/SDK 校验，校验不过记受阻，不用候选值冒充平台线上许可。

| 分支 | 平台及叶字段                                                 | 明确的操作 / 预期                                                                                                             | 合并位置与材料                                                         |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| WD01 | Web 桌面 `useWebGPU`                                         | A=false → B=true → C=false；每次回读、任务值一致并构建成功，保存重开专项单列                                                  | A/B/C 与 C01/C02/C03 合并；只验证构建兼容，不要求运行浏览器或 GPU 效果 |
| WD02 | Web 桌面 `resolution.designWidth`、`resolution.designHeight` | A=1280×960 → B=960×640 → C=1280×960，两项分别核对                                                                             | 与 WD01 同三次构建；无新增材料                                         |
| WM01 | Web 手机 `orientation`                                       | A=`auto` → B=`landscape` → C=`portrait`；覆盖三个枚举                                                                         | Web 手机 A/B/C；不为每个字段再单独构建                                 |
| WM02 | Web 手机 `embedWebDebugger`                                  | A=false → B=true → C=false                                                                                                    | 与 WM01 合并；不验证 VConsole 运行效果                                 |
| FB01 | Facebook `orientation`                                       | A=`portrait` → B=`landscape` → C=`portrait`；旧记录按文本适配；2026-10-19快照为combobox，后续按当前枚举定位，不沿用旧控件类型 | Facebook A/B/C；无新增材料                                             |
| FB02 | Facebook `embedWebDebugger`                                  | A=false → B=true → C=false                                                                                                    | 与 FB01 合并；不要求 Facebook 登录、开发工具或上传                     |

2026-10-19配置快照已在Web手机自定义视图中记录可见、可操作的 `WEBGPU` 复选框，源码绑定 `packages.web-mobile.useWebGPU`。更正旧“实际表单未出现”：本批已经真实UI完成开启和关闭返回、入队/终态参数及成功卡片核对。预览地址当前unavailable，因此HTTP/HTTPS警告条件不计覆盖；不打开预览。不能用Web桌面WD01替代，也不能因自定义行缺data-option-key而漏项。

### 专属选项用例：四个快游戏平台

以下 Q 模板分别实例化为 `OP-Qxx`（OPPO）、`VI-Qxx`（vivo）、`HN-Qxx`（荣耀）、`HW-Qxx`（华为快游戏），每个平台独立判定；相同字段名不代表平台钩子相同。A 轮基准值显式回读，B/C/D 覆盖变化及返回。A 轮可见字段基准已通过，B 已审阅变化的实际结果见构建设计，不缺材料的C-local返回已通过，D收尾及材料分支仍待测。vivo 自定义表单未显示 VI-Q05 和 VI-Q06，明确记 UI 未覆盖，不把 D 旧任务当作专属基准证据。

| 分支模板         | 叶字段与独立预期                                                                                                                                                                        | 适用平台          | 合并位置 / 当前前提                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q01 身份与版本   | `package`、`versionName`、`versionCode`、`runtimeVersion`。A 用该包基准值；后续改成各平台独立的 `com.pink.qa.<oppo/vivo/honor/huawei>`、`1.0.1`、`2` 及 QA 合法运行时版本，四项逐一核对 | OP / VI / HN / HW | 非默认值并入 B；B 的 runtimeVersion 保留 2.0.0，非默认运行时版本由 M06 核定。其他元数据不因此整体阻塞                                                                                                        |
| Q02 图标         | `icon`，SDK 默认图标 → 自定义 PNG → 默认图标；记录最终路径及任务入参，不检查拷贝产物                                                                                                    | OP / VI / HN / HW | 自定义侧缺 M02；可并入 B，返回并入 C。路径解析先只读取证，不通过修改 SDK 使其可用                                                                                                                            |
| Q03 方向         | `deviceOrientation`，`portrait` → `landscape` → `portrait`；OP/HN/HW 为文本控件，当前 vivo 自定义 UI 为原生 select                                                                      | OP / VI / HN / HW | A/B/C；无新增文件                                                                                                                                                                                            |
| Q04 签名配置     | `useDebugKey`、`privatePemPath`、`certificatePemPath`。调试密钥 true → false + 匹配测试文件 → true；两个路径分别核对                                                                    | OP / VI / HN / HW | 自定义侧缺 M03；并入 C，返回可并入 D。只覆盖配置传递与 build，不宣称真实签名或正式发行通过                                                                                                                   |
| Q05 应用参数     | `appid`、`appkey`，空值基准 → 合法测试对 → 空值返回；有包名绑定时以 M04 的匹配包名覆盖 Q01 候选                                                                                         | OP / VI / HN / HW | VI 当前 UI 未显示；其余平台 A 空值基准通过，非空侧缺 M04；可并入 B，返回并入 C。AppKey 仅在内存比较，结果只保存脱敏匹配状态                                                                                  |
| Q06 分离引擎     | `separateEngine`，false → true → false；读取由平台钩子明确改写的相关公共参数，不静默修正用例期望                                                                                        | 仅 OP / VI / HW   | OP/HW A=false 已通过；VI 当前 UI 未显示；HW 可 B=true、C=false；OP 的 B 留给 C05，C 再开、D 关。HW开启/关闭、OP C开启及九项批次中的关闭返回均已完成本地build；VI无控件继续UI未覆盖，不证明插件有效或make成功 |
| Q07 最低平台版本 | `minPlatformVersion`，荣耀 number 1080 → 候选 1081；华为 string `1103` → 候选 `1104`；必须保留实际字段类型                                                                              | HN / HW           | 并入 B，返回并入 C；B 使用 1081（number）/1104（string）完成 UI、参数和本地构建验证，不要求安装对应手机系统                                                                                                  |
| Q08 全屏         | `fullScreen`，true → false → true                                                                                                                                                       | HN / HW           | A/B/C；不验证实际屏幕显示                                                                                                                                                                                    |
| Q09 日志等级     | `logLevel`，`log` → 候选 `warn` → `log`，按当前文本控件与平台校验规则核定候选                                                                                                           | HN / HW           | A/B/C；B 使用 warn 完成 UI、参数和本地构建验证；不宣称设备日志效果或平台线上许可                                                                                                                             |

完整字段映射：

| 平台       | 模板实例集合          | 可见专属叶字段数   | 当前缺口                                                                                              |
| ---------- | --------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- |
| OPPO       | OP-Q01～Q06           | 12                 | A/B及C元数据/方向返回已通过；分离引擎C开启成功、本批关闭返回已通过；M02/M03/M04和非默认运行时版本保留 |
| vivo       | VI-Q01～Q06           | 9（原通用表单 12） | A/B及C元数据/方向返回已通过；Q05/Q06无控件保持UI未覆盖；图标、签名及非默认运行时版本待材料/规则       |
| 荣耀       | HN-Q01～Q05、Q07～Q09 | 14                 | A/B及C已审阅变化/返回通过；材料及非默认运行时版本待补；无HN-Q06控件                                   |
| 华为快游戏 | HW-Q01～Q09           | 15                 | A/B及C已审阅变化/返回、分离引擎两侧本地build通过；材料/非默认运行时版本待补，插件实际可用性未验证     |

Q01 的包基准分别为 `com.oppo.cocos` / `com.vivo.cocos` / `com.honor.cocos` / `com.huawei.cocos`，版本名 `1.0.0`、版本号 `1`、运行时版本 `2.0.0`。这只是设计取证时的合法代表，执行前核对最新保存初态；不清偏好制造出厂默认。

### 专属选项用例：淘宝

| 分支              | 叶字段与操作 / 预期                                                                              | 合并位置                                                                   | 状态 / 前提                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TA01 方向         | `orientation`，A=`portrait` → B=`landscape` → C=`portrait`                                       | 淘宝 A/B/C                                                                 | A 竖屏基准通过；B 横屏 UI/重开/入队确认，同次引擎编译失败；C竖屏返回已定向补测通过；当前UI横/竖两项，运行支持范围不由build通过推定 |
| TA02 原生代码分包 | `wasmSubpackage`，A=false → B=true → C=false；全过程 `separateEngine=false`                      | B 与 TA01 / C10 开启侧合并，C 与返回侧合并；控件与模块前提不满足时拆开 C10 | A=false 通过；B=true UI/重开/入队确认，同次引擎编译失败；C=false定向补测通过。当前模块满足控件前提，未验证 Wasm 分包产物或实际效果 |
| TA03 分离引擎     | `separateEngine`，A=false → D=true → E=false；D/E 固定 `wasmSubpackage=false`，使用 R-L 非 Debug | 单列 D/E，避免与 TA02 互相抑制；可合并尚未覆盖的元数据返回                 | A=false 基准通过；开启侧待规则核实：文案要求正式引擎/非调试，实际钩子及当前 alpha SDK 兼容性未验证。先核实 M07，不自动换包或 SDK   |

历史A/B/C只核对淘宝方向、Wasm分包、分离引擎共3项，不是完整可见UI字段数。本批另外纳入 `globalAdapter`（globalThis 全局变量适配）与条件文本 `globalVariable`：两项无data-option-key，按唯一自定义标签真实操作；已完成填写文本、开启适配隐藏并保留文本、关闭适配恢复后清空三种状态的UI、任务参数及build成功。前者虽在通用schema标hidden，实际自定义视图仍可见；新证据单列，不倒填历史60项计数。其他输入校验及独立保存仍未全覆盖。详见[公共 UI 全量清单](pink-build-ui-automation-design.md#公共-ui-全量覆盖清单2026-10-17-qa-范围)。Wasm压缩仍为公共条件字段C10；`taobaoDevtoolsPath` 服务于运行，不要求安装开发工具。

### 合并构建安排与逐分支完成条件

“合并”指一个平台的多个独立预期由同一次真实构建证明；“批次”指工具依次提交限定平台，**不是点击产品“全部构建”**。首次先完成公共模板设置、回读和专属基准 A；B/C/D/E 按下表叠加明确差异，跨轮须重新设置完整公共模板，不能继承上一平台的未知值。

| 轮次             | 提交目标与固定背景                                                                  | 同次覆盖的内容                                                                                                                                                   | 材料不足时的安排                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 复用 D           | 不新增构建                                                                          | 前述 8 平台 D 公共字段、入口与成功链路                                                                                                                           | D 不提供专属基准证据；A 另列                                                                                                   |
| A 发布及专属基准 | 8 平台每 2 项一组提交到 PinK 队列，R-L；Web 两端 none，六个小游戏 merge_all_json    | C01/C03/C06/C07/C08 适用部分，所有可见专属字段基准                                                                                                               | 继续使用默认图标、调试密钥、空 AppID/Key；不需要 M01～M04，不把它们计为非默认侧已覆盖                                          |
| B 专属变化       | 8 平台；Web 桌面 merge_dep、OPPO subpackage，其余沿 A 的 R-L 模式                   | C02/C05；Web/Facebook 的变化；快游戏非默认元数据、方向/全屏/日志；HW 分离引擎（VI 当前 UI 未显示）；淘宝 TA02                                                    | 仅纳入材料已确认的 Q02/Q05；runtimeVersion 保留 2.0.0，非默认值仍由 M06 核定；当前工程 C10 可与 TA02 合并，不更换 Builtin 背景 |
| C 返回及条件材料 | 8 平台中仍有未覆盖分支者；Web 桌面 merge_all_json；OPPO 有 M01 时用 Zip，其余沿 R-L | C03/C04；Web 手机 portrait；VConsole/WebGPU/方向等返回；Q02/Q05 返回；Q04 自定义文件；HW 分离引擎（VI 当前 UI 未显示） off；OP 分离引擎 on；淘宝 TA02/C10 关闭侧 | 缺 M01 时 OP 的 Zip 单元缺材料；仍可明确以 R-L 合并其余独立分支，不能将该任务登记为 C04 通过。缺签名不阻塞其他返回分支         |
| D 收尾与条件分支 | 仅 OP、待签名返回的平台及淘宝等有剩余分支者                                         | OP 分离引擎 off，并可验证 C09 远程→本地；Q04 回调试密钥；淘宝 TA03 开启                                                                                          | 只提交前轮留下的实际缺口；TA03 前提不满足则受阻，其他目标照常                                                                  |
| E / 材料补齐     | 仅尚有返回或材料分支的平台                                                          | 淘宝 TA03 关闭返回；后补图标、签名、AppID、实际纹理/图集路径                                                                                                     | 不为补一项重跑 8 平台；只补尚缺的一侧及受影响联动                                                                              |

C10 当前背景已确认：R-L/Builtin 与当前引擎预设包含 3d，实际出现原生包装模式入口；切换 wasm 后才操作压缩控件。未切换物理后端或新增工程模块；其他工程如不满足显示条件记受阻，不通过隐藏字段写入绕过。

上表是可合并的候选安排，不承诺固定构建次数：Web 桌面、Web 手机、Facebook 各至少 A/B/C 才能证明本表选定的值变化；其他平台按独立合法分支合并。只有同一任务中所有关联字段分别满足预期，才能同时完成多个用例。材料导致目标分支拆分时，先生成明确的子单元预期并保留原受阻状态，不在执行中改完值再倒推用例。

### 材料、配置与受阻范围

| 编号 | 需要的材料 / 配置                                                | 只阻塞哪些分支                                     | 当前状态与责任边界                                                                                                                      |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| M01  | QA 专用 HTTP/HTTPS 资源根 URL S，约定尾部 `/`                    | C04、C09 的远程侧；以后明确指定的 R-S              | 新表已有候选地址；QA仍需确认可用的测试根URL及目录。当前不需FTP登录或上传操作；未确认前C04/C09远程侧保留受阻                             |
| M02  | 自定义测试 PNG 及每个平台可解析的输入路径                        | Q02 自定义侧                                       | 工程现有 512×512 PNG 可作候选，尚未核对图标要求和路径兼容；须核对 SDK 钩子相对路径拼接与 UI 路径转换，未确认前不算已就绪                |
| M03  | 匹配的测试 `private.pem`、`certificate.pem` 本地路径             | Q04 自定义侧及其返回                               | 缺材料；不要求生产签名，不读取或输出私钥正文，不执行真正打包签名阶段                                                                    |
| M04  | 每平台合法测试 AppID/AppKey 对及需要时匹配的包名，本地提供       | Q05 非空侧及其返回                                 | 新表已有部分AppID/账号候选，需QA确认适用平台、有效性与匹配包名，AppKey仍按平台提供。不登录、不上传，不把空值基准判失败                  |
| M05  | 被所选场景引用的自动图集 `.pac` / 图片组、配置压缩格式的纹理样本 | C07 的实际处理路径                                 | 现有UI开关/入参证据可复用，不强制阻塞本轮；若要求实际经过图集/纹理处理，才补已被场景引用的样本或另批批准制作，效果验证下期              |
| M06  | QA 合法运行时版本；最低平台版本和日志等级按当前包规则选择        | Q01 运行时非默认值；Q07/Q09 当前候选已本地构建验证 | 非默认运行时版本待 QA 核定，B 保留 2.0.0；1081/1104/warn 已通过当前 UI/参数/build，不宣称线上许可                                       |
| M07  | 淘宝分离引擎的当前版本适用说明/匹配插件条件；华为插件资源前提    | TA03、HW-Q06 的相关开启路径                        | TA03待当前版本规则核实；HW开启/关闭侧本地build已有，插件实际可用和make不在本轮。微信插件启用另需匹配正式SDK，不能把该门槛套到所有小游戏 |

专属用例不验证商店接受包名/版本、账号权限、证书真正签名、引擎插件运行、设备方向、分辨率或 VConsole 效果。若上述输入仅在 make/run 才消费，本阶段只记配置与 build 兼容证据；构建成功不能补齐后续阶段的证明。

M07 是前提核实项，不是已确认的构建失败：只有实际校验或 build 要求的版本/文件条件不满足时才受阻。华为已完成的开启/关闭本地build继续复用；其他尚缺合法组合若仅产生插件告警，记录告警，不因make/run才消费的资源阻塞本阶段；淘宝也不因文案出现“正式版本”就直接判定当前 alpha 包不可构建。

### A 轮执行记录

2026-10-16 已先完成 web-desktop 单平台，再完成优先 8 平台串行 A 轮，最终 **8/8 passed**。逐平台结果与任务归属统一见[构建设计 A 轮记录](pink-build-ui-automation-design.md#a-轮本地发布与专属基准)及 [JSON](../results/2026-10-16T12-04-28-784Z/result.json)。本次共核对 60 个专属基准字段：Web 桌面 3、Web 手机 2、OPPO 12、vivo 9、荣耀 14、华为 15、淘宝 3、Facebook 2。所有值均经过初态、公共参数修改后、关闭重开及本次任务核对；专属值未修改。

A 同次完成 C01（Web 两端）、C03（六个小游戏）、C06（8 平台）、C07（除 Web 手机的可见开关与入参）、C08（五个小游戏）以及上述可见专属基准。以当次A为限，Web桌面R代表、其他压缩、条件Wasm和专属变化/返回当时尚无覆盖；后续B/C已补的当前状态按上方分支表及构建设计，不再把全部返回笼统列待测。A的一个基准值不能代表整个选项覆盖。C07 实际纹理/图集处理仍缺 M05；vivo 的 VI-Q05 / VI-Q06 在当前自定义 UI 未显示，保留 UI 未覆盖和后续设计。

随后按[队列执行设计](pink-build-ui-automation-design.md#逐个提交与统一收集)改为逐个提交、统一收集，新的 A 轮 [2026-10-16 队列结果](../results/2026-10-16T12-16-29-853Z/result.json) 同样 8/8 通过。7 项在 waiting 状态关联且提交早于上一项结束，入队与最终参数均核对；本次仅改变调度，不新增公共模式或专属非默认分支覆盖。

当前固定每组最多 2 项的 [A 轮结果](../results/2026-10-16T12-34-21-975Z/result.json) 为 4 组、8/8 passed，3 组实际观察到队列等待，1 组仅构建通过；配置加载证据与组间收尾规则见[配置加载与分组](pink-build-ui-automation-design.md#配置加载状态与两项分组)。本轮没有增加其他组合或材料分支覆盖。

### 当前工具能力与配置页缺口（2026-10-19复核）

已实现D/A/B/C-local、17平台配置页基线及公共字段往返、普通组合直接提交、显式保存专项、统一finalConfiguration和schema5；历史schema3/4不改写。本批新增九项用例数据和子集选择，同平台多case分别关联最终快照和taskId，新增公共字段、Web手机及淘宝自定义表单合同；实包结论见本地选项九项记录。A默认核对专属基准，显式 `-ApplyProfile` 才经UI设置已批准的非敏感目标，不能把它当作通用重置。账号、签名、图标、运行时版本继续守卫，其他未测分支按下表保留；未建设通用框架或修改PinK/SDK。

以下列的是未覆盖分支，公共项由代表平台承担，不为18平台逐项复制。可见/回读、真实交互、保存与任务/build分别判定；本页计划不算执行证据。

| 公共字段/交互                                                                    | 已有证据与剩余缺口                                                            | 材料与安排                                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `mangleProperties`                                                               | 17平台保存/恢复已有；本批Web桌面变化/返回、任务参数和build已通过              | 新增任务/变化构建已有并复用，不为同值再构建；额外校验另列                                    |
| `inlineEnum`、`experimentalEraseModules`、`useSplashScreen`、`bundleCommonChunk` | 本批Web桌面合法变化/返回、入参与build通过；独立保存专项未做                   | 不缺材料；每字段独立预期，合并合法最终状态                                                   |
| `sourceMaps`                                                                     | 本批关闭/独立/内联均完成UI选择、任务类型核对和build成功；独立保存未做         | DOM回读false/true/inline字符串；枚举与任务为布尔false/true或字符串inline，精确合同见九项记录 |
| 名称、构建路径、输出名                                                           | 编辑、选择器、协议转换、重名避让、输入校验待测                                | 复用当前工程与受控测试输出名，不覆盖旧输出                                                   |
| 初始场景、场景列表                                                               | 切换、搜索、全选/取消、入口约束待测                                           | 两个现有场景可作候选；记录各UUID及期望集合，不再称为缺第二场景                               |
| 包含的Bundle                                                                     | 候选、搜索、选择/取消、任务集合待测                                           | 先核实现有工程是否有足够的合法Bundle；不足才请QA补，不拿空列表算通过                         |
| 压缩、主包远程、服务器、初始场景Bundle                                           | 本地C01/C02/C03/C05及适用场景Bundle两侧已有；Zip、远程/本地返回与互斥未完     | 远程侧依赖M01；不重复已有效的本地分支                                                        |
| `binGroupConfig.enable/threshold`                                                | 开关、阈值变化、返回、提示/边界待测                                           | 无文件缺口；默认16不是已确认的合法范围，边界合同待核定                                       |
| 引擎预设、继承、3D/2D物理、WebGL2、`cleanupImageCache`                           | Builtin/Bullet/WebGL2部分已有；Cannon/PhysX、2D物理、继承和宏变化未完         | UI及build兼容无需物理效果工程；只选当前支持候选，不改工程模块来制造控件                      |
| `nativeCodeBundleMode/wasmCompressionMode`                                       | 淘宝B开启入参通过但build失败，C关闭/asmjs返回通过；完整适用模式及条件显隐未完 | 已有模块背景可复用；不为盘点重跑已知失败，不写隐藏字段                                       |
| L10N目标/默认/回退语言                                                           | 可见/部分回读不算选择、联动、保存和任务验证                                   | 先确认当前Catalog候选和测试语言集合，缺时请QA补；不翻译、不改Catalog                         |
| Polyfills及旧表专有项                                                            | 当前快照未证明存在可操作入口                                                  | 先判当前UI适用性；schema/旧表有字段不等于可点，不补写隐藏值                                  |
| 布局、焦点、关闭、提示、复制key、包含开关、防重复提交                            | 保存专项已有一个公共字段往返，其余公共交互并未全覆盖                          | 无效输入只检查UI并恢复，不提交非法构建；未定规则不自造预期                                   |

## 18 个平台差异与可测性

2026-10-20最新接入：另外10平台现已补入`debug`/`release-a`基础公共组合，18平台均有适用D/A入口；`release-b`/`release-c-local`仍限原8平台。下表保留原有证据及专属分支缺口，新增D/A入口不把这些待测分支改成通过。[准确字段目标和执行命令](../tools/build-ui/README.md#18平台调试本地发布基础组合)以工具说明为准；新增组合的实机证据独立保存，不复用existing结果冒充通过。

压缩值：`none`＝无压缩，`merge_dep`＝合并依赖，`merge_all_json`＝合并所有 JSON，`subpackage`＝小游戏分包。此表按实际目标性质区分 Web、原生、小游戏；Google Play 虽在 X-Application，仍按 Android 原生目标处理。

以下为18平台用例清单定稿；首批可执行范围不等于全部设计均已实现。每行复用公共配置与历史用例，只列平台差异；具体字段目标仍引用前文C01～C10、WD/WM/OP/VI/HN/HW/TA/FB，不重新编号业务用例。17平台已有身份/加载/字段回读基线及对应mangleProperties往返记录，不代表所有字段交互完成。[旧版17通过/1受阻记录](../results/2026-10-19T03-09-28-698Z-configuration/result.json)和九项结果继续复用；本轮不刷新现场或执行新版验证。

表内“待实现”是自动化缺口，条件就绪的分支也不意味着本次要执行；缺材料只影响指定一侧。原R/D压缩候选受当前平台合同约束，不直接变成18×2构建计划。

| 分类 / 平台ID                       | 已实现及原有证据                                                                | 已设计、待实现的操作与预期                                                                                                 | 缺材料或待核条件                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| X-Device `web-desktop`              | 基线及D/A/B/C；三种本地压缩、WebGPU/尺寸往返、五个公共开关和Source Map三态      | 公共UI专项；MD5父子显隐/保留、CCONB开关/数值、缓存宏三态、多场景/入口，按下方三个用例逐字段回读并核对任务                  | 三个合并用例不缺新文件，仍缺局部适配及完整字段合同；选择器/边界规则、Bundle/L10N另核；远程侧依M01                |
| X-Device `web-mobile`               | 基线及D/A/B/C；方向auto/landscape/portrait、VConsole两侧、自定义WebGPU开关/返回 | 专属字段真实修改→重开→核对→恢复；WebGPU与HTTP提示的条件关系；纹理/图集无当前控件则不补写                                   | HTTP提示需要可用预览地址，旧现场不可用；不由桌面WebGPU替代自身适配                                               |
| X-Application `oppo-mini-game`      | 基线及D/A/B/C；元数据/方向变化返回，分离引擎开启及关闭返回                      | OP-Q01～Q06剩余侧：输入校验、图标默认→自定义→默认、调试签名→自定义→返回、应用参数及runtimeVersion；每字段独立回读/参数核对 | 自定义侧依M02/M03/M04/M06，Zip/远程依M01；已通过分离引擎不重跑                                                   |
| X-Application `vivo-mini-game`      | 基线及D/A/B/C；9项专属基准、元数据和原生方向下拉变化返回                        | VI-Q01～Q04可见侧的校验/保存、图标和签名返回；自定义区展开/折叠；方向用原生select合同                                      | M02/M03/M06；AppID/Key/分离引擎在当前自定义表单无控件，记当前UI不适用，不借通用schema补写                        |
| X-Application `honor-mini-game`     | 基线及D/A/B/C；元数据/方向、最低版本1080↔1081(number)、全屏及log↔warn返回       | HN-Q01～Q05/Q07～Q09剩余侧：文本/数字校验、专属保存、图标/签名/应用参数/runtimeVersion                                     | M02/M03/M04/M06；无分离引擎控件，不复制华为该用例                                                                |
| X-Application `huawei-quick-game`   | 基线及D/A/B/C；元数据/方向、最低版本1103↔1104(string)、全屏/日志、分离引擎两侧  | HW-Q01～Q09剩余侧：输入校验、签名显隐/路径、专属保存及材料返回；数值外观不改变string合同                                   | M02/M03/M04/M06；插件效果及生成运行不由本地build推定                                                             |
| X-Application `taobao-mini-game`    | 基线、D/A及C成功；旧B Wasm组合失败保留；全局文本→适配隐藏保留→恢复清空三态通过  | TA03分离引擎开启/返回；专属保存/校验；Wasm失败分支保留失败并按版本影响定向处理，不自动再跑                                 | M07及当前SDK/包装/压缩合同；缺材料与旧失败分开，不因asmjs成功关闭Wasm缺口                                        |
| X-Application `fb-instant-games`    | 基线及D/A/B/C；方向/VConsole变化返回                                            | 以当前combobox合同补方向交互、专属字段保存/校验及返回；参数身份独立核对                                                    | 现有本地组合不缺账号/上传材料；不支持Zip/subpackage的分支按适用性处理                                            |
| X-Device `windows`                  | 共同基线；1958 existing成功，5项当前值合同                                      | 可执行名合法/非法/允许空；x64/x86；后端；Generator加载/刷新/空结果；加密/调度及保存返回                                    | 当前架构已有基础证据；其他架构/Generator按候选另核，不以可选推定支持                                             |
| X-Device `android`                  | 共同基线；1958 existing及A成功，10项当前值合同                                  | 包名/后端/方向；Swappy/Input SDK/.so/Activity；API/ABI；加密/调度/签名；独立宽高比；Instant/API                            | Android没有Instant URL联动，宽高比不随Activity禁用；自定义签名材料与其他候选分别维护                             |
| X-Device `ohos`                     | 工具入口及7项UI回读；构建未在本机提交                                           | 包名/API数字/方向；加密/调度及子项、专属保存、变化返回及本平台构建成功                                                     | 测试组环境齐全，不整体列缺SDK；API合法范围另核，无当前ABI/Android签名UI                                          |
| X-Device `harmonyos-next`           | 共同基线；1958 existing成功，14项当前值合同                                     | JSVM/V8/ARK；设备七候选/手柄/方向/GLES3；唯一ABI；加密/调度与专属保存                                                      | 仅arm64-v8a/GLES3；Source Map隐藏；ARK实际关闭加密；源码显示归一化为 arm64-v8a；底层空数组与任务一致性风险待实测 |
| X-Device `huawei-agc`               | 1958 JSON/包名及基础构建成功，12项当前值合同                                    | 服务文件必填/保存、JSON包名采用；API/后端/方向/Swappy/Input SDK/.so；签名、Activity→宽高比                                 | 已有JSON不缺材料；当前无ABI/加密/调度/Instant UI；坏文件错误合同与工具预检分开                                   |
| X-Application `wechatgame`          | 共同基线；1958 existing及D成功，6项当前值合同                                   | AppID/方向；开放数据域/Wasm分包/高性能及返回；分离引擎禁用/警告和兼容侧；专属保存                                          | 当前beta插件UI禁用；发布正向另需兼容引擎条件，其他无材料分支不连带阻塞                                           |
| X-Application `bytedance-mini-game` | 共同基线；1958 existing成功，7项当前值合同                                      | AppID/方向/开放数据域/Wasm分包/预加载；lite/full；插件/包装关系；专属保存返回                                              | 当前通用表单；发布分离引擎builtin规则另核，启动模式仅检查配置/参数                                               |
| X-Application `alipay-mini-game`    | 共同基线；1958原成功任务复核，2项当前值合同                                     | 方向字符串portrait/landscape；引擎asm.js分包开/返回、false缺省；专属保存                                                   | 包内下拉未注册；无当前AppID/开放数据域/插件/高性能UI，不引入minidev运行前提                                      |
| X-Application `google-play`         | 共同基线；1958 existing成功，10项当前值合同                                     | GLES父子/Vulkan；四方向/包名双入口；图标；API/ABI/签名；Activity→宽高比、Instant→URL；Billing/Input/Swappy/ADPF/.so        | 无当前JS加密/调度UI；隐藏AAB/PlayGames不补写；图标优先复用，签名材料独立                                         |
| X-Application `openpaas`            | 专属配置及1958正常构建成功，3项当前值合同                                       | 有效版本/方向；游戏刷新/失效/异常与非空代码版本；四项网络超时折叠/编辑/保存/任务核对                                       | 沿当前账号和已有游戏；不新建；自动密钥/上下文不手填，正常按钮内部阶段不拦截                                      |

## 其余10平台专属选项与条件分支（2026-10-20定稿）

本节维护微信、抖音、支付宝、Android、Google Play、Windows、OHOS、HarmonyOS NEXT、华为AGC及OpenPaaS的当前缺口和下一批设计。依据1958包所用custom SDK beta.0的schema、`package.json`中的实际`customView/customFields`注册、自定义表单及构建钩子，并复用已有UI/任务结果。本节10个专属最终状态已接入`-Plan special-options-ten`，用例ID可直接传给`-Cases`；不改变38+24业务范围。本批10个新专属组合均已执行：5项通过（OpenPaaS、Android、Google Play、Windows、鸿蒙NEXT），5项失败（微信、抖音、支付宝、AGC、OHOS）。微信沿用前一次失败；本次其余9项为5通过、4失败，无旧通过用例重跑。独立零构建专项与材料分支仍待实现/待测。

### 已有覆盖与公共组合复用

已有回读合同只证明当时的字段值和任务参数，不证明所有枚举、开关、校验或保存分支。九个平台有1958基础构建成功证据；OHOS新专属组合已在本机提交，UI/入队参数通过但SDK目录不存在导致失败；测试组环境仍按其已确认条件执行。新增20条D/A中，仅微信D与Android A有本次实机成功证据，其余18条未执行；原8平台B/C不扩大为18平台。OpenPaaS的已有游戏切换、版本必填/恢复、保存重开和正常按钮构建已有独立结果，不重复列成全部待实现。

| 公共部分                                                     | 复用方式                                                         | 需要保留的平台核对                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 混淆、内联枚举、模块裁剪、启动画面、公共分块、Source Map三态 | 复用代表平台用例与有效版本证据，不复制全部候选到10平台           | 有无控件及平台限制分别判定；NEXT隐藏Source Map并在钩子中关闭，不写隐藏字段             |
| Debug、MD5、物理、纹理和图集                                 | 各平台沿已定义D/A背景，专属变化并入A本地发布，详细值引用工具说明 | 微信/抖音/支付宝D的MD5开启；WebGL和主包压缩保持平台差异；最终UI与入队/终态仍逐任务核对 |
| none/merge_dep/merge_all_json主包模式                        | 共享模式由代表平台覆盖，不新增完整笛卡尔积                       | 六个原生目标含Google Play只提供这三种；支付宝A采用merge_dep                            |
| 主包subpackage、引擎wasmSubpackage、加密compressZip          | 三个不同字段，不互相抵扣覆盖                                     | 微信/抖音/支付宝各自引擎分包与原生加密子项需要平台用例，不能引用主包模式通过           |
| 加载、提示、保存重开、任务展示                               | 复用公共步骤及适配机制；历史记录复用既有任务                     | 每平台补一次专属合法变化的保存重开；普通构建直接提交，公共UI专项不是强制前置           |

### 逐平台完整缺口

“当前值合同数”是现有任务核对白名单数，不是页面字段总数。“不缺材料”只说明可沿现有工程/账号/测试环境设计，仍需要UI适配和字段合同；不保证任意候选都能构建。

| 平台 / 当前值合同  | 已有证据                                         | 专属分支族（完成侧见本批结果，其余待测）                                                                                                                                                   | 不适用、条件或材料                                                                                                            |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 微信 / 6项         | existing及D成功，6项当前值传递匹配               | AppID空/合法；portrait↔landscapeRight；开放数据域模板、Wasm分包、高性能开关/返回及说明；分离引擎的禁用、警告和兼容环境正向侧；包装/压缩联动                                                | 当前beta版本的分离引擎UI禁用；发布开启侧另需符合平台规则的引擎环境，不擅自切换；其他侧沿已有AppID                             |
| 抖音 / 7项         | existing成功                                     | AppID、portrait↔landscape、开放数据域、Wasm分包、预加载开关/返回；lite↔full；分离引擎及包装/压缩关系                                                                                       | 仅注册通用表单及host，无自定义视图；发布分离引擎受builtin规则限制；lite/full仅核配置与参数，不启动开发工具                    |
| 支付宝 / 2项       | 原成功任务复核通过                               | 方向字符串portrait↔landscape的合法修改/保存；引擎asm.js分包开启/返回；false在任务中缺省的合同                                                                                              | 当前通用表单；包内未注册的方向下拉组件不作为UI入口；无当前AppID、开放数据域、分离引擎或高性能UI                               |
| Android / 10项     | existing及A成功                                  | 包名修改/空/格式；渲染、三个方向；Swappy、Input SDK、Activity、.so压缩开关；API/ABI；加密、调度、签名；宽高比预设/自定义/校验；Instant/API条件                                             | 宽高比当前独立可编辑，不按Activity禁用；Instant仅展示API提示，没有URL输入联动；自定义签名需匹配keystore                       |
| Google Play / 10项 | existing成功                                     | GLES父子与Vulkan、后端非空；四方向含upsideDown、集合非空；包名双入口同步；图标默认/自定义/预览/返回；API/ABI/签名；Activity→宽高比；Instant→URL；Billing、Input SDK、Swappy、ADPF、.so开关 | 无当前JS加密/调度UI；App Bundle、Play Games隐藏；图标优先复用已有合规PNG，自定义签名需材料                                    |
| Windows / 5项      | existing成功                                     | 可执行名合法/非法/允许空；x64↔x86；后端；CMake Generator候选/刷新/加载/空结果；加密、调度                                                                                                  | 名称不做必填断言；架构/Generator按实际候选，不能把可选推定为支持；无Android API/keystore UI                                   |
| OHOS / 7项         | 新组合UI/入队通过；本机SDK失败                   | 包名合法/空/格式；API数值/必填；三个方向；加密/调度变化、保存及返回；本平台构建成功                                                                                                        | 测试组确认环境齐全，不再整体列缺SDK；API合法数值范围另核；无当前ABI选择和Android签名UI                                        |
| NEXT / 14项        | existing成功                                     | JSVM/V8/ARK；手柄；设备类型phone/tablet/pc_2in1/tv/wearable/car/default；包名/方向/GLES3；ABI；加密/调度；保存返回                                                                         | 仅arm64-v8a、GLES3；Source Map隐藏；ARK实际加密关闭，不记加密生效。唯一 ABI 取消后显示归一化，底层 []/任务一致性风险待实测    |
| AGC / 12项         | JSON/包名UI设置、基础构建及参数通过              | 文件必填/合法保存；包名修改与JSON采用规则；API；后端/方向/Swappy/Input SDK/.so变化；签名；Activity→宽高比                                                                                  | 已有JSON不缺材料；无当前ABI、加密、调度、Instant UI；坏JSON/不存在文件属于另列错误合同，不能由工具预检冒充产品UI校验          |
| OpenPaaS / 3项     | 游戏切换/恢复、版本必填/恢复与保存、基础构建通过 | 不同有效版本名、方向；游戏刷新/保留/失效/无候选/加载错误；非空代码版本；网络超时展开/折叠及XMLHttpRequest/Websocket/uploadFile/downloadFile四项修改/保存/任务参数                          | 沿当前账号，不新建游戏；非空代码版本需对应已有记录，异常列表需相应现场；隐藏密钥/上下文不手填；内部阶段按正常构建按钮任务结果 |

### 同类原生专项的分支合同

以下可共用操作机制，但仍在各自平台实例化并独立判定；代表平台只能复用共享操作证据，不能替代不同平台的参数/钩子核对。

| 专项 / 平台                              | 必须覆盖的侧                                                                                         | 不可错误推定的部分                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 加密 / Android、Windows、OHOS、NEXT      | 发布下开→密钥/压缩出现→压缩开/关→关加密清compressZip；Debug交互限制/提示；合法密钥与空值；保存返回   | Debug限制包含CSS阻止鼠标，不能只看input.disabled；空密钥是UI负向，不提交；NEXT ARK只检查限制，不宣称加密生效；结果只留测试密钥摘要 |
| 调度 / 上述四个平台                      | none/taskFlow/tbb、TaskFlow说明和返回；Android TBB/API门槛                                           | 候选存在不等于任意SDK都可构建；不伪造低API候选，不把Google Play源码中的防御条件当作可操作调度UI                                    |
| 签名 / Android、Google Play、AGC         | 调试签名下四项禁用；切自定义后可编辑；合法值回读；返回调试签名四项清空                               | 正向构建需匹配测试keystore/别名/密码；禁用/必填侧不需要生产签名，密码和路径敏感值不截图、不落原文                                  |
| API/ABI / Android、Google Play；AGC仅API | 实际API候选与number类型；Android/Google四种ABI候选及单/多/空集合；Instant/API≥23，Android TBB/API≥21 | SDK查询入口仅检查入口/提示，不改SDK设置；仅选择已确认支持的候选；OHOS数字输入与NEXT唯一ABI另用本平台合同                           |
| 宽高比 / Android、Google Play、AGC       | 2.4、16:9、16:10、4:3预设，自定义及返回；空/格式/边界先按已明确校验分别检查                          | Google Play/AGC由Activity禁用且保留值，Android不禁用；不能把Android/Google已有校验直接当作AGC完全相同                              |
| 集合 / 原生方向和后端、NEXT设备          | 逐候选读写、组合和返回；正向始终保持合法目标集合                                                     | Google明确非空校验，其他平台未明确处先核合同；NEXT界面可能将空ABI显示为默认arm64，不能以回勾冒充底层恢复                           |

### 下一批不缺材料用例与合并构建

本批实现10个专属变化最终状态，分别复用本平台A公共背景。它们替代重复跑一遍同背景A，不额外追加10次纯公共构建，也不重跑原8平台。下表顺序为5组，每组最多2项；组内逐个配置、稳定回读后提交，组间等任务参数/终态/卡片全部收尾。下表为完整集合的分组安排；微信单项失败后，按最新规则继续其余9项；重新按最多2项分组，不再以微信成功为前置。明确单项失败保留结果，后续独立用例继续。

| 组/位 | 文档用例ID                              | 合并到一次构建的专属最终状态                                                                                          | 保留项及前提                                                                                   |
| ----- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1/1   | design.wechatgame.local-change          | 横屏landscapeRight、开放数据域模板开、引擎Wasm分包开、高性能开；使用合法Wasm包装背景                                  | AppID与分离引擎关闭侧保持，当前SDK不启用插件；先核包装/分包字段合同                            |
| 1/2   | design.bytedance-mini-game.local-change | 横屏landscape、开放数据域模板/Wasm分包/预加载开、full模式                                                             | AppID保持、分离引擎关；不启动开发工具；包装背景按当前合法候选                                  |
| 2/1   | design.alipay-mini-game.local-change    | 方向文本landscape、引擎asm.js分包开                                                                                   | A主包merge_dep；核对任务false缺省/true实值区别，不使用未注册下拉                               |
| 2/2   | design.openpaas.local-change            | 不同有效版本名、横屏；展开后四项网络超时分别设不同合法正整数文本                                                      | 当前已有游戏保持；四个子项分别核对，非空代码版本另列；不新建游戏或另点阶段按钮                 |
| 3/1   | design.android.local-change             | Swappy/Input SDK开、.so压缩关、竖屏；Activity关、宽高比16:9；加密开且compressZip关、TaskFlow                          | 保持当前合法API/ABI和调试签名；非生产测试密钥；后端保留已可用组合                              |
| 3/2   | design.google-play.local-change         | GLES3开/GLES2关、竖屏与倒置；Swappy/Input SDK开、ADPF/Billing关、.so压缩开；Activity关、16:9；Instant开及合法HTTP URL | 至少一个后端/方向；API≥23，保持当前合法ABI/调试签名；不请求URL运行或商店服务；图标材料侧单列   |
| 4/1   | design.windows.local-change             | 不同合法可执行名、GLES3开/GLES2关；加密开且compressZip关、TaskFlow                                                    | 当前架构和可用Generator保持；不以架构切换作为本批前提；非生产密钥                              |
| 4/2   | design.harmonyos-next.local-change      | JSVM背景、手柄开、phone类型、竖屏；加密开且compressZip关、TaskFlow                                                    | arm64-v8a、GLES3；JSVM是已有合法候选，不改全局custom引擎；V8/ARK另列，不把本项覆盖扩为三个引擎 |
| 5/1   | design.huawei-agc.local-change          | GLES3开/GLES2关、竖屏、Swappy/Input SDK开、.so压缩关；Activity关、16:9                                                | 沿已有JSON及匹配包名、调试签名和合法API；不操作不存在的ABI/加密UI                              |
| 5/2   | design.ohos.local-change                | 不同合法包名、竖屏；加密开且compressZip关、TaskFlow                                                                   | API保持当前合法值；测试组已有环境；非生产密钥，不再整体因环境封闭入口                          |

签名零构建专项以调试签名开启、四项自定义值为空为前提；已有用户自定义签名不自动清空。若要求真实变化而初态已等于目标，按初态合同标记无变化/受阻，或在执行前另行选择已确认的不同合法候选；不自动重置用户配置制造通过。任何条件不满足只阻塞该用例，不静默删字段或替换为低覆盖组合。

可独立选择的零构建UI专项包括：每平台一次专属合法变化的保存重开/恢复；微信/抖音AppID必填；各包名/Windows名称校验；API/ABI候选及查询提示；Windows Generator刷新；原生加密显隐/Debug限制；签名禁用/空值/返回；Activity/宽高比条件；Google父子后端与空集合；OpenPaaS超时折叠/刷新。非法状态均恢复后结束，不提交非法配置；这些专项不是10个平台构建的强制前置。

返回侧、compressZip开启侧、其他枚举、非默认API/ABI、x86/其他Generator、NEXT V8/ARK的合法构建状态另列待测。可与后续尚缺的公共状态或本平台其他变化合并；不固定再加10次返回构建。纯UI返回只能记UI覆盖，不能冒充该侧任务参数或构建成功。

### 本批实现与实机边界（2026-10-20）

新增计划`special-options-ten`复用现有执行器、最终配置快照、任务观察及两项分组；专属写入按顺序进行，回读后直接点击构建。分组复选框、ABI集合回读、API数值下拉、OpenPaaS网络超时展开和非生产密钥摘要为本批新增适配。命令和其余9项的精确选择见[工具说明](../tools/build-ui/README.md#新增10个平台的专属组合)。

[微信唯一实机结果](../results/2026-10-20T07-04-06-028Z/result.json)关联`task-1792479876469-2`：从portrait及关闭状态真实改为landscapeRight、开放数据域/Wasm分包/高性能开启；AppID摘要保持，最终UI、全部5项专属入队参数和公共参数核对通过。44%的`buildEngineCommand`失败，日志为Babel要求调用时提供`filename`；栈指向现用SDK的`ExternalWasmModuleBundler._transform`（`external-wasm-loader.js:183`），该调用未提供filename。这里只定位失败位置，未修改SDK、未通过改组合绕过，也未再次提交。终点未达到成功，成功卡片检查未通过。

本批10个新专属组合均已执行：5项通过（OpenPaaS、Android、Google Play、Windows、鸿蒙NEXT），5项失败（微信、抖音、支付宝、AGC、OHOS）。微信沿用前一次失败；本次其余9项为5通过、4失败，无旧通过用例重跑。 不缺外部材料不等于当前SDK一定通过。微信的旧基础/D成功结果保留，但不能抵消本次新组合失败。独立保存返回、其他枚举、材料分支维持原缺口。工程及用户引擎设置文件哈希与本轮开始相同；构建配置按批准用例在UI中保存了新值，未自动恢复或重置。

本次续跑使用[九项批次原结果](../results/2026-10-20T07-10-32-731Z/result.json)和[OHOS单项续跑](../results/2026-10-20T07-20-45-917Z/result.json)。按caseId合并执行状态，原批次OHOS的not-run不改写，也不重复计入本次总数。

| 平台        | 用例结果 | 核对范围与失败原因                            | 任务ID                  |
| ----------- | -------- | --------------------------------------------- | ----------------------- |
| 微信        | 失败     | UI/入队参数通过；SDK Babel编译失败            | `task-1792479876469-2`  |
| 抖音        | 失败     | UI/入队参数通过；SDK Babel编译失败            | `task-1792480266451-3`  |
| 支付宝      | 失败     | UI/入队参数通过；SDK Babel编译失败            | `task-1792480283019-4`  |
| OpenPaaS    | 通过     | UI配置、最终回读、入队/终态参数和成功卡片通过 | `task-1792480384648-5`  |
| Android     | 通过     | UI配置、最终回读、入队/终态参数和成功卡片通过 | `task-1792480418040-6`  |
| Google Play | 通过     | UI配置、最终回读、入队/终态参数和成功卡片通过 | `task-1792480560050-7`  |
| Windows     | 通过     | UI配置、最终回读、入队/终态参数和成功卡片通过 | `task-1792480588015-8`  |
| 鸿蒙 NEXT   | 通过     | UI配置、最终回读、入队/终态参数和成功卡片通过 | `task-1792480719617-9`  |
| 华为 AGC    | 失败     | 构建成功；API Level UI=36、任务=35，用例失败  | `task-1792480756790-10` |
| OHOS        | 失败     | UI/入队参数通过；本机SDK目录不存在，任务失败  | `task-1792480879152-11` |

AGC的API Level差异保留为用例失败，未把任务成功当作整体通过，也未修改API选项掩盖差异。收窄执行器中断规则：任务已唯一关联后的参数核对失败，保留当前失败并等待本组收尾后继续；提交是否生效不明、观察器异常、任务仍活动且超时等仍中止。修正时原批次已按旧规则停止，故OHOS独立续跑；没有为验证新中断分支重提AGC。普通构建失败后继续下一组已由本批第一组失败、后续组正常执行实际验证。第二、三组原始queueCoverage为observed；失败组中仍保留waiting/processing原始时序，不把整体失败改成队列通过。

### 具体材料、待合同与不适用项

| 分类             | 影响分支                                                                                                                                                                                  | 处理                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 当前不缺外部材料 | 上表10个最终状态已接入；可独立UI专项仍待实现                                                                                                                                              | 沿现有工程/账号/合法候选；加密使用本地非生产测试值并脱敏；本批5通过/5失败，具体原因见实机结果；其他分支仍待测 |
| 自定义签名材料   | Android/Google Play/AGC正向签名                                                                                                                                                           | 匹配测试keystore、别名、密码；不可由“环境齐全”推定已取得所有自定义签名数据                                    |
| 图标文件         | Google自定义图标正向                                                                                                                                                                      | 优先复用工程合规PNG，核清产品接受规则；不足时再请QA提供，不先要求制作新资源                                   |
| 兼容引擎条件     | 微信/抖音分离引擎正向及包装联动                                                                                                                                                           | 区分微信正式版本UI门槛与两平台发布builtin校验；不自动切换当前custom引擎或假定两者UI相同                       |
| 对应账号现场     | OpenPaaS非空代码版本、无候选、权限/加载失败、容量入口                                                                                                                                     | 使用已有对应游戏/账号状态；不新建游戏凑数量；当前有候选及空代码版本的通过证据保留                             |
| 远程资源         | 主包Zip/远程侧                                                                                                                                                                            | 沿M01；Google Instant仅URL配置/回读不等于部署资源，不能把它等同远程主包材料                                   |
| 待产品/字段合同  | NEXT空ABI显示与配置、其他平台集合校验、AGC错误文件/包名采用、超时边界、合法API/Generator                                                                                                  | 先核清UI、入队、终态及有效配置的差异，未知不算通过；无候选不伪造，不把候选问题写成全机缺SDK                   |
| 当前UI不适用     | 原生主包Zip/subpackage；支付宝不存在的AppID/开放数据域/插件/高性能；Android Instant URL；AGC ABI/加密/调度/Instant；Google加密/调度及隐藏AppBundle/PlayGames；NEXT其他ABI/后端和SourceMap | 不经API补写隐藏字段，不列为缺材料；NEXT ARK加密仅做限制侧；Windows名允许空                                    |
| 本期不执行       | OpenPaaS创建游戏，主动生成/运行/上传，产物验证，历史重建/取消/移除，全部构建                                                                                                              | 相关按钮仅按既定入口UI范围设计；OpenPaaS正常构建按钮内部阶段由产品负责，最终任务失败仍失败                    |

### 配置页用例的共同步骤与逐项判定

以上每个平台都实例化UI-P01/P03及适用的UI-P06/P08；特殊表单另用UI-P04/P05。每个可见字段/条件分支是独立检查点，不能把表中一整行或单个公共字段通过算成平台全量通过。

1. 核对平台ID、标题、材料身份和当前值。原有基线只检查加载/回读；不得将它改称枚举、联动和校验已实现。
2. 普通开关覆盖开启/关闭及返回；枚举按已确认候选和平台限制选择；文本/数字按合同编辑、失焦、回读。非法输入只检查提示和按钮状态，恢复合法值，不提交非法构建。没有合法范围或候选的分支标为待合同核实，不猜值。
3. 条件项按“先父项→等待联动→检查子项可见/禁用/必填→合法填写→父项返回→检查保留或清空规则”组织；隐藏值不能伪装为DOM回读。不同平台的字段类型、私有控件和UI/任务值映射分别维护。
4. 保存专项独立检查真实变化、重开后的目标值及非目标保持，随后恢复本轮可恢复的编辑；普通平台组合最终回读后直接提交，不重复保存专项。涉及平台自动生成上下文的部分只记录边界，不声称能恢复全部服务端状态。
5. 可构建的合法分支尽量合并同一最终状态，逐字段核对最终UI与任务参数；互斥状态、开启和返回是不同用例。同平台多用例仍独立caseId/taskId，最多两项一组。10个最终状态已接入独立计划；10项新组合均已有执行结果，明确单项失败继续后续项，未重跑旧用例。

首批缺口分为三类：不缺新文件但待实现的公共专项/三个合并用例及可见平台交互；缺M01～M06或匹配签名等材料的正向侧；AGC服务JSON已接入并完成一次基础构建，其他未覆盖分支单列；缺产品合同、候选查询或构建环境核实的分支。后两类不能混称“全部缺材料”，也不阻塞已有独立用例交付。

优先8平台A轮本地R-L已通过，A执行时纳入白名单的60个专属字段基准亦通过；远程/Zip和专属材料分支按M01～M07分别保留缺口。微信、抖音、支付宝1958基础链路已开放且有成功证据；后续专属变化仍逐字段补合同，不一概要求远程URL，也不把基础成功扩大到全部分支。它们不加入下方三项代表平台构建。A 基准不代表非默认专属值、其他 R 压缩模式或 vivo 未显示的 3 项通过。其他平台的专属变化、材料和构建资格仍分别保留；18目标没有静默删项。

最初环境取证记录显示：SDK 路径存在，已安装 API 26/28/34/36，未发现 API 35；NDK 19.2/21.4 目录及 JDK17 路径存在。Android/Google Play 页面却显示查询失败。AGC 页面能枚举部分已安装 API。上述记录不是本次重新查询；执行前仍需刷新受影响的环境事实。它支持“需要核实各平台查询与版本适配”，不支持“整台机器没有 SDK”或“已满足所有原生构建前提”的结论。本轮不安装、切换 SDK 或修复产品。

### OpenPaaS：必填项与游戏ID选择用例

OpenPaaS专属配置模式已在1958包、现用custom beta.0 SDK和当前账号上实现并验证；入口为`-Platforms openpaas -Mode openpaas`，通用inspect/exercise仍不进入。当前SDK在构建中管理包上下文及make/upload；最新按用户要求由正常按钮驱动并跟踪最终结果，配置专项仍独立；不删除旧失败/受阻记录。[实际结果及证据边界](pink-build-ui-automation-design.md#openpaas专属配置检查2026-10-20)由构建设计统一维护。

| 复用用例族 / 检查点       | 前提与操作                                                                      | 独立预期及状态                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| UI-P01/P08 身份与加载     | 进入3000+平台配置，等待自定义表单及游戏候选加载                                 | 正常身份、加载通过；失败/无候选有受阻处理，但异常现场未执行                                                             |
| UI-C04/P03 必填提示       | 回读名称、路径的必填标记与非空值；临时清空versionName，保存重开触发校验，再恢复 | 版本名必填提示与恢复通过；名称/路径的负向校验、构建按钮校验行为未执行，不点击构建来触发校验                             |
| UI-P03/P08 游戏选择       | 沿用当前账号，以真实数字ID键入选择另一已有候选；只剩一个时回读并明确未改变身份  | 两个候选真实切换通过；UI候选与被动列表响应一致，结果仅存ID摘要；不按索引选择，不经过创建游戏选项                        |
| UI-P03/P06 联动与必填完成 | 等待选择及代码版本回读，与页面已收到的游戏列表响应核对                          | 当前两个游戏代码版本均为空，该分支通过；非空版本分支待测；不伪造密钥或上下文                                            |
| UI-C24 保存重开           | 版本名负向检查后，恢复原版本与原游戏，再保存重开回读                            | 原版本0.0.1和游戏恢复通过；不要求整个偏好字节相同，不覆盖产品自动刷新项                                                 |
| UI-P07 阶段入口           | 检查构建及后续阶段的实际链关系和提示，核对目标版钩子                            | 生成/上传等独立按钮仅登记入口；普通构建内部自动阶段由产品负责，按整项任务最终结果判定，不改平台钩子                     |
| UI-P01 构建成功链路       | 有效已有游戏与版本名，最终UI回读→点击普通构建按钮→关联本次任务                  | 1958正常按钮已通过，游戏ID摘要、版本/方向、任务最终结果与成功卡片核对通过；产品自动阶段如实保留，不单独驱动、不验证产物 |

材料使用已有环境、已有工程及QA认可的有效游戏，不把新增专用账号/环境当作统一门槛。真实候选不可用、权限不足或有效必填值缺失时，才按具体检查点记录所需输入；敏感值仅脱敏比较，文档和报告不复制token、上下文签名或密钥正文。

历史风险仍保留：旧PinK 0.0.1.39 / alpha.35配置页加载曾请求新包上下文及密钥。当前1958包与custom beta.0 SDK已核实为页面请求游戏列表并刷新账号环境；包上下文在构建钩子获取，UI构建仍会追加make/upload。此前因此保留受阻；用户最新确认构建内部由产品负责，现已接入普通按钮任务链路；不将旧SDK加载副作用直接套用新版，也不从UI链为空推定终点安全。零构建不等于零外部请求。

## 本地选项九项用例与合并构建（2026-10-19）

用户已批准实现下表九项本地构建用例，独立工具已增加 `-Plan local-options-nine` 和可选 `-Cases` 子集选择；本批实包验证结果见本节记录。以下用例不增加38+24业务范围，也不重编号UI-C/UI-P或原C/Q分支。`next.*`是独立执行caseId，区分同平台不同最终状态；复用原执行器，不另建通用框架。下面独立UI专项仍只设计，本次不实现或执行。

### 本地构建主批：9个最终状态，全选时5组最多两项

代表平台公共背景沿R-L：Debug=false、MD5=true、主包本地、server空；Web桌面/手机用none，OPPO/淘宝用merge_all_json；保留当前工程、单入口场景和已批准模块背景，不操作账号/签名/图标。每项都检查实际加载、平台身份、联动稳定、最终回读、唯一新taskId、入队及终态参数和成功卡片。无材料不等于无需字段合同和UI适配，合同或合法性未确定的项先记受阻，不提交。

| 组/顺序 | caseId与平台                           | 同次构建的明确目标/预期                                                                                                               | 覆盖与复用                                                                   |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1/1     | `next.public.maps-off`，Web桌面        | Source Map关闭；mangleProperties=true、inlineEnum=false、experimentalEraseModules=true、useSplashScreen=false、bundleCommonChunk=true | 公共字段逐项核对；一次合法最终状态合并六项差异，不据整体成功推定各字段效果   |
| 1/2     | `next.public.maps-standalone`，Web桌面 | Source Map独立；上述五个布尔回false/true/false/true/false                                                                             | 补返回参数与第二枚举；同平台任务仍分别关联caseId/taskId/输出名               |
| 2/1     | `next.public.maps-inline`，Web桌面     | Source Map内联，保留上一项合法布尔目标                                                                                                | 补内联的明确UI/任务/build证据；未变化布尔只核对，不记本次修改覆盖            |
| 2/2     | `next.web-mobile.webgpu-on`            | 自定义useWebGPU=true，portrait、VConsole=false，其余R-L                                                                               | 补Web手机自身实现；不引用桌面WebGPU代替，不运行浏览器或打开预览URL           |
| 3/1     | `next.web-mobile.webgpu-return`        | useWebGPU=false，其他同上一项                                                                                                         | 真实开启后返回；检查联动提示和任务参数，预览/HTTPS效果仍下期                 |
| 3/2     | `next.oppo.engine-return`              | separateEngine=false，本地merge_all_json，其他专属保持批准的A目标                                                                     | 复用C开启成功，仅补关闭返回；不附带Zip/远程或生成RPK                         |
| 4/1     | `next.taobao.globals-text`             | globalAdapter=false，globalVariable为 `qaBuildFlag, qaBuildCounter`；asmjs、wasmSubpackage=false、separateEngine=false、portrait      | 假名仅为合法JS标识符代表，核对文本与任务；不要求新脚本或声称运行中已使用变量 |
| 4/2     | `next.taobao.globals-adapter`          | globalAdapter=true；前项文本保留但控件隐藏，其他背景不变                                                                              | 核对父项与子项显隐；按最终状态与已确认提交合同检查参数，不把隐藏当清空       |
| 5/1     | `next.taobao.globals-return`           | globalAdapter=false，确认原文本再现，再清空globalVariable；其余背景不变                                                               | 补恢复显示、清空、返回参数；旧Wasm B失败保留，不重试其编译分支               |

Source Map合同已核清：旧SDK share/builder-config.js虽用字符串候选，但当前实际CLI的api/builder/schema.js使用boolean或literal inline，PinK真实选项的data-pink-enum-value分别是JSON布尔false/true与字符串inline；隐藏input的DOM回读统一为字符串false/true/inline。工具按该类型合同真实点击，任务预期关闭/独立分别为布尔false/true，内联为字符串inline。淘宝全局适配源码切开关不直接清空文本；工具以已确认的可见初值、条件显隐、恢复显示回读和入队/终态参数分别取证，不把隐藏字段伪装成DOM回读。所有新字段纳入受限任务白名单，预期来自用例与提交合同，不从结果反推。

执行器已支持同一平台多个case，结果、进度、截图、组成员均按caseId区分，入队和终态核对各自finalConfiguration及唯一taskId。每组逐个配置提交，取得唯一任务后再处理组内下一项；组内收尾完成后才进入下一组，不补位第三项，不点击产品“全部构建”。选择子集仍保持表中顺序，每组选中用例最多两项；分批验收不重复已通过项。队列实际未出现waiting则记未观察到，不造任务或延长队列凑覆盖。

19日已记录的Web桌面六字段初态为false/true/false/true/false、Source Map inline；Web手机WebGPU为false，OPPO分离引擎为true，淘宝globalAdapter=false、文本空。执行前重新核对，不能把这些记录当永久当前值。要求真实A→B的case若初态不符，先记录受阻或重排计划，不偷偷复位制造通过；已有有效变化证据可复用。本批九项已逐用例完成，仍不视为固定KPI；以后复用有效证据，只补未覆盖或受影响的单元。

普通组合配置后直接构建，不为每项重开。持久化专项独立选择：新字段需要保存证据时，在没有活动任务的窗口做真实修改→关闭重开→核对→恢复，不成为所有平台构建的强制前置。mangleProperties既有17平台往返可复用，其余字段不借该单字段结果充数。配置/入队不明、观察丢失、超时或UI清理失败时按现有规则停止后续提交并收集已关联任务，不自动降级、重试或取消。

### 九项实包结果与证据边界

2026-10-19在当前PinK 0.0.1.39、配置选择official/4.0.0-alpha.35、l10n_007工程上分三次正常入口验收，**九项逐用例全部passed，9个独立taskId**。先[Web桌面关闭](../results/2026-10-19T03-46-19-293Z/result.json)，再[Web桌面独立与内联两项](../results/2026-10-19T03-48-05-346Z/result.json)，最后[其余六项三组](../results/2026-10-19T03-52-44-740Z/result.json)。这是分批验证合计9/9，不冒充一个全选九项运行记录；未重跑D/A/B/C或其他17页专项。三次均连接已运行的指定实例，未重新验证冷启动。

| caseId                          | 成功taskId            | 输出名               |
| ------------------------------- | --------------------- | -------------------- |
| `next.public.maps-off`          | task-1792381602422-9  | web-desktop-016      |
| `next.public.maps-standalone`   | task-1792381707108-10 | web-desktop-017      |
| `next.public.maps-inline`       | task-1792381722155-11 | web-desktop-018      |
| `next.web-mobile.webgpu-on`     | task-1792381981465-12 | web-mobile-009       |
| `next.web-mobile.webgpu-return` | task-1792381993255-13 | web-mobile-010       |
| `next.oppo.engine-return`       | task-1792382133959-14 | oppo-mini-game-008   |
| `next.taobao.globals-text`      | task-1792382148397-15 | taobao-mini-game-008 |
| `next.taobao.globals-adapter`   | task-1792382287438-16 | taobao-mini-game-009 |
| `next.taobao.globals-return`    | task-1792382302824-17 | taobao-mini-game-010 |

每项均完成真实变化（第三项仅Source Map变化）、稳定回读、入队与终态公共/专属参数核对、唯一任务和成功卡片确认，持久化为not-requested且无reopened快照。Web桌面五开关在首两项真实往返，第三项保留同值仅核对；Source Map任务值依次为布尔false、布尔true、字符串inline。淘宝开启项的hiddenFields保留已确认初文，任务仍携带文本；返回项conditionalSteps记录原文重新显示后回读，再通过真实键盘清空，入队/终态为空字符串。

五个实际验收组中四组观察到waiting→processing→success，一组单项不适用；任务创建/完成区间核对最多两项在途，六项运行的各组startedAt不早于前组settledAt。所有组均收尾，无本轮遗留活动任务、无清理警告。PinK窗口与本轮偏好保留：Web桌面公共开关回默认组合、Source Map inline；Web手机WebGPU=false；OPPO separateEngine=false；淘宝globalAdapter=false且globalVariable空。后续重跑OPPO返回项需重新确认真实开启初态，不自动复位。

Web手机两项的webgpuPreviewUI均为previewProtocol=unavailable，未出现可用预览URL；因此HTTP/HTTPS警告条件记未覆盖，不由开关/build成功推定。新字段独立保存、其他候选/校验、产物、运行和生成仍未覆盖；旧淘宝B的Wasm/Brotli失败不因本批asmjs通过而注销。OpenPaaS未进入，材料分支未执行，PinK/SDK/工程源码未改。

保留两次未提交记录：[首项枚举适配受阻](../results/2026-10-19T03-43-10-345Z/result.json)在Source Map选项定位超时，无新任务。核对当前CLI布尔枚举合同后修正；恢复前核对现场等于工具已确认修改值，随后仅经UI恢复本工具已改六字段，再完成首项真实变化验证，不重置整份偏好。[六项启动基线超时](../results/2026-10-19T03-51-25-891Z/result.json)没有配置写入或构建；随后只读检查两类均为78项且无活动任务，超时未复现，增加分类进度记录后续跑未提交六项。未将原因断言为产品加载失败或已根治，也未增加自动重试。

类型检查、TypeScript编译、changed-file Prettier、PowerShell入口语法和基于修改前备份的git diff --no-index --check通过。没有新增测试文件或模拟成功测试；本节为正常工具驱动真实打包版的证据。PinK-Test不是Git checkout，未初始化或提交仓库。操作与参数见[工具说明](../tools/build-ui/README.md#九项本地选项用例)。

## 下一批公共UI专项与三项合并构建设计

**状态：仅设计，待实现、未执行。** 本次只更新设计文档，未改工具、未操作配置、未提交构建。以下为下一批待测清单，不是可运行的新命令；现有 `-Plan local-options-nine` 仍只执行前述已实现九项。复用UI-C/UI-P和38+24业务范围，下面 `planned.*` 仅是候选执行caseId，不重编号业务用例。覆盖状态、受阻项和18平台明细以上方唯一矩阵为准。

### 公共UI专项：独立选择，零构建

代表平台选web-desktop，平台自定义或条件差异按18平台矩阵补实例。专项不成为普通构建的强制前置；只有目标构建用例依赖的字段合同与材料必须先就绪。除明确复用的旧证据外，下表均为**已设计、待实现、未执行**。

| 专项及复用用例                               | 已有覆盖                                                 | 下一批待测操作与预期                                                                                                                                                           | 受阻与边界                                                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保存往返（UI-C13/C14/C18/C20/C24）           | 17平台mangle保存/恢复；新九项配置→任务→成功已通过        | 代表平台对inlineEnum、experimentalEraseModules、useSplashScreen、bundleCommonChunk、Source Map及本批新字段做合法真实修改→回读→关闭重开→再回读→恢复；逐字段判定保存和非目标保持 | 同值重开不记修改；普通构建仍直接提交；不对17页复制全套公共模式                                                                                                                                                                                                         |
| 名称、路径、输出名、选择器（UI-C04～C07）    | 原值回读、自动输出名与任务关联已有                       | 分别编辑合法值、失焦、回读；按已明确规则检查必填及冲突提示后恢复。选择和取消须通过真实选择入口独立取证                                                                         | 受控测试目录/新输出名，不覆盖旧输出。选择器适配/协议及冲突规则未核清则对应分支受阻；不把手填当选择器通过。本轮三次构建不宣称已验证自定义名称/路径传参                                                                                                                  |
| 场景（UI-C08～C10）                          | 单scene-2d构建已有；两个场景元数据/UUID已确认            | 搜索命中/无匹配/清空，单选/多选/全选，切换入口并检查选中集合及入口约束；合法最终集合进入下方合并构建                                                                           | scene-2d=`2e58824f-0bca-4f31-a495-1eceb60b610f`；audio=`51aa1a3c-4184-422b-b643-fd09a9dcb82f`。不改场景源码，空集合或非法入口只查UI，不提交                                                                                                                            |
| MD5子项（UI-C12）                            | MD5父开/关已有，模板链接子项尚无独立任务证据             | MD5开启时修改 `md5CacheOptions.handleTemplateMd5Link`；关闭时检查隐藏，恢复时先核原子值再修改；合法状态与下方构建合并                                                          | 子控件没有独立data-option-key，不能点击父项冒充子项。表单源码为父关仅隐藏、子值保留；任务保存/忽略合同仍需核清，隐藏项不读写DOM补值                                                                                                                                    |
| CCONB与数值（UI-C18）                        | enable=false、threshold=16只读快照，不是变化/build通过   | enable往返，阈值候选32和16的真实数字输入、失焦和回读；检查最终值及任务数值类型                                                                                                 | SDK `dist/core/builder/share/builder-config.js` 声明number/default16，worker的 `asset-handler/bundle/bin-group.js` 按threshold×KB使用，未给出完整边界规则。32是普通正整数候选，需当前UI校验；不猜最小/最大值。快照中关闭时阈值仍可见，不预设隐藏；不证明实际资源已分组 |
| 引擎区、缓存宏（UI-C19/C20）                 | Builtin/Bullet/WebGL2部分已通过                          | 本批缓存宏测试 `on` / `off` / `inherit-project-setting`；区域折叠与继承回读。预设、Cannon/2D物理的其他候选放后续定向批                                                         | 只选当前真实候选；不修改工程模块或新建预设制造前提，不据无物理样本的build宣称物理效果                                                                                                                                                                                  |
| 公共交互（UI-C02/C03/C23/C26，平台包含开关） | 正常打开/关闭、直接提交与成功卡片已有                    | 滚动及控件可达、明确合同下的焦点/关闭方式、提示、复制key；包含此平台开关真实变化/保存/恢复                                                                                     | 无key的自定义项不虚构复制功能；剪贴板/选择器需局部适配；不点击实际全部构建，不由单个包含开关推定全量分发通过                                                                                                                                                           |
| 其余平台条件UI（UI-P03/P06/P08）             | 新增10平台已有当前值合同及分批基础证据；专属变化仍待实现 | 各平台实际可见的渲染/方向/API/ABI/调度/加密/签名；Google/AGC的Activity→宽高比及Google Instant→URL；NEXT引擎/设备/手柄；小游戏按本节逐平台清单，不将不存在的选项交叉复制        | 无候选API/ABI、未知合法范围单列受阻。加密可用符合校验的非生产测试值，但先补脱敏；合法签名需匹配文件，AGC已有服务JSON；自定义文件和错误分支另列；不执行SDK安装、开发工具、生成、运行或上传                                                                              |

各平台专属保存/输入校验可与打开一次表单的UI专项合并，但不能用代表平台替代vivo原生下拉、淘宝无key表单、Google Play自定义表单或NEXT条件差异。多Bundle尚未确认足够的合法可切换实例；L10N需核清现有Catalog、目标/默认/回退语言集合。先复用现有材料，不因只读控件存在就计选择/保存/build通过，也不自动请QA重做已有场景或PNG。

### 三项代表平台合并构建：2+1分组

三项均为web-desktop，**已设计、未实现、未执行**。沿用当前工程及已批准模块背景：Debug=false、主包本地、server空、压缩none、Source Map inline；MD5按下表显式变化，不被R模板的固定true覆盖。名称/构建路径保留已确认工程值，使用产品正常分配的新输出名，不复用旧输出。五个公共开关、WebGPU等已有效覆盖值只回读，不重复记新增变化。

场景集合写实际UUID数组，入口必须属于所选集合；顺序要求与材料身份分别核对。普通链路配置→等联动→最终完整回读→直接构建，不为每项重开。保存专项独立选择。

| 组/顺序 | 候选caseId                      | MD5与子项                                                                    | CCONB与缓存宏                                                          | 场景集合/入口                | 独立预期及复用                                                                                                    |
| ------- | ------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1/1     | `planned.public.md5-child-off`  | md5Cache=true；md5CacheOptions.handleTemplateMd5Link=false                   | enable=true；threshold=32；cleanupImageCache=`on`                      | scene-2d+audio；入口audio    | 子项真实关闭、CCONB开启/数值修改、宏开启、多场景及audio入口；每个字段分别回读并核对任务，不以整体成功代替参数证据 |
| 1/2     | `planned.public.md5-parent-off` | md5Cache=false；子项隐藏；表单保留前项false，任务携带/忽略按事先核清合同核对 | enable=false；threshold保留32；cleanupImageCache=`off`                 | 仅scene-2d；入口scene-2d     | 父关及子项隐藏、CCONB关闭、宏关闭、场景排除/返回；不能把隐藏视为清空。CCONB关闭时后端不执行分组，仍按合同核参数   |
| 2/1     | `planned.public.md5-child-on`   | md5Cache=true；先确认原false子值恢复显示，再改true                           | enable=true；threshold=16；cleanupImageCache=`inherit-project-setting` | scene-2d+audio；入口scene-2d | 子项恢复与开启、阈值32→16、缓存继承、多场景中的另一入口；子项/阈值/宏各自判定。此项不是整份配置恢复，CCONB仍开启  |

执行前先记录实际初态、真实候选、场景身份及非目标字段。需要A→B的用例初态不符就记受阻或另行重排，不能自动复位制造通过；当前值等于目标仅算回读。32未通过当前UI校验时停止该分支，不自行改成其他数字再声称原用例通过。

先核清MD5子项及关闭后任务表示、CCONB数值/关闭保留、缓存宏继承和场景序列化合同，再实现最小适配：子控件定位、公共number类型真实输入/回读、按用例声明的场景集合/入口断言、受限任务白名单及预期。当前执行器固定单场景断言，不能直接拿既有命令运行这三项；不移除校验来假装支持多场景，不从任务实际值反推预期，不另建流程框架。

三项具有连续初态依赖：前项目标状态未形成，后续依赖项受阻，不自动补动作制造前置；已观察到本平台构建失败时暂停尚未提交项，已提交项继续收集且不自动取消。第1组逐项提交，每项取得唯一taskId及入队参数后再处理下一项；两项都收尾并核对终态/成功卡片后进入第2组。每项独立caseId、finalConfiguration、taskId、输出名和结果；一组最多2项，不补位第三项。waiting未实际出现就记未观察到，不为凑队列额外构建。遇到配置不明、任务关联/参数异常或超时按现有规则停止后续提交并收集已关联任务。

若批准执行时包含恢复，结束仅经UI恢复本轮实际修改字段并核对，不为恢复额外加第4次构建，不覆盖整份偏好。三项通过最多证明UI选择→任务参数→本次构建成功；不证明MD5链接、CCONB实际文件分组、多场景运行或缓存宏效果。名称/路径自定义传参、其他引擎/物理候选、预设、完整包装模式、产品全部构建、产物和后续阶段继续另列。

### 暂缓项与QA输入

M01～M07继续由前表唯一维护，不复制新的材料编号。图标有候选但路径合同未完成、URL/AppID有候选但有效性未确认，不等于已就绪。其余平台的输入与核实责任如下；只影响对应分支，不成为18平台配置页的统一门槛。

| 输入或条件                                                  | 影响分支                                        | 交付状态                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| AGC服务JSON及匹配包名                                       | AGC合法文件、校验解除和构建正向侧               | 已选入UI，包名com.testcases.cocos；1958基础构建及任务合同已通过，见构建设计AGC记录 |
| 自定义keystore、别名及有效密码                              | Android/AGC/Google Play的自定义签名侧           | 材料待提供/确认；仅本地读取所需字段，不在文档保存密码，默认签名侧不因此删除        |
| API/ABI合法候选与SDK版本，原生模板/工具链及NEXT引擎支持矩阵 | 原生合法选择、联动及构建资格                    | 待环境/合同核实，不直接断言机器缺SDK；只要求build实际消费的部分                    |
| 微信匹配正式SDK与插件测试条件，其他平台插件适用规则         | 插件启用正向侧及其包装/压缩联动                 | 待版本/合同核实；禁用/提示侧保留，不阻塞方向等独立UI                               |
| OpenPaaS现有有效测试游戏ID及仍缺的必填值                    | 游戏选择、必填完成和身份回读                    | 当前账号已有候选，配置专项已通过；真实无候选/权限不足/值缺失才请QA提供具体输入     |
| 预览地址、足够的Bundle及有效语言候选                        | Web手机HTTP提示、Bundle选择、L10N附加UI的对应侧 | 旧现场部分不可用或合同未核；复用现有材料，不为UI交付自动新建服务/工程              |

设备、商店或make/run才消费的输入不一律前移成本地build前置。下期产物、物理、纹理及图集效果材料仍由原业务用例维护，本轮不制作或执行。

现有场景和PNG候选先复用；多个Bundle、L10N语言集合不足时再补。CCONB普通阈值和缓存宏继承已纳入上述三项待测设计，边界规则仍未覆盖；预设、Cannon/2D物理及完整包装模式不缺文件但仍有规则/适配工作，保留后续定向批，不重跑已完成九项。图集/纹理实际处理和物理效果样本不阻塞现有开关/入参检查；产物、运行、生成/上传、淘宝插件D/E、远程/Zip及产品全部构建继续保留原边界。

## 用例步骤与判定

R、D 各自独立设置完整的目标字段。为了节省操作可以沿用同一工程和窗口，但每次提交前必须回读本组合的完整适用字段，尤其是 Debug、MD5、远程主包、服务器、压缩、纹理、图集、物理模块和平台覆盖值。

1. 核对 PinK/SDK/工程身份、平台 ID、当前任务基线和材料；记录初态、保存偏好与字段不适用项。材料缺失或未获确认的后续阶段超出终点时只做前提检查，不提交；OpenPaaS正常按钮按已确认口径执行。
2. 从左侧 X-Device / X-Application 分类入口打开平台新建配置；不能编辑旧成功任务冒充本次新任务。
3. 通过可见 UI 配置本组合：先选择模块与平台依赖项，再设置服务器/远程包、压缩等关联选项；等待异步联动。隐藏字段不调用 API 补写。
4. 回读实际值、校验提示和主构建按钮阶段；普通链路直接提交，显式保存专项才关闭重开，并以该次最终回读为统一快照。无提示不能替代值核对；产品正常生成的输出名与包名联动单独解释。
5. 真实点击一次“构建”，以基线、点击时间、平台、实际输出名及唯一任务 ID 关联新任务。核对已取得的任务选项与组合预期；平台正常化造成差异时说明规则，不用实际结果反推预期。
6. 跟踪同一任务到终态，并复核对应 UI 卡片。UI 值正确、可取得的任务参数正确、任务成功及卡片成功才判本组合通过；未取得必要任务参数时记录证据缺口，不将其视为已核对。
7. 保留失败、超时、配置差异或受阻原因；不自动降级组合、重复点击、修 SDK、改签名或继续超范围阶段。结束只释放工具观察连接，保留任务与输出；配置恢复另按执行时约定处理，不清空用户偏好。

输出最小信息为：工程/版本、分类/平台 ID、R/D 及平台覆盖规则、提交前 UI 值、字段不适用项、任务 ID/批次/终态、预期与实际差异。组合成功只能说明这些输入能被提交并完成构建，不能逐项证明纹理、图集、远程资源、物理模块在产物中的最终效果。

AGC服务文件及当前基础构建已验证；其他SDK/API候选仍按分支核对，AGC当前无ABI选择UI；本轮不额外扩展“点击非法配置”的负向构建用例，也不为了观察失败提交已知缺材料任务。

## 两个“全部构建”入口

先建立各平台组合的独立预期，再设计批量入口检查。各平台同一组合必须已通过 UI 保存并重开确认，单平台成功仍不能替代全部构建的集合和参数分发检查。

- 当前分类 ID 是 X-Device=`native`、X-Application=`game`，两类 `excludedFromAll` 均为空。按 UI 卡片、状态与随包代码推算，分别会包含 7 和 11 个平台；没有实点验证任务数。当前 Windows 隐藏的 mac、ios 不属于这 18 个入口。
- 原生分类AGC基础构建已单独通过，OHOS环境已由测试组保证，工具入口已开放；本机新组合UI/入队核对通过，任务因SDK目录不存在失败；应用分类OpenPaaS正常按钮内部自动阶段已核实并获用户确认，不再因此受阻；产品“全部构建”的集合/场景/分发行为仍未实测，不以卡片可点击作为提交依据，也不据此排除OpenPaaS配置页用例。
- 单平台配置页有场景补齐、校验与部分平台配置规范化；随包 `runBuildAll` 主要合并配置和偏好、处理输出名、设置 nextStages 后批量提交，未执行同一段场景补齐。因此必须验证批量任务的场景和组合参数，不能认为“预先打开看过”就等于已保存。
- 以后确需选择部分平台或修改包含开关时，应先明确实际目标集合及恢复约定；当前不修改开关，也不把缩小后的集合称为 18 平台全覆盖。
- 分别验证 R 和 D 的批次分发，按平台核对新任务集合、重复/缺失任务及父子关系。批次终态按每个平台判定，内部队列由 PinK 管理，不推定并行，也不为节省时间混用上一组合的偏好。

## 设计完成后仍需确定的输入

18平台用例与首批范围已定稿；待补输入不阻止设计或已实现部分交付。8平台M01～M07以及其他平台输入统一由前述材料节维护；OpenPaaS配置专项已补齐，普通按钮构建链路已接入、实际结果独立记录，不再要求整个平台跳过。纯出厂默认态、混合组合三、跨操作系统及产物/运行验收不在首批范围；旧定稿记录不自动触发材料制作或脚本重跑。

源码核对入口为随包 Builder 的 `dist/web/custom-views/PlatformConfigModal.js`、`filePickerBridge.js`，实际 SDK 的 `dist/core/builder/manager/plugin.js`、`packages/engine/editor/engine-features/render-config.json`、各平台 `src/hooks.js` / `dist/hooks.js`。平台 ID 和控件可见性来自实际 UI 快照；schema 枚举和静态钩子分析不替代真实组合构建。版本、SDK、工程配置或平台包变化后，只刷新受影响的前提与用例，不沿用过期成功结论。

## B 轮当前实现范围（2026-10-17）

按已批准方案新增 release-b / release-b-priority，使用原两项分组调度；专属配置和候选值见[工具说明](../tools/build-ui/README.md#b-轮非默认组合)。当前边界：vivo 分离引擎因当前 UI 隐藏不执行；四个快游戏 runtimeVersion 保留 2.0.0，版本名/版本号、包名、方向可纳入 B；荣耀/华为最低平台版本及 warn 纳入当前本地构建参数验证。

只读确认的补充前提：当前工程引擎预设包含 3d，随包 UI 显示 nativeCodeBundleMode；选择 wasm 后才应显示 Wasm 压缩。C10 开启侧与 TA02 合并，通过真实控件设置，UI true 与任务 brotli 分别核对，未改变工程模块或物理背景。华为 separateEngine=true 的最低版本要求 >=1091，候选字符串 1104 满足；当前 SDK 构建钩子对缺插件文件只警告，后续 make 才需要额外文件，部分引擎分离初始化已注释。因此可测本地 UI/参数/构建兼容，但不能推定真实分离效果或打包可用。

B 的每项记录初态、写后回读、关闭重开、入队参数、终态参数和成功卡片；8 项分成 Web 两端、OPPO/vivo、荣耀/华为、淘宝/Facebook 四组，每组最多 2 项，本组全部收尾后进入下一组。缺材料、返回侧、其他公共模式和其他 10 平台不因 B 实现而视为通过。实际执行结果统一见[构建设计](pink-build-ui-automation-design.md)，当前逐平台结果为 7 passed / 淘宝 1 failed（Web 手机为适配后的定向补测），不是单批 8/8。C02/C05 发布代表已通过；TA01/TA02/C10 开启侧只计 UI、重开和入队确认，构建失败保留，不降低预期。

## 首批 QA 工具补齐（2026-10-19）

现有工具登记18目标，支持17平台通用基线及公共字段往返；2026-10-20另增加OpenPaaS专属必填/已有游戏检查，实包证据独立保存。通用模式不进入OpenPaaS，不把不同批次拼为全目录通过。配置专项不提交构建，不代表每个字段交互全部通过。AGC必填错误属于对应构建前提，不把表单加载判失败。可执行入口见[工具说明](../tools/build-ui/README.md#首批配置页检查18-个目标)，首批承诺由[交付范围定稿](pink-build-ui-automation-design.md#首批交付范围定稿2026-10-19)统一维护。

D/A/B 的既有结果继续复用，不为工具整理重跑整套。普通构建默认不重开；显式保存专项要求本次真实变化。A/B 的 `-ApplyProfile` 允许经 UI 设置已审阅的非敏感专属字段，解决 B 后再跑 A 时单纯基准比较造成的受阻；账号、签名、图标和运行时版本保持基准守卫，不做通用重置。

C 的不缺材料部分单列 `release-c-local`：Web 桌面 R/merge_all_json；Web 手机 portrait/调试器关闭；WebGPU、分辨率、快游戏元数据/方向/全屏/日志、华为分离引擎等按清单返回；OPPO 本地 merge_all_json 加分离引擎开启；淘宝在条件控件可见时先关闭 Wasm 压缩再回 asmjs/分包关闭；Facebook 返回。OPPO 未选择 Zip，此任务不能计 C04 或 C09 远程侧通过。UI 控件压缩 false 对应任务字段缺省；先回读再隐藏，不向隐藏字段补写。

M01～M05、非默认 runtimeVersion、淘宝分离引擎、D/E 尚缺的收尾、vivo 未显示项及“全部构建”继续保留。新的最终判定和实际任务证据统一见[构建设计](pink-build-ui-automation-design.md)，不在本页复制结果清单。本节历史现场引擎选择为 4.0.0-alpha.35，旧 D/A/B 结果不据此视为新 SDK 回归通过，淘宝旧 B 失败也不被其他组合成功覆盖。

C-local的当前逐平台结论为8平台均有成功证据，来源是7通过/淘宝1受阻的批次加淘宝定向补测，不能标成原批次8/8。WebGPU和分辨率回A的真实变化由本次先行Web桌面A直接构建证明，随后的C03仅改变压缩模式；其余返回变化按confirmedChangedFields判断，不把初态已等于目标算成本次修改。OP分离引擎开启、华为关闭、淘宝压缩关闭/asmjs/分包关闭已有本地build成功。D/E收尾与材料分支继续保留；此状态不抹去旧B淘宝失败。

</details>

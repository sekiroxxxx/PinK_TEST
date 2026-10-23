# Builder 测试仓库的材料设计与结果核验参考

`SUD-GLOBAL/builder-ui-test-extension` 值得借鉴的是：用真实项目材料支撑明确的操作目标，再分别核对保存配置、实际任务和构建产物。它不能直接替代 PinK 的 UI 自动化基座，也不能仅凭配置一致就判定游戏运行正确。

本记录只保留 Creator 3 相关设计。业务范围仍以 [首轮回归用例](pink-regression-cases.md) 为准；项目组成、材料映射与恢复方案维护在 [测试项目设计草案](pink-test-project-design.md)，此处不另维护一套清单。

## 参考版本与适用范围

- 仓库：[builder-ui-test-extension](https://github.com/SUD-GLOBAL/builder-ui-test-extension)。
- 记录日期：2026 年 10 月 15 日。
- 源码快照：`bb970fd457a34d105d1ddfb476ee48cc3f58cca3`，对应 2026 年 10 月 9 日提交；下文源码链接固定在此版本。
- 证据范围：仓库文档和源码静态核对，未安装插件或执行真实 Creator 验收。这里的实现事实不代表 PinK 已拥有相同接口或已通过测试。

## 原仓库的测试方式

| 路径 | 操作与核验 | 证据边界 |
| --- | --- | --- |
| 标准界面交互 | 工具提供确定的字段和值；测试人员修改真实 Builder 面板、点击真实构建；工具采集配置和新任务并比较 | 核对界面操作后的配置保存与任务传值，不是无人值守 UI 点击 |
| 自由界面交互 | 人工按业务目标操作；工具采集差异、任务、校验和恢复结果 | 工具不猜测业务预期，保留人工确认 |
| 构建产物检查 | 从 Creator 3 持久化 Profile 发现任务配置、关联输出目录，执行注册规则 | 只覆盖声明的字段或结构，不等于启动产物并验证运行 |

交互检查先记录已有任务 ID，再寻找本轮新增任务；多个同平台新任务被视为无法唯一归属。源码另有“本轮唯一新增任务但平台未匹配”的警告式回退，因此不能把当前实现理解成任何情况下都严格证明平台归属。PinK 的任务排队与配置隔离用例需要明确关联本次提交、参数快照和输出，不能直接用“最新任务”代替。

来源：[交互验收设计](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/docs/builder-form-interaction-verification-plan.md)、[交互检查实现](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/shared/static/api-example/interaction-check.js)。

## 值得借鉴的材料设计

| 思路 | 原仓库做法 | 对 PinK 材料设计的启发 |
| --- | --- | --- |
| 使用真实资源身份 | 场景和 Bundle 候选来自当前项目资源及已有配置，不伪造 UUID、URL 或 Bundle 名称 | 提供内容可区分、确实存在的场景；工具解析实际身份，保留它与场景角色的对应关系 |
| 准备可切换的输入 | 选择与当前值不同的合法候选；材料不足则记录缺口 | 场景、图片、语言等要有明确对照，不能只有一个候选却要求验证切换 |
| 文件字段使用真实材料 | 插件携带真实图标文件，不使用不存在的假路径 | 工程外导入件、更新件与故障修复件都应真实可用；不同用途不要混用 |
| 明确依赖组合 | 签名等关联字段需要成组合法材料，不能只填写一个孤立字段 | 只为已选范围准备完整依赖；账号和密钥属于环境前提，不随项目分发 |
| 预期值可明确比较 | 标准交互给出具体目标值，不只要求“改为另一个有效值” | 材料应让配置、画面和业务结果都有可观察的差异 |
| 材料不足不伪装执行成功 | 没有可切换资源或确定候选时，记录待补材料与原因 | 区分材料阻塞、未执行和产品失败；不靠排除字段掩盖材料缺口 |

来源：[真实项目资源候选](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/shared/static/api-example/project-resources.js)、[Creator 3 字段策略](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/creator3/interaction-profile.js)、[仓库使用说明](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/README.md)。

这些思路用于完善现有材料方案，不增加新用例：

- 场景入口切换依靠 A、B 的明确身份和不同内容，不只检查下拉框显示。
- 图片更新依靠原件与更新件的内容差异，同时按用例保留路径和 meta；不能仅靠修改时间判断。
- L10N 使用随目标 PinK 打包并实际加载的插件，准备可区分译文、目标语言缺 Key 和完整条目对照。原仓库的通用字段检查不能替代这条运行时核验。
- 首次配置、空目录创建、未保存修改等状态由对应流程真实产生，不能提前填好“正确结果”。

## 分层核验结果

构建链路应分别回答五个问题。各层有自己的预期，不能只把上一层的实际值当成下一层唯一的正确标准，否则同一个错误可能一路保持一致。

| 层级 | 要核对的内容 | 不能替代的证据 |
| --- | --- | --- |
| UI 操作 | 对正确对象执行操作，控件状态符合用例目标 | API 直接写配置不能证明 UI 可用 |
| 保存配置 | 回读值符合指定目标，非目标字段没有意外变化 | 面板显示正确不能证明保存成功 |
| 实际任务 | 本次提交的任务身份、平台及参数快照正确 | 当前草稿或旧任务不能代表本次输入 |
| 对应产物 | 输出与本次任务关联，必需字段、内容及结构符合预期 | 构建成功或配置回显不能证明全部选项生效 |
| 实际运行 | 启动对应产物，检查入口、交互及语言显示 | 文件存在、JSON 一致不能证明运行正确 |

原仓库的产物规则分为配置字段映射、文件与结构效果等。例如把配置与生成 JSON 比较，或检查 Bundle 结构。这种规则组织可以参考，但具体路径和断言必须按目标 PinK 与引擎产物确认，不继承 Creator 的目录假设。

来源：[产物规则边界](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/shared/static/api-example/artifact-check/README.md)、[字段规则实现](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/shared/static/api-example/artifact-check/registry.js)。

## 结果展示与恢复

值得保留的结果组织方式是：同一份结构化数据支持测试人员阅读和工具处理。原仓库使用自包含 HTML，并内嵌机器可读 JSON；PinK-Test 可借鉴这种形式，无需为了查看结果先建设独立前端平台。

结果应能关联用例、测试轮次、实际 PinK/SDK/插件身份、项目副本、任务与输出，以及期望值、实际值和失败原因。采集范围服务于定位问题，不保存凭据；不能仅记录版本号就推定实际消费的包相同。

恢复方面，原仓库会回写操作前配置并再次读取确认，但对于操作前未设置的部分字段，会保留测试值并记录警告。因此“执行了恢复”不等于“全部初态已恢复”。PinK-Test 优先使用不可变原始材料与可丢弃工作副本；工程外的偏好、语言存储、任务和 Agent 状态另行确认，不能以复制项目代替环境隔离。

来源：[交互报告与恢复约定](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/docs/builder-form-interaction-verification-plan.md)、[恢复实现](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/shared/static/api-example/interaction-check.js)。

## 不宜直接采用的实现

| 实现或约定 | 不直接采用的原因 |
| --- | --- |
| Creator 插件宿主、Editor.Message、本机 HTTP 测试端点 | 属于 Creator 接入方式；PinK 优先核对既有能力，不为复用该仓库新增同样的服务 |
| Creator Profile 路径和平台产物落点 | 是特定宿主与版本合同，需要重新确认 PinK 任务和产物的实际来源 |
| schema 驱动抽样代替业务回归 | 字段可编辑不等于业务链路正确；固定关键用例和 L10N 组合不能被抽样跳过 |
| 固定种子的字段轮换被理解成跨次遍历 | 当前策略以平台和模块等固定信息决定顺序；同一候选池重复执行不保证覆盖其他字段 |
| 部分规则通过即视为整个任务通过 | 当前产物汇总在没有失败且存在通过规则时可标为 passed，即使另有 skipped 或未注册规则；PinK 必需检查缺失不能据此算完整通过 |
| 缺产物统一记为 skipped | 对要求产物存在的明确用例，缺失是未满足预期；只有适用条件不成立才应跳过，前提不具备则记录阻塞 |
| 报告保留所有现场原值 | 交互设计文档说明保留密码、token 等原值；PinK 报告不应照搬该策略，避免敏感信息流转 |
| FTP 上传、全局链接与环境切换流程 | 不属于当前项目材料和核验需求，不因参考仓库而扩入范围 |

来源：[Creator 3 策略](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/creator3/interaction-profile.js)、[产物汇总实现](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/shared/static/api-example/artifact-check/index.js)、[Creator 3 宿主入口](https://github.com/SUD-GLOBAL/builder-ui-test-extension/blob/bb970fd457a34d105d1ddfb476ee48cc3f58cca3/creator3/panel.js)。

## 对当前设计的用途

本记录作为测试项目设计和后续核验工具的参考，不决定技术选型，也不授权迁移代码。下一步在现有材料方案中核对：是否提供足够的真实对照材料、是否能关联本次任务与产物、是否有独立运行预期、是否能恢复初态。需要调整时仍在对应方案和用例的原维护位置处理。

现有 PinK UI 基座主要提供操作能力，本仓库主要提供构建核验和报告思路。两者可以互补，但实际接口、安装包兼容和运行闭环仍需在后续获批的实现与验证阶段确认。

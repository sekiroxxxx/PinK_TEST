# TesterArmy e2e 的自动化设计参考与适用边界

`tester-army/e2e` 可供 PinK-Test 参考的重点是固定脚本与 AI 辅助的分离、明确断言、步骤级进度和结构化结果。它可列为浏览器预览及 web-desktop 产物运行测试的技术候选，但不据此确定统一框架，也不替换现有构建工具。

用例范围仍由 [首轮回归清单](pink-regression-cases.md) 维护，材料组织见 [测试项目设计](pink-test-project-design.md)。本记录不增加用例或实施任务。

## 参考版本

- 仓库：[tester-army/e2e](https://github.com/tester-army/e2e)。
- 记录日期：2026 年 10 月 16 日。
- 调查快照：`b41afa262ec32a7e90d065a4624f69f8f4a22e4f`。以下链接固定在该提交，不代表仓库后续版本。
- 证据范围：README、官方文档及 Web 引擎部分源码的静态核对；未安装、运行或验证 PinK 接入。

官方将项目定位为 Web 与移动端 E2E 框架，并说明仍在迈向 1.0，次版本间 API 和配置可能变化。引入前应确认具体版本与维护成本，不能以功能介绍代替安装包验证。[项目说明](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/README.md)

## 固定脚本与 AI 执行的区别

| 方式 | 仓库提供的行为 | 对 PinK 的参考价值 |
| --- | --- | --- |
| 固定脚本 | 使用定位规则执行点击、填写等动作，使用明确断言；没有 Agent 步骤时无需模型 | 符合稳定回归的确定流程，不要求每次临场规划 |
| AI 实时执行 | `agent.act` 接受自然语言目标；模型根据界面观察选择动作 | 可辅助探索或完善流程，不默认成为固定回归执行方式 |
| 已验证动作回放 | 后续检查确认结果后记录 `act` 动作，下次优先回放；不匹配时默认交给 AI | 可研究减少重复模型调用，但回放与实时接管须在结果中区分 |

AI 操作默认主要读取角色、名称、文字和状态等语义快照，不等于每一步都看图点击；视觉模式和像素操作另有支持。`agent.assert`、`agent.waitFor`、`agent.extract` 不使用动作回放缓存，仍实时执行。[Agent 步骤机制](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/docs/agent-steps.mdx)、[缓存机制](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/docs/cache.mdx)

PinK 的稳定回归应提前确定初态、操作目标、等待条件和业务预期。固定流程不要求固定屏幕坐标；定位稳定控件后执行，并根据实际状态等待和检查即可。AI 辅助是否引入，属于另行评估的执行选择。

## 值得借鉴的设计

| 设计 | 原仓库能力 | 对 PinK-Test 的启发 |
| --- | --- | --- |
| 操作与断言分开 | 同一用例可使用 Agent 操作和精确 locator 断言，也可完全不用 Agent | 结果不只依赖执行者自报完成，关键业务结果有独立预期 |
| 语义定位 | 支持 role、label、test ID 等定位方式，Web 引擎也有 CSS 与 iframe 入口 | 优先稳定身份与控件语义，减少布局变化对固定流程的影响 |
| 执行步骤有身份 | 用例、尝试和步骤分别记录身份，重试有不同的 attempt ID | 能分清第一次失败、后续重试和最终结果，避免证据混用 |
| 进度来自真实事件 | 运行、准备、用例、步骤的开始和结束都有事件；同一事件流支持展示 | 未来测试组界面消费执行事实，不靠预估时间显示虚假进度 |
| 状态保留语义 | 步骤可区分 passed、failed、blocked、timed-out、cancelled 等 | 材料或服务阻塞与产品行为失败分开，不把所有非通过归为产品缺陷 |
| 结构化结果与附件 | 最终报告关联尝试、步骤和附件，支持自定义 reporter 及 JUnit、Markdown 输出 | 命令行和展示入口可共享结果，不各自维护一套判定逻辑 |
| 界面引擎与执行组织分工 | 引擎负责平台观察、操作与进程机制，runner 负责用例和执行组织 | 业务用例不直接混入所有宿主细节；这里只参考分工，不默认建设自定义引擎 |

来源：[Web 引擎](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/packages/web/README.md)、[报告与进度事件](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/docs/reference/reporters.mdx)、[引擎职责](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/docs/writing-an-engine.mdx)。

框架中的测试 Agent 是执行测试的角色，不是被测的 PinK Agent。使用它也不能自动证明 PinK Agent 的上下文、修改、接受与拒绝流程正确，仍需对应业务用例和文件、运行结果检查。

## 回放不能替代回归判定

动作回放会核对起始路由、目标控件及结束状态等条件。默认回放不匹配时，AI 可从当前画面接管；这种机制用于完成目标，但可能改变原有操作路径。

如果用例要保护“指定入口可用”，AI 换入口后达成目标不能算原入口通过。如果要保护某个配置组合，也不能让 AI 换配置绕过失败。是否允许备用路径应由用例合同决定，不能由执行器自动扩大。

该仓库的严格缓存模式可以在部分旧记录失效时直接报错而不调用模型，但不等于全程禁用模型：新步骤、部分不可回放或截断的记录等仍可能实时执行。稳定回归若要求无模型依赖，应从用例中明确使用固定操作和精确检查，而不只依赖严格缓存开关。[严格缓存的适用条件](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/docs/cache.mdx)

缓存记录也不是完整测试预期或运行证明。普通输入值可能被记录，分享前需要检查；开启 AI 时，还需明确界面内容进入模型的范围与敏感数据策略，不能把脱敏功能介绍当成本项目的安全验收。

## 对 PinK 的适用边界

| 范围 | 当前判断 | 需要另行确认的内容 |
| --- | --- | --- |
| 浏览器预览 | Web 引擎是相关候选 | 本地预览启动、页面生命周期、业务脚本与确定性检查能否满足用例 |
| web-desktop 产物运行 | Web 引擎是相关候选 | 是否启动本次任务产物，实际场景、交互及 L10N 显示能否核验 |
| PinK 构建面板与其他编辑器 UI | 不能按普通网页直接认定可用 | 安装包启动、已有窗口与 Webview 识别、跨面板操作、重启和宿主状态 |
| CDP 连接 | 官方支持 Chromium CDP 接入 | 接上端口不等于选对 PinK 工作台、保持正确页面身份或控制完整 Electron 生命周期 |
| 自定义桌面引擎 | 有扩展合同，不是现成 PinK 支持 | 是否比复用现有能力更省维护；只有实际需要且获批才实施 |
| 构建配置、任务与产物核验 | 不因引入 UI 框架自动具备 | 仍要按 PinK 的业务合同设计，参考 [Builder 核验思路](builder-ui-test-reference.md) |

Web 引擎支持多个标签页和 iframe，但它的浏览器页面模型不能直接证明适配 PinK 所有 Webview 与场景目标。CDP 连接和恢复另有浏览器上下文、页面身份及生命周期限制，不应直接套到正在使用的 PinK 会话。[Web API 与 CDP 边界](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/docs/reference/web.mdx)、[CDP 连接实现](https://github.com/tester-army/e2e/blob/b41afa262ec32a7e90d065a4624f69f8f4a22e4f/packages/web/src/browser-connection.ts)

## 当前使用方式

先把它作为执行组织、进度和结果设计的参考，以及浏览器测试的候选。是否引入包、自定义适配或迁移既有工具，留到技术选型时，以代表性用例的真实验证及维护成本判断。

当前构建工具与其已批准范围以 [构建工具说明](../tools/build-ui/README.md) 和 [构建自动化设计](pink-build-ui-automation-design.md) 为准。本记录不要求替换工具、迁移 PinK 内部基座、增加模型依赖或建立统一平台，也不把任一局部技术选择推广为其他业务线的既定方案。

# Creator QA 流程与测试材料的历史参考

`cocos/3d-tasks` 中值得保留的是测试职责分层、代表性配置组合、场景材料与适用条件绑定，以及失败结果的可追溯信息。这些资料用于完善 PinK 已选回归链路，不要求迁移 Creator 全部测试项目、平台或旧框架。

当前范围以 [首轮回归用例](pink-regression-cases.md) 为准，材料设计维护在 [测试项目设计草案](pink-test-project-design.md)。已有实现与运行证据仍见 [Creator 历史自动化业务事实](creator-automation-history.md)；这里补充流程文档来源，不重复维护用例或执行状态。

## 历史版本与证据边界

- 记录日期：2026 年 10 月 16 日。
- 仓库：[cocos/3d-tasks](https://github.com/cocos/3d-tasks)，本次读取 `master` 快照 `df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf`，提交日期为 2025 年 6 月 5 日。
- 来源为私有仓库，通过已登录账号的只读接口获取。匿名网页不可访问不代表资料不存在；后续阅读需具备仓库权限。
- 本记录基于文档正文与 Git 文件历史，未运行旧框架、核验当前测试平台任务或进行截图基线比较。文档描述不证明测试组今天仍执行该流程，更不证明 PinK 已继承它。

下表日期是截至上述快照查到的文件最近一次提交日期，按 UTC 记录；不是功能首发日，也不是文档适配全部产品版本的证明。

| 来源 | 文件最后提交日期 | 使用边界 |
| --- | --- | --- |
| [QA 流程总纲](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/qa-process.md) | 2025-06-05 | 总纲混合不同年代平台条件；借鉴职责和组合方法，不直接沿用工具版本、支持范围及参数 |
| [场景测试说明](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/test-case-docs.md) | 2020-10-11 | 借鉴场景与配置条件、预期绑定；旧产物路径和纹理支持需重新确认 |
| [测试项目分支管理](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/workflows/branch-guidance-for-testcases.md) | 2020-05-09 | 借鉴材料版本及迁移身份保护，不照搬分支命名和合并流程 |
| [冒烟平台配置](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/test-docs/smoke-test-settings/README.md) | 2022-04-08 | 保留“冒烟有明确配置”的思路；旧选项、物理后端和手工资源部署不是 PinK 默认要求 |
| [Creator-tester 总览](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/test-docs/creator-tester/README.md) | 2023-10-28 | 总览描述菜单、HTML、场景与对话框能力；子文档、伪代码不视为已验证实现 |
| [编辑器提测流程](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/editor-docs/flow/submit-test.md) | 2024-02-23 | 参考包、变更、测试重点、报告与人工确认的关联；不新增发布平台或审批系统 |

仓库中的 2.x 目录、迁移 2.x 的案例不作为本次 PinK 材料来源。原文提及不等于纳入当前调查或测试范围。

## 测试流程的职责分层

| 历史安排 | 保护目标 | 对 PinK 已选范围的启发 |
| --- | --- | --- |
| 编辑器用例 | 编辑操作及编辑器行为 | 保存、资源与面板操作应有自己的检查，不能由构建成功代替 |
| 功能测试场景 | 明确模块或功能在特定配置下正确 | 为已选行为提供小型、可判定材料，不用综合 Demo 隐含覆盖 |
| 综合 Demo | 多功能复合使用与项目升级可用性 | 代表性运行场景可保护衔接，但不能据此宣称每个模块完全覆盖 |
| 配置组合 | 发布、调试和部分混合配置下的差异 | 按风险和适用条件选择合法组合，避免不必要的全排列 |
| 性能跟踪 | 在固定环境、配置和指标下比较性能 | 功能正常与性能达标分开；性能测试不因参考该文档进入本轮 |
| 问题回归与提测 | 对应版本的缺陷、变更及交付状态 | 结果关联实际包、材料和执行记录，缺陷修复需独立验证 |

QA 总纲对功能场景要求详细测试，对 Demo 安排首轮暴露问题、后续问题回归，并在无问题时于后期进行代表性组合测试。它不是“每轮所有项目、所有平台、所有配置全排列”的要求，其三个组合也不是严格成对覆盖或穷尽交互风险的证明。

PinK 可借鉴稳定代表链路与必要专项检查的分工，不继承旧平台矩阵。新增或稳定功能是否进入回归仍在原用例位置讨论，不能通过材料参考自动加项。

来源：[QA 流程与组合](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/qa-process.md)。

## 材料应说明用途与适用条件

历史场景说明把材料与测试条件绑定。例如自动图集场景只有开启相应构建选项后才有对应验证意义；图集与纹理压缩的组合场景则要求两个条件同时成立。纹理显示还依赖设备支持范围，不能只采用一幅跨设备通用的正确图片。

| 值得保留的思路 | PinK 材料设计中的表达 |
| --- | --- |
| 场景说明保护的行为 | 说明材料支撑哪个已选用例，不把素材存在当功能覆盖 |
| 写明平台、选项与资源前提 | 明确何时执行、何时不适用、何时缺材料阻塞；不能混为通过 |
| 提供可观察的预期 | 场景身份、内容、交互或产物标记可区分，避免只写“显示正常” |
| 保留真实依赖与资源身份 | 场景、资源、meta 和必要配置一并考虑，不只拷贝场景文件 |
| 区分正常使用与升级验证 | 常规回归使用明确版本的基线；迁移验证保留旧输入，不能提前用新版本重写后冒充升级 |
| 配置组合按用途准备 | 有默认态、已配置态和已选故障态，不为每个组合复制永久工程 |

版本管理文档特别要求避免随意提交旧 meta 的自动变化，以保留迁移可验证性。对 PinK 借鉴的是原始材料和身份可追溯；不把它机械变成“所有 meta 永远不能更新”的规则，也不因此新增跨版本专项。

来源：[场景测试说明](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/test-case-docs.md)、[材料版本管理](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/workflows/branch-guidance-for-testcases.md)。

## 固定 UI 流程与场景操作

Creator-tester 文档把菜单、HTML、场景画布和对话框分开处理，值得借鉴这种操作对象的区别，不直接迁移旧库或选择器。

| 对象 | 历史方法 | 可借鉴点与限制 |
| --- | --- | --- |
| 菜单与 HTML | 菜单路径、面板选择器及元素信息 | 固定目标可确定性执行；旧 CSS 层级和 nth-child 示例不作为稳定定位标准 |
| Gizmo 场景操作 | 固定节点与摄像机初态，获取几何体位置，转换屏幕坐标，真实拖拽后观察属性 | 固定业务流程不等于固定绝对坐标；伪代码和 TODO 不证明完整断言已实现 |
| 保存与确认对话框 | 测试启动模式拦截对话框，查询参数并模拟确认/取消 | 可检查后续业务分支，但不能宣称真实覆盖操作系统原生对话框交互 |
| 编辑器包/API | tester 发送消息并检查返回值，或通过命令行运行插件测试 | 是接口或集成证据，不等于用户 UI 操作成功 |

场景测试中，API 可以用于非被测前置状态或查询结果；被测的点击、拖拽不能直接改属性代替。若几何信息也来自被测系统，仍应以实际属性变化和独立业务预期判断，不只验证查询结果自洽。

来源：[HTML 定位](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/test-docs/creator-tester/html/README.md)、[Gizmo 测试](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/test-docs/creator-tester/scene/gizmo/README.md)、[对话框测试](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/test-docs/creator-tester/dialog/README.md)、[编辑器测试](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/editor-docs/other/test.md)。

## 结果判定与失败信息

历史资料存在不同证据层级，不能合并成一个“自动化已通过”。

| 证据 | 能说明什么 | 不能替代什么 |
| --- | --- | --- |
| 命令行构建成功 | 指定入口与配置完成构建 | 构建面板点击、配置保存、产物运行 |
| 模板标记进入产物 | 文件拷贝、模板渲染或特定配置处理发生 | 整个游戏运行和全部选项生效 |
| 场景交互与对应预期 | 指定条件下的业务结果正确 | 其他未操作功能、平台或配置 |
| tester 接口断言 | 特定接口返回或集成行为满足预期 | 完整用户链路及安装包消费 |
| 提测人工确认 | 对失败或例外作出交付判断 | 自动测试本身通过 |

自定义模板文档展示了“放入明确标记并在产物核对”的有效思路，但其概述与部分平台例子对配置优先级的描述不一致，不能直接作为 PinK 优先级断言。应按目标版本合同和真实实现确认；当前不新增模板专项。

失败记录可参考 QA Bug 模板：操作步骤和预期、首个错误及完整调用栈、宿主/目标平台与版本、配置组合、问题最早出现的已验证版本、必要截图和材料。测试报告应保留真实失败；人工复核或例外接受另行说明，不能改写自动结果。

来源：[命令行测试](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/publish/publish-in-command.md)、[模板产物检查](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/tests/publish/user-template.md)、[QA Bug 模板](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/.github/ISSUE_TEMPLATE/b_bug_editor.yml)、[提测流程](https://github.com/cocos/3d-tasks/blob/df7dd7d185dcb3dc7edcbc90a285eb404ba69cbf/editor-docs/flow/submit-test.md)。

## 当前适用边界

- 保持首轮 38 条和条件补测 24 条的既有范围，不把物理、渲染、粒子、性能、全平台矩阵或升级项目自动纳入。
- 不照搬旧版本的参数、退出码、平台支持、工具版本、UI 路径或测试插件接口；不因文档描述新增 PinK 宿主机制。
- 原文“自动化”标记、框架说明和测试入口不能证明当前执行频率、线上覆盖或测试组已接入 PinK。
- 平台调试资料含历史账号与凭据，不转录到测试项目、报告或新文档，也不尝试使用。
- 本记录仅为材料和核验设计提供参考，不确定技术选型，不替换 [构建工具及其支持边界](../tools/build-ui/README.md)，不改变其他对话维护的方案。

后续使用时先核对目标 PinK、SDK、插件与材料版本，再把所需调整写回现有用例或材料方案。原始资料、当前产品合同和真实执行证据分别保留，不能互相代替。

# PinK 构建用例

- [平台 → 用例](pink-build-cases.html#view=platform)：18 个平台展示发布、调试、混合，以及第四组“条件与扩展”。前三组看固定配置；第四组展开适用场景，查看启用条件、输入、步骤和检查点。
- [公共界面与历史记录](pink-build-cases.html#view=public)：代表平台检查公共交互，历史记录复用已有任务。

2026-10-22 第四组“表单反向校验”已按源码规则细化：仍为 29 条检查点，不同错误输入按独立样本展开，分别看前提、触发、提示/修正、按钮、任务和恢复。公共字段由 Web 桌面代表，平台差异单列。结构化样本已随完整用例导出，可按页面给出的 ID 显式加载；缺材料或未适配项单独保留。web-desktop 公共样本在 1958 包已有 30 项通过、2 项 L10N 受阻的[汇总记录](../results/2026-10-22-public-eight-recheck-1792656676890/acceptance-summary-report.html)，原 22 项复用，本批仅补验 8 项非 L10N；协议根应显示必填的预期已按源码修正并单项补验，本批原配置已恢复，Zip 按强制远程防护、CCONB 按关闭仍可编辑阈值的当前实现判定；未提交构建或修改引擎，后续 Windows、微信、抖音、淘宝 8 项专属反向样本已[实机通过](../results/2026-10-22-platform-eight-1792659733452/execution/2026-10-22T09-05-46-391Z/report.html)，三平台签名及AGC文件/包名另有[18项通过](../results/2026-10-22-native-form-1792660577977/acceptance-summary-report.html)，恢复失败停止后项也已有本批实际故障记录，其余专属样本仍未验收；[完整规则与风险](pink-build-combination-design.md#第四组产品表单反向校验2026-10-22)、[最小后续产物范围](pink-build-ui-automation-design.md#关键配置最终效果最小后续范围仅设计)均在现有文档维护。

**四组用例已定稿。** 页面区分“明确检查 / 仅保留回读 / 待补材料或候选”，均不是实测通过状态。 测试名称、包名、版本、合法 URL、超时等直接定义在用例里；只有文件、账号、真实服务才列材料前提。2D 物理、缓存宏和基准预设已补入前三组；仅保留的当前值不计修改覆盖。普通开关仍在前三组内搭配；依赖项目能力、文件、账号候选或兼容环境的场景进入第四组。

L10N 未启用时语言控件不存在是正确预期；1958 启用后，取消目标不收缩默认/回退候选，也不自动修正或禁用下拉；全部取消不等于跳过本地化。共享 L10N/资源 UI 由 Web 桌面代表验证，第四组不固定跑满 18 平台。

AGC 文件选择与构建前 JSON 解析分开；三组均主动填匹配包名。比例按 Android/Google 与 AGC 分开判定，版本/超时保留各自字符串规则，不统一要求即时拦截。源码规则已回写；缺真实材料/候选的分支单独保留，详见完整设计。

调试组采用 Bullet（physics-ammo），混合组保持 Cannon 并按工程和平台适用性执行；异常输入按当前实现，不增加业务限制。缺材料只影响对应分支。新入口 `-Plan four-groups` 已接入本稿，旧 52 项入口保留。设计和代码接入不代表实机通过；历史证据不自动继承。

[完整组合搭配与材料边界](pink-build-combination-design.md) · [公共与历史 UI 设计](pink-build-ui-automation-design.md)

2026-10-22 随后仅验收 OPPO、vivo、荣耀、华为快游戏的 `FORM-Q01`，**36 项全部通过，每平台 9 项**：包名、版本名、版本号、运行时版本清空各 1 项，版本号 `0`、`-1`、`1.5`、`abc` 各 1 项，版本名 `qa-version` 1 项。仅为被测字段声明临时合法非空初态，复用现有 UI 适配，每组最多 2 项。空值显示通用必填提示，vivo 包名显示自定义非空提示；非空特殊版本文本不提示错误，主构建按钮始终可用。这是已批准的当前实现基线，不证明平台版本合法性或提交后的防护。没有提交构建、修改 SDK 或引擎，之前通过项未重跑，PEM 缺材料与 L10N 保留。[本批报告](../results/2026-10-22-quick-form-1792663578813/execution/2026-10-22T10-07-01-480Z/report.html)；[配置恢复与文件核对](../results/2026-10-22-quick-form-1792663578813/after.json)。末次核对任务及引擎文件未变，所有原有配置值已恢复。vivo 打开时自动避让的输出名已通过 UI 恢复；产品新增 OPPO、华为快游戏默认偏好，以及 vivo/荣耀原来缺省的语言键和荣耀空 AppID，故偏好文件整体不字节相同。没有执行 L10N 分支。

<details>
<summary>维护来源</summary>

- [public-combinations.json](../tools/case-catalog/public-combinations.json)：本次四组设计、18 平台专属配置、普通测试输入和条件场景，仅供设计展示。
- [cases.json](../tools/case-catalog/cases.json)：保留已有公共/平台专项、旧编号与历史证据。旧构建批次不混入定稿的组合卡片。
- [form-validation-design.json](../tools/case-catalog/form-validation-design.json)：第四组反向校验的展示设计，公共部分由代表平台覆盖，平台差异分别列明；不加入执行清单。
- [generate.mjs](../tools/case-catalog/generate.mjs) 与 [page-shell.html](../tools/case-catalog/page-shell.html)：只生成只读单文件 HTML，不连接 PinK、不设置引擎、不运行自动化。字段绑定复用 1958 包已采集的真实配置页；不取观察值冒充预期。

生成页面：`node tools/case-catalog/generate.mjs`。本轮将定稿同步到 `four-groups` 入口，并重新生成页面；仅做类型/工具编译与静态格式/语法检查，未运行自动化入口、单元测试、PinK 或产品构建。命令、材料及 L10N 跨页启用的操作适配受阻见[工具说明](../tools/build-ui/README.md#四组定稿入口)。

</details>

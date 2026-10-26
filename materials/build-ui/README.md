# 构建测试材料

Windows v2 试用将 `materials.example.json` 复制到 `local/materials.json` 再填写；`local/` 为本机私有目录，已加入忽略规则。新入口使用 `-CatalogFile` 或 `-StepsFile`，完整准备与执行命令见[工具试用说明](../../tools/build-ui/README.md#windows-v2-试用基线2026-10-26)。`run.example.json` 是旧 `-RunConfig` 入口的兼容示例，不作为新版试用快启；需要旧入口时再复制到 `local/run.json`，相对路径按该位置编写。

- 用例 JSON 保存测试目标和材料引用；密钥库、账号口令不写进公共用例。
- 将现成 `android.keystore` 放入 `local/`，在私有清单填写匹配的别名与两项口令。没有创建密钥库流程。
- Android、OHOS、HarmonyOS NEXT、Windows 的发布加密用例通过 `nativeEncryption.key` 读取测试密钥；填写在私有材料清单，不在公共用例中嵌入明文。签名密钥库与脚本加密密钥是两种材料。
- 所有 `bindings.*.path` 相对材料清单解析；启动配置的路径相对启动配置解析，也支持绝对路径。
- 示例 API 数字只是填写示例，必须使用测试机实际合法候选；调试/混合所需的额外候选只在具备条件时绑定。
- `mixedPlatforms` 是明确的工程/平台适用清单；空数组表示本机暂不执行混合组，不意味着产品不支持。
- 离线检查只证明文件可读、引用与类型正确；不验证签名密码、账号、SDK环境或产物。

从 PinK-Test 根目录用 v2 入口预览（替换包及工程路径，输出目录需已存在）：

```powershell
.\run-build-ui.ps1 -CatalogFile .\tools\case-catalog\public-combinations.json -Cases review.publish.web-desktop -Pink '<待测包目录>' -Project '<测试工程目录>' -Materials .\materials\build-ui\local\materials.json -Preview -PreviewFile .\results\qa-plan.json
.\run-build-ui.ps1 -CatalogFile .\tools\case-catalog\public-combinations.json -Cases review.publish.web-desktop -Pink '<待测包目录>' -Project '<测试工程目录>' -Materials .\materials\build-ui\local\materials.json -ExpectedPlan .\results\qa-plan.json -CheckPlan
```

命令只预览或核验计划，不启动或连接 PinK。v2 计划的 `ready` 只表示离线输入满足合同，不能代替实机通过；缺材料、不适用及缺适配的条目保留原因。旧入口的计划状态和退出码另按其历史合同解释。

真正执行必须携带同一份 `-ExpectedPlan`，使用与预览相同的输入并去掉 `-CheckPlan`。用例、材料文件、目标工程或执行范围变化时重新预览。材料密码不写进计划，材料内容和引用文件摘要参与哈希。AGC 服务文件通过材料引用提供，四组入口不接受额外 `-AgcServices` 覆盖。仅旧 `-RunConfig` 可以在 `run.json` 中配置 `expectedPlan`，不要将该文件误当 v2 启动配置。

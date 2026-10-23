# 构建测试材料

将两个示例复制到 `local/materials.json`、`local/run.json` 再填写；`local/` 为本机私有目录，已加入忽略规则。`run.example.json` 中的相对路径按复制到 `local/` 后的位置编写。

- 用例 JSON 保存测试目标和材料引用；密钥库、账号口令不写进公共用例。
- 将现成 `android.keystore` 放入 `local/`，在私有清单填写匹配的别名与两项口令。没有创建密钥库流程。
- 所有 `bindings.*.path` 相对材料清单解析；启动配置的路径相对启动配置解析，也支持绝对路径。
- 示例 API 数字只是填写示例，必须使用测试机实际合法候选；调试/混合所需的额外候选只在具备条件时绑定。
- `mixedPlatforms` 是明确的工程/平台适用清单；空数组表示本机暂不执行混合组，不意味着产品不支持。
- 离线检查只证明文件可读、引用与类型正确；不验证签名密码、账号、SDK环境或产物。

从 PinK-Test 根目录预览：

```powershell
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -Preview -PreviewFile .\results\qa-plan.json
.\run-build-ui.ps1 -RunConfig .\materials\build-ui\local\run.json -ExpectedPlan .\results\qa-plan.json -CheckPlan
```

输出目录需要已经存在。命令只生成脱敏计划，不启动或连接 PinK。`ready-for-runtime-preflight` 表示可以进入后续实机前提检查，不表示已构建或通过。用例有缺材料分支时仍会输出完整计划，并返回非零退出码。

四组真正执行必须携带同一份 `-ExpectedPlan`，也可在 `run.json` 增加 `"expectedPlan": "./plan.json"`（相对启动文件解析）。先预览，离线核验后再启动；用例、材料文件、目标工程或执行范围变化时重新预览。材料密码不写进计划，材料内容和引用文件摘要参与哈希。AGC 服务文件通过材料引用提供，四组入口不再接受额外 `-AgcServices` 覆盖。

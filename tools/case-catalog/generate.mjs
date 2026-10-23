// Presentation-only export. Does not import the CLI, connect to PinK or run builds.
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  caseContract,
  createCaseContract,
} from "../build-ui/dist/case-contract.js";
import * as profiles from "../build-ui/dist/profiles.js";
import { platformCatalog } from "../build-ui/dist/platform-catalog.js";
import { existingFields } from "../build-ui/dist/existing-platforms.js";
import { format } from "../build-ui/node_modules/prettier/index.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { values: arguments_ } = parseArgs({
  options: { "cases-file": { type: "string" }, output: { type: "string" } },
});
const pagePath = arguments_.output ?? join(root, "docs/pink-build-cases.html");
const html = await readFile(
  new URL("./page-shell.html", import.meta.url),
  "utf8",
);
const data = JSON.parse(
  await readFile(new URL("./cases.json", import.meta.url), "utf8"),
);
// One authoring source; exported documents carry the same executable UI samples.
const builtinForms = JSON.parse(
  await readFile(
    new URL("./form-validation-design.json", import.meta.url),
    "utf8",
  ),
);
const sourceBytes = await readFile(
  arguments_["cases-file"] ??
    new URL("./public-combinations.json", import.meta.url),
);
const rawSource = JSON.parse(
  sourceBytes.toString("utf8").replace(/^\uFEFF/, ""),
);
const executionSource = caseContract.validate({
  ...rawSource,
  ...(!arguments_["cases-file"] ? { formValidation: builtinForms } : {}),
});
const design = caseContract.normalize(executionSource);
const templateIds = design.templates.map((t) => t.id);
const scenarioById = new Map(design.conditionalScenarios.map((s) => [s.id, s]));
const reviewById = new Map(design.reviewItems.map((item) => [item.id, item]));
if (scenarioById.size !== design.conditionalScenarios.length)
  throw new Error("Duplicate conditional scenario identity");
if (
  new Set(design.platforms.map((p) => p.id)).size !== platformCatalog.length ||
  design.platforms.length !== platformCatalog.length
)
  throw new Error("Design must list each current platform exactly once");
for (const p of design.platforms)
  if (p.combinations.map((c) => c.template).join(",") !== templateIds.join(","))
    throw new Error(`Inconsistent shared templates: ${p.id}`);
const oldCombinationTypes = new Set([
  "可执行组合",
  "待实现组合",
  "专属组合构建",
  "验收组合",
]);
for (const c of data.cases) {
  if (oldCombinationTypes.has(c.type))
    c.applicability = {
      status: "historical",
      reason:
        "原批次/执行定义保留为历史依据；当前定稿采用前三组与第四组条件场景，不据此自动执行或记通过。",
    };
}
for (const p of design.platforms)
  for (const c of p.combinations)
    data.cases.push({
      id: c.id,
      title: c.title,
      platform: p.id,
      area: "platform",
      type: "公共组合定稿",
      outcome: "unrun",
      prerequisites: c.materials.join("；"),
      notes: c.notes.join("；"),
      grouping: "每组最多 2 项；普通配置直接构建，公共 UI 专项不逐平台重复。",
      steps:
        c.kind === "conditional"
          ? [
              {
                action:
                  "按本平台适用范围选择一个前提满足的条件场景，记录初态和恢复约定。",
                expected:
                  "共享场景默认由代表平台覆盖；不要求所有特殊能力同时开启。",
              },
              {
                action: "按所选场景启用条件、输入与检查点执行。",
                expected:
                  "未启用/不适用时字段缺席不是定位失败；就绪后才允许操作条件控件。",
              },
              {
                action: "按场景终点决定是否提交构建，结束后恢复本例修改。",
                expected:
                  "UI/校验场景不提交；正向构建核对唯一任务参数与成功状态，不验证产物。",
              },
            ]
          : [
              {
                action:
                  "确认本平台和工程；按本例测试输入填写名称、场景与输出目录。",
                expected:
                  "普通输入使用例内值；账号/文件候选满足对应前提，未决合同不伪造成有效输入。",
              },
              {
                action:
                  "按公共配置及本平台专用配置设置；先父项后条件子项，等待联动稳定，逐字段回读。",
                expected:
                  "目标字段正确，禁用/隐藏字段按条件判定；未指定字段保留，不等于变化覆盖。",
              },
              {
                action:
                  "按本例条件配置完成后，直接点击一次构建，按唯一任务 ID 核对配置快照、入队及终态。",
                expected:
                  "本次任务参数匹配最终回读且状态成功；不验证产物，不另点生成/运行。",
              },
            ],
      sources: [
        {
          label: "公共组合与测试输入定稿",
          href: "../tools/case-catalog/public-combinations.json",
        },
        ...design.sources,
      ],
      evidence: [],
    });
const byId = new Map(data.cases.map((c) => [c.id, c]));
if (byId.size !== data.cases.length) throw new Error("Duplicate case identity");
// Refuse stale compiled definitions; refresh with the existing build-ui compile command.
for (const name of ["profiles", "platform-catalog", "existing-platforms"]) {
  const [source, compiled] = await Promise.all(
    ["src/" + name + ".ts", "dist/" + name + ".js"].map((p) =>
      stat(join(root, "tools/build-ui", p)),
    ),
  );
  if (source.mtimeMs > compiled.mtimeMs)
    throw new Error(`Stale definition: ${name}; compile build-ui first`);
}

const sourceLink = (name) => ({
  label: name,
  href: `../tools/build-ui/src/${name}`,
});
const labels = {
  name: "名称",
  buildPath: "构建路径",
  outputName: "输出名",
  startScene: "初始场景",
  scenes: "包含场景",
  debug: "调试模式",
  md5Cache: "MD5 缓存",
  "md5CacheOptions.handleTemplateMd5Link": "处理模板中的 MD5 链接",
  mangleProperties: "混淆属性名",
  inlineEnum: "内联枚举",
  sourceMaps: "Source Map",
  experimentalEraseModules: "实验性模块裁剪",
  skipCompressTexture: "跳过纹理压缩",
  useSplashScreen: "启用插屏",
  packAutoAtlas: "打包自动图集",
  bundleConfigs: "包含的 Bundle",
  mainBundleCompressionType: "主 Bundle 压缩",
  mainBundleIsRemote: "主 Bundle 为远程包",
  server: "远程服务器地址",
  startSceneAssetBundle: "初始场景资源 Bundle",
  bundleCommonChunk: "在 Bundle 中嵌入公共脚本",
  "binGroupConfig.enable": "启用 CCONB 分组",
  "binGroupConfig.threshold": "CCONB 分组阈值",
  engineModulesConfigKey: "引擎模块配置",
  nativeCodeBundleMode: "原生代码包装",
  wasmCompressionMode: "Wasm 压缩",
  "overwriteProjectSettings.includeModules.physics": "3D 物理系统",
  "overwriteProjectSettings.includeModules.physics-2d": "2D 物理系统",
  "overwriteProjectSettings.includeModules.gfx-webgl2": "WebGL 2.0",
  "overwriteProjectSettings.macroConfig.cleanupImageCache": "图片缓存清理",
  "resolution.designWidth": "预览宽度",
  "resolution.designHeight": "预览高度",
  orientation: "屏幕方向",
  deviceOrientation: "屏幕方向",
  useWebGPU: "WebGPU",
  embedWebDebugger: "VConsole",
  package: "游戏包名",
  packageName: "应用包名",
  appid: "AppID",
  appkey: "AppKey",
  icon: "图标",
  versionName: "版本名",
  versionCode: "版本号",
  runtimeVersion: "运行时版本",
  minPlatformVersion: "最低平台版本",
  useDebugKey: "使用调试签名",
  privatePemPath: "私钥路径",
  certificatePemPath: "证书路径",
  fullScreen: "全屏",
  logLevel: "日志等级",
  separateEngine: "分离引擎",
  wasmSubpackage: "引擎分包",
  buildOpenDataContextTemplate: "开放数据域模板",
  highPerformanceMode: "高性能模式",
  generatePreloadJsFileList: "生成预加载脚本列表",
  devToolsLaunchMethod: "开发工具启动模式",
  globalAdapter: "globalThis 全局变量适配",
  globalVariable: "全局变量",
  apiLevel: "API Level",
  appABIs: "ABI",
  swappy: "启用 Swappy",
  inputSDK: "Input SDK",
  adpf: "ADPF",
  googleBilling: "Play Billing",
  isSoFileCompressed: "压缩 .so 文件",
  resizeableActivity: "可调整大小的 Activity",
  maxAspectRatio: "最大宽高比",
  androidInstant: "Google Play Instant",
  remoteUrl: "Intent 过滤器",
  encrypted: "加密 JS",
  xxteaKey: "JS 加密密钥",
  compressZip: "Zip 压缩",
  JobSystem: "任务调度系统",
  useDebugKeystore: "使用调试密钥库",
  keystorePath: "密钥库路径",
  keystorePassword: "密钥库密码",
  keystoreAlias: "密钥库别名",
  keystoreAliasPassword: "密钥库别名密码",
  executableName: "可执行文件名",
  targetPlatform: "目标架构",
  vsData: "CMake Generator",
  jsEngine: "平台 JS 引擎",
  useGamepad: "启用手柄",
  serviceConfigPath: "AGC 服务 JSON",
  customIcon: "图标",
  "renderBackEnd.vulkan": "Vulkan",
  "renderBackEnd.gles3": "GLES3",
  "renderBackEnd.gles2": "GLES2",
  "orientation.portrait": "竖屏",
  "orientation.upsideDown": "倒竖屏",
  "orientation.landscapeLeft": "左横屏",
  "orientation.landscapeRight": "右横屏",
};
const publicRefs = {
  name: ["UI-C04"],
  buildPath: ["UI-C05", "UI-C06"],
  outputName: ["UI-C05", "UI-C07"],
  startScene: ["UI-C08"],
  scenes: ["UI-C09", "UI-C10"],
  debug: ["UI-C11"],
  md5Cache: ["UI-C11", "UI-C12"],
  "md5CacheOptions.handleTemplateMd5Link": ["UI-C12"],
  sourceMaps: ["UI-C13"],
  mangleProperties: ["UI-C13"],
  inlineEnum: ["UI-C13"],
  experimentalEraseModules: ["UI-C13"],
  skipCompressTexture: ["UI-C14"],
  packAutoAtlas: ["UI-C14"],
  useSplashScreen: ["UI-C14"],
  bundleConfigs: ["UI-C15"],
  mainBundleCompressionType: ["UI-C16"],
  mainBundleIsRemote: ["UI-C17"],
  server: ["UI-C17"],
  startSceneAssetBundle: ["UI-C17"],
  bundleCommonChunk: ["UI-C18"],
  "binGroupConfig.enable": ["UI-C18"],
  "binGroupConfig.threshold": ["UI-C18"],
  engineModulesConfigKey: ["UI-C19"],
  nativeCodeBundleMode: ["UI-C21"],
  wasmCompressionMode: ["UI-C21"],
};
// Explicit relationships to existing cases, never inferred from a keyword in a title.
const specialRefs = {
  appid: ["appid"],
  orientation: ["orientation"],
  deviceOrientation: ["orientation"],
  buildOpenDataContextTemplate: ["open-data"],
  wasmSubpackage: ["wasm-subpackage", "engine-subpackage"],
  separateEngine: ["plugin"],
  highPerformanceMode: ["high-performance"],
  generatePreloadJsFileList: ["preload"],
  devToolsLaunchMethod: ["launch-mode"],
  encrypted: ["encryption", "encryption-debug"],
  xxteaKey: ["encryption"],
  compressZip: ["encryption"],
  JobSystem: ["jobsystem"],
  useDebugKeystore: ["signing", "signing-ui"],
  keystorePath: ["signing", "signing-ui"],
  keystorePassword: ["signing", "signing-ui"],
  keystoreAlias: ["signing", "signing-ui"],
  keystoreAliasPassword: ["signing", "signing-ui"],
  apiLevel: ["api", "api-abi", "instant-api"],
  appABIs: ["api-abi", "abi"],
  resizeableActivity: ["aspect-ratio"],
  maxAspectRatio: ["aspect-ratio"],
  packageName: ["identity", "package-sync", "package-adoption"],
  executableName: ["identity"],
  targetPlatform: ["architecture"],
  vsData: ["generator"],
  jsEngine: ["js-engine"],
  useGamepad: ["devices"],
  androidInstant: ["instant", "instant-api"],
  remoteUrl: ["instant"],
  swappy: ["switches"],
  inputSDK: ["switches"],
  adpf: ["switches"],
  googleBilling: ["switches"],
  isSoFileCompressed: ["switches"],
  customIcon: ["icon"],
  serviceConfigPath: ["services", "file-errors", "package-adoption"],
  versionName: ["version"],
};
const extraRefs = {
  "web-desktop:useWebGPU": ["branch.WD01"],
  "web-desktop:resolution.designWidth": ["branch.WD02"],
  "web-desktop:resolution.designHeight": ["branch.WD02"],
  "web-mobile:orientation": ["branch.WM01"],
  "web-mobile:embedWebDebugger": ["branch.WM02"],
  "fb-instant-games:orientation": ["branch.FB01"],
  "fb-instant-games:embedWebDebugger": ["branch.FB02"],
  "taobao-mini-game:orientation": ["branch.TA01"],
  "taobao-mini-game:wasmSubpackage": ["branch.TA02"],
  "taobao-mini-game:separateEngine": ["branch.TA03"],
  "openpaas:appid": [
    "design.openpaas.3",
    "design.openpaas.4",
    "design.openpaas.refresh",
  ],
  "openpaas:versionName": ["design.openpaas.2", "design.openpaas.5"],
};
// Current field identity comes from the 1958 package, not every property in an SDK schema.
// Observation values are intentionally discarded; only case definitions supply targets.
const currentRun = "2026-10-20T08-16-36-302Z-configuration";
const currentReport = JSON.parse(
  await readFile(join(root, "results", currentRun, "result.json"), "utf8"),
);
const openAuditPath =
  "2026-10-20-current-platform-audit/openpaas-and-platforms.json";
const openAudit = JSON.parse(
  await readFile(join(root, "results", openAuditPath), "utf8"),
);
const cards = JSON.parse(
  await readFile(
    join(root, "results/2026-10-20-current-platform-audit/platform-cards.json"),
    "utf8",
  ),
);
const observedPlatforms = cards.flatMap((g) =>
  g.cards.filter((c) => c.visible).map((c) => `${g.category}:${c.label}`),
);
const registeredPlatforms = platformCatalog.map(
  (p) => `${p.category}:${p.label}`,
);
if (
  observedPlatforms.length !== registeredPlatforms.length ||
  observedPlatforms.some((p) => !registeredPlatforms.includes(p))
)
  throw new Error(
    "Current platform cards differ from catalogue; refresh UI evidence first",
  );
const snapshots = new Map(
  currentReport.cases.map((c) => [
    c.platform,
    {
      fields: c.initial.fields,
      custom: c.initial.unkeyedFields,
      source: {
        label: "当前 UI · PinK 0.0.2.0（1958）· 2026-10-20",
        href: `../results/${currentRun}/result.json`,
      },
    },
  ]),
);
snapshots.set("openpaas", {
  fields: openAudit.openpaas.expanded.fields,
  custom: openAudit.openpaas.expanded.unkeyedFields,
  source: {
    label: "当前 OpenPaaS UI（网络超时展开）· 1958",
    href: `../results/${openAuditPath}`,
  },
});
const excludedFields = new Map([
  [
    "packages.openpaas.privatePemPath",
    "当前自定义视图永久隐藏，不是用户配置入口",
  ],
  ["packages.openpaas.encryptKey", "平台内部自动上下文，不是用户配置入口"],
  ...["appid", "appkey", "separateEngine"].map((key) => [
    `packages.vivo-mini-game.${key}`,
    "当前 vivo 自定义表单没有此控件",
  ]),
]);
const customMap = {
  全部构建时构建此平台: "custom-common:includeInAll",
  游戏包名: "package",
  屏幕方向: "deviceOrientation",
  使用调试秘钥库: "useDebugKey",
  "private.pem 路径": "privatePemPath",
  "certificate.pem 路径": "certificatePemPath",
  "OpenPaaS 游戏": "appid",
  "XMLHttpRequest 超时时间": "networkTimeout.XMLHttpRequest",
  "Websocket 超时时间": "networkTimeout.Websocket",
  "uploadFile 超时时间": "networkTimeout.uploadFile",
  "downloadFile 超时时间": "networkTimeout.downloadFile",
  "加密 JS": "encrypted",
  "JS 加密密钥": "xxteaKey",
  "Zip 压缩": "compressZip",
  任务调度系统: "JobSystem",
  "Job System": "JobSystem",
  "API Level": "apiLevel",
  "Target API Level": "apiLevel",
  "APP ABI": "appABIs",
  "支持的 ABI": "appABIs",
  使用调试密钥库: "useDebugKeystore",
  密钥库路径: "keystorePath",
  密钥库密码: "keystorePassword",
  密钥库别名: "keystoreAlias",
  密钥库别名密码: "keystoreAliasPassword",
  "可调整大小的 Activity": "resizeableActivity",
  最大宽高比: "maxAspectRatio",
  "Google Play Instant": "androidInstant",
  "Intent 过滤器": "remoteUrl",
  "压缩 .so 文件": "isSoFileCompressed",
  "Compress .so files": "isSoFileCompressed",
  "Built in Play Billing": "googleBilling",
  "Input SDK": "inputSDK",
  自定义图标: "customIcon",
  "CMake Generator": "vsData",
  WEBGPU: "useWebGPU",
  "globalThis 全局变量适配": "globalAdapter",
  全局变量: "globalVariable",
  "应用 ID 名称": "packageName",
};
const activeCase = (c) =>
  !["historical", "not-applicable", "manual", "planned"].includes(
    c.applicability?.status,
  );
function bindingsFor(platform, snapshot) {
  const bindings = new Map();
  const bind = (key, field, choice) => {
    if (excludedFields.has(key)) return;
    const rows = bindings.get(key) ?? [];
    rows.push({
      label: field.label.replace(/^\*/, ""),
      ...(choice ? { choice } : {}),
      kind: field.key ? "keyed" : "custom",
      visible: field.visible,
      controls: field.controls.map(({ type, disabled }) => ({
        type,
        disabled,
      })),
    });
    bindings.set(key, rows);
  };
  for (const f of snapshot.fields) bind(f.key, f);
  for (const f of snapshot.custom) {
    if (
      platform === "google-play" &&
      ["渲染后端", "屏幕方向"].includes(f.label)
    ) {
      const choices =
        f.label === "渲染后端"
          ? {
              "renderBackEnd.vulkan": "Vulkan",
              "renderBackEnd.gles3": "GLES 2/3",
              "renderBackEnd.gles2": "GLES2",
            }
          : {
              "orientation.portrait": "竖屏",
              "orientation.upsideDown": "倒竖屏",
              "orientation.landscapeLeft": "左横屏",
              "orientation.landscapeRight": "右横屏",
            };
      for (const [key, label] of Object.entries(choices))
        bind(`packages.${platform}.${key}`, f, label);
    } else {
      const tail = customMap[f.label];
      if (!tail)
        throw new Error(
          `Unmapped current custom control: ${platform}: ${f.label}`,
        );
      bind(
        tail.startsWith("custom-common:")
          ? tail
          : `packages.${platform}.${tail}`,
        f,
      );
    }
  }
  // A single build-path row contains two distinct UI inputs.
  bind("outputName", {
    ...snapshot.fields.find((f) => f.key === "buildPath"),
    label: "输出名",
  });
  bindings.get("outputName")[0].position = "构建路径行中的输出名输入框";
  if (platform === "web-desktop")
    bind("md5CacheOptions.handleTemplateMd5Link", {
      ...snapshot.fields.find((f) => f.key === "md5Cache"),
      label: "处理模板中的 MD5 链接",
    });
  if (platform === "web-desktop")
    bindings.get("md5CacheOptions.handleTemplateMd5Link")[0].position =
      "MD5 行中的第二个复选框，无独立 data-option-key";
  // Conditionally absent controls are registered in the current custom view/schema.
  const conditional = [];
  if (
    bindings.has("nativeCodeBundleMode") &&
    !bindings.has("wasmCompressionMode")
  )
    bindings.set("wasmCompressionMode", [
      { label: "Wasm 压缩", kind: "conditional", visible: false, controls: [] },
    ]);
  if (["android", "windows", "ohos", "harmonyos-next"].includes(platform))
    conditional.push(["xxteaKey", "JS 加密密钥"], ["compressZip", "Zip 压缩"]);
  if (platform === "taobao-mini-game") {
    conditional.push(["globalVariable", "全局变量"]);
    bindings.set("wasmCompressionMode", [
      { label: "Wasm 压缩", kind: "conditional", visible: false, controls: [] },
    ]);
  }
  if (platform === "google-play")
    conditional.push(["remoteUrl", "Intent 过滤器"]);
  for (const [key, label] of conditional)
    if (!bindings.has(`packages.${platform}.${key}`))
      bindings.set(`packages.${platform}.${key}`, [
        { label, kind: "conditional", visible: false, controls: [] },
      ]);
  return bindings;
}
function conditionsFor(platform, key, values) {
  const tail = key.replace(`packages.${platform}.`, "");
  const value = (name) => values[`packages.${platform}.${name}`];
  const rules = [];
  if (key.startsWith("packages.localization-editor."))
    rules.push(
      "仅项目已启用 L10N、开发语言有效且附加区就绪时出现；未启用时正确缺席，按第四组检查，不当作定位失败",
    );
  if (key === "md5CacheOptions.handleTemplateMd5Link")
    rules.push(
      values.md5Cache === false
        ? "MD5 关闭：子项隐藏且表单值保留，提交不因隐藏自动清除"
        : "MD5 开启后在父项行内操作子复选框；隐藏不等于清空",
    );
  if (key === "wasmCompressionMode")
    rules.push(
      "实际选中原生模块后出现包装；wasm/both 显示压缩，asmjs 隐藏；UI 开写 brotli，关写 undefined，JSON 省略；切 asmjs 前先取消压缩",
    );
  if (key === "nativeCodeBundleMode")
    rules.push(
      "仅当前预设/覆盖选中的模块含原生模块时出现；无模块时正确缺席，不补写隐藏项",
    );
  if (
    [
      "engineModulesConfigKey",
      "overwriteProjectSettings.includeModules.physics-2d",
      "overwriteProjectSettings.macroConfig.cleanupImageCache",
    ].includes(key)
  )
    rules.push(
      "先选择真实预设并等待模块刷新，再设置本组覆盖；继承只核对标记及已确认的任务表示",
    );
  if (
    ["android", "windows", "ohos", "harmonyos-next"].includes(platform) &&
    ["encrypted", "xxteaKey", "compressZip"].includes(tail)
  ) {
    if (values.debug === true)
      rules.push(
        "调试模式下禁止编辑加密项；核对提示与交互限制，保留值不代表加密生效",
      );
    if (tail !== "encrypted")
      rules.push(
        value("encrypted") === false
          ? "加密关闭：子项隐藏；关闭时压缩值清为 false"
          : value("encrypted") === true
            ? "先开启加密，待子项出现后操作"
            : "仅加密开启时出现；本组合沿用的父值需先回读",
      );
    if (platform === "harmonyos-next")
      rules.push("ARK 分支的构建内部关闭加密；JSVM/V8 与 ARK 分开判定");
  }
  if (platform === "wechatgame" && tail === "separateEngine")
    rules.push(
      "当前 beta 引擎下控件禁用：只检查禁用与说明；开启分支需兼容引擎环境",
    );
  const signingParent = ["privatePemPath", "certificatePemPath"].includes(tail)
    ? "useDebugKey"
    : [
          "keystorePath",
          "keystorePassword",
          "keystoreAlias",
          "keystoreAliasPassword",
        ].includes(tail)
      ? "useDebugKeystore"
      : undefined;
  if (signingParent)
    rules.push(
      value(signingParent) === true
        ? "使用调试签名：路径及凭据禁用"
        : value(signingParent) === false
          ? "关闭调试签名后编辑；有效签名构建需匹配材料"
          : "依赖当前调试签名状态：开启时禁用，关闭后才能编辑",
    );
  if (
    ["google-play", "huawei-agc"].includes(platform) &&
    tail === "maxAspectRatio"
  )
    rules.push(
      value("resizeableActivity") === true
        ? "Activity 开启：比例控件禁用，已有值保持"
        : value("resizeableActivity") === false
          ? "Activity 关闭：比例控件可编辑"
          : "Activity 开启时禁用，关闭后可编辑；先回读父值",
    );
  if (platform === "google-play" && tail === "renderBackEnd.gles3")
    rules.push(
      "操作 GLES 2/3 父开关；展开后的 GLES3 子项固定勾选且禁用，不可当独立开关",
    );
  if (platform === "google-play" && tail === "renderBackEnd.gles2")
    rules.push("GLES 2/3 开启后显示；关闭父项时 GLES2/3 一起清为 false");
  if (platform === "google-play" && tail === "remoteUrl")
    rules.push(
      value("androidInstant") === false
        ? "Instant 关闭：地址隐藏，不假定清空"
        : "Instant 开启且 API≥23 后配置 HTTP 地址；否则不操作隐藏项",
    );
  if (platform === "taobao-mini-game" && tail === "globalVariable")
    rules.push(
      value("globalAdapter") === true
        ? "全局适配开启：文本隐藏、原值保留"
        : value("globalAdapter") === false
          ? "全局适配关闭：文本可编辑"
          : "全局适配关闭时显示；开启时隐藏并保留值",
    );
  if (platform === "openpaas" && tail === "appid")
    rules.push(
      "从当前账号的已有游戏候选选择，回读游戏 ID；不填写任意 AppID，不新建游戏",
    );
  if (platform === "openpaas" && tail.startsWith("networkTimeout."))
    rules.push("先展开网络超时，再按实际文本控件逐项输入并回读");
  return rules;
}
function refs(platform, key) {
  if (publicRefs[key]) return publicRefs[key];
  if (key.startsWith("overwriteProjectSettings.")) return ["UI-C20"];
  if (key.startsWith("packages.localization-editor.")) return ["UI-C22"];
  if (key === "nativeCodeBundleMode" || key === "wasmCompressionMode")
    return ["UI-C21"];
  const tail = key.replace(`packages.${platform}.`, "");
  let suffixes = specialRefs[tail] ?? [];
  if (tail.startsWith("renderBackEnd.")) suffixes = ["renderer"];
  if (tail.startsWith("orientation.")) suffixes = ["orientation"];
  if (tail.startsWith("deviceTypes.")) suffixes = ["devices"];
  if (tail.startsWith("networkTimeout.")) suffixes = ["timeouts"];
  const ids = [
    ...suffixes.map((s) => `design.${platform}.${s}`),
    ...(extraRefs[`${platform}:${tail}`] ?? []),
  ];
  const quick = {
    "oppo-mini-game": "OP",
    "vivo-mini-game": "VI",
    "honor-mini-game": "HN",
    "huawei-quick-game": "HW",
  }[platform];
  if (quick) {
    const q = {
      package: "01",
      versionName: "01",
      versionCode: "01",
      icon: "02",
      deviceOrientation: "03",
      useDebugKey: "04",
      privatePemPath: "04",
      certificatePemPath: "04",
      appid: "05",
      appkey: "05",
      runtimeVersion: "05",
      separateEngine: "06",
      minPlatformVersion: "07",
      fullScreen: "08",
      logLevel: "09",
    }[tail];
    if (q) ids.push(`branch.${quick}-Q${q}`);
  }
  return [...new Set(ids.filter((id) => byId.has(id)))];
}
function fieldLabel(platform, key, contract, observed) {
  const tail = key.replace(`packages.${platform}.`, "");
  return (
    observed?.replace(/^\*/, "") ??
    (contract?.choiceLabel
      ? `${contract.uiLabel} · ${contract.choiceLabel}`
      : contract?.uiLabel) ??
    labels[key] ??
    labels[tail] ??
    key
  );
}
const summarySpecial = {
  "web-desktop": [
    "useWebGPU",
    "resolution.designWidth",
    "resolution.designHeight",
  ],
  "web-mobile": ["useWebGPU", "orientation", "embedWebDebugger"],
  "fb-instant-games": ["orientation", "embedWebDebugger"],
  "taobao-mini-game": [
    "globalAdapter",
    "globalVariable",
    "orientation",
    "wasmSubpackage",
  ],
  wechatgame: ["orientation", "wasmSubpackage", "highPerformanceMode"],
  "bytedance-mini-game": [
    "orientation",
    "wasmSubpackage",
    "generatePreloadJsFileList",
    "devToolsLaunchMethod",
  ],
  "alipay-mini-game": ["deviceOrientation", "wasmSubpackage"],
  openpaas: [
    "versionName",
    "deviceOrientation",
    "networkTimeout.XMLHttpRequest",
  ],
  android: ["encrypted", "JobSystem", "maxAspectRatio"],
  windows: ["executableName", "encrypted", "JobSystem"],
  "google-play": ["androidInstant", "remoteUrl", "googleBilling"],
  "harmonyos-next": ["jsEngine", "deviceTypes.phone", "encrypted", "JobSystem"],
  "huawei-agc": [
    "serviceConfigPath",
    "packageName",
    "maxAspectRatio",
    "swappy",
    "isSoFileCompressed",
  ],
  ohos: ["packageName", "encrypted", "JobSystem"],
};
const presentation = { platforms: [], publicGroups: [] };
for (const platform of platformCatalog) {
  const own = data.cases.filter(
    (c) => c.platform === platform.id && activeCase(c),
  );
  const snapshot = snapshots.get(platform.id);
  if (!snapshot) throw new Error(`Missing current UI: ${platform.id}`);
  const bindings = bindingsFor(platform.id, snapshot);
  const p = profiles.baseCombinationPlatforms.find((p) => p.id === platform.id);
  const priority = profiles.platforms.some((p) => p.id === platform.id);
  const fieldMap = new Map();
  const contracts = new Map();
  const add = (key, contract, observed, source) => {
    if (excludedFields.has(key)) return;
    const uiBindings = bindings.get(key);
    if (!uiBindings)
      throw new Error(`No current UI binding: ${platform.id}: ${key}`);
    if (contract) contracts.set(key, contract);
    const section =
      key.startsWith(`packages.${platform.id}.`) || key.startsWith("custom:")
        ? "special"
        : "common";
    const previous = fieldMap.get(key);
    fieldMap.set(key, {
      key,
      label: fieldLabel(
        platform.id,
        key,
        contract,
        uiBindings[0].choice
          ? `${uiBindings[0].label} · ${uiBindings[0].choice}`
          : uiBindings[0].label,
      ),
      section,
      refs: refs(platform.id, key).filter((id) => activeCase(byId.get(id))),
      source: source ?? previous?.source ?? sourceLink("profiles.ts"),
      bindings: uiBindings,
    });
  };
  for (const f of snapshot?.fields ?? [])
    if (f.visible) add(f.key, undefined, f.label, snapshot.source);
  for (const f of priority
    ? profiles.specialFields(p)
    : existingFields(platform.id))
    add(f.key, f);
  const proposed = design.platforms.find((p) => p.id === platform.id);
  if (!proposed) throw new Error(`Missing design platform: ${platform.id}`);
  const combinations = proposed.combinations.map((c) => {
    const source = {
      label: "公共组合与测试输入定稿",
      href: "../tools/case-catalog/public-combinations.json",
    };
    for (const key of Object.keys(c.values))
      add(key, undefined, undefined, source);
    for (const variant of c.variants)
      for (const key of Object.keys(variant.values))
        add(key, undefined, undefined, source);
    const scenarios = (c.scenarioIds ?? []).map((id) => {
      const scenario = scenarioById.get(id);
      if (!scenario || !scenario.platforms.includes(platform.id))
        throw new Error(
          `Inapplicable conditional scenario: ${platform.id}: ${id}`,
        );
      for (const key of Object.keys(
        scenario.valuesByPlatform[platform.id] ?? {},
      ))
        add(key, undefined, undefined, source);
      return scenario;
    });
    const preferred = [
      "debug",
      "mainBundleCompressionType",
      ...(
        summarySpecial[platform.id] ?? [
          "deviceOrientation",
          "versionName",
          "separateEngine",
        ]
      ).map((key) => `packages.${platform.id}.${key}`),
    ];
    return {
      ...c,
      scenarios,
      reviewItems: (c.reviewItemIds ?? []).map((id) => {
        const item = reviewById.get(id);
        if (!item || !item.platforms.includes(platform.id))
          throw new Error(`Inapplicable review item: ${platform.id}: ${id}`);
        return item;
      }),
      purpose: "design",
      source,
      conditions: Object.fromEntries(
        [...bindings.keys()]
          .map((key) => [key, conditionsFor(platform.id, key, c.values)])
          .filter(([, notes]) => notes.length),
      ),
      summaryKeys: preferred
        .filter((key) => Object.hasOwn(c.values, key))
        .slice(0, 6),
      initial: {},
      hidden: [],
      hiddenInitially: [],
      retained: [],
      orderedKeys: [
        ...new Set([
          ...(c.configurationOrder ?? []).filter((key) =>
            Object.hasOwn(c.values, key),
          ),
          ...Object.keys(c.values),
        ]),
      ],
      unspecified: "保持当前值；本组合未安排该字段变化覆盖",
    };
  });
  // Complete visible fields and registered conditional children share one canonical identity.
  for (const key of bindings.keys())
    add(key, contracts.get(key), undefined, snapshot.source);
  presentation.platforms.push({
    id: platform.id,
    name: platform.label,
    category: platform.category,
    fields: [...fieldMap.values()],
    combinations,
    standaloneIds: own
      .filter((c) => c.type !== "公共组合定稿")
      .map((c) => c.id),
  });
}
const ids = (prefix, numbers) =>
  numbers.map((n) => `${prefix}${String(n).padStart(2, "0")}`);
const groups = [
  [
    "入口与平台切换",
    [
      ["打开与切换", ids("UI-N", [1, 2, 3, 4, 6])],
      ["加载、链接与布局", ids("UI-N", [5, 7, 9])],
    ],
  ],
  [
    "配置表单与交互",
    [
      ["加载、关闭与焦点", ids("UI-C", [1, 2, 3])],
      ["名称、路径与输出", ids("UI-C", [4, 5, 6, 7])],
      ["场景搜索与选择", ids("UI-C", [8, 9, 10])],
      ["调试、编译与资源", ids("UI-C", [11, 12, 13, 14, 15, 16, 17, 18])],
      ["引擎、附加区与提示", ids("UI-C", [19, 20, 21, 22, 23])],
      ["平台差异与文件前提", ids("UI-P", [1, 2, 3, 4, 5, 6, 7, 8])],
      ["共享构建分支", ["branch.C06", "branch.C07", "branch.C08"]],
    ],
  ],
  ["保存与恢复", [["保存、重开与保持", ["UI-C24"]]]],
  [
    "构建提交",
    [
      ["单项与全部构建入口", ["UI-C25", "UI-C26", "UI-N08"]],
      ["用例分组与配置分发", ["UI-P09", "UI-P10"]],
    ],
  ],
  [
    "构建记录与任务状态",
    [
      ["进入、时间与批次", ids("UI-H", [1, 2, 3, 4])],
      ["搜索与筛选", ids("UI-H", [5, 6, 7, 8, 9, 10, 11])],
      ["任务身份与排队进度", ids("UI-H", [12, 13, 14, 15])],
      ["成功、失败与错误展示", ids("UI-H", [16, 17, 18])],
      ["旧记录、多目标与定位", ids("UI-H", [29, 32, 33])],
    ],
  ],
  [
    "日志、输出与历史操作",
    [
      ["日志、目录与历史配置", ids("UI-H", [19, 20, 21, 22])],
      ["重建、取消与任务菜单", ids("UI-H", [23, 24, 25, 26, 27, 28])],
      ["阶段入口、引导及异常", ids("UI-H", [30, 31, 34, 35])],
    ],
  ],
];
const publicAssigned = new Set();
for (const [name, topics] of groups)
  presentation.publicGroups.push({
    name,
    topics: topics.map(([name, caseIds]) => {
      for (const id of caseIds) {
        if (!byId.has(id) || !activeCase(byId.get(id)))
          throw new Error(`Invalid public reference ${id}`);
        publicAssigned.add(id);
      }
      return { name, caseIds };
    }),
  });
const remaining = data.cases
  .filter((c) => !c.platform && activeCase(c) && !publicAssigned.has(c.id))
  .map((c) => c.id);
if (remaining.length)
  presentation.publicGroups.push({
    name: "其他专项",
    topics: [{ name: "其他公共检查", caseIds: remaining }],
  });
const reachable = new Set([
  ...presentation.platforms.flatMap((p) => [
    ...p.combinations.map((c) => c.id),
    ...p.standaloneIds,
  ]),
  ...presentation.publicGroups.flatMap((g) =>
    g.topics.flatMap((t) => t.caseIds),
  ),
]);
presentation.excludedCases = data.cases
  .filter((c) => !activeCase(c))
  .map((c) => ({ id: c.id, reason: c.applicability.reason }));
const lost = data.cases.filter((c) => activeCase(c) && !reachable.has(c.id));
if (lost.length)
  throw new Error(`Unreachable cases: ${lost.map((c) => c.id).join(", ")}`);
for (const platform of presentation.platforms) {
  const fields = new Set(platform.fields.map((f) => f.key));
  if (fields.size !== platform.fields.length)
    throw new Error(`Duplicate field: ${platform.id}`);
  for (const combo of platform.combinations) {
    for (const key of [
      ...Object.keys(combo.values),
      ...combo.variants.flatMap((v) => Object.keys(v.values)),
      ...combo.scenarios.flatMap((s) =>
        Object.keys(s.valuesByPlatform[platform.id] ?? {}),
      ),
    ])
      if (!fields.has(key) || excludedFields.has(key))
        throw new Error(`Unbound target: ${combo.id}: ${key}`);
  }
  for (const field of platform.fields) {
    if (excludedFields.has(field.key) || !field.bindings.length)
      throw new Error(`Invalid current field: ${field.key}`);
    for (const id of field.refs)
      if (!activeCase(byId.get(id)))
        throw new Error(`Inapplicable reference: ${id}`);
  }
}
presentation.review = { status: design.status, decisions: design.decisions };
presentation.conditionalPolicy = design.conditionalPolicy;
presentation.coveragePolicy = design.coveragePolicy;
data.presentation = presentation;
data.executionSource = executionSource;
data.executionSourceHash = createHash("sha256")
  .update(JSON.stringify(executionSource))
  .digest("hex");
if (!html.includes("<!-- CASE_CATALOG -->"))
  throw new Error("Missing catalogue insertion point");
await writeFile(
  pagePath,
  await format(
    html.replace(
      "<!-- CASE_CATALOG -->",
      `<script>globalThis.PinkCaseContract = (${createCaseContract.toString()})();</script>\n<script id="catalog-data" type="application/json">\n${JSON.stringify(data, null, 2).replace(/</g, "\\u003c")}\n</script>`,
    ),
    { parser: "html" },
  ),
  "utf8",
);
console.log(
  `Exported ${presentation.platforms.length} platforms, ${presentation.platforms.flatMap((p) => p.combinations).length} group entries, ${scenarioById.size} conditional scenario definitions; ${reachable.size} records reachable. Design display only; no tests or builds executed.`,
);

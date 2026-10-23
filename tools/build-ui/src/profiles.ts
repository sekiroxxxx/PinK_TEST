import type { FieldValue } from "./common.js";

export interface Platform {
  id: string;
  label: string;
  category: "X-Device" | "X-Application";
  compression: "none" | "merge_all_json" | "subpackage";
  releaseCompression?: "none" | "merge_dep" | "merge_all_json";
  debugMd5?: boolean;
  webgl2: "on" | "off";
  textureAndAtlas: boolean;
  sceneBundle: boolean;
}

export const platforms: readonly Platform[] = [
  {
    id: "web-desktop",
    label: "Web 桌面端",
    category: "X-Device",
    compression: "merge_all_json",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: false,
  },
  {
    id: "web-mobile",
    label: "Web 手机端",
    category: "X-Device",
    compression: "merge_all_json",
    webgl2: "on",
    textureAndAtlas: false,
    sceneBundle: false,
  },
  {
    id: "oppo-mini-game",
    label: "OPPO",
    category: "X-Application",
    compression: "subpackage",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "vivo-mini-game",
    label: "vivo",
    category: "X-Application",
    compression: "subpackage",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "honor-mini-game",
    label: "荣耀",
    category: "X-Application",
    compression: "subpackage",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "huawei-quick-game",
    label: "华为快游戏",
    category: "X-Application",
    compression: "subpackage",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "taobao-mini-game",
    label: "淘宝",
    category: "X-Application",
    compression: "subpackage",
    webgl2: "off",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "fb-instant-games",
    label: "Facebook 即时游戏",
    category: "X-Application",
    compression: "merge_all_json",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: false,
  },
];

/** Base D/A coverage only. Priority B/C special baselines remain unchanged. */
export const additionalPlatforms: readonly Platform[] = [
  {
    id: "wechatgame",
    label: "微信小游戏",
    category: "X-Application",
    compression: "merge_all_json",
    debugMd5: true,
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "bytedance-mini-game",
    label: "抖音小游戏",
    category: "X-Application",
    compression: "merge_all_json",
    debugMd5: true,
    webgl2: "off",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  {
    id: "alipay-mini-game",
    label: "支付宝",
    category: "X-Application",
    compression: "merge_all_json",
    releaseCompression: "merge_dep",
    debugMd5: true,
    webgl2: "off",
    textureAndAtlas: true,
    sceneBundle: true,
  },
  ...[
    { id: "android", label: "安卓", category: "X-Device" as const },
    { id: "google-play", label: "Google Play 商店", category: "X-Application" as const },
    { id: "windows", label: "Windows", category: "X-Device" as const },
    { id: "harmonyos-next", label: "鸿蒙 NEXT", category: "X-Device" as const },
    { id: "huawei-agc", label: "AppGallery Connect", category: "X-Device" as const },
    { id: "ohos", label: "鸿蒙", category: "X-Device" as const },
  ].map((platform): Platform => ({
    ...platform,
    compression: "none",
    releaseCompression: "none",
    webgl2: "off",
    textureAndAtlas: true,
    sceneBundle: false,
  })),
  {
    id: "openpaas",
    label: "3000+ 平台",
    category: "X-Application",
    compression: "subpackage",
    webgl2: "on",
    textureAndAtlas: true,
    sceneBundle: false,
  },
];

export const baseCombinationPlatforms: readonly Platform[] = [...platforms, ...additionalPlatforms];

export function debugFields(platform: Platform): Record<string, boolean | string> {
  return {
    "overwriteProjectSettings.includeModules.physics": "physics-ammo",
    "overwriteProjectSettings.includeModules.gfx-webgl2": platform.webgl2,
    debug: true,
    md5Cache: platform.debugMd5 ?? false,
    mainBundleIsRemote: false,
    server: "",
    mainBundleCompressionType: platform.compression,
    ...(platform.textureAndAtlas ? { skipCompressTexture: true, packAutoAtlas: false } : {}),
    ...(platform.sceneBundle ? { startSceneAssetBundle: false } : {}),
  };
}

export function releaseFields(platform: Platform): Record<string, boolean | string> {
  return {
    "overwriteProjectSettings.includeModules.physics": "physics-builtin",
    "overwriteProjectSettings.includeModules.gfx-webgl2": platform.webgl2,
    debug: false,
    md5Cache: true,
    mainBundleIsRemote: false,
    server: "",
    mainBundleCompressionType:
      platform.releaseCompression ?? (platform.category === "X-Device" ? "none" : "merge_all_json"),
    ...(platform.textureAndAtlas ? { skipCompressTexture: false, packAutoAtlas: true } : {}),
    ...(platform.sceneBundle ? { startSceneAssetBundle: true } : {}),
  };
}

/** B-round public branches; conditional Wasm compression is set after choosing Wasm. */
export function releaseBFields(platform: Platform): Record<string, boolean | string> {
  return {
    ...releaseFields(platform),
    ...(platform.id === "web-desktop" ? { mainBundleCompressionType: "merge_dep" } : {}),
    ...(platform.id === "oppo-mini-game" ? { mainBundleCompressionType: "subpackage" } : {}),
    ...(platform.id === "taobao-mini-game"
      ? { nativeCodeBundleMode: "wasm", wasmCompressionMode: true }
      : {}),
  };
}

/** C's local branches; Zip/remote still require M01 and are not silently substituted. */
export function releaseCLocalFields(platform: Platform): Record<string, boolean | string> {
  return {
    ...releaseFields(platform),
    ...(platform.id === "web-desktop" ? { mainBundleCompressionType: "merge_all_json" } : {}),
    ...(platform.id === "taobao-mini-game" ? { nativeCodeBundleMode: "asmjs" } : {}),
  };
}

export interface SpecialFieldContract {
  key: string;
  type: "boolean" | "number" | "string";
  optionalEmpty?: boolean;
  redact?: boolean;
  fingerprint?: boolean;
  missingDefault?: false;
  uiLabel?: string;
  choiceLabel?: string;
  nativeSelect?: boolean;
  arrayChoices?: string[];
  minimum?: number;
}

export interface SpecialField extends SpecialFieldContract {
  expected: FieldValue;
}

/** The reviewed A-round baseline, not a generic form schema or a configuration writer. */
export function specialFields(platform: Platform): SpecialField[] {
  const field = (key: string, baseline: FieldValue, optionalEmpty = false): SpecialField => ({
    key: `packages.${platform.id}.${key}`,
    type: typeof baseline as SpecialField["type"],
    expected: baseline,
    ...(optionalEmpty ? { optionalEmpty: true } : {}),
  });
  if (platform.id === "web-desktop")
    return [
      field("useWebGPU", false),
      field("resolution.designWidth", 1280),
      field("resolution.designHeight", 960),
    ];
  if (platform.id === "web-mobile")
    return [field("orientation", "auto"), field("embedWebDebugger", false)];
  if (platform.id === "fb-instant-games")
    return [field("orientation", "portrait"), field("embedWebDebugger", false)];
  if (platform.id === "taobao-mini-game")
    return [
      field("orientation", "portrait"),
      field("wasmSubpackage", false),
      field("separateEngine", false),
    ];
  const packages: Record<string, string> = {
    "oppo-mini-game": "com.oppo.cocos",
    "vivo-mini-game": "com.vivo.cocos",
    "honor-mini-game": "com.honor.cocos",
    "huawei-quick-game": "com.huawei.cocos",
  };
  if (!packages[platform.id]) throw new Error(`未定义 A 轮专属基准：${platform.id}`);
  return [
    field("package", packages[platform.id]),
    field("icon", "./icon/icon.png"),
    field("versionName", "1.0.0"),
    field("versionCode", "1"),
    field("runtimeVersion", "2.0.0"),
    field("appid", "", true),
    { ...field("appkey", "[redacted:empty]", true), redact: true },
    field("deviceOrientation", "portrait"),
    field("useDebugKey", true),
    field("privatePemPath", "", true),
    field("certificatePemPath", "", true),
    ...(platform.id !== "honor-mini-game" ? [field("separateEngine", false)] : []),
    ...(platform.id === "honor-mini-game" ? [field("minPlatformVersion", 1080)] : []),
    ...(platform.id === "huawei-quick-game" ? [field("minPlatformVersion", "1103")] : []),
    ...(["honor-mini-game", "huawei-quick-game"].includes(platform.id)
      ? [field("fullScreen", true), field("logLevel", "log")]
      : []),
  ];
}

export function releaseBSpecialFields(platform: Platform): SpecialField[] {
  const prefix = `packages.${platform.id}.`;
  let changes: Record<string, FieldValue>;
  switch (platform.id) {
    case "web-desktop":
      changes = { useWebGPU: true, "resolution.designWidth": 960, "resolution.designHeight": 640 };
      break;
    case "web-mobile":
    case "fb-instant-games":
      changes = { orientation: "landscape", embedWebDebugger: true };
      break;
    case "taobao-mini-game":
      changes = { orientation: "landscape", wasmSubpackage: true };
      break;
    default: {
      const suffixes: Record<string, string> = {
        "oppo-mini-game": "oppo",
        "vivo-mini-game": "vivo",
        "honor-mini-game": "honor",
        "huawei-quick-game": "huawei",
      };
      changes = {
        package: `com.pink.qa.${suffixes[platform.id]}`,
        versionName: "1.0.1",
        versionCode: "2",
        deviceOrientation: "landscape",
        ...(platform.id === "honor-mini-game"
          ? { minPlatformVersion: 1081, fullScreen: false, logLevel: "warn" }
          : {}),
        ...(platform.id === "huawei-quick-game"
          ? {
              minPlatformVersion: "1104",
              fullScreen: false,
              logLevel: "warn",
              separateEngine: true,
            }
          : {}),
      };
    }
  }
  return specialFields(platform).map((field) => ({
    ...field,
    ...(Object.hasOwn(changes, field.key.slice(prefix.length))
      ? { expected: changes[field.key.slice(prefix.length)] }
      : {}),
  }));
}

export function releaseCLocalSpecialFields(platform: Platform): SpecialField[] {
  return specialFields(platform).map((field) => ({
    ...field,
    ...(platform.id === "web-mobile" && field.key.endsWith(".orientation")
      ? { expected: "portrait" }
      : {}),
    ...(platform.id === "oppo-mini-game" && field.key.endsWith(".separateEngine")
      ? { expected: true }
      : {}),
  }));
}

/** Only previously reviewed non-secret scenario fields may be changed by ApplyProfile. */
export function canApplySpecial(field: SpecialField): boolean {
  return (
    !field.redact &&
    [
      "useWebGPU",
      "designWidth",
      "designHeight",
      "orientation",
      "embedWebDebugger",
      "package",
      "versionName",
      "versionCode",
      "deviceOrientation",
      "separateEngine",
      "wasmSubpackage",
      "minPlatformVersion",
      "fullScreen",
      "logLevel",
    ].includes(field.key.split(".").at(-1)!)
  );
}

export function deferredReleaseBBranches() {
  return [
    ...deferredReleaseBranches.filter((branch) => !["M06", "M07"].includes(branch.material)),
    {
      material: "M06",
      branches: "Q01 非默认 runtimeVersion",
      status: "precondition-unverified",
      reason: "有效平台运行时版本待核定，保留 2.0.0",
    },
    {
      material: "M07",
      branches: "TA03 分离引擎开启",
      status: "precondition-unverified",
      reason: "alpha SDK 分离引擎兼容待核实",
    },
  ];
}

export const deferredReleaseBranches = [
  {
    material: "M01",
    branches: "C04 / C09 远程侧",
    status: "missing-material",
    reason: "缺测试资源 URL",
  },
  {
    material: "M02",
    branches: "Q02 自定义图标",
    status: "precondition-unverified",
    reason: "图标与路径兼容待核实",
  },
  {
    material: "M03",
    branches: "Q04 自定义签名",
    status: "missing-material",
    reason: "缺匹配测试私钥和证书",
  },
  {
    material: "M04",
    branches: "Q05 非空应用参数",
    status: "missing-material",
    reason: "缺合法测试 AppID/AppKey",
  },
  {
    material: "M05",
    branches: "C07 实际纹理/图集处理",
    status: "missing-material",
    reason: "缺已配置且被场景引用的样本",
  },
  {
    material: "M06",
    branches: "Q01 / Q07 / Q09 非默认候选",
    status: "precondition-unverified",
    reason: "版本及日志候选规则待核实",
  },
  {
    material: "M07",
    branches: "TA03 / HW-Q06 开启侧",
    status: "precondition-unverified",
    reason: "分离引擎前提待核实",
  },
];

export function omittedFields(platform: Platform): string[] {
  return [
    ...(!platform.textureAndAtlas ? ["skipCompressTexture", "packAutoAtlas"] : []),
    ...(!platform.sceneBundle ? ["startSceneAssetBundle"] : []),
    "polyfills.asyncFunctions",
  ];
}

export function selectionLabel(value: string): string {
  const labels: Record<string, string> = {
    "physics-ammo": "基于 Bullet 的物理系统",
    "physics-builtin": "内置物理系统",
    none: "无压缩",
    on: "开启",
    off: "关闭",
    merge_all_json: "合并所有 JSON",
    merge_dep: "合并依赖",
    subpackage: "小游戏分包",
    wasm: "Wasm",
    asmjs: "Asmjs",
  };
  if (!labels[value]) throw new Error(`没有适配下拉值：${value}`);
  return labels[value];
}

export function optionAt(options: Record<string, unknown>, path: string): unknown {
  let current: unknown = options;
  for (const key of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

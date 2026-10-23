import { platforms, specialFields } from "./profiles.js";

export interface PlatformEntry {
  id: string;
  label: string;
  category: "X-Device" | "X-Application";
  configurationTitle?: string;
  configurationBlock?: string;
  requiredOptionKeys?: string[];
  requiredCustomLabels?: string[];
  build:
    | "supported"
    | "base-combinations"
    | "existing-only"
    | "precondition-unverified"
    | "missing-material"
    | "stage-out-of-scope";
  reason?: string;
}

/** Windows package catalogue; build support is separate from configuration-page coverage. */
export const platformCatalog: readonly PlatformEntry[] = [
  {
    id: "ohos",
    label: "鸿蒙",
    category: "X-Device",
    build: "base-combinations",
  },
  {
    id: "harmonyos-next",
    label: "鸿蒙 NEXT",
    category: "X-Device",
    build: "base-combinations",
  },
  {
    id: "huawei-agc",
    label: "AppGallery Connect",
    category: "X-Device",
    build: "base-combinations",
  },
  {
    id: "android",
    label: "安卓",
    category: "X-Device",
    build: "base-combinations",
  },
  ...platforms
    .filter((p) => p.category === "X-Device")
    .map((p): PlatformEntry => ({
      id: p.id,
      label: p.label,
      category: p.category,
      build: "supported",
    })),
  {
    id: "windows",
    label: "Windows",
    category: "X-Device",
    build: "base-combinations",
  },
  {
    id: "openpaas",
    label: "3000+ 平台",
    category: "X-Application",
    build: "base-combinations",
    configurationBlock:
      "OpenPaaS使用专属openpaas模式检查必填项和已有游戏；通用inspect/exercise不进入",
  },
  {
    id: "wechatgame",
    label: "微信小游戏",
    category: "X-Application",
    build: "base-combinations",
  },
  {
    id: "bytedance-mini-game",
    label: "抖音小游戏",
    category: "X-Application",
    build: "base-combinations",
  },
  {
    id: "alipay-mini-game",
    label: "支付宝",
    category: "X-Application",
    build: "base-combinations",
  },
  ...platforms
    .filter((p) => p.category === "X-Application")
    .map((p): PlatformEntry => ({
      id: p.id,
      label: p.label,
      category: p.category,
      build: "supported",
    })),
  {
    id: "google-play",
    label: "Google Play 商店",
    category: "X-Application",
    build: "base-combinations",
  },
];

export function platformEntry(id: string): PlatformEntry {
  const platform = platformCatalog.find((entry) => entry.id === id);
  if (!platform) throw new Error(`未维护的平台ID：${id}`);
  const titles: Record<string, string> = {
    ohos: "OHOS",
    "harmonyos-next": "HarmonyOS Next",
    "huawei-agc": "华为 AppGallery Connect",
    android: "Android",
    openpaas: "openpaas小游戏",
    "alipay-mini-game": "支付宝小游戏",
    "fb-instant-games": "Facebook Instant Games",
    "google-play": "Google Play",
    "vivo-mini-game": "vivo 小游戏",
    "taobao-mini-game": "淘宝小游戏",
    "oppo-mini-game": "OPPO 小游戏",
    "honor-mini-game": "荣耀小游戏",
  };
  const extra: Record<string, string[]> = {
    openpaas: ["versionName"],
    ohos: [
      "packageName",
      "apiLevel",
      "orientation.portrait",
      "orientation.landscapeRight",
      "orientation.landscapeLeft",
    ],
    "harmonyos-next": [
      "jsEngine",
      "useGamepad",
      "packageName",
      "renderBackEnd.gles3",
      "orientation.portrait",
      "deviceTypes.phone",
      "deviceTypes.default",
    ],
    "huawei-agc": [
      "packageName",
      "serviceConfigPath",
      "swappy",
      "renderBackEnd.gles3",
      "orientation.portrait",
      "inputSDK",
      "isSoFileCompressed",
    ],
    android: [
      "packageName",
      "swappy",
      "renderBackEnd.gles3",
      "resizeableActivity",
      "orientation.portrait",
      "inputSDK",
    ],
    windows: ["executableName", "targetPlatform", "renderBackEnd.gles3"],
    wechatgame: [
      "orientation",
      "appid",
      "buildOpenDataContextTemplate",
      "wasmSubpackage",
      "separateEngine",
      "highPerformanceMode",
    ],
    "bytedance-mini-game": [
      "orientation",
      "appid",
      "buildOpenDataContextTemplate",
      "wasmSubpackage",
      "separateEngine",
      "devToolsLaunchMethod",
      "generatePreloadJsFileList",
    ],
    "alipay-mini-game": ["deviceOrientation", "wasmSubpackage"],
    "google-play": ["packageName", "swappy", "adpf"],
    "vivo-mini-game": ["icon", "versionName", "versionCode", "runtimeVersion"],
  };
  const profile = platforms.find((entry) => entry.id === id);
  const requiredOptionKeys = extra[id]
    ? extra[id].map((key) => `packages.${id}.${key}`)
    : profile
      ? specialFields(profile).map((field) => field.key)
      : [];
  const requiredCustomLabels =
    id === "openpaas"
      ? ["OpenPaaS 游戏"]
      : id === "vivo-mini-game"
        ? ["游戏包名", "屏幕方向", "使用调试秘钥库", "private.pem 路径", "certificate.pem 路径"]
        : id === "taobao-mini-game"
          ? ["globalThis 全局变量适配", "全局变量"]
          : [];
  return {
    ...platform,
    configurationTitle: titles[id] ?? platform.label,
    requiredOptionKeys,
    requiredCustomLabels,
  };
}

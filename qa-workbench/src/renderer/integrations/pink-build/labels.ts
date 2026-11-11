import platformPresentation from "./platform-presentation.json";

export const labels: Record<string, string> = {
  ...platformPresentation.labels,
  name: "名称",
  buildPath: "构建路径",
  outputName: "输出名称",
  startScene: "初始场景",
  scenes: "包含场景",
  debug: "调试模式",
  md5Cache: "MD5 缓存",
  mangleProperties: "混淆属性名",
  inlineEnum: "内联枚举",
  sourceMaps: "Source Map",
  experimentalEraseModules: "实验性模块裁剪",
  skipCompressTexture: "跳过纹理压缩",
  packAutoAtlas: "打包自动图集",
  useSplashScreen: "启动画面",
  bundleCommonChunk: "公共代码块",
  mainBundleCompressionType: "主包压缩类型",
  mainBundleIsRemote: "主包为远程包",
  server: "资源服务器地址",
  engineModulesConfigKey: "引擎模块配置",
  "overwriteProjectSettings.includeModules.physics": "3D 物理模块",
  "overwriteProjectSettings.includeModules.physics-2d": "2D 物理模块",
  "overwriteProjectSettings.includeModules.gfx-webgl2": "WebGL 2 模块",
  "overwriteProjectSettings.macroConfig.cleanupImageCache": "图像缓存清理",
};
export const label = (key: string) => labels[key] ?? key;
export function display(value: unknown, sensitive = false): string {
  if (value && typeof value === "object" && "$material" in value)
    return "材料引用：" + String(value.$material);
  if (value && typeof value === "object" && "$scene" in value)
    return "场景角色：" + String(value.$scene);
  if (sensitive) return "已配置（隐藏原值）";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (value === undefined) return "未指定目标";
  if (Array.isArray(value))
    return value.map((v) => display(v, sensitive)).join("，");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

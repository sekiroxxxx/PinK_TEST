// Executor-owned field registry. Changing a case document does not register a UI capability.
import type { FieldType } from "./case-contract.js";

export const supportedFieldTypes: Readonly<Record<string, FieldType>> = {
  "binGroupConfig.enable": {
    kind: "boolean",
  },
  "binGroupConfig.threshold": {
    kind: "number",
  },
  buildPath: {
    kind: "string",
  },
  bundleCommonChunk: {
    kind: "boolean",
  },
  debug: {
    kind: "boolean",
  },
  engineModulesConfigKey: {
    kind: "string",
  },
  experimentalEraseModules: {
    kind: "boolean",
  },
  inlineEnum: {
    kind: "boolean",
  },
  mainBundleCompressionType: {
    kind: "string",
  },
  mainBundleIsRemote: {
    kind: "boolean",
  },
  mangleProperties: {
    kind: "boolean",
  },
  md5Cache: {
    kind: "boolean",
  },
  "md5CacheOptions.handleTemplateMd5Link": {
    kind: "boolean",
  },
  name: {
    kind: "string",
  },
  nativeCodeBundleMode: {
    kind: "string",
  },
  outputName: {
    kind: "string",
  },
  "overwriteProjectSettings.includeModules.gfx-webgl2": {
    kind: "string",
  },
  "overwriteProjectSettings.includeModules.physics": {
    kind: "string",
  },
  "overwriteProjectSettings.includeModules.physics-2d": {
    kind: "string",
  },
  "overwriteProjectSettings.macroConfig.cleanupImageCache": {
    kind: "string",
  },
  "packages.alipay-mini-game.deviceOrientation": {
    kind: "string",
  },
  "packages.alipay-mini-game.wasmSubpackage": {
    kind: "boolean",
  },
  "packages.android.androidInstant": {
    kind: "boolean",
  },
  "packages.android.apiLevel": {
    kind: "number",
  },
  "packages.android.appABIs": {
    kind: "array",
  },
  "packages.android.compressZip": {
    kind: "boolean",
  },
  "packages.android.encrypted": {
    kind: "boolean",
  },
  "packages.android.inputSDK": {
    kind: "boolean",
  },
  "packages.android.isSoFileCompressed": {
    kind: "boolean",
  },
  "packages.android.JobSystem": {
    kind: "string",
  },
  "packages.android.keystoreAlias": {
    kind: "string",
  },
  "packages.android.keystoreAliasPassword": {
    kind: "string",
    sensitive: true,
  },
  "packages.android.keystorePassword": {
    kind: "string",
    sensitive: true,
  },
  "packages.android.keystorePath": {
    kind: "string",
  },
  "packages.android.maxAspectRatio": {
    kind: "string",
  },
  "packages.android.orientation.landscapeLeft": {
    kind: "boolean",
  },
  "packages.android.orientation.landscapeRight": {
    kind: "boolean",
  },
  "packages.android.orientation.portrait": {
    kind: "boolean",
  },
  "packages.android.packageName": {
    kind: "string",
  },
  "packages.android.renderBackEnd.gles2": {
    kind: "boolean",
  },
  "packages.android.renderBackEnd.gles3": {
    kind: "boolean",
  },
  "packages.android.renderBackEnd.vulkan": {
    kind: "boolean",
  },
  "packages.android.resizeableActivity": {
    kind: "boolean",
  },
  "packages.android.swappy": {
    kind: "boolean",
  },
  "packages.android.useDebugKeystore": {
    kind: "boolean",
  },
  "packages.android.xxteaKey": {
    kind: "string",
    sensitive: true,
  },
  "packages.bytedance-mini-game.appid": {
    kind: "string",
    sensitive: true,
  },
  "packages.bytedance-mini-game.buildOpenDataContextTemplate": {
    kind: "boolean",
  },
  "packages.bytedance-mini-game.devToolsLaunchMethod": {
    kind: "string",
  },
  "packages.bytedance-mini-game.generatePreloadJsFileList": {
    kind: "boolean",
  },
  "packages.bytedance-mini-game.orientation": {
    kind: "string",
  },
  "packages.bytedance-mini-game.separateEngine": {
    kind: "boolean",
  },
  "packages.bytedance-mini-game.wasmSubpackage": {
    kind: "boolean",
  },
  "packages.fb-instant-games.embedWebDebugger": {
    kind: "boolean",
  },
  "packages.fb-instant-games.orientation": {
    kind: "string",
  },
  "packages.google-play.adpf": {
    kind: "boolean",
  },
  "packages.google-play.androidInstant": {
    kind: "boolean",
  },
  "packages.google-play.apiLevel": {
    kind: "number",
  },
  "packages.google-play.appABIs": {
    kind: "array",
  },
  "packages.google-play.customIcon": {
    kind: "string",
  },
  "packages.google-play.googleBilling": {
    kind: "boolean",
  },
  "packages.google-play.inputSDK": {
    kind: "boolean",
  },
  "packages.google-play.isSoFileCompressed": {
    kind: "boolean",
  },
  "packages.google-play.keystoreAlias": {
    kind: "string",
  },
  "packages.google-play.keystoreAliasPassword": {
    kind: "string",
    sensitive: true,
  },
  "packages.google-play.keystorePassword": {
    kind: "string",
    sensitive: true,
  },
  "packages.google-play.keystorePath": {
    kind: "string",
  },
  "packages.google-play.maxAspectRatio": {
    kind: "string",
  },
  "packages.google-play.orientation.landscapeLeft": {
    kind: "boolean",
  },
  "packages.google-play.orientation.landscapeRight": {
    kind: "boolean",
  },
  "packages.google-play.orientation.portrait": {
    kind: "boolean",
  },
  "packages.google-play.orientation.upsideDown": {
    kind: "boolean",
  },
  "packages.google-play.packageName": {
    kind: "string",
  },
  "packages.google-play.remoteUrl": {
    kind: "string",
  },
  "packages.google-play.renderBackEnd.gles2": {
    kind: "boolean",
  },
  "packages.google-play.renderBackEnd.gles3": {
    kind: "boolean",
  },
  "packages.google-play.renderBackEnd.vulkan": {
    kind: "boolean",
  },
  "packages.google-play.resizeableActivity": {
    kind: "boolean",
  },
  "packages.google-play.swappy": {
    kind: "boolean",
  },
  "packages.google-play.useDebugKeystore": {
    kind: "boolean",
  },
  "packages.harmonyos-next.appABIs": {
    kind: "array",
  },
  "packages.harmonyos-next.compressZip": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.car": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.default": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.pc_2in1": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.phone": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.tablet": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.tv": {
    kind: "boolean",
  },
  "packages.harmonyos-next.deviceTypes.wearable": {
    kind: "boolean",
  },
  "packages.harmonyos-next.encrypted": {
    kind: "boolean",
  },
  "packages.harmonyos-next.JobSystem": {
    kind: "string",
  },
  "packages.harmonyos-next.jsEngine": {
    kind: "string",
  },
  "packages.harmonyos-next.orientation.landscapeLeft": {
    kind: "boolean",
  },
  "packages.harmonyos-next.orientation.landscapeRight": {
    kind: "boolean",
  },
  "packages.harmonyos-next.orientation.portrait": {
    kind: "boolean",
  },
  "packages.harmonyos-next.packageName": {
    kind: "string",
  },
  "packages.harmonyos-next.renderBackEnd.gles3": {
    kind: "boolean",
  },
  "packages.harmonyos-next.useGamepad": {
    kind: "boolean",
  },
  "packages.harmonyos-next.xxteaKey": {
    kind: "string",
    sensitive: true,
  },
  "packages.honor-mini-game.appid": {
    kind: "string",
    sensitive: true,
  },
  "packages.honor-mini-game.appkey": {
    kind: "string",
    sensitive: true,
  },
  "packages.honor-mini-game.certificatePemPath": {
    kind: "string",
  },
  "packages.honor-mini-game.deviceOrientation": {
    kind: "string",
  },
  "packages.honor-mini-game.fullScreen": {
    kind: "boolean",
  },
  "packages.honor-mini-game.icon": {
    kind: "string",
  },
  "packages.honor-mini-game.logLevel": {
    kind: "string",
  },
  "packages.honor-mini-game.minPlatformVersion": {
    kind: "number",
  },
  "packages.honor-mini-game.package": {
    kind: "string",
  },
  "packages.honor-mini-game.privatePemPath": {
    kind: "string",
  },
  "packages.honor-mini-game.runtimeVersion": {
    kind: "string",
  },
  "packages.honor-mini-game.useDebugKey": {
    kind: "boolean",
  },
  "packages.honor-mini-game.versionCode": {
    kind: "string",
  },
  "packages.honor-mini-game.versionName": {
    kind: "string",
  },
  "packages.huawei-agc.apiLevel": {
    kind: "number",
  },
  "packages.huawei-agc.inputSDK": {
    kind: "boolean",
  },
  "packages.huawei-agc.isSoFileCompressed": {
    kind: "boolean",
  },
  "packages.huawei-agc.keystoreAlias": {
    kind: "string",
  },
  "packages.huawei-agc.keystoreAliasPassword": {
    kind: "string",
    sensitive: true,
  },
  "packages.huawei-agc.keystorePassword": {
    kind: "string",
    sensitive: true,
  },
  "packages.huawei-agc.keystorePath": {
    kind: "string",
  },
  "packages.huawei-agc.maxAspectRatio": {
    kind: "string",
  },
  "packages.huawei-agc.orientation.landscapeLeft": {
    kind: "boolean",
  },
  "packages.huawei-agc.orientation.landscapeRight": {
    kind: "boolean",
  },
  "packages.huawei-agc.orientation.portrait": {
    kind: "boolean",
  },
  "packages.huawei-agc.packageName": {
    kind: "string",
  },
  "packages.huawei-agc.renderBackEnd.gles2": {
    kind: "boolean",
  },
  "packages.huawei-agc.renderBackEnd.gles3": {
    kind: "boolean",
  },
  "packages.huawei-agc.renderBackEnd.vulkan": {
    kind: "boolean",
  },
  "packages.huawei-agc.resizeableActivity": {
    kind: "boolean",
  },
  "packages.huawei-agc.serviceConfigPath": {
    kind: "string",
  },
  "packages.huawei-agc.swappy": {
    kind: "boolean",
  },
  "packages.huawei-agc.useDebugKeystore": {
    kind: "boolean",
  },
  "packages.huawei-quick-game.appid": {
    kind: "string",
    sensitive: true,
  },
  "packages.huawei-quick-game.appkey": {
    kind: "string",
    sensitive: true,
  },
  "packages.huawei-quick-game.certificatePemPath": {
    kind: "string",
  },
  "packages.huawei-quick-game.deviceOrientation": {
    kind: "string",
  },
  "packages.huawei-quick-game.fullScreen": {
    kind: "boolean",
  },
  "packages.huawei-quick-game.icon": {
    kind: "string",
  },
  "packages.huawei-quick-game.logLevel": {
    kind: "string",
  },
  "packages.huawei-quick-game.minPlatformVersion": {
    kind: "string",
  },
  "packages.huawei-quick-game.package": {
    kind: "string",
  },
  "packages.huawei-quick-game.privatePemPath": {
    kind: "string",
  },
  "packages.huawei-quick-game.runtimeVersion": {
    kind: "string",
  },
  "packages.huawei-quick-game.separateEngine": {
    kind: "boolean",
  },
  "packages.huawei-quick-game.useDebugKey": {
    kind: "boolean",
  },
  "packages.huawei-quick-game.versionCode": {
    kind: "string",
  },
  "packages.huawei-quick-game.versionName": {
    kind: "string",
  },
  "packages.localization-editor.defaultLanguage": {
    kind: "string",
  },
  "packages.localization-editor.fallbackLanguage": {
    kind: "string",
  },
  "packages.localization-editor.targetLanguageMap": {
    kind: "object",
  },
  "packages.ohos.apiLevel": {
    kind: "number",
  },
  "packages.ohos.compressZip": {
    kind: "boolean",
  },
  "packages.ohos.encrypted": {
    kind: "boolean",
  },
  "packages.ohos.JobSystem": {
    kind: "string",
  },
  "packages.ohos.orientation.landscapeLeft": {
    kind: "boolean",
  },
  "packages.ohos.orientation.landscapeRight": {
    kind: "boolean",
  },
  "packages.ohos.orientation.portrait": {
    kind: "boolean",
  },
  "packages.ohos.packageName": {
    kind: "string",
  },
  "packages.ohos.xxteaKey": {
    kind: "string",
    sensitive: true,
  },
  "packages.openpaas.appid": {
    kind: "string",
    sensitive: true,
  },
  "packages.openpaas.deviceOrientation": {
    kind: "string",
  },
  "packages.openpaas.networkTimeout.downloadFile": {
    kind: "string",
  },
  "packages.openpaas.networkTimeout.uploadFile": {
    kind: "string",
  },
  "packages.openpaas.networkTimeout.Websocket": {
    kind: "string",
  },
  "packages.openpaas.networkTimeout.XMLHttpRequest": {
    kind: "string",
  },
  "packages.openpaas.versionName": {
    kind: "string",
  },
  "packages.oppo-mini-game.appid": {
    kind: "string",
    sensitive: true,
  },
  "packages.oppo-mini-game.appkey": {
    kind: "string",
    sensitive: true,
  },
  "packages.oppo-mini-game.certificatePemPath": {
    kind: "string",
  },
  "packages.oppo-mini-game.deviceOrientation": {
    kind: "string",
  },
  "packages.oppo-mini-game.icon": {
    kind: "string",
  },
  "packages.oppo-mini-game.package": {
    kind: "string",
  },
  "packages.oppo-mini-game.privatePemPath": {
    kind: "string",
  },
  "packages.oppo-mini-game.runtimeVersion": {
    kind: "string",
  },
  "packages.oppo-mini-game.separateEngine": {
    kind: "boolean",
  },
  "packages.oppo-mini-game.useDebugKey": {
    kind: "boolean",
  },
  "packages.oppo-mini-game.versionCode": {
    kind: "string",
  },
  "packages.oppo-mini-game.versionName": {
    kind: "string",
  },
  "packages.taobao-mini-game.globalAdapter": {
    kind: "boolean",
  },
  "packages.taobao-mini-game.globalVariable": {
    kind: "string",
  },
  "packages.taobao-mini-game.orientation": {
    kind: "string",
  },
  "packages.taobao-mini-game.separateEngine": {
    kind: "boolean",
  },
  "packages.taobao-mini-game.wasmSubpackage": {
    kind: "boolean",
  },
  "packages.vivo-mini-game.certificatePemPath": {
    kind: "string",
  },
  "packages.vivo-mini-game.deviceOrientation": {
    kind: "string",
  },
  "packages.vivo-mini-game.icon": {
    kind: "string",
  },
  "packages.vivo-mini-game.package": {
    kind: "string",
  },
  "packages.vivo-mini-game.privatePemPath": {
    kind: "string",
  },
  "packages.vivo-mini-game.runtimeVersion": {
    kind: "string",
  },
  "packages.vivo-mini-game.useDebugKey": {
    kind: "boolean",
  },
  "packages.vivo-mini-game.versionCode": {
    kind: "string",
  },
  "packages.vivo-mini-game.versionName": {
    kind: "string",
  },
  "packages.web-desktop.resolution.designHeight": {
    kind: "number",
  },
  "packages.web-desktop.resolution.designWidth": {
    kind: "number",
  },
  "packages.web-desktop.useWebGPU": {
    kind: "boolean",
  },
  "packages.web-mobile.embedWebDebugger": {
    kind: "boolean",
  },
  "packages.web-mobile.orientation": {
    kind: "string",
  },
  "packages.web-mobile.useWebGPU": {
    kind: "boolean",
  },
  "packages.wechatgame.appid": {
    kind: "string",
    sensitive: true,
  },
  "packages.wechatgame.buildOpenDataContextTemplate": {
    kind: "boolean",
  },
  "packages.wechatgame.highPerformanceMode": {
    kind: "boolean",
  },
  "packages.wechatgame.orientation": {
    kind: "string",
  },
  "packages.wechatgame.separateEngine": {
    kind: "boolean",
  },
  "packages.wechatgame.wasmSubpackage": {
    kind: "boolean",
  },
  "packages.windows.compressZip": {
    kind: "boolean",
  },
  "packages.windows.encrypted": {
    kind: "boolean",
  },
  "packages.windows.executableName": {
    kind: "string",
  },
  "packages.windows.JobSystem": {
    kind: "string",
  },
  "packages.windows.renderBackEnd.gles2": {
    kind: "boolean",
  },
  "packages.windows.renderBackEnd.gles3": {
    kind: "boolean",
  },
  "packages.windows.renderBackEnd.vulkan": {
    kind: "boolean",
  },
  "packages.windows.targetPlatform": {
    kind: "string",
  },
  "packages.windows.vsData": {
    kind: "string",
  },
  "packages.windows.xxteaKey": {
    kind: "string",
    sensitive: true,
  },
  packAutoAtlas: {
    kind: "boolean",
  },
  scenes: {
    kind: "array",
  },
  server: {
    kind: "string",
  },
  skipCompressTexture: {
    kind: "boolean",
  },
  sourceMaps: {
    kind: "string",
    choices: ["false", "true", "inline"],
  },
  startScene: {
    kind: "string",
  },
  startSceneAssetBundle: {
    kind: "boolean",
  },
  useSplashScreen: {
    kind: "boolean",
  },
  wasmCompressionMode: {
    kind: "boolean",
  },
};

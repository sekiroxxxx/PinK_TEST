import { randomBytes } from "node:crypto";
import type { BuildCase } from "./build-cases.js";
import {
  baseCombinationPlatforms,
  releaseFields,
  type SpecialField,
  type SpecialFieldContract,
} from "./profiles.js";
import { fieldFingerprint } from "./existing-platforms.js";
import type { FieldValue } from "./common.js";

/** Ten reviewed final states; no signing, icon, engine-plugin or SDK setup branches. */
export function selectSpecialOptions(ids?: string): BuildCase[] {
  const cases: BuildCase[] = [];
  const abis = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];
  const key = randomBytes(8).toString("hex");
  const make = (
    id: string,
    targets: SpecialField[],
    options: Partial<BuildCase> = {},
  ): BuildCase => {
    const platform = baseCombinationPlatforms.find((p) => p.id === id)!;
    return {
      caseId: `design.${id}.local-change`,
      platform: id,
      expected: releaseFields(platform),
      specials: targets,
      writes: targets.map((f) => ({ key: f.key })),
      ...options,
    };
  };
  const field = (
    id: string,
    name: string,
    expected: FieldValue,
    extra: Partial<SpecialFieldContract> = {},
  ): SpecialField => ({
    key: `packages.${id}.${name}`,
    type: typeof expected as SpecialField["type"],
    expected,
    ...extra,
  });
  const api = (id: string, label = "API Level"): SpecialFieldContract => ({
    key: `packages.${id}.apiLevel`,
    type: "number",
    uiLabel: label,
    nativeSelect: true,
  });
  const abi = (id: string, choices = abis, label = "APP ABI"): SpecialFieldContract => ({
    key: `packages.${id}.appABIs`,
    type: "string",
    uiLabel: label,
    arrayChoices: choices,
  });
  const mini = (id: string, orientation: string): BuildCase => {
    const targets = [
      field(id, "orientation", orientation),
      field(id, "buildOpenDataContextTemplate", true),
      field(id, "wasmSubpackage", true),
      field(id, "separateEngine", false),
    ];
    if (id === "wechatgame") targets.push(field(id, "highPerformanceMode", true));
    else
      targets.push(
        field(id, "generatePreloadJsFileList", true),
        field(id, "devToolsLaunchMethod", "full"),
      );
    const result = make(id, targets);
    result.expected = {
      ...result.expected,
      nativeCodeBundleMode: "wasm",
      wasmCompressionMode: false,
    };
    result.writes = result.writes.filter((f) => !f.key.endsWith(".separateEngine"));
    return result;
  };
  cases.push(mini("wechatgame", "landscapeRight"), mini("bytedance-mini-game", "landscape"));
  cases.push(
    make("alipay-mini-game", [
      field("alipay-mini-game", "deviceOrientation", "landscape"),
      field("alipay-mini-game", "wasmSubpackage", true, { missingDefault: false }),
    ]),
  );
  const openId = "openpaas";
  cases.push(
    make(
      openId,
      [
        field(openId, "versionName", "0.0.2"),
        field(openId, "deviceOrientation", "landscape"),
        ...["XMLHttpRequest", "Websocket", "uploadFile", "downloadFile"].map((name, i) =>
          field(openId, `networkTimeout.${name}`, String(8000 + i * 1000), {
            uiLabel: `${name} 超时时间`,
          }),
        ),
      ],
      { expandSection: "网络超时" },
    ),
  );

  const directions = (id: string) => [
    field(id, "orientation.portrait", true),
    field(id, "orientation.landscapeRight", false),
    field(id, "orientation.landscapeLeft", false),
  ];
  const encryption = (id: string) => [
    field(id, "encrypted", true, { uiLabel: "加密 JS" }),
    field(id, "xxteaKey", fieldFingerprint(key), { uiLabel: "JS 加密密钥", fingerprint: true }),
    field(id, "compressZip", false, { uiLabel: "Zip 压缩" }),
    field(id, "JobSystem", "taskFlow", {
      uiLabel: id === "windows" ? "Job System" : "任务调度系统",
      nativeSelect: true,
    }),
  ];
  const withEncryption = (
    id: string,
    targets: SpecialField[],
    preserveFields: SpecialFieldContract[] = [],
  ) => {
    const enc = encryption(id);
    const result = make(id, [...targets, ...enc], {
      preserveFields,
      initialSpecial: { [`packages.${id}.encrypted`]: false },
      hiddenAtStart: enc
        .filter((f) => ["xxteaKey", "compressZip"].includes(f.key.split(".").at(-1)!))
        .map((f) => f.key),
    });
    result.writes = result.writes.map((step) =>
      step.key.endsWith(".xxteaKey") ? { ...step, input: key } : step,
    );
    return result;
  };
  const android = "android";
  cases.push(
    withEncryption(
      android,
      [
        field(android, "swappy", true),
        field(android, "inputSDK", true),
        field(android, "resizeableActivity", false),
        field(android, "maxAspectRatio", "16:9", { uiLabel: "最大宽高比", nativeSelect: true }),
        field(android, "isSoFileCompressed", false, { uiLabel: "压缩 .so 文件" }),
        ...directions(android),
        field(android, "useDebugKeystore", true, { uiLabel: "使用调试密钥库" }),
      ],
      [api(android), abi(android)],
    ),
  );
  // The selected signature is a read-only guard, not a request to clear a custom keystore.
  cases.at(-1)!.writes = cases.at(-1)!.writes.filter((f) => !f.key.endsWith(".useDebugKeystore"));
  const google = "google-play";
  const grouped = (name: string, expected: boolean, label: string, choice: string) =>
    field(google, name, expected, { uiLabel: label, choiceLabel: choice });
  const googleCase = make(
    google,
    [
      grouped("renderBackEnd.gles3", true, "渲染后端", "GLES 2/3"),
      grouped("renderBackEnd.gles2", false, "渲染后端", "GLES2"),
      grouped("orientation.portrait", true, "屏幕方向", "竖屏"),
      grouped("orientation.upsideDown", true, "屏幕方向", "倒竖屏"),
      grouped("orientation.landscapeLeft", false, "屏幕方向", "左横屏"),
      grouped("orientation.landscapeRight", false, "屏幕方向", "右横屏"),
      field(google, "swappy", true),
      field(google, "adpf", false),
      field(google, "inputSDK", true, { uiLabel: "Input SDK" }),
      field(google, "googleBilling", false, { uiLabel: "Built in Play Billing" }),
      field(google, "isSoFileCompressed", true, { uiLabel: "Compress .so files" }),
      field(google, "resizeableActivity", false, { uiLabel: "可调整大小的 Activity" }),
      field(google, "maxAspectRatio", "16:9", { uiLabel: "最大宽高比", nativeSelect: true }),
      field(google, "androidInstant", true, { uiLabel: "Google Play Instant" }),
      field(google, "remoteUrl", "https://example.com/pink-qa/", { uiLabel: "Intent 过滤器" }),
      field(google, "useDebugKeystore", true, { uiLabel: "使用调试密钥库" }),
    ],
    {
      preserveFields: [{ ...api(google, "Target API Level"), minimum: 23 }, abi(google)],
      hiddenAtStart: [`packages.${google}.remoteUrl`],
    },
  );
  googleCase.writes = googleCase.writes.filter((f) => !f.key.endsWith(".useDebugKeystore"));
  cases.push(googleCase);
  const windows = "windows";
  cases.push(
    withEncryption(
      windows,
      [
        field(windows, "executableName", "qaui_build"),
        field(windows, "renderBackEnd.gles3", true),
        field(windows, "renderBackEnd.gles2", false),
      ],
      [
        {
          key: `packages.${windows}.vsData`,
          type: "string",
          optionalEmpty: true,
          uiLabel: "CMake Generator",
          nativeSelect: true,
        },
      ],
    ),
  );
  const next = "harmonyos-next";
  const nextCase = withEncryption(
    next,
    [
      field(next, "jsEngine", "JSVM"),
      field(next, "useGamepad", true),
      field(next, "deviceTypes.phone", true, { missingDefault: false }),
      ...["tablet", "pc_2in1", "tv", "wearable", "car", "default"].map((name) =>
        field(next, `deviceTypes.${name}`, false, { missingDefault: false }),
      ),
      ...directions(next),
    ],
    [abi(next, ["arm64-v8a"], "支持的 ABI")],
  );
  // Select the JS engine before editing encryption, without changing the host engine selection.
  cases.push(nextCase);
  const agc = "huawei-agc";
  cases.push(
    make(
      agc,
      [
        field(agc, "renderBackEnd.gles3", true),
        field(agc, "renderBackEnd.gles2", false),
        ...directions(agc),
        field(agc, "swappy", true),
        field(agc, "inputSDK", true),
        field(agc, "isSoFileCompressed", false),
        field(agc, "resizeableActivity", false, { uiLabel: "可调整大小的 Activity" }),
        field(agc, "useDebugKeystore", true, { uiLabel: "使用调试密钥库" }),
        field(agc, "maxAspectRatio", "16:9", { uiLabel: "最大宽高比", nativeSelect: true }),
      ],
      { preserveFields: [api(agc)] },
    ),
  );
  cases.at(-1)!.writes = cases.at(-1)!.writes.filter((f) => !f.key.endsWith(".useDebugKeystore"));
  const ohos = "ohos";
  cases.push(
    withEncryption(ohos, [field(ohos, "packageName", "com.cocos.ohos.qaui"), ...directions(ohos)]),
  );
  if (ids === undefined) return cases;
  const selected = ids.split(",").map((id) => id.trim());
  if (
    new Set(selected).size !== selected.length ||
    selected.some((id) => !cases.some((c) => c.caseId === id))
  )
    throw new Error("special-options-ten的cases须为不重复的已定义caseId");
  return cases.filter((c) => selected.includes(c.caseId));
}

import type { FieldValue } from "./common.js";
import type { FinalCase } from "./finalized-cases.js";
import {
  platforms,
  releaseFields,
  specialFields,
  type SpecialField,
  type SpecialFieldContract,
} from "./profiles.js";

export interface BuildCase {
  finalized?: FinalCase;
  caseId: string;
  platform: string;
  title?: string;
  purpose?: "target" | "transition";
  profile?: string;
  sourceCaseIds?: string[];
  requiresInitialFrom?: string[];
  expected: Record<string, boolean | string>;
  specials: SpecialField[];
  writes: Array<{ key: string; before?: FieldValue; input?: FieldValue }>;
  expandSection?: string;
  preserveFields?: SpecialFieldContract[];
  initialPublic?: Record<string, boolean | string>;
  initialSpecial?: Record<string, FieldValue>;
  hiddenAtStart?: string[];
  hiddenAtEnd?: string[];
  webgpuPreview?: boolean;
}

const publicOff = {
  mangleProperties: true,
  inlineEnum: false,
  experimentalEraseModules: true,
  useSplashScreen: false,
  bundleCommonChunk: true,
};
const publicReturn = {
  mangleProperties: false,
  inlineEnum: true,
  experimentalEraseModules: false,
  useSplashScreen: true,
  bundleCommonChunk: false,
};
const globals = "qaBuildFlag, qaBuildCounter";
const prefix = "packages.taobao-mini-game.";

function platform(id: string) {
  const value = platforms.find((item) => item.id === id);
  if (!value) throw new Error(`未定义构建平台：${id}`);
  return value;
}

function custom(key: string, expected: FieldValue, uiLabel: string): SpecialField {
  return { key, expected, uiLabel, type: typeof expected as SpecialField["type"] };
}

const desktop = ["false", "true", "inline"].map((sourceMaps, index): BuildCase => ({
  caseId: ["next.public.maps-off", "next.public.maps-standalone", "next.public.maps-inline"][index],
  platform: "web-desktop",
  expected: {
    ...releaseFields(platform("web-desktop")),
    ...(index ? publicReturn : publicOff),
    sourceMaps,
  },
  initialPublic:
    index === 0
      ? { ...publicReturn, sourceMaps: "inline" }
      : { ...(index === 1 ? publicOff : publicReturn), sourceMaps: index === 1 ? "false" : "true" },
  specials: specialFields(platform("web-desktop")),
  writes: [],
}));

const mobile = [true, false].map((enabled): BuildCase => ({
  caseId: `next.web-mobile.webgpu-${enabled ? "on" : "return"}`,
  platform: "web-mobile",
  expected: releaseFields(platform("web-mobile")),
  specials: [
    ...specialFields(platform("web-mobile")).map((field) =>
      field.key.endsWith(".orientation") ? { ...field, expected: "portrait" } : field,
    ),
    custom("packages.web-mobile.useWebGPU", enabled, "WEBGPU"),
  ],
  initialSpecial: { "packages.web-mobile.useWebGPU": !enabled },
  webgpuPreview: enabled,
  writes: [{ key: "packages.web-mobile.useWebGPU" }],
}));

const taobao = ["text", "adapter", "return"].map((variant): BuildCase => ({
  caseId: `next.taobao.globals-${variant}`,
  platform: "taobao-mini-game",
  expected: { ...releaseFields(platform("taobao-mini-game")), nativeCodeBundleMode: "asmjs" },
  specials: [
    ...specialFields(platform("taobao-mini-game")),
    custom(`${prefix}globalAdapter`, variant === "adapter", "globalThis 全局变量适配"),
    custom(`${prefix}globalVariable`, variant === "return" ? "" : globals, "全局变量"),
  ],
  initialSpecial: {
    [`${prefix}globalAdapter`]: variant === "return",
    ...(variant !== "return"
      ? { [`${prefix}globalVariable`]: variant === "text" ? "" : globals }
      : {}),
  },
  writes:
    variant === "adapter"
      ? [{ key: `${prefix}globalAdapter` }]
      : [
          { key: `${prefix}globalAdapter` },
          { key: `${prefix}globalVariable`, before: variant === "return" ? globals : "" },
        ],
  ...(variant === "adapter" ? { hiddenAtEnd: [`${prefix}globalVariable`] } : {}),
  ...(variant === "return" ? { hiddenAtStart: [`${prefix}globalVariable`] } : {}),
}));

export const localOptionsNine: readonly BuildCase[] = [
  ...desktop,
  ...mobile,
  {
    caseId: "next.oppo.engine-return",
    platform: "oppo-mini-game",
    expected: releaseFields(platform("oppo-mini-game")),
    specials: specialFields(platform("oppo-mini-game")),
    initialSpecial: { "packages.oppo-mini-game.separateEngine": true },
    writes: [{ key: "packages.oppo-mini-game.separateEngine" }],
  },
  ...taobao,
];

export function selectLocalOptions(ids?: string): BuildCase[] {
  if (ids === undefined) return [...localOptionsNine];
  const requested = ids.split(",").map((id) => id.trim());
  if (
    new Set(requested).size !== requested.length ||
    requested.some((id) => !localOptionsNine.some((item) => item.caseId === id))
  )
    throw new Error("cases 包含重复或未知 caseId");
  return localOptionsNine.filter((item) => requested.includes(item.caseId));
}

import type { BuildCase } from "./build-cases.js";
import { localOptionsNine } from "./build-cases.js";
import {
  baseCombinationPlatforms,
  platforms,
  debugFields,
  releaseFields,
  releaseBFields,
  releaseCLocalFields,
  specialFields,
  releaseBSpecialFields,
  releaseCLocalSpecialFields,
  canApplySpecial,
} from "./profiles.js";
import { selectSpecialOptions } from "./special-options.js";

/** One explicit acceptance collection. Legacy plans remain available for focused regressions. */
export function selectAcceptanceCases(ids?: string): BuildCase[] {
  const cases: BuildCase[] = [];
  const local = new Map(localOptionsNine.map((c) => [c.caseId, c]));
  const special = new Map(selectSpecialOptions().map((c) => [c.platform, c]));
  const get = (id: string) => local.get(id)!;
  const phaseLabel = { debug: "调试", release: "发布", variant: "选项变化", return: "选项返回" };
  for (const phase of ["debug", "release", "variant", "return"] as const) {
    for (const p of phase === "debug" || phase === "release"
      ? baseCombinationPlatforms
      : platforms) {
      const priority = platforms.some((entry) => entry.id === p.id);
      const profile = {
        debug: "debug",
        release: "release-a",
        variant: "release-b",
        return: "release-c-local",
      }[phase];
      const expected = {
        debug: debugFields,
        release: releaseFields,
        variant: releaseBFields,
        return: releaseCLocalFields,
      }[phase](p);
      const specials = priority
        ? {
            debug: specialFields,
            release: specialFields,
            variant: releaseBSpecialFields,
            return: releaseCLocalSpecialFields,
          }[phase](p)
        : [];
      let item: BuildCase = {
        caseId: `acceptance.${phase}.${p.id}`,
        platform: p.id,
        title: phaseLabel[phase],
        profile,
        purpose: "target",
        expected,
        specials,
        writes: specials.filter(canApplySpecial).map((field) => ({ key: field.key })),
        sourceCaseIds: [`${profile}.${p.id}`],
      };
      const merge = (source: BuildCase, transition = false) => {
        item = {
          ...item,
          expected: { ...item.expected, ...source.expected },
          specials: source.specials,
          writes: source.writes,
          preserveFields: source.preserveFields,
          expandSection: source.expandSection,
          webgpuPreview: source.webgpuPreview,
          purpose: transition ? "transition" : "target",
          initialPublic: transition ? source.initialPublic : undefined,
          initialSpecial: transition ? source.initialSpecial : undefined,
          hiddenAtStart: transition ? source.hiddenAtStart : undefined,
          hiddenAtEnd: source.hiddenAtEnd,
          sourceCaseIds: [...item.sourceCaseIds!, source.caseId],
        };
      };
      if (phase === "release" && !priority) merge(special.get(p.id)!);
      if (p.id === "web-desktop" && phase !== "debug") {
        const source = get(
          {
            release: "next.public.maps-off",
            variant: "next.public.maps-standalone",
            return: "next.public.maps-inline",
          }[phase],
        );
        // Keep this phase's compression and dedicated platform options, merging only the shared compiler switches.
        for (const key of [
          "mangleProperties",
          "inlineEnum",
          "experimentalEraseModules",
          "useSplashScreen",
          "bundleCommonChunk",
          "sourceMaps",
        ])
          item.expected[key] = source.expected[key];
        item.sourceCaseIds!.push(source.caseId);
      }
      if (p.id === "web-mobile" && phase === "release") {
        const source = get("next.web-mobile.webgpu-on");
        item.specials = source.specials;
        item.writes = source.specials.filter(canApplySpecial).map((field) => ({ key: field.key }));
        item.writes.push(...source.writes);
        item.webgpuPreview = source.webgpuPreview;
        item.sourceCaseIds!.push(source.caseId);
      }
      if (p.id === "web-mobile" && phase === "return") {
        const source = get("next.web-mobile.webgpu-return");
        item.specials = source.specials;
        item.writes = [
          ...source.specials.filter(canApplySpecial).map((field) => ({ key: field.key })),
          ...source.writes,
        ];
        item.initialSpecial = source.initialSpecial;
        item.purpose = "transition";
        item.requiresInitialFrom = ["acceptance.release.web-mobile"];
        item.sourceCaseIds!.push(source.caseId);
      }
      if (p.id === "oppo-mini-game" && phase === "variant") {
        item.specials = item.specials.map((f) =>
          f.key.endsWith(".separateEngine") ? { ...f, expected: true } : f,
        );
        item.sourceCaseIds!.push("release-c-local.oppo-mini-game");
      }
      if (p.id === "oppo-mini-game" && phase === "return") {
        item.specials = specialFields(p);
        item.initialSpecial = get("next.oppo.engine-return").initialSpecial;
        item.purpose = "transition";
        item.requiresInitialFrom = ["acceptance.variant.oppo-mini-game"];
        item.sourceCaseIds!.push("next.oppo.engine-return");
      }
      if (p.id === "taobao-mini-game" && phase !== "variant")
        item.expected.nativeCodeBundleMode = "asmjs";
      if (p.id === "taobao-mini-game" && phase !== "debug") {
        const source = get(
          `next.taobao.globals-${{ release: "text", variant: "adapter", return: "return" }[phase]}`,
        );
        // Keep Wasm/Brotli in the variant phase; add only the global-variable controls to that phase.
        const specialKeys = new Set(item.specials.map((f) => f.key));
        item.specials.push(...source.specials.filter((f) => !specialKeys.has(f.key)));
        item.writes.push(...source.writes);
        item.initialSpecial = source.initialSpecial;
        item.hiddenAtStart = source.hiddenAtStart;
        item.hiddenAtEnd = source.hiddenAtEnd;
        item.purpose = "transition";
        item.requiresInitialFrom =
          phase === "variant"
            ? ["acceptance.release.taobao-mini-game"]
            : phase === "return"
              ? ["acceptance.variant.taobao-mini-game"]
              : [];
        item.sourceCaseIds!.push(source.caseId);
      }
      // Merging a field must not send duplicate input events.
      item.writes = [...new Map(item.writes.map((step) => [step.key, step])).values()];
      cases.push(item);
    }
  }
  if (ids === undefined) return cases;
  const requested = ids.split(",").map((id) => id.trim());
  if (
    !requested.length ||
    new Set(requested).size !== requested.length ||
    requested.some((id) => !cases.some((c) => c.caseId === id))
  )
    throw new Error(
      "acceptance 的 cases 须为不重复的 acceptance.<阶段>.<平台ID>；可先 --list-cases",
    );
  // Selection never adds prerequisite builds or resets the user's initial state.
  return cases.filter((c) => requested.includes(c.caseId));
}

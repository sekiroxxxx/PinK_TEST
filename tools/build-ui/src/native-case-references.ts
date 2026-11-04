import { validateExecutableCatalog } from "./field-capabilities.js";
import { validateConfigurationSteps } from "./configuration-steps-contract.js";
import type { CatalogDocument } from "./case-contract.js";
import type { BuilderTarget } from "./builder-checks.js";
import { valueHash } from "./plan-integrity.js";

export interface NativeCaseReference {
  caseId: string;
  platform?: string;
  target?: BuilderTarget;
  title: string;
  origin: {
    kind: "combination" | "variant" | "scenario" | "form-sample" | "steps-case";
    sourcePath: Array<string | number>;
    group?: string;
    combinationId?: string;
    scenarioId?: string;
    familyId?: string;
    sampleId?: string;
  };
}

/** The same expanded identities serve authoring, composition and runtime selection. */
export function catalogReferenceEntries(catalog: CatalogDocument) {
  const entries: Array<
    NativeCaseReference & {
      platform: string;
      combo?: string;
      variant?: number;
      scenario?: number;
      form?: { family: number; sample: number };
    }
  > = [];
  for (const group of ["publish", "debug", "mixed"])
    for (const [pi, platform] of catalog.platforms.entries()) {
      const ci = platform.combinations.findIndex((c) => c.template === group);
      const combo = platform.combinations[ci];
      const sourcePath = ["platforms", pi, "combinations", ci];
      entries.push({
        caseId: combo.id,
        platform: platform.id,
        combo: combo.id,
        title: combo.title,
        origin: { kind: "combination", sourcePath, group, combinationId: combo.id },
      });
      combo.variants.forEach((variant, index) =>
        entries.push({
          caseId: `${combo.id}.variant-${index + 1}`,
          platform: platform.id,
          combo: combo.id,
          variant: index,
          title: `${combo.title} · ${variant.title}`,
          origin: {
            kind: "variant",
            sourcePath: [...sourcePath, "variants", index],
            group,
            combinationId: combo.id,
          },
        }),
      );
    }
  catalog.conditionalScenarios.forEach((scenario, index) =>
    scenario.representativePlatforms.forEach((platform) =>
      entries.push({
        caseId:
          scenario.representativePlatforms.length === 1
            ? scenario.id
            : `${scenario.id}.${platform}`,
        platform,
        scenario: index,
        title: scenario.title,
        origin: {
          kind: "scenario",
          sourcePath: ["conditionalScenarios", index],
          group: "conditional",
          scenarioId: scenario.id,
        },
      }),
    ),
  );
  catalog.formValidation?.cases.forEach((family, fi) =>
    family.samples.forEach((sample, si) =>
      sample.platforms.forEach((platform) =>
        entries.push({
          caseId: `${sample.id}.${platform}`,
          platform,
          form: { family: fi, sample: si },
          title: `${family.title} · ${sample.title}`,
          origin: {
            kind: "form-sample",
            sourcePath: ["formValidation", "cases", fi, "samples", si],
            group: "conditional",
            familyId: family.id,
            sampleId: sample.id,
          },
        }),
      ),
    ),
  );
  const order = catalog.executionOrder ?? [];
  return [
    ...order.flatMap((id) => entries.filter((c) => c.caseId === id)),
    ...entries.filter((c) => !order.includes(c.caseId)),
  ];
}

/** Definition identities only: no files, materials, project discovery or executable status. */
export function listNativeCaseReferences(document: unknown): {
  documentSha256: string;
  items: NativeCaseReference[];
} {
  const raw = document as Record<string, unknown> | null;
  if (raw?.kind === "pink-configuration-steps") {
    const native = validateConfigurationSteps(document);
    return {
      documentSha256: valueHash(native),
      items: native.cases.map((c, index) => ({
        caseId: c.caseId,
        ...(c.platform ? { platform: c.platform } : {}),
        ...("target" in c && c.target ? { target: structuredClone(c.target) } : {}),
        title: c.caseId,
        origin: { kind: "steps-case", sourcePath: ["cases", index] },
      })),
    };
  }
  const native = validateExecutableCatalog(document);
  return {
    documentSha256: valueHash(native),
    items: catalogReferenceEntries(native).map(({ caseId, platform, title, origin }) => ({
      caseId,
      platform,
      title,
      origin,
    })),
  };
}

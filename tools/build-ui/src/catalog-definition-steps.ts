import { selectCatalogDefinitionCases } from "./finalized-cases.js";
import { catalogStepSequence } from "./catalog-step-sequence.js";
import { formToSteps } from "./form-to-steps.js";
import type { CatalogDocument } from "./case-contract.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";
import { validateConfigurationSteps } from "./configuration-steps-contract.js";

/** Lower symbolic definitions with the existing generators, without resolving a local context. */
export async function compileCatalogDefinition(
  catalog: CatalogDocument,
  caseId: string,
  endpoint?: "ui",
) {
  const cases = await selectCatalogDefinitionCases(catalog, caseId, endpoint);
  const item = cases.find((c) => c.caseId === caseId);
  if (!item) throw new Error("Catalog 用例不存在");
  const definition = item.finalized!;
  const deferredChecks = definition.blockers.map((blocker) => ({
    kind: blocker.kind === "ui-adapter" ? "execution-support" : blocker.kind,
    reason: blocker.reason,
  }));
  if (caseId.startsWith("FORM-") && !definition.formValidation) {
    if (!deferredChecks.length) throw new Error("FORM 样本没有静态操作定义或明确的受阻声明");
    return {
      document: undefined,
      deferredChecks: [
        ...deferredChecks,
        {
          kind: "static-chain-pending",
          reason: "样本显式保留为受阻/不适用，尚无操作链；不能确认其操作依赖或执行能力",
        },
      ],
    };
  }
  const document: BuildStepsDocument = {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    ...(catalog.targets ? { targets: structuredClone(catalog.targets) } : {}),
    cases: [definition.formValidation ? formToSteps(item) : catalogStepSequence(item)],
  };
  validateConfigurationSteps(document);
  return {
    document,
    deferredChecks,
  };
}

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { catalogToSteps } from "./catalog-to-steps.js";
import { loadStepInputs, type StepInputOptions } from "./step-inputs.js";
import type { LoadedConfigurationSteps } from "./configuration-steps-contract.js";
import type { BuildStepsDocument } from "./build-steps-contract.js";
import { contentHash, valueHash } from "./plan-integrity.js";
import { ConfigurationOperationError } from "./configuration-context.js";
export { selectedStepResults as catalogStepResults } from "./step-preflight.js";

/** Catalog and hand-authored steps converge here, before the existing launch/plan/execution code. */
export async function loadCatalogSteps(
  file: string,
  options: StepInputOptions & { cases?: string; groups?: string; endpoint?: "ui" } = {},
): Promise<LoadedConfigurationSteps> {
  const migration = await catalogToSteps(file, options);
  const document: BuildStepsDocument = migration.document ?? {
    kind: "pink-configuration-steps",
    schemaVersion: 2,
    cases: [],
    ...(migration.targets.length ? { targets: migration.targets } : {}),
  };
  const sources = [{ file: migration.source.path, sha256: migration.source.sha256 }];
  if (options.cases?.split(",").some((id) => id.trim().startsWith("FORM-"))) {
    const raw = JSON.parse((await readFile(migration.source.path, "utf8")).replace(/^\uFEFF/, ""));
    if (!raw.formValidation) {
      const path = fileURLToPath(
        new URL("../../case-catalog/form-validation-design.json", import.meta.url),
      );
      sources.push({ file: path, sha256: contentHash(await readFile(path)) });
    }
  }
  return {
    path: migration.source.path,
    sourceSha256: migration.source.sha256,
    documentSha256: valueHash(document),
    document,
    inputs: await loadStepInputs(document, options),
    catalog: {
      source: migration.source,
      compilationSha256: migration.integrity.sha256,
      inputs: migration.inputs,
      selection: { cases: options.cases, groups: options.groups, endpoint: options.endpoint },
      cases: migration.cases.map(
        ({ caseId, title, platform, group, endpoint, status, sourceCaseIds, gaps }) => ({
          caseId,
          title,
          platform,
          group,
          endpoint,
          status,
          sourceCaseIds,
          gaps,
        }),
      ),
    },
    verifySource: async () => {
      try {
        for (const source of sources)
          if (contentHash(await readFile(source.file)) !== source.sha256) throw new Error();
      } catch {
        throw new ConfigurationOperationError(
          "snapshot",
          "四组目录或反向样本已变化，请重新预览",
          "stop",
        );
      }
    },
  };
}

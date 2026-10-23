import { caseContract, type CatalogDocument, type InputValues } from "./case-contract.js";
import { supportedFieldTypes } from "./supported-field-types.js";

export { supportedFieldTypes } from "./supported-field-types.js";

/** Pure browser/Node contract. No target discovery, UI connection or file access. */
export function describeFieldCapabilities() {
  return {
    kind: "pink-build-field-capabilities",
    schemaVersion: 1,
    capabilityVersion: "1",
    supportedCaseSchemaVersions: [1],
    runtimeVerified: false,
    supportedFields: Object.entries(supportedFieldTypes).map(([key, type]) => {
      const scene = key === "startScene" || key === "scenes";
      const platform = key.startsWith("packages.") ? key.split(".")[1] : undefined;
      return {
        key,
        ...structuredClone(type),
        editable: true,
        allowedReferenceKinds: scene ? ["material", "scene"] : ["material"],
        operation: scene
          ? "scene-selection"
          : key === "packages.google-play.customIcon"
            ? "google-icon"
            : key === "packages.openpaas.appid"
              ? "select-existing-game"
              : "set-target-and-read-back",
        availability: {
          scope: platform === "localization-editor" ? "l10n" : platform ? "platform" : "common",
          ...(platform && platform !== "localization-editor" ? { platforms: [platform] } : {}),
          runtimeVisibility: "must-be-confirmed",
          ...(platform === "localization-editor"
            ? { prerequisites: ["project-l10n-enabled", "catalogs-ready"] }
            : {}),
        },
        candidates: type.choices
          ? { source: "static-contract", values: [...type.choices] }
          : { source: "runtime-ui", state: "not-observed" },
      };
    }),
  };
}

export function assertSupportedValues(values: InputValues, path: string): void {
  for (const [key, value] of Object.entries(values)) {
    const capability = Object.hasOwn(supportedFieldTypes, key)
      ? supportedFieldTypes[key]
      : undefined;
    if (!capability) throw new Error(`${path}.${key}：执行器没有该字段的操作能力`);
    caseContract.validateValue(key, value, capability, `${path}.${key}`);
  }
}

export function validateExecutableCatalog(value: unknown): CatalogDocument {
  const doc = caseContract.validate(value);
  for (const [key, type] of Object.entries(doc.fieldTypes)) {
    const capability = Object.hasOwn(supportedFieldTypes, key)
      ? supportedFieldTypes[key]
      : undefined;
    if (!capability) throw new Error(`fieldTypes.${key}：执行器未注册该字段，不能由用例自授能力`);
    if (type.kind !== capability.kind || (capability.sensitive && !type.sensitive))
      throw new Error(`fieldTypes.${key}：字段类型或敏感性与执行器能力不符`);
  }
  for (const t of doc.templates) assertSupportedValues(t.values, `templates.${t.id}`);
  for (const p of doc.platforms)
    for (const c of p.combinations) {
      assertSupportedValues(c.values, c.id);
      for (const [i, v] of c.variants.entries())
        assertSupportedValues(v.values, `${c.id}.variant-${i + 1}`);
    }
  for (const s of doc.conditionalScenarios)
    for (const [p, values] of Object.entries(s.valuesByPlatform))
      assertSupportedValues(values, `${s.id}.${p}`);
  return doc;
}

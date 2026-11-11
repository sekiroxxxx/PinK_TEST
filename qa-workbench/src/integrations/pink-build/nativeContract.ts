import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  nativeAuthoringRequest,
  nativeCaseReferencesSchema,
} from "../../shared/nativeAuthoring.js";
import { automationOriginSchema } from "../../shared/automation.js";
import { z } from "zod";

export const executorIdentitySchema = z.object({
  kind: z.literal("pink-build-executor-identity"),
  schemaVersion: z.literal(1),
  capabilityVersion: z.string().min(1),
  implementationSha256: z.string().regex(/^[a-f0-9]{64}$/),
  files: z
    .array(z.tuple([z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/)]))
    .min(1),
});
export type ExecutorIdentity = z.infer<typeof executorIdentitySchema>;

const assemblySchema = z
  .object({
    kind: z.literal("pink-case-assembly"),
    schemaVersion: z.literal(1),
    definitionSha256: z.string().min(1),
    selectionSha256: z.string().min(1),
    documentSha256: z.string().optional(),
    document: z.record(z.string(), z.unknown()).optional(),
    caseIds: z.array(z.string()),
    willSubmit: z.boolean(),
    sourceMap: z.array(automationOriginSchema),
    diagnostics: z.array(
      z
        .object({
          severity: z.literal("error"),
          code: z.string(),
          message: z.string(),
          nodeId: z.string().optional(),
          instancePath: z.array(z.string()),
          phase: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

type NativeContract = {
  getExecutorIdentity(): Promise<ExecutorIdentity>;
  verifyExecutorIdentity(expected: unknown): Promise<ExecutorIdentity>;
  identifyNativeDocument(value: unknown): {
    format: "catalog" | "steps";
    schemaVersion: number;
  };
  validateNativeDocument(value: unknown): { document: Record<string, unknown> };
  describeNativeCaseCapabilities(): Record<string, unknown>;
  configurationCheckDocument(
    input: Record<string, unknown>,
  ): Record<string, unknown>;
  describeCaseComposition?(): Record<string, unknown>;
  validateCaseComposition?(
    definition: Record<string, unknown>,
    selection?: unknown,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  listNativeCaseReferences?(
    document: Record<string, unknown>,
  ): Record<string, unknown>;
  createCaseComposition?(
    document: Record<string, unknown>,
    options?: { sourceId?: string },
  ): Record<string, unknown>;
  composeNativeCases?(
    definition: Record<string, unknown>,
    selection?: unknown,
    options?: Record<string, unknown>,
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
  mapCompositionResults?(
    assembly: Record<string, unknown>,
    result: unknown,
  ): unknown;
};
export async function nativeContract(root: string): Promise<NativeContract> {
  const module = await import(
    pathToFileURL(join(root, "tools/build-ui/dist/native-case-contract.js"))
      .href
  );
  if (
    ![
      "getExecutorIdentity",
      "verifyExecutorIdentity",
      "identifyNativeDocument",
      "validateNativeDocument",
      "describeNativeCaseCapabilities",
      "configurationCheckDocument",
    ].every((key) => typeof module[key] === "function")
  )
    throw new Error(
      "自动化工具缺少正式原生用例合同或执行器身份校验，请核对工具版本并重新加载工作台宿主。",
    );
  executorIdentitySchema.parse(await module.getExecutorIdentity());
  return module as NativeContract;
}

export async function assembleNativeDocument(
  contract: NativeContract,
  definition: Record<string, unknown>,
  selection: unknown,
  options: Record<string, unknown>,
) {
  if (!contract.composeNativeCases)
    throw new Error("当前工具尚未提供用例组装能力；未生成执行文件。");
  const assembly = assemblySchema.parse(
    await contract.composeNativeCases(definition, selection, options),
  );
  if (assembly.diagnostics.length)
    throw new Error(
      assembly.diagnostics
        .map(
          (item) =>
            `${item.instancePath.join(" / ") || "链路"}：${item.message}（${item.code}）`,
        )
        .join("\n"),
    );
  if (
    !assembly.document ||
    !assembly.documentSha256 ||
    !assembly.caseIds.length
  )
    throw new Error("工具没有生成有效的执行快照；未预览或启动测试。");
  return assembly;
}
export async function authorNativeDocument(root: string, value: unknown) {
  const request = nativeAuthoringRequest.parse(value);
  if (request.moduleId !== "pink-build")
    throw new Error("当前宿主尚未接入该自动化模块。");
  const contract = await nativeContract(root);
  if (request.action === "describeComposition") {
    if (!contract.describeCaseComposition)
      throw new Error("当前工具尚未提供组合用例描述，请核对工具版本。");
    return contract.describeCaseComposition();
  }
  if (request.action === "validateComposition") {
    if (!contract.validateCaseComposition)
      throw new Error(
        "当前工具缺少组合定义校验，请更新工具后再保存；原用例和草稿仍保留。",
      );
    return await contract.validateCaseComposition(
      request.definition,
      request.selection,
    );
  }
  if (request.action === "listCaseReferences") {
    if (!contract.listNativeCaseReferences)
      throw new Error("当前工具缺少正式用例引用清单，请更新工具后再选择用例。");
    return nativeCaseReferencesSchema.parse(
      contract.listNativeCaseReferences(request.document),
    );
  }
  if (request.action === "compose") {
    if (!contract.composeNativeCases)
      throw new Error("当前工具尚未提供用例组装能力；未生成执行文件。");
    return await contract.composeNativeCases(
      request.definition,
      request.selection,
      request.options,
    );
  }
  if (request.action === "createComposition") {
    if (!contract.createCaseComposition)
      throw new Error("当前工具尚未提供用例引用转换；原用例未改动。");
    return contract.createCaseComposition(request.document, {
      sourceId: request.sourceId,
    });
  }
  if (request.action === "describe")
    return contract.describeNativeCaseCapabilities();
  const document =
    request.action === "template"
      ? contract.configurationCheckDocument(request.input)
      : request.document;
  return contract.validateNativeDocument(document).document;
}

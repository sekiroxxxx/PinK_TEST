import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { atomicWrite, hash, json } from "../../main/files.js";
import type {
  Catalog,
  CatalogDocument,
  CaseDetail,
  FieldCapability,
  ModuleDescriptor,
} from "../../shared/model.js";
import type { BuildCatalogModule } from "../types.js";
import { nativeContract } from "./nativeContract.js";

type Contract = {
  validate(value: unknown): CatalogDocument;
  normalize(value: unknown): CatalogDocument;
};
type CapabilityContract = {
  describeFieldCapabilities(): { supportedFields: FieldCapability[] };
  validateExecutableCatalog(value: unknown): unknown;
};
export class PinkBuildAdapter implements BuildCatalogModule {
  readonly descriptor: ModuleDescriptor = {
    id: "pink-build",
    name: "PinK 构建测试",
    interfaceVersion: 1,
    capabilities: {
      browse: true,
      edit: true,
      preview: true,
      start: true,
      observe: true,
      readResult: true,
    },
    reason:
      "支持真实计划预览、配置检查及按用例定义提交构建；执行前须确认计划。",
  };
  private documents = new Map<string, { path: string; hash: string }>();
  private contract?: Contract;
  private capabilities?: CapabilityContract;
  constructor(readonly root: string) {}
  private async contracts() {
    await nativeContract(this.root);
    this.contract ??= (
      await import(
        pathToFileURL(join(this.root, "tools/build-ui/dist/case-contract.js"))
          .href
      )
    ).caseContract as Contract;
    if (!this.contract?.validate || !this.contract?.normalize)
      throw new Error("链路缺少正式编译的用例合同，请核对链路目录");
    if (!this.capabilities) {
      try {
        this.capabilities = (await import(
          pathToFileURL(
            join(this.root, "tools/build-ui/dist/field-capabilities.js"),
          ).href
        )) as CapabilityContract;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND")
          throw error;
      }
    }
    return this.contract;
  }
  async load(
    path = join(this.root, "tools/case-catalog/public-combinations.json"),
  ): Promise<Catalog> {
    const contract = await this.contracts();
    if ((await stat(path)).size > 32 * 1024 * 1024)
      throw new Error("用例文件不能超过 32 MB");
    const bytes = await readFile(path);
    const document = contract.validate(
      JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
    );
    this.capabilities?.validateExecutableCatalog(document);
    const normalized = contract.normalize(document);
    let details: CaseDetail[] = [],
      detailsAvailable = false;
    let detailsSource: Catalog["detailsSource"];
    try {
      const indexPath = join(this.root, "tools/case-catalog/cases.json");
      const indexBytes = await readFile(indexPath);
      const index = JSON.parse(
        indexBytes.toString("utf8").replace(/^\uFEFF/, ""),
      );
      if (!Array.isArray(index.cases)) throw new Error("用例说明索引格式错误");
      details = index.cases;
      detailsAvailable = true;
      detailsSource = {
        path: indexPath,
        hash: hash(indexBytes),
        revision: String(index.date ?? ""),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const token = randomUUID(),
      sha = hash(bytes);
    this.documents.set(token, { path: resolve(path), hash: sha });
    return {
      token,
      path: resolve(path),
      hash: sha,
      contractVersion: "CatalogDocument/1",
      document,
      normalized,
      details,
      detailsAvailable,
      detailsSource,
      fields:
        this.capabilities?.describeFieldCapabilities().supportedFields ?? [],
      capabilitiesAvailable: !!this.capabilities,
    };
  }
  async validate(token: string, document: CatalogDocument) {
    if (!this.documents.has(token))
      throw new Error("用例会话已失效，请重新加载");
    const contract = await this.contracts();
    contract.validate(document);
    // Display/edit schema is not an operation registry. Use execution-side capability validation when supplied.
    this.capabilities?.validateExecutableCatalog(document);
    return contract.normalize(document);
  }
  async save(token: string, document: CatalogDocument, destination?: string) {
    const source = this.documents.get(token);
    if (!source) throw new Error("用例会话已失效");
    if (!this.capabilities)
      throw new Error("缺少字段能力合同，暂不开放保存；浏览和人工测试仍可使用");
    await this.validate(token, document);
    const path = destination ? resolve(destination) : source.path;
    if (
      path === source.path &&
      hash(await readFile(source.path)) !== source.hash
    )
      throw new Error("磁盘用例已被修改，未覆盖。请另存副本或重新加载后处理");
    await atomicWrite(path, json(document));
    return this.load(path);
  }
}

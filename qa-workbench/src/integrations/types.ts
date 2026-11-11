import type {
  Catalog,
  CatalogDocument,
  ModuleDescriptor,
} from "../shared/model.js";
import type {
  ExecutionRequest,
  ExecutionPreview,
  ExecutionState,
  ExecutionDetail,
} from "../shared/execution.js";

// The host depends on this port, not on a particular runner or its case format.
// Other modules can introduce their own document type; CatalogDocument belongs to pink-build.
export interface CatalogModule<TDocument, TView> {
  descriptor: ModuleDescriptor;
  load(path?: string): Promise<TView>;
  validate(token: string, document: TDocument): Promise<TDocument>;
  save(
    token: string,
    document: TDocument,
    destination?: string,
  ): Promise<TView>;
}
export type BuildCatalogModule = CatalogModule<CatalogDocument, Catalog>;

export interface AutomationPort {
  preview(request: ExecutionRequest): Promise<ExecutionPreview>;
  start(previewId: string): Promise<ExecutionState>;
  list(): Promise<ExecutionState[]>;
  detail(id: string): Promise<ExecutionDetail>;
  stop(id: string): Promise<void>;
}

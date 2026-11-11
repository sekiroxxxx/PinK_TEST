import type { CaseComposition } from "./case-composition.js";
import type { ParameterSchema } from "./step-parameter-contract.js";
import { platformCatalog } from "./platform-catalog.js";

interface CompositionTemplate {
  id: string;
  title: string;
  description: string;
  parameters: Array<{
    key: string;
    title: string;
    required: boolean;
    schema: ParameterSchema;
    nodePath: string[];
    inputPath: string[];
    candidates?: Array<{ value: string; label: string }>;
  }>;
  definition: CaseComposition;
}

/** Module-owned copies of the existing reuse fixture, with their original cleanup semantics. */
export const compositionTemplates: CompositionTemplate[] = [
  {
    id: "configuration-check",
    title: "配置修改、回读与恢复",
    description: "选择平台，设置名称，回读并核对独立预期，最后恢复原名称并关闭配置页。",
    parameters: [
      {
        key: "platform",
        title: "平台",
        required: true,
        schema: { type: "string", minLength: 1, "x-reference": "platform-description" },
        nodePath: ["configuration"],
        inputPath: ["arguments", "platform"],
        candidates: platformCatalog.map((platform) => ({
          value: platform.id,
          label: platform.label,
        })),
      },
      {
        key: "name",
        title: "设置名称",
        required: true,
        schema: { type: "string" },
        nodePath: ["configuration"],
        inputPath: ["arguments", "name"],
      },
      {
        key: "expectedName",
        title: "预期名称",
        required: true,
        schema: { type: "string" },
        nodePath: ["configuration"],
        inputPath: ["arguments", "expectedName"],
      },
    ],
    definition: {
      kind: "pink-case-composition",
      schemaVersion: 1,
      sources: [],
      fragments: [
        {
          id: "configuration-check",
          kind: "nodes",
          parameters: {
            platform: { kind: "string" },
            name: { kind: "string" },
            expectedName: { kind: "string" },
          },
          nodes: [
            {
              id: "check",
              kind: "flow",
              target: { kind: "platform", id: { $param: "platform" } },
              before: [
                {
                  id: "open",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "config.open",
                  inputs: {},
                },
                {
                  id: "original",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "record",
                  inputs: { page: { $output: "open" }, fields: ["name"] },
                },
              ],
              steps: [
                {
                  id: "name",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "set",
                  inputs: { page: { $output: "open" }, field: "name", value: { $param: "name" } },
                },
                {
                  id: "read",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "read",
                  inputs: { page: { $output: "open" }, fields: ["name"] },
                },
                {
                  id: "expected",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "assert",
                  inputs: {
                    check: "values",
                    snapshot: { $output: "read" },
                    values: { name: { $param: "expectedName" } },
                  },
                },
              ],
              finally: [
                {
                  id: "cleanup",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "config.open",
                  inputs: {},
                },
                {
                  id: "restore",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "restore",
                  inputs: { page: { $output: "cleanup" }, record: { $output: "original" } },
                },
                {
                  id: "close",
                  kind: "action",
                  moduleId: "pink-build",
                  operationId: "config.close",
                  inputs: { page: { $output: "cleanup" } },
                },
              ],
            },
          ],
        },
      ],
      nodes: [
        {
          id: "configuration",
          kind: "use",
          fragmentId: "configuration-check",
          arguments: {
            platform: "web-desktop",
            name: "QA_configuration_check",
            expectedName: "QA_configuration_check",
          },
        },
      ],
    },
  },
  {
    id: "builder-home",
    title: "构建主页入口检查",
    description: "检查构建主页已就绪、历史记录入口可见且未禁用，结束返回主页，不点击入口。",
    parameters: [
      {
        key: "representativePlatform",
        title: "代表平台",
        required: true,
        schema: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
        nodePath: ["common-home"],
        inputPath: ["target", "representativePlatform"],
      },
    ],
    definition: {
      kind: "pink-case-composition",
      schemaVersion: 1,
      sources: [],
      fragments: [],
      nodes: [
        {
          id: "common-home",
          kind: "flow",
          target: { kind: "builder", representativePlatform: "web-desktop" },
          before: [
            {
              id: "open",
              kind: "action",
              moduleId: "pink-build",
              operationId: "builder.open",
              inputs: {},
            },
          ],
          steps: [
            {
              id: "read",
              kind: "action",
              moduleId: "pink-build",
              operationId: "builder.read",
              inputs: { page: { $output: "open" } },
            },
            {
              id: "expected",
              kind: "action",
              moduleId: "pink-build",
              operationId: "assert",
              inputs: {
                check: "builder-state",
                snapshot: { $output: "read" },
                expected: { ready: true, buttons: { history: { visible: true, disabled: false } } },
              },
            },
          ],
          finally: [
            {
              id: "home",
              kind: "action",
              moduleId: "pink-build",
              operationId: "builder.home",
              inputs: {},
            },
          ],
        },
      ],
    },
  },
];

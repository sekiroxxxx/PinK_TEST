import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Builder } from "./builder.js";
import type { SpecialField } from "./profiles.js";

export interface AgcMaterial {
  path: string;
  sha256: string;
  packageName: string;
}

/** Keep credentials in the material file; the result retains only identity metadata. */
export async function readAgcMaterial(path: string): Promise<AgcMaterial> {
  const resolved = resolve(path);
  const content = await readFile(resolved);
  const json = JSON.parse(content.toString("utf8").replace(/^\uFEFF/, "")) as {
    client?: { package_name?: unknown };
  };
  const packageName = json.client?.package_name;
  assert.ok(
    typeof packageName === "string" && packageName.trim(),
    "AGC文件缺少client.package_name",
  );
  return {
    path: resolved,
    sha256: createHash("sha256").update(content).digest("hex"),
    packageName,
  };
}

export async function configureAgc(builder: Builder, material: AgcMaterial) {
  const view = await builder.openConfigurationPage("AppGallery Connect");
  assert.equal(view.title, "华为 AppGallery Connect", "AGC配置页身份不一致");
  const fields: SpecialField[] = [
    { key: "packages.huawei-agc.serviceConfigPath", type: "string", expected: material.path },
    { key: "packages.huawei-agc.packageName", type: "string", expected: material.packageName },
  ];
  const before = await builder.readSpecialFields(fields);
  const changed: string[] = [];
  for (const field of fields) if (await builder.setSpecialField(field)) changed.push(field.key);
  const after = await builder.readSpecialFields(fields);
  for (const field of fields)
    assert.equal(after[field.key], field.expected, `AGC字段回读不一致：${field.key}`);
  return {
    material,
    before,
    after,
    changed,
    input: "real keyboard into service-file path and package-name inputs; no browse button",
    packageContract: "UI package matches JSON client.package_name adopted by build hook",
  };
}

import {
  cp,
  mkdir,
  readFile,
  writeFile,
  rename,
  access,
} from "node:fs/promises";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (process.platform !== "win32") throw new Error("当前试用包面向 Windows。");
const output = join(
  root,
  "release",
  "QA-Workbench-" + pkg.version + "-win-x64",
);
await mkdir(join(root, "release"), { recursive: true });
await mkdir(output, { recursive: false });
await cp(join(root, "node_modules/electron/dist"), output, {
  recursive: true,
  filter: (path) => !path.endsWith("default_app.asar"),
});
await rename(join(output, "electron.exe"), join(output, "QA-Workbench.exe"));
try {
  await access(join(output, "electron_wer.dll"));
  await rename(
    join(output, "electron_wer.dll"),
    join(output, "QA-Workbench_wer.dll"),
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const app = join(output, "resources/app");
await mkdir(app, { recursive: true });
for (const dir of ["dist", "dist-electron"])
  await cp(join(root, dir), join(app, dir), { recursive: true });
await mkdir(join(app, "node_modules"), { recursive: true });
await cp(join(root, "node_modules/zod"), join(app, "node_modules/zod"), {
  recursive: true,
});
await writeFile(
  join(app, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, type: "module", main: pkg.main },
    null,
    2,
  ),
);
await cp(join(root, "TRIAL.md"), join(output, "试用说明.md"));
console.log(output);

import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { atomicWrite, json, readJson, Serial } from "./files.js";
import { verifyNodeRuntime } from "./nodeRuntime.js";
import {
  settingsInputSchema,
  type WorkbenchSettings,
} from "../shared/settings.js";

const storedSchema = z
  .object({
    moduleRoot: z.string().min(1).optional(),
    outputDirectory: z.string().min(1).optional(),
    nodePath: z.string().optional(),
    outputDirectories: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export function distinctDirectories(paths: string[]) {
  return [
    ...new Map(
      paths.map((path) => {
        const full = resolve(path);
        return [process.platform === "win32" ? full.toLowerCase() : full, full];
      }),
    ).values(),
  ];
}

export class SettingsStore {
  readonly file: string;
  private serial = new Serial();
  constructor(
    readonly dataPath: string,
    private defaults: { moduleRoot: string; nodePath: string },
  ) {
    this.file = join(dataPath, "settings.json");
  }
  private async stored() {
    try {
      return storedSchema.parse(await readJson(this.file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(
        "设置读取失败，原文件已保留。请检查 settings.json 后重启。",
        { cause: error },
      );
    }
  }
  defaultValues(): WorkbenchSettings {
    const outputDirectory = join(this.dataPath, "automation");
    return {
      ...this.defaults,
      dataPath: this.dataPath,
      outputDirectory,
      defaultOutputDirectory: outputDirectory,
      outputDirectories: [outputDirectory],
    };
  }
  async read(): Promise<WorkbenchSettings> {
    const stored = await this.stored(),
      defaults = this.defaultValues();
    return {
      ...defaults,
      moduleRoot: stored.moduleRoot || defaults.moduleRoot,
      outputDirectory: stored.outputDirectory || defaults.outputDirectory,
      nodePath: stored.nodePath || defaults.nodePath,
      outputDirectories: distinctDirectories([
        defaults.outputDirectory,
        ...(stored.outputDirectories || []),
        stored.outputDirectory || defaults.outputDirectory,
      ]),
    };
  }
  async save(value: unknown): Promise<WorkbenchSettings> {
    return this.serial.run(async () => {
      const input = settingsInputSchema.parse(value);
      if (!isAbsolute(input.outputDirectory) || !isAbsolute(input.moduleRoot))
        throw new Error("请选择完整的本机目录路径");
      if (!(await stat(input.moduleRoot)).isDirectory())
        throw new Error("自动化工具位置不是目录");
      if (
        input.nodePath &&
        (!isAbsolute(input.nodePath) || !(await stat(input.nodePath)).isFile())
      )
        throw new Error("请选择 Node.js 程序的完整路径");
      await verifyNodeRuntime(
        input.nodePath || this.defaults.nodePath || "node",
      );
      const stored = await this.stored(),
        previous = await this.read();
      const outputDirectory = resolve(input.outputDirectory);
      try {
        await mkdir(outputDirectory, { recursive: true });
        await access(outputDirectory, constants.R_OK | constants.W_OK);
      } catch (error) {
        throw new Error("测试输出目录不可用或不可写，请重新选择。", {
          cause: error,
        });
      }
      await atomicWrite(
        this.file,
        json({
          ...stored,
          ...input,
          moduleRoot: resolve(input.moduleRoot),
          outputDirectory,
          outputDirectories: distinctDirectories([
            ...previous.outputDirectories,
            previous.outputDirectory,
            outputDirectory,
          ]),
        }),
      );
      return this.read();
    });
  }
}

import assert from "node:assert/strict";
import type { Builder } from "./builder.js";
import type { FormView } from "./configuration-page.js";
import { fieldFingerprint } from "./existing-platforms.js";
import { errorMessage } from "./common.js";

export interface OpenpaasGame {
  id: string;
  codeVersion: string;
}

export class OpenpaasBlockedError extends Error {}

/** Reads the displayed native select, not React state or product internals. */
export function readOpenpaasPage(document: Document) {
  const modal = document.querySelector('button[aria-label="Close"]')?.parentElement?.parentElement;
  if (!modal) return undefined;
  const rows = Array.from(modal.querySelectorAll('[data-slot="field"]')).filter(
    (row) =>
      row.querySelector(':scope > [data-slot="field-label"]')?.textContent?.trim() ===
      "OpenPaaS 游戏",
  );
  if (rows.length !== 1) return undefined;
  const select = rows[0].querySelector<HTMLSelectElement>("select");
  if (!select || !select.getClientRects().length) return undefined;
  const options = Array.from(select.options);
  const versions = Array.from(modal.querySelectorAll<HTMLElement>("div")).filter(
    (element) =>
      !element.children.length &&
      element.getClientRects().length &&
      /^代码版本[：:]/.test(element.textContent?.trim() ?? ""),
  );
  if (versions.length > 1) throw new Error("OpenPaaS代码版本展示不唯一");
  return {
    id: select.value,
    disabled: select.disabled,
    ids: options
      .filter((option) => /^\d+$/.test(option.value) && !option.disabled)
      .map((option) => option.value),
    createLabel:
      options.find((option) => option.value === "__create_game__")?.textContent?.trim() ?? "",
    codeVersion: versions[0]?.textContent?.trim().replace(/^代码版本[：:]\s*/, "") ?? "",
  };
}

type Check = (caseId: string, action: () => Promise<unknown>) => Promise<void>;
const versionKey = "packages.openpaas.versionName";
const platformLabel = "3000+ 平台";

function version(view: FormView): string {
  const field = view.fields.find((field) => field.key === versionKey);
  assert.ok(field?.visible && field.label.startsWith("*"), "游戏版本名须显示必填标记");
  const inputs = field.controls.filter((control) => control.type === "input:text");
  assert.equal(inputs.length, 1, "游戏版本名文本框须唯一");
  assert.equal(inputs[0].disabled, false);
  assert.equal(typeof inputs[0].value, "string");
  return inputs[0].value as string;
}

function versionErrors(view: FormView) {
  return view.alerts.filter((alert) => alert.key === versionKey);
}

/** Ordinary build preparation reuses the selected existing game; no persistence/negative checks. */
export async function prepareOpenpaasBuild(builder: Builder, initialView?: FormView) {
  const view = initialView ?? (await builder.openConfigurationPage(platformLabel));
  assert.equal(view.title, "openpaas小游戏", "OpenPaaS配置页身份不一致");
  const versionName = version(view);
  assert.ok(versionName.trim(), "OpenPaaS游戏版本名必填");
  const games = await builder.openpaasPage();
  assert.ok(games.ids.includes(games.id), "请先在配置页选定已有游戏；工具不新建游戏或替换已选游戏");
  return {
    gameId: fieldFingerprint(games.id),
    versionName,
    codeVersionUI: games.codeVersion,
    entry: "normal UI build button",
    outcomePolicy: "submitted task final result, including product-managed internal stages",
    automaticStages:
      "product-managed; retain task options when exposed; no SDK changes or separate clicks",
  };
}

/** This scope never calls a build, stage or game-creation operation. */
export async function checkOpenpaasConfiguration(
  builder: Builder,
  initial: FormView,
  check: Check,
  restored: () => void,
) {
  const originalVersion = version(initial);
  if (!originalVersion.trim())
    throw new OpenpaasBlockedError(
      "当前游戏版本名为空；需要有效的初始版本名才能完成恢复后正向检查",
    );
  let originalGame: string | undefined;
  let versionEdited = false;
  let gameEdited = false;
  try {
    await check("UI-P08-required-readback", async () => {
      for (const key of ["name", "buildPath"]) {
        const field = initial.fields.find((field) => field.key === key);
        assert.ok(field?.visible && field.label.startsWith("*"), `公共必填项缺标记：${key}`);
        assert.ok(
          field.controls
            .filter((control) => control.type === "input:text")
            .every((control) => typeof control.value === "string" && control.value.trim()),
          `公共必填项为空：${key}`,
        );
      }
      return {
        commonRequired: ["name", "buildPath"],
        versionName: originalVersion,
        commonNegativeBranches: "not executed; separate public UI scope",
      };
    });
    let games;
    try {
      games = await builder.openpaasPage();
    } catch (error) {
      throw new OpenpaasBlockedError(`已有游戏列表不可用：${errorMessage(error)}；不创建游戏`);
    }
    if (!games.ids.includes(games.id))
      throw new OpenpaasBlockedError(
        "当前没有选中的有效已有游戏；请先在UI选择已有游戏，再运行检查",
      );
    originalGame = games.id;
    await check("UI-P08-existing-games", async () => {
      assert.equal(new Set(games.ids).size, games.ids.length, "已有游戏ID重复");
      return {
        existingCount: games.ids.length,
        originalId: fieldFingerprint(games.id),
        candidates: games.ids.map(fieldFingerprint),
        source: "UI options matched passive game-list response",
      };
    });
    const selected = games.ids.find((id) => id !== originalGame) ?? originalGame;
    await check("UI-P08-select-existing-game", async () => {
      gameEdited = selected !== originalGame;
      await builder.selectOpenpaasGame(selected);
      const readback = await builder.openpaasPage();
      return {
        selectedId: fieldFingerprint(selected),
        selectionChanged: gameEdited,
        codeVersion: readback.codeVersion,
        expectedCodeVersion: readback.games.find((game) => game.id === selected)!.codeVersion,
        source: "real numeric typeahead; read-only game-list response; UI readback",
        singleCandidate: games.ids.length === 1,
      };
    });
    await check("UI-P08-version-required", async () => {
      versionEdited = true;
      await builder.setSpecialField({ key: versionKey, type: "string", expected: "" });
      await builder.closeConfiguration();
      const empty = await builder.openConfigurationPage(platformLabel);
      assert.equal(version(empty), "", "版本名清空后回读不一致");
      const errors = versionErrors(empty);
      assert.ok(
        errors.some((alert) => alert.level === "error"),
        "版本名为空未显示必填错误",
      );
      assert.equal((await builder.openpaasPage()).id, selected, "重开后已有游戏选择改变");
      return {
        emptyValueReadback: true,
        alerts: errors,
        validationTrigger: "save and reopen; no build click",
      };
    });
  } finally {
    if (versionEdited || gameEdited) {
      await check("UI-P08-restore-readback", async () => {
        await builder.setSpecialField({
          key: versionKey,
          type: "string",
          expected: originalVersion,
        });
        if (gameEdited && originalGame) await builder.selectOpenpaasGame(originalGame);
        await builder.closeConfiguration();
        const final = await builder.openConfigurationPage(platformLabel);
        assert.equal(version(final), originalVersion, "原版本名恢复后回读不一致");
        assert.equal(versionErrors(final).length, 0, "恢复有效版本名后仍有必填提示");
        const readback = await builder.openpaasPage();
        assert.equal(readback.id, originalGame, "原游戏选择恢复后回读不一致");
        restored();
        return {
          versionName: originalVersion,
          gameId: fieldFingerprint(readback.id),
          codeVersion: readback.codeVersion,
          buildSubmitted: false,
        };
      });
    }
  }
}

import type { Mount } from "../../shared/content";
import type { State } from "../../shared/model";
import { readDraft, draftKeys } from "../components/useDraft";
import { routeDraft } from "./draftSchemas";
import { fromRoute } from "./ContentWorkspace";

export function manualSources(state: State): Mount[] {
  const legacy = state.routes.map((route) => ({
    id: "legacy:" + route.id,
    name: route.name,
    sourceName: "已有个人链路",
    content: fromRoute(route),
  }));
  const drafts: Mount[] = draftKeys("route:").flatMap((key, index) => {
    try {
      const parsed = routeDraft.safeParse(readDraft(key));
      if (
        !parsed.success ||
        (!parsed.data.items.length && !parsed.data.quick.trim())
      )
        return [];
      const id = "legacy-draft:" + index;
      const items = [...parsed.data.items];
      if (parsed.data.quick.trim())
        items.push({
          id: id + ":quick",
          title: parsed.data.quick.trim(),
          action: "",
          expected: "",
        });
      return [
        {
          id,
          name: parsed.data.name + " · 恢复草稿",
          sourceName: "qa:draft:1:" + key,
          content: fromRoute({ id, name: parsed.data.name, items }),
        },
      ];
    } catch {
      return [];
    }
  });
  return [
    ...state.mounts.filter((mount) => !mount.editor),
    ...legacy.filter(
      (mount) => !state.mounts.some((saved) => saved.id === mount.id),
    ),
    ...drafts.filter(
      (mount) =>
        !state.mounts.some((saved) => saved.sourceName === mount.sourceName),
    ),
  ];
}

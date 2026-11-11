import { z } from "zod";
import { flatten, type EditNode } from "./authoring";

export const organizationSchema = z.object({
  folders: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      parent: z.string().optional(),
    }),
  ),
  parents: z.record(z.string(), z.string()),
});
export type Organization = z.infer<typeof organizationSchema>;
export const emptyOrganization: Organization = { folders: [], parents: {} };

function naturalParents(base: EditNode[]) {
  const parents = new Map<string, string>();
  const visit = (nodes: EditNode[]) => {
    for (const node of nodes) {
      for (const child of node.children || []) parents.set(child.id, node.id);
      visit(node.children || []);
    }
  };
  visit(base);
  return parents;
}

export function reconcileOrganization(
  base: EditNode[],
  organization: Organization,
  options: {
    previous?: EditNode[];
    remap?: Record<string, string | null>;
    protectedFolders?: Set<string>;
  } = {},
): Organization {
  const nodes = new Map(flatten(base).map((node) => [node.id, node]));
  const natural = naturalParents(base);
  const previousParents = naturalParents(options.previous || base);
  const folders = new Map(
    organization.folders.map((folder) => [folder.id, folder]),
  );
  const remap = (id: string) =>
    Object.hasOwn(options.remap || {}, id) ? options.remap![id] : id;
  for (const folder of organization.folders) {
    const parent = Object.hasOwn(organization.parents, folder.id)
      ? organization.parents[folder.id]
      : folder.parent;
    if (parent) previousParents.set(folder.id, parent);
  }
  const mappedParents = Object.entries(organization.parents).flatMap(
    ([key, value]) => {
      const nextKey = remap(key),
        nextValue = remap(value);
      const parent = nextKey && natural.get(nextKey);
      return nextKey &&
        parent &&
        nodes.get(parent)?.canHaveFolders &&
        nextValue &&
        folders.has(nextValue)
        ? [[nextKey, nextValue] as const]
        : [];
    },
  );
  const hasContents = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      mappedParents.some(([, parent]) => parent === id) ||
      organization.folders.some(
        (child) =>
          previousParents.get(child.id) === id &&
          (options.protectedFolders?.has(child.id) ||
            hasContents(child.id, seen)),
      )
    );
  };
  const removed = new Set(
    options.protectedFolders
      ? organization.folders
          .filter((folder) => {
            const parent = previousParents.get(folder.id);
            const mapped = parent && remap(parent);
            const missing =
              parent &&
              (!mapped || (!nodes.has(mapped) && !folders.has(mapped)));
            return (
              missing &&
              !options.protectedFolders!.has(folder.id) &&
              !hasContents(folder.id)
            );
          })
          .map((folder) => folder.id)
      : [],
  );
  const fallback = base.find((node) => node.canHaveFolders)?.id;
  function owner(parent: string | undefined, child: string) {
    const seen = new Set([child]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const next = remap(parent);
      if (next && nodes.get(next)?.canHaveFolders) return next;
      if (next && folders.has(next) && !removed.has(next)) {
        let ancestor: string | undefined = next;
        const ancestors = new Set([child]);
        while (ancestor && folders.has(ancestor) && !ancestors.has(ancestor)) {
          ancestors.add(ancestor);
          ancestor = previousParents.get(ancestor);
        }
        if (!ancestor || !ancestors.has(ancestor)) return next;
      }
      parent = previousParents.get(parent);
    }
    return fallback;
  }
  return {
    folders: organization.folders
      .filter((folder) => !removed.has(folder.id))
      .map((folder) => ({
        ...folder,
        parent: owner(previousParents.get(folder.id), folder.id),
      })),
    parents: Object.fromEntries(
      mappedParents.filter(([, parent]) => !removed.has(parent)),
    ),
  };
}

export function organize(
  base: EditNode[],
  organization: Organization,
): EditNode[] {
  const normalized = reconcileOrganization(base, organization);
  const natural = naturalParents(base);
  const nodes = flatten(base).map((node) => ({
    ...node,
    children: [] as EditNode[],
  }));
  nodes.push(
    ...normalized.folders.map((folder) => ({
      id: folder.id,
      title: folder.title,
      children: [],
    })),
  );
  const index = new Map(nodes.map((node) => [node.id, node]));
  const folders = new Map(
    normalized.folders.map((folder) => [folder.id, folder]),
  );
  const roots: EditNode[] = [];
  for (const node of nodes) {
    const parent =
      normalized.parents[node.id] ||
      folders.get(node.id)?.parent ||
      natural.get(node.id);
    const destination = parent && index.get(parent);
    if (destination) destination.children.push(node);
    else roots.push(node);
  }
  return roots;
}

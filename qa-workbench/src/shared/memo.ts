import { z } from "zod";

export const memoEntrySchema = z.object({
  id: z.string().min(1).max(300),
  text: z.string().max(50000),
});
export const memoEntriesSchema = z
  .array(memoEntrySchema)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => entry.id)).size === entries.length,
    "备忘条目 ID 重复",
  );
export const memoSchema = z
  .union([z.string().max(50000), memoEntriesSchema])
  .transform((value) =>
    typeof value === "string"
      ? value.length
        ? [{ id: "legacy-memo", text: value }]
        : []
      : value,
  );
export type MemoEntry = z.infer<typeof memoEntrySchema>;

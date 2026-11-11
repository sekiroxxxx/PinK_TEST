type Step = Record<string, unknown>;

export type NativeValueRelation = {
  field: string;
  setting: number;
  assertion: number;
};

export function nativeSettingParameter(step: Step) {
  return step.op === "set"
    ? "value"
    : step.op === "config.select"
      ? "candidate"
      : undefined;
}

/** Presentation links follow explicit reads; no execution steps are generated. */
export function nativeValueRelations(steps: Step[]): NativeValueRelation[] {
  const writes = new Map<string, Map<string, number>>();
  const revisions = new Map<string, number>();
  const readonly = new Set([
    "config.ready",
    "config.probe",
    "config.candidates",
    "config.require",
    "read",
    "record",
    "retain",
    "assert",
    "stage.read",
    "stage.record",
    "stage.hint",
  ]);
  const reads = new Map<
    string,
    {
      page: string;
      revision: number;
      fields: Set<string>;
      writers: Map<string, number>;
    }
  >();
  const relations: NativeValueRelation[] = [];
  steps.forEach((step, index) => {
    const parameter = nativeSettingParameter(step);
    if (typeof step.page === "string" && !readonly.has(String(step.op))) {
      revisions.set(step.page, (revisions.get(step.page) || 0) + 1);
      if (!parameter) {
        if (typeof step.field === "string")
          writes.get(step.page)?.delete(step.field);
        else writes.delete(step.page);
      }
    }
    if (
      parameter &&
      typeof step.page === "string" &&
      typeof step.field === "string"
    ) {
      const page = writes.get(step.page) || new Map<string, number>();
      page.set(step.field, index);
      writes.set(step.page, page);
    }
    if (
      step.op === "read" &&
      typeof step.id === "string" &&
      typeof step.page === "string" &&
      Array.isArray(step.fields)
    )
      reads.set(step.id, {
        page: step.page,
        revision: revisions.get(step.page) || 0,
        fields: new Set(
          step.fields.filter(
            (field): field is string => typeof field === "string",
          ),
        ),
        writers: new Map(writes.get(step.page)),
      });
    if (
      step.op !== "assert" ||
      step.check !== "values" ||
      typeof step.snapshot !== "string" ||
      !step.values ||
      typeof step.values !== "object" ||
      Array.isArray(step.values)
    )
      return;
    const read = reads.get(step.snapshot);
    if (!read || read.revision !== (revisions.get(read.page) || 0)) return;
    for (const field of Object.keys(step.values)) {
      const setting = read.writers.get(field);
      if (setting !== undefined && read.fields.has(field))
        relations.push({ field, setting, assertion: index });
    }
  });
  return relations;
}

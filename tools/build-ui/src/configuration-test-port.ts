import { ExecutionContext } from "./configuration-context.js";
import { ConfigurationOperations, type ConfigurationPort } from "./configuration-operations.js";
import { runFormSample, type LoadedFormSample } from "./form-validation.js";

/** Offline observations only: exercises production operations/controller, never launches a UI. */
export function operationsFor(port: ConfigurationPort, platform = "web-desktop") {
  const identity = { executable: "offline-PinK", project: "offline-project", windowId: 1 };
  const session = new ExecutionContext(identity, async () => identity);
  let generation = 0;
  const bind = () =>
    session.bind(platform, platform, ++generation, async () => ({ title: platform, generation }));
  return new ConfigurationOperations(bind(), port, async () => bind());
}

export function runObservedFormSample(port: ConfigurationPort, sample: LoadedFormSample) {
  const field = sample.execution.field;
  const platform =
    field.startsWith("packages.") && !field.startsWith("packages.localization-editor.")
      ? field.split(".")[1]
      : "web-desktop";
  return runFormSample(operationsFor(port, platform), sample);
}

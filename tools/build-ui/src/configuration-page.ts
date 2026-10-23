export interface FormControl {
  type: string;
  disabled: boolean;
  value?: boolean | string;
  redacted?: boolean;
}

export interface FormField {
  key: string;
  label: string;
  visible: boolean;
  controls: FormControl[];
}

export interface FormView {
  state: "awaiting-dialog" | "loading-options" | "no-options" | "awaiting-fields" | "form";
  title: string;
  fields: FormField[];
  unkeyedFields: FormField[];
  alerts: Array<{ key: string; level: string; message: string }>;
  sections: Array<{ label: string; expanded: boolean | null }>;
  buttons: Array<{ label: string; disabled: boolean }>;
}

/** Reads displayed controls; validation/disabled build buttons do not make the page unloaded. */
export function readForm(document: Document): FormView {
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
  const modal = close?.parentElement?.parentElement;
  const empty: FormView = {
    state: "awaiting-dialog",
    title: "",
    fields: [],
    unkeyedFields: [],
    alerts: [],
    sections: [],
    buttons: [],
  };
  if (!modal || !modal.getClientRects().length) return empty;
  const visible = (element: HTMLElement) =>
    element.getClientRects().length > 0 &&
    document.defaultView!.getComputedStyle(element).visibility === "visible";
  const text = (element: Element | null | undefined) => element?.textContent?.trim() ?? "";
  const sensitive =
    /(?:^|\.)(?:appid|appkey|accessToken|token|password|secret|storePassword|keyPassword|xxteaKey)$/i;
  const secretValues: string[] = [];
  const controls = (row: HTMLElement, key: string): FormControl[] =>
    Array.from(
      row.querySelectorAll<HTMLElement>('input,select,[role="checkbox"],[role="combobox"]'),
    )
      .filter(
        (control) =>
          !row.hasAttribute("data-option-key") || control.closest("[data-option-key]") === row,
      )
      .filter((control) => control.getAttribute("type") !== "hidden")
      .map((control) => {
        const input = control as HTMLInputElement;
        const type =
          control.getAttribute("role") ??
          control.tagName.toLowerCase() + (input.type ? `:${input.type}` : "");
        let value: string | boolean | undefined =
          control.getAttribute("role") === "checkbox"
            ? control.getAttribute("aria-checked") === "true"
            : input.type === "checkbox"
              ? input.checked
              : control.getAttribute("role") === "combobox"
                ? (row.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ??
                  text(control))
                : "value" in control
                  ? String(input.value)
                  : text(control);
        const redacted =
          sensitive.test(key) ||
          input.type === "password" ||
          /^packages\.openpaas\.(?:encryptKey|privatePemPath|context_signature)$/i.test(key);
        if (redacted) {
          if (typeof value === "string" && value) secretValues.push(value);
          value = value ? "[redacted:nonempty]" : "[redacted:empty]";
        }
        return {
          type,
          disabled: input.disabled === true || control.getAttribute("aria-disabled") === "true",
          value,
          ...(redacted ? { redacted: true } : {}),
        };
      });
  const fields = Array.from(modal.querySelectorAll<HTMLElement>("[data-option-key]")).map((row) => {
    const key = row.getAttribute("data-option-key")!;
    return {
      key,
      label: text(row.querySelector('[data-slot="field-label"]')),
      visible: visible(row),
      controls: controls(row, key),
    };
  });
  const unkeyedFields = Array.from(modal.querySelectorAll<HTMLElement>('[data-slot="field"]'))
    .filter((row) => !row.closest("[data-option-key]"))
    .map((row) => {
      const label = text(row.querySelector(':scope > [data-slot="field-label"]'));
      return {
        key: "",
        label,
        visible: visible(row),
        controls: controls(
          row,
          /(?:appid|appkey|密码|密钥)/i.test(label) || label === "OpenPaaS 游戏" ? "appkey" : "",
        ),
      };
    })
    .filter((field) => field.label && field.controls.length);
  const scrub = (value: string) =>
    secretValues.reduce((result, secret) => result.split(secret).join("[redacted]"), value);
  const leafText = Array.from(modal.querySelectorAll<HTMLElement>("div"))
    .filter((element) => visible(element) && !element.children.length)
    .map(text);
  const state = leafText.some((value) =>
    ["该平台暂无可配置参数", "No options available for this platform"].includes(value),
  )
    ? "no-options"
    : leafText.some((value) => /^(加载参数中…|正在加载选项…|Loading options\.\.\.)$/.test(value))
      ? "loading-options"
      : !fields.some((field) => field.key === "name" && field.controls.length) ||
          !fields.some((field) => field.key === "buildPath" && field.controls.length >= 2)
        ? "awaiting-fields"
        : "form";
  return {
    state,
    title: text(close!.parentElement?.querySelector("span")),
    fields,
    unkeyedFields,
    alerts: Array.from(modal.querySelectorAll<HTMLElement>('[role="alert"]')).map((alert) => ({
      key: alert.closest("[data-option-key]")?.getAttribute("data-option-key") ?? "",
      level: alert.getAttribute("data-type") ?? "unknown",
      message: scrub(text(alert)),
    })),
    sections: Array.from(modal.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).map(
      (button) => ({
        label: text(button),
        expanded: button.getAttribute("aria-expanded") === "true",
      }),
    ),
    buttons: Array.from(modal.querySelectorAll<HTMLButtonElement>("button"))
      .filter(visible)
      .map((button) => ({
        label: text(button) || button.getAttribute("aria-label") || "",
        disabled: button.disabled || button.getAttribute("aria-disabled") === "true",
      })),
  };
}

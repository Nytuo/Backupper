import en from "./en";
import fr from "./fr";

export const DICTIONARIES: Record<string, unknown> = { en, fr };
export const LOCALES = Object.keys(DICTIONARIES);
export const FALLBACK_LOCALE = "en";

export type Vars = Record<string, string | number>;

export interface AppErrorShape {
  kind: string;
  message?: string;
}

function lookup(dict: unknown, path: string): string | undefined {
  const node = path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object"
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      dict,
    );
  return typeof node === "string" ? node : undefined;
}

export function interpolate(template: string, vars: Vars): string {
  return Object.entries(vars).reduce(
    (str, [name, value]) => str.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function translate(
  locale: string,
  key: string,
  vars: Vars = {},
): string {
  const template = lookup(DICTIONARIES[locale], key) ??
    lookup(DICTIONARIES[FALLBACK_LOCALE], key);
  if (template === undefined) return key;
  return interpolate(template, vars);
}

export function errorMessageFor(locale: string, err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    typeof (err as AppErrorShape).kind === "string"
  ) {
    const e = err as AppErrorShape;
    return translate(locale, `errors.${e.kind}`, { message: e.message ?? "" });
  }
  return String(err);
}

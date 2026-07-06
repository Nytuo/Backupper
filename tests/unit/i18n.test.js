import { describe, expect, it } from "vitest";
import {
  errorMessageFor,
  LOCALES,
  translate,
} from "../../src/i18n/translate.ts";

describe("i18n", () => {
  it("exposes english and french", () => {
    expect(LOCALES).toContain("en");
    expect(LOCALES).toContain("fr");
  });

  it("translates a simple key", () => {
    expect(translate("en", "common.password")).toBe("Password");
  });

  it("translates into french", () => {
    expect(translate("fr", "common.password")).toBe("Mot de passe");
  });

  it("falls back to english for an unknown locale", () => {
    expect(translate("xx", "common.password")).toBe("Password");
  });

  it("interpolates variables", () => {
    expect(
      translate("en", "home.repoCardSummary", {
        count: 3,
        path: "/tmp/backup",
      }),
    ).toBe("3 folder(s) → /tmp/backup");
  });

  it("falls back to the raw key when translation is missing anywhere", () => {
    expect(translate("en", "nonexistent.key.path")).toBe(
      "nonexistent.key.path",
    );
  });

  it("maps a known AppError kind to a localized message", () => {
    expect(errorMessageFor("en", { kind: "wrong_password" })).toBe(
      "That password is incorrect for this backup.",
    );
  });

  it("interpolates the raw message for generic error kinds", () => {
    expect(errorMessageFor("en", { kind: "restic", message: "disk full" }))
      .toBe(
        "restic reported an error: disk full",
      );
  });

  it("stringifies anything that is not a recognized error shape", () => {
    expect(errorMessageFor("en", "plain string error")).toBe(
      "plain string error",
    );
    expect(errorMessageFor("en", new Error("boom"))).toBe("Error: boom");
  });
});

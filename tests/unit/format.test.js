import { describe, expect, it } from "vitest";
import {
  canRestore,
  formatSnapshotLabel,
  pathBasename,
} from "../../src/lib/format.ts";

describe("canRestore", () => {
  it("requires both a snapshot and a destination", () => {
    expect(canRestore(null, null)).toBe(false);
    expect(canRestore("snap-1", null)).toBe(false);
    expect(canRestore(null, "/tmp/restore")).toBe(false);
    expect(canRestore("snap-1", "/tmp/restore")).toBe(true);
  });
});

describe("formatSnapshotLabel", () => {
  it("includes the short id alongside a localized date", () => {
    const snapshot = { time: "2026-01-15T10:30:00Z", short_id: "abc123" };
    const label = formatSnapshotLabel("en", snapshot);
    expect(label).toContain("abc123");
    expect(label).toMatch(/\(abc123\)$/);
  });
});

describe("pathBasename", () => {
  it("returns the last path segment", () => {
    expect(pathBasename("/tmp/seeded-source/Documents")).toBe("Documents");
    expect(pathBasename("/tmp/seeded-source/")).toBe("seeded-source");
  });

  it("falls back to the full string when there are no segments", () => {
    expect(pathBasename("")).toBe("");
  });
});

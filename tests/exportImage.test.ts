import { describe, expect, test } from "vitest";
import { fileName } from "../src/editor/exportImage";

describe("fileName", () => {
  test("turns a title into a lowercase slug", () => {
    expect(fileName("Cell Biology: Basics")).toBe("cell-biology-basics");
  });

  test("drops accents and trims separators", () => {
    expect(fileName("  Économie & Société!  ")).toBe("economie-societe");
  });

  test("falls back when nothing is left", () => {
    expect(fileName("")).toBe("map");
    expect(fileName("日本語")).toBe("map");
  });

  test("caps the length without a trailing dash", () => {
    const name = fileName(`${"a".repeat(79)} b`);
    expect(name).toBe("a".repeat(79));
  });
});

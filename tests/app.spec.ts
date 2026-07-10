import { describe, test, expect } from "vitest";
import { decodeForm } from "../src/app.ts";

describe("tautology", () => {
  test("reality still works", () => {
    expect(1 + 1).toEqual(2);
  });
});

describe("decodeForm", () => {
  test("recognizes long form (top bits 00)", () => {
    expect(decodeForm(0x00, 3)).toBe("long");
  });

  test("recognizes long form (top bits 01)", () => {
    expect(decodeForm(0x7f, 3)).toBe("long");
  });

  test("recognizes short form (top bits 10)", () => {
    expect(decodeForm(0x80, 3)).toBe("short");
  });

  test("recognizes variable form (top bits 11)", () => {
    expect(decodeForm(0xc0, 3)).toBe("variable");
    expect(decodeForm(0xff, 3)).toBe("variable");
  });

  test("$BE is short form in V3, since extended form doesn't exist yet", () => {
    expect(decodeForm(0xbe, 3)).toBe("short");
  });

  test("$BE is extended form in V5+", () => {
    expect(decodeForm(0xbe, 5)).toBe("extended");
    expect(decodeForm(0xbe, 8)).toBe("extended");
  });

  test("$BE is extended form exactly at the V5 boundary, not V4", () => {
    expect(decodeForm(0xbe, 4)).toBe("short");
    expect(decodeForm(0xbe, 5)).toBe("extended");
  });
});

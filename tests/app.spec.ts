import { describe, test, expect } from "vitest";
import { readPropertyDefaultsTable } from "../src/app.ts";

describe("tautology", () => {
  test("reality still works", () => {
    expect(1 + 1).toEqual(2);
  });
});

describe("readPropertyDefaultsTable", () => {
  test("reads 31 words for a V3 file and computes the correct offset", () => {
    const mockStory = new Uint8Array(200);
    const tableAddr = 0x10;

    mockStory[tableAddr] = 0x00;
    mockStory[tableAddr + 1] = 0x2a; // first default = 42

    const result = readPropertyDefaultsTable(mockStory, tableAddr, 3);

    expect(result.defaults.length).toBe(31);
    expect(result.defaults[0]).toBe(42);
    expect(result.firstObjectEntryAddress).toBe(tableAddr + 31 * 2);
  });

  test("reads 63 words for a V5 file and computes the correct offset", () => {
    const mockStory = new Uint8Array(200);
    const tableAddr = 0x10;

    const result = readPropertyDefaultsTable(mockStory, tableAddr, 5);

    expect(result.defaults.length).toBe(63);
    expect(result.firstObjectEntryAddress).toBe(tableAddr + 63 * 2);
  });
});

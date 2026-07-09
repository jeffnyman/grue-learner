import { describe, test, expect } from "vitest";
import { readDictionaryHeader } from "../src/app.ts";

describe("tautology", () => {
  test("reality still works", () => {
    expect(1 + 1).toEqual(2);
  });
});

describe("readDictionaryHeader", () => {
  // prettier-ignore
  test("parses a standard positive-count (sorted) header", () => {
    const mockStory = new Uint8Array(20);
    const addr = 0x00;

    mockStory[addr] = 3; // 3 separators
    mockStory[addr + 1] = 46; mockStory[addr + 2] = 44; mockStory[addr + 3] = 34; // . , "
    mockStory[addr + 4] = 7; // entry length
    mockStory[addr + 5] = 0x00; mockStory[addr + 6] = 128; // entryCount = 128

    const result = readDictionaryHeader(mockStory, addr);

    expect(result.separatorCount).toBe(3);
    expect(result.separators).toEqual([46, 44, 34]);
    expect(result.entryLength).toBe(7);
    expect(result.entryCount).toBe(128);
    expect(result.isSorted).toBe(true);
    expect(result.firstEntryAddress).toBe(addr + 7);
  });

  // prettier-ignore
  test("correctly interprets a negative entry count as unsorted", () => {
    const mockStory = new Uint8Array(20);
    const addr = 0x00;

    mockStory[addr] = 0; // no separators, for simplicity
    mockStory[addr + 1] = 7; // entry length
    mockStory[addr + 2] = 0xff; mockStory[addr + 3] = 0xfb; // 0xFFFB = -5 as signed 16-bit

    const result = readDictionaryHeader(mockStory, addr);

    expect(result.entryCount).toBe(-5);
    expect(result.isSorted).toBe(false);
  });
});

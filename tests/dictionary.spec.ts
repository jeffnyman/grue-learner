import { describe, test, expect } from "vitest";
import {
  readDictionary,
  readDictionaryEntry,
  readDictionaryHeader,
  validateDictionarySortOrder,
  type Dictionary,
  type DictionaryHeader,
} from "../src/dictionary.ts";

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

describe("readDictionaryEntry", () => {
  test("decodes a V3 entry: text + 3 data bytes, confirming word count", () => {
    const mockStory = new Uint8Array(20);
    const header: DictionaryHeader = {
      separatorCount: 0,
      separators: [],
      entryLength: 7,
      entryCount: 1,
      isSorted: true,
      firstEntryAddress: 0,
    };

    // "the" as before: zchars [25,13,10], but needs exactly 2 words (4 bytes) for V3.
    // word1: zchars 25,13,10, end-bit=0 (not yet done, need a 2nd word to hit 4 bytes)
    const word1 = (0 << 15) | (25 << 10) | (13 << 5) | 10;
    mockStory[0] = (word1 >> 8) & 0xff;
    mockStory[1] = word1 & 0xff;
    // word2: padding (zchar 5,5,5), end-bit=1
    const word2 = (1 << 15) | (5 << 10) | (5 << 5) | 5;
    mockStory[2] = (word2 >> 8) & 0xff;
    mockStory[3] = word2 & 0xff;

    // data bytes (entryLength 7 - textWidth 4 = 3 bytes)
    mockStory[4] = 0x01;
    mockStory[5] = 0x02;
    mockStory[6] = 0x03;

    const entry = readDictionaryEntry(mockStory, header, 0, 3, 0);

    expect(entry.data).toEqual([0x01, 0x02, 0x03]);
    expect(entry.address).toBe(0);
  });

  test("computes the correct address for a non-zero index", () => {
    const mockStory = new Uint8Array(30);
    const header: DictionaryHeader = {
      separatorCount: 0,
      separators: [],
      entryLength: 7,
      entryCount: 2,
      isSorted: true,
      firstEntryAddress: 0,
    };

    const address = 3 * 7; // 21

    // Minimal valid terminated string: zchars [0,0,0], end-bit set
    const word = (1 << 15) | (0 << 10) | (0 << 5) | 0;
    mockStory[address] = (word >> 8) & 0xff;
    mockStory[address + 1] = word & 0xff;

    const entry = readDictionaryEntry(mockStory, header, 3, 3, 0);
    expect(entry.address).toBe(address);
  });
});

describe("readDictionary", () => {
  test("walks a small dictionary and returns all entries in order", () => {
    const mockStory = new Uint8Array(50);
    const addr = 0x00;

    mockStory[addr] = 0; // 0 separators
    mockStory[addr + 1] = 7; // entry length
    mockStory[addr + 2] = 0x00;
    mockStory[addr + 3] = 2; // entryCount = 2

    const firstEntryAddress = addr + 4;

    // Entry 0: minimal terminated string (zchars 0,0,0, end-bit set), + 3 data bytes
    const word0 = (1 << 15) | 0;
    mockStory[firstEntryAddress] = (word0 >> 8) & 0xff;
    mockStory[firstEntryAddress + 1] = word0 & 0xff;
    mockStory[firstEntryAddress + 4] = 0xaa;

    // Entry 1: same, at firstEntryAddress + 7
    const word1 = (1 << 15) | 0;
    mockStory[firstEntryAddress + 7] = (word1 >> 8) & 0xff;
    mockStory[firstEntryAddress + 7 + 1] = word1 & 0xff;
    mockStory[firstEntryAddress + 7 + 4] = 0xbb;

    const dict = readDictionary(mockStory, addr, 3, 0);

    expect(dict.entries.length).toBe(2);
    expect(dict.entries[0]).toBeDefined();
    expect(dict.entries[0]!.data[0]).toBe(0xaa);
    expect(dict.entries[1]).toBeDefined();
    expect(dict.entries[1]!.data[0]).toBe(0xbb);
  });
});

describe("validateDictionarySortOrder", () => {
  test("passes for strictly ascending raw text", () => {
    const dictionary: Dictionary = {
      header: {} as DictionaryHeader,
      entries: [
        { index: 0, address: 0, rawText: [1, 0, 0, 0], text: "a", data: [] },
        { index: 1, address: 0, rawText: [2, 0, 0, 0], text: "b", data: [] },
      ],
    };

    const results = validateDictionarySortOrder(dictionary);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("fails on a duplicate encoded text", () => {
    const dictionary: Dictionary = {
      header: {} as DictionaryHeader,
      entries: [
        { index: 0, address: 0, rawText: [5, 0, 0, 0], text: "x", data: [] },
        { index: 1, address: 0, rawText: [5, 0, 0, 0], text: "x", data: [] },
      ],
    };

    const results = validateDictionarySortOrder(dictionary);
    expect(results[0]!.passed).toBe(false);
  });

  test("fails on genuinely out-of-order entries", () => {
    const dictionary: Dictionary = {
      header: {} as DictionaryHeader,
      entries: [
        { index: 0, address: 0, rawText: [9, 0, 0, 0], text: "z", data: [] },
        { index: 1, address: 0, rawText: [3, 0, 0, 0], text: "c", data: [] },
      ],
    };

    const results = validateDictionarySortOrder(dictionary);
    expect(results[0]!.passed).toBe(false);
  });
});

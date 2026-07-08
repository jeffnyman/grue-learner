import { describe, test, expect } from "vitest";
import { readAbbreviationEntry, unpackWord } from "../src/app.ts";

describe("tautology", () => {
  test("reality still works", () => {
    expect(1 + 1).toEqual(2);
  });
});

describe("unpackWord", () => {
  test("unpacks three Z-characters with end-bit unset", () => {
    // first=1, second=2, third=3, end=0
    // binary: 0 00001 00010 00011
    const word = 0b0000100010_00011 & 0xffff;
    const result = unpackWord(word);

    expect(result.zchars).toEqual([1, 2, 3]);
    expect(result.isEnd).toBe(false);
  });

  test("unpacks with end-bit set", () => {
    // first=31, second=31, third=31, end=1
    const word = 0b1_11111_11111_11111;
    const result = unpackWord(word);

    expect(result.zchars).toEqual([31, 31, 31]);
    expect(result.isEnd).toBe(true);
  });

  test("correctly isolates all-zero Z-characters with end-bit set", () => {
    const word = 0b1_00000_00000_00000;
    const result = unpackWord(word);

    expect(result.zchars).toEqual([0, 0, 0]);
    expect(result.isEnd).toBe(true);
  });
});

describe("readAbbreviationEntry", () => {
  test("converts a word address to a byte address by doubling it", () => {
    const mockStory = new Uint8Array(10);
    const tableAddr = 0x00;

    mockStory[0x00] = 0x01;
    mockStory[0x01] = 0x00; // word address = 0x0100 = 256

    const result = readAbbreviationEntry(mockStory, tableAddr, 0);

    expect(result).toBe(512); // 256 * 2
  });

  test("reads the correct entry when index > 0", () => {
    const mockStory = new Uint8Array(10);

    mockStory[0x02] = 0x00;
    mockStory[0x03] = 0x0a; // entry 1: word address = 10

    const result = readAbbreviationEntry(mockStory, 0x00, 1);

    expect(result).toBe(20);
  });
});

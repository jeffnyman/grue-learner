import { describe, test, expect } from "vitest";
import {
  readAbbreviationEntry,
  translateZCharacter,
  unpackWord,
  type DecoderState,
} from "../src/app.ts";

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

describe("translateZCharacter", () => {
  const initial = (): DecoderState => ({ current: 0, lock: 0 });

  test("matches the Standard's own worked example: Z-char 12 in A1 is capital G", () => {
    const result = translateZCharacter(12, { current: 1, lock: 1 }, 5);
    expect(result).toMatchObject({ type: "output", zscii: 71 }); // 'G'
  });

  test("Z-char 0 is always a space", () => {
    const result = translateZCharacter(0, initial(), 5);
    expect(result).toMatchObject({ type: "output", zscii: 32 });
  });

  test("Z-char 1 is newline in V1", () => {
    const result = translateZCharacter(1, initial(), 1);
    expect(result).toMatchObject({ type: "output", zscii: 13 });
  });

  test("Z-char 1 is an abbreviation trigger in V5", () => {
    const result = translateZCharacter(1, initial(), 5);
    expect(result.type).toBe("abbreviation");
  });

  test("Z-char 2 is a single-shift in V2 (A0 -> A1, lock unchanged)", () => {
    const result = translateZCharacter(2, initial(), 2);
    expect(result.newState).toEqual({ current: 1, lock: 0 });
  });

  test("Z-char 2 is an abbreviation trigger in V3+", () => {
    const result = translateZCharacter(2, initial(), 3);
    expect(result.type).toBe("abbreviation");
  });

  test("Z-char 4 is a shift-lock in V1 (both current and lock change)", () => {
    const result = translateZCharacter(4, initial(), 1);
    expect(result.newState).toEqual({ current: 1, lock: 1 });
  });

  test("Z-char 4 is a single-shift only in V5 (lock stays at A0)", () => {
    const result = translateZCharacter(4, initial(), 5);
    expect(result.newState).toEqual({ current: 1, lock: 0 });
  });

  test("Z-char 6 in A2 signals an escape, not output", () => {
    const result = translateZCharacter(6, { current: 2, lock: 0 }, 5);
    expect(result.type).toBe("escape");
  });

  test("Z-char 7 in A2 is newline in V5", () => {
    const result = translateZCharacter(7, { current: 2, lock: 0 }, 5);
    expect(result).toMatchObject({ type: "output", zscii: 13 });
  });

  test("Z-char 7 in A2 is '<' in V1", () => {
    const result = translateZCharacter(7, { current: 2, lock: 0 }, 1);
    expect(result).toMatchObject({ type: "output", zscii: 60 });
  });
});

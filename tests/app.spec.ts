import { describe, test, expect } from "vitest";
import {
  decodeZString,
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

describe("decodeZString", () => {
  test("decodes a single-word string ending immediately", () => {
    // Z-chars: 6, 9, 14 (a=6->'a'? let's use simple known values)
    // word: end-bit=1, first=6, second=9, third=14
    const mockStory = new Uint8Array(2);
    const word = (1 << 15) | (6 << 10) | (9 << 5) | 14;

    mockStory[0] = (word >> 8) & 0xff;
    mockStory[1] = word & 0xff;

    const result = decodeZString(mockStory, 0, 5, 0);

    expect(result.wordsConsumed).toBe(1);
    expect(result.tokens).toEqual([
      { type: "zscii", value: 97 }, // 'a' (A0, zchar 6)
      { type: "zscii", value: 100 }, // 'd' (A0, zchar 9)
      { type: "zscii", value: 105 }, // 'i' (A0, zchar 14)
    ]);
  });

  test("carries state across a word boundary (shift-lock persists into next word)", () => {
    // Word 1 (V1): zchar 4 (shift-lock to A1), zchar 6 ('A'), zchar 6 ('A'), end-bit=0
    const mockStory = new Uint8Array(4);
    const word1 = (0 << 15) | (4 << 10) | (6 << 5) | 6;

    mockStory[0] = (word1 >> 8) & 0xff;
    mockStory[1] = word1 & 0xff;

    // Word 2 (V1): zchar 6 ('A' still, since lock persisted), zchar 0, zchar 0, end-bit=1
    const word2 = (1 << 15) | (6 << 10) | (0 << 5) | 0;

    mockStory[2] = (word2 >> 8) & 0xff;
    mockStory[3] = word2 & 0xff;

    const result = decodeZString(mockStory, 0, 1, 0);

    // zchar 4 -> shift, no token. Then 'A','A' from word1, then 'A' from word2 (lock held!), then two spaces.
    expect(result.tokens.map((t: any) => t.value)).toEqual([65, 65, 65, 32, 32]);
    expect(result.wordsConsumed).toBe(2);
  });
});

describe("decodeZString with abbreviation resolution", () => {
  test("resolves a simple abbreviation reference and reports wordsConsumed", () => {
    const mockStory = new Uint8Array(68);
    mockStory[0x00] = 0x00;
    mockStory[0x01] = 0x20; // entry 0 -> word addr 0x20 -> byte 0x40

    const word = (1 << 15) | (25 << 10) | (13 << 5) | 10; // "the", end-bit set
    mockStory[0x40] = (word >> 8) & 0xff;
    mockStory[0x41] = word & 0xff;

    const mainWord = (1 << 15) | (1 << 10) | (0 << 5) | 0; // trigger, index=0, pad, end-bit=1
    mockStory[0x42] = (mainWord >> 8) & 0xff;
    mockStory[0x43] = mainWord & 0xff;

    const result = decodeZString(mockStory, 0x42, 5, 0x00);

    expect(result.tokens.map((t) => t.value)).toEqual([116, 104, 101, 32]); // "the" + ONE trailing space
    expect(result.wordsConsumed).toBe(1); // the OUTER string is only 1 word; the inner abbreviation's length doesn't count here
  });

  test("flags recursive abbreviation use as an error rather than recursing", () => {
    const mockStory = new Uint8Array(70);
    mockStory[0x00] = 0x00;
    mockStory[0x01] = 0x20;

    const innerWord = (1 << 15) | (1 << 10) | (0 << 5) | 0;
    mockStory[0x40] = (innerWord >> 8) & 0xff;
    mockStory[0x41] = innerWord & 0xff;

    const mainWord = (1 << 15) | (1 << 10) | (0 << 5) | 0;
    mockStory[0x42] = (mainWord >> 8) & 0xff;
    mockStory[0x43] = mainWord & 0xff;

    const result = decodeZString(mockStory, 0x42, 5, 0x00);
    expect(result.tokens[0]?.type).toBe("abbreviationError");
  });
});

describe("decodeZString with escape resolution", () => {
  test("resolves a full ZSCII escape into a single 10-bit code", () => {
    // Word 1: zchar 5 (single-shift A0->A2), zchar 6 (escape trigger), zchar 4 (top 5 bits), end-bit=0
    const mockStory = new Uint8Array(4);
    const word1 = (0 << 15) | (5 << 10) | (6 << 5) | 4;
    mockStory[0] = (word1 >> 8) & 0xff;
    mockStory[1] = word1 & 0xff;

    // Word 2: zchar 27 (bottom 5 bits), zchar 0, zchar 0, end-bit=1
    const word2 = (1 << 15) | (27 << 10) | (0 << 5) | 0;
    mockStory[2] = (word2 >> 8) & 0xff;
    mockStory[3] = word2 & 0xff;

    const result = decodeZString(mockStory, 0, 3, 0);

    // (4 << 5) | 27 = 128 + 27 = 155
    expect(result.tokens.map((t) => t.value)).toEqual([155, 32, 32]);
    expect(result.wordsConsumed).toBe(2);
  });

  test("ignores an incomplete trailing escape construction", () => {
    // zchar 0 (space), zchar 5 (shift to A2), zchar 6 (escape trigger) -- then nothing
    const mockStory = new Uint8Array(2);
    const word = (1 << 15) | (0 << 10) | (5 << 5) | 6;
    mockStory[0] = (word >> 8) & 0xff;
    mockStory[1] = word & 0xff;

    const result = decodeZString(mockStory, 0, 3, 0);

    // Only the leading space should appear; the incomplete escape produces nothing
    expect(result.tokens.map((t) => t.value)).toEqual([32]);
  });
});

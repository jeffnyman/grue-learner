import { describe, test, expect } from "vitest";
import { unpackWord } from "../src/app.ts";

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

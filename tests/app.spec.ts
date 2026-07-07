import { describe, test, expect } from "vitest";
import { readMemoryMap, readVersion, validateDynamicMemoryMinimum } from "../src/app.js";

describe("readVersion", () => {
  test("reads a valid version byte", () => {
    const mockStory = new Uint8Array([3, 0, 0, 0]);
    expect(readVersion(mockStory)).toBe(3);
  });

  test("rejects an illegal version byte", () => {
    const mockStory = new Uint8Array([9, 0, 0, 0]);
    expect(() => readVersion(mockStory)).toThrow();
  });
});

describe("readMemoryMap", () => {
  // prettier-ignore
  test("reads all five pointers correctly", () => {
    const mockStory = new Uint8Array(16);

    mockStory[0x04] = 0x12; mockStory[0x05] = 0x34; // highMemoryBase = 0x1234
    mockStory[0x08] = 0x00; mockStory[0x09] = 0xaa; // dictionaryAddress = 0x00AA
    mockStory[0x0a] = 0x00; mockStory[0x0b] = 0xbb; // objectTableAddress = 0x00BB
    mockStory[0x0c] = 0x00; mockStory[0x0d] = 0xcc; // globalsAddress = 0x00CC
    mockStory[0x0e] = 0x00; mockStory[0x0f] = 0xdd; // staticMemoryBase = 0x00DD

    const map = readMemoryMap(mockStory);

    expect(map.highMemoryBase).toBe(0x1234);
    expect(map.dictionaryAddress).toBe(0x00aa);
    expect(map.objectTableAddress).toBe(0x00bb);
    expect(map.globalsAddress).toBe(0x00cc);
    expect(map.staticMemoryBase).toBe(0x00dd);
  })
});

describe("validateDynamicMemoryMinimum", () => {
  test("passes when staticMemoryBase is exactly 64", () => {
    const result = validateDynamicMemoryMinimum(64);
    expect(result.passed).toBe(true);
  });

  test("passes when staticMemoryBase is well above 64", () => {
    const result = validateDynamicMemoryMinimum(0x3b3e);
    expect(result.passed).toBe(true);
  });

  test("fails when staticMemoryBase is below 64", () => {
    const result = validateDynamicMemoryMinimum(32);
    expect(result.passed).toBe(false);
  });
});

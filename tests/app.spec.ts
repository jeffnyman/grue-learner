import { describe, test, expect } from "vitest";
import {
  decodeFlags1,
  decodeFlags1Conventions,
  decodeFlags2,
  readConventionalIdentifiers,
  readInformVersionField,
  readMemoryMap,
  readRawFlags,
  readVersion,
  validateDynamicMemoryMinimum,
  validateDynamicStaticMaximum,
  validateHighDynamicNonOverlap,
  validateMemoryMap,
  validateStaticMemoryCeiling,
  type MemoryMap,
} from "../src/app.js";

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

describe("validateStaticMemoryCeiling", () => {
  test("passes when staticMemoryBase is well within a small file", () => {
    const result = validateStaticMemoryCeiling(0x3b3e, 105264);
    expect(result.passed).toBe(true);
  });

  test("passes when staticMemoryBase sits right at the file's end", () => {
    const result = validateStaticMemoryCeiling(1000, 1000);
    expect(result.passed).toBe(true);
  });

  test("fails when staticMemoryBase exceeds the file length", () => {
    const result = validateStaticMemoryCeiling(2000, 1000);
    expect(result.passed).toBe(false);
  });

  test("fails when staticMemoryBase exceeds the 64K ceiling, even in a huge file", () => {
    const result = validateStaticMemoryCeiling(0x10001, 500000);
    expect(result.passed).toBe(false);
  });
});

describe("validateHighDynamicNonOverlap", () => {
  test("passes when highMemoryBase equals staticMemoryBase (full overlap with static, none with dynamic)", () => {
    const result = validateHighDynamicNonOverlap(0x3b3e, 0x3b3e);
    expect(result.passed).toBe(true);
  });

  test("passes when highMemoryBase is comfortably after staticMemoryBase", () => {
    const result = validateHighDynamicNonOverlap(0x6059, 0x3b3e);
    expect(result.passed).toBe(true);
  });

  test("fails when highMemoryBase falls before staticMemoryBase", () => {
    const result = validateHighDynamicNonOverlap(1000, 2000);
    expect(result.passed).toBe(false);
  });
});

describe("validateDynamicStaticMaximum", () => {
  test("passes when staticMemoryBase is well within a small file", () => {
    const result = validateDynamicStaticMaximum(0x3b3e, 105264);
    expect(result.passed).toBe(true);
  });

  test("passes when staticMemoryBase sits exactly at the 65534 ceiling", () => {
    const result = validateDynamicStaticMaximum(65534, 500000);
    expect(result.passed).toBe(true);
  });

  test("fails when staticMemoryBase is 65535 — one byte past the documented max", () => {
    const result = validateDynamicStaticMaximum(65535, 500000);
    expect(result.passed).toBe(false);
  });

  test("still respects fileLength as the tighter bound in a small file", () => {
    const result = validateDynamicStaticMaximum(2000, 1000);
    expect(result.passed).toBe(false);
  });
});

describe("validateMemoryMap", () => {
  test("returns 4 results, all passing, for a well-formed memory map", () => {
    const map: MemoryMap = {
      highMemoryBase: 0x6059,
      dictionaryAddress: 0x47fe,
      objectTableAddress: 0x03fc,
      globalsAddress: 0x02b0,
      staticMemoryBase: 0x3b3e,
    };
    const results = validateMemoryMap(map, 105264);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  test("surfaces multiple simultaneous failures, not just the first", () => {
    const map: MemoryMap = {
      highMemoryBase: 100, // will fail non-overlap check
      dictionaryAddress: 0,
      objectTableAddress: 0,
      globalsAddress: 0,
      staticMemoryBase: 65535, // will fail dynamic+static maximum check
    };
    const results = validateMemoryMap(map, 500000);

    const failures = results.filter((r) => !r.passed);
    expect(failures.length).toBeGreaterThanOrEqual(2);
  });
});

describe("readRawFlags", () => {
  test("reads flags1 and flags2 correctly", () => {
    const mockStory = new Uint8Array(18);

    mockStory[0x01] = 0b01010101; // arbitrary flags1 pattern
    mockStory[0x10] = 0x00;
    mockStory[0x11] = 0b00010011; // arbitrary flags2 low byte pattern

    const flags = readRawFlags(mockStory);

    expect(flags.flags1).toBe(0b01010101);
    expect(flags.flags2).toBe(0x0013);
  });
});

describe("decodeFlags2", () => {
  test("marks bit 4 as set but NOT applicable for a V3 story file", () => {
    const results = decodeFlags2(0b0000000000010000, 3); // Lurking Horror r219 pattern
    const undoBit = results.find((r) => r.name === "wantsUndo")!;

    expect(undoBit.set).toBe(true);
    expect(undoBit.applicable).toBe(false); // this is the whole point
  });

  test("marks bit 4 as set AND applicable for a V5 story file", () => {
    const results = decodeFlags2(0b0000000010010000, 5); // Sherlock pattern
    const undoBit = results.find((r) => r.name === "wantsUndo")!;

    expect(undoBit.set).toBe(true);
    expect(undoBit.applicable).toBe(true);
  });

  test("marks bit 0 (transcripting) as applicable at every version", () => {
    const resultsV1 = decodeFlags2(0b1, 1);
    const resultsV8 = decodeFlags2(0b1, 8);

    expect(resultsV1.find((r) => r.name === "transcriptingOn")!.applicable).toBe(true);
    expect(resultsV8.find((r) => r.name === "transcriptingOn")!.applicable).toBe(true);
  });
});

describe("decodeFlags1", () => {
  test("uses the V1-3 table for a V3 file", () => {
    const results = decodeFlags1(0b00000010, 3); // bit 1 set
    const statusLine = results.find((r) => r.name === "statusLineIsTimeBased")!;

    expect(statusLine.set).toBe(true);
    expect(statusLine.applicable).toBe(true);
    expect(results.some((r) => r.name === "coloursAvailable")).toBe(false); // V4+ concept shouldn't appear
  });

  test("uses the V4+ table for a V5 file", () => {
    const results = decodeFlags1(0b00000001, 5); // bit 0 set
    const colours = results.find((r) => r.name === "coloursAvailable")!;

    expect(colours.set).toBe(true);
    expect(colours.applicable).toBe(true);
    expect(results.some((r) => r.name === "statusLineIsTimeBased")).toBe(false); // V1-3 concept shouldn't appear
  });

  test("marks V6-only bits as not applicable for a V4 file", () => {
    const results = decodeFlags1(0b00100000, 4); // bit 5 (sound) set
    const sound = results.find((r) => r.name === "soundEffectsAvailable")!;

    expect(sound.set).toBe(true);
    expect(sound.applicable).toBe(false); // sound needs V6, this is V4
  });
});

describe("decodeFlags1Conventions", () => {
  test("detects the Tandy bit when set on a V3 file", () => {
    const results = decodeFlags1Conventions(0b00001000, 3); // bit 3 set
    const tandy = results.find((r) => r.name === "tandyBit")!;

    expect(tandy.set).toBe(true);
  });

  test("omits the Tandy bit entirely for a V6 file", () => {
    const results = decodeFlags1Conventions(0b00001000, 6); // bit 3 set, but V6
    expect(results.some((r) => r.name === "tandyBit")).toBe(false);
  });
});

describe("readConventionalIdentifiers", () => {
  test("reads release number and serial code correctly", () => {
    const mockStory = new Uint8Array(24);

    mockStory[0x02] = 0x00;
    mockStory[0x03] = 0x17; // release number = 23

    const serial = "840509"; // Zork I release 76's actual serial, per Appendix D's table
    for (let i = 0; i < 6; i++) {
      mockStory[0x12 + i] = serial.charCodeAt(i);
    }

    const result = readConventionalIdentifiers(mockStory);

    expect(result.releaseNumber).toBe(23);
    expect(result.serialCode).toBe("840509");
  });
});

describe("readInformVersionField", () => {
  test("recognizes a valid Inform version string", () => {
    const mockStory = new Uint8Array(64);
    const version = "6.11";

    for (let i = 0; i < 4; i++) {
      mockStory[0x3c + i] = version.charCodeAt(i);
    }

    const result = readInformVersionField(mockStory);

    expect(result.raw).toBe("6.11");
    expect(result.looksLikeInform6).toBe(true);
  });

  test("does not flag an all-zero field as Inform", () => {
    const mockStory = new Uint8Array(64); // all zeros by default
    const result = readInformVersionField(mockStory);

    expect(result.looksLikeInform6).toBe(false);
  });
});

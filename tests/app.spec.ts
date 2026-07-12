import { describe, test, expect } from "vitest";
import {
  decodeForm,
  decodeInstruction,
  decodeOpcodeNumber,
  decodeOperandCount,
  decodeOperandTypes,
  decodeVariableFormOperandTypes,
  hasBranchByte,
  hasStoreByte,
  interpretBranch,
  isDoubleVariableOpcode,
  readBranchByteIfPresent,
  readOpcodeNumber,
  readOperand,
  readOperands,
  readOperandTypes,
  readRawBranchInfo,
  readStoreByte,
  readStoreByteIfPresent,
  readTextArgument,
  type OperandType,
  type RawBranchInfo,
} from "../src/app.ts";

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

describe("decodeOperandCount", () => {
  test("long form is always 2OP", () => {
    expect(decodeOperandCount(0x05, "long")).toBe("2OP");
    expect(decodeOperandCount(0x3f, "long")).toBe("2OP");
  });

  test("extended form is always VAR", () => {
    expect(decodeOperandCount(0xbe, "extended")).toBe("VAR");
  });

  test("short form with type bits 11 is 0OP", () => {
    expect(decodeOperandCount(0xb0, "short")).toBe("0OP"); // %10110000
  });

  test("short form with type bits 00 (large constant) is 1OP", () => {
    expect(decodeOperandCount(0x8f, "short")).toBe("1OP");
  });

  test("short form with type bits 01 (small constant) is 1OP", () => {
    expect(decodeOperandCount(0x9f, "short")).toBe("1OP");
  });

  test("short form with type bits 10 (variable) is 1OP", () => {
    expect(decodeOperandCount(0xaf, "short")).toBe("1OP");
  });

  test("variable form with bit 5 clear is 2OP", () => {
    expect(decodeOperandCount(0xc1, "variable")).toBe("2OP"); // je as 2OP
  });

  test("variable form with bit 5 set is VAR", () => {
    expect(decodeOperandCount(0xe0, "variable")).toBe("VAR"); // call_vs as VAR
  });
});

describe("decodeOperandTypes", () => {
  describe("long form", () => {
    test("both bits 0 → small constant, small constant", () => {
      expect(decodeOperandTypes(0x05, "long", "2OP")).toEqual(["small constant", "small constant"]);
    });

    test("bit6=1, bit5=0 → variable, small constant", () => {
      expect(decodeOperandTypes(0x45, "long", "2OP")).toEqual(["variable", "small constant"]);
    });

    test("bit6=0, bit5=1 → small constant, variable", () => {
      expect(decodeOperandTypes(0x25, "long", "2OP")).toEqual(["small constant", "variable"]);
    });

    test("both bits 1 → variable, variable", () => {
      expect(decodeOperandTypes(0x65, "long", "2OP")).toEqual(["variable", "variable"]);
    });
  });

  describe("short form", () => {
    test("0OP yields no operand types", () => {
      expect(decodeOperandTypes(0xb0, "short", "0OP")).toEqual([]);
    });

    test("type bits 00 → large constant", () => {
      expect(decodeOperandTypes(0x8f, "short", "1OP")).toEqual(["large constant"]);
    });

    test("type bits 01 → small constant", () => {
      expect(decodeOperandTypes(0x9f, "short", "1OP")).toEqual(["small constant"]);
    });

    test("type bits 10 → variable", () => {
      expect(decodeOperandTypes(0xaf, "short", "1OP")).toEqual(["variable"]);
    });
  });

  describe("unsupported forms", () => {
    test("throws for variable form (not yet implemented)", () => {
      expect(() => decodeOperandTypes(0xe0, "variable", "VAR")).toThrow();
    });

    test("throws for extended form (not yet implemented)", () => {
      expect(() => decodeOperandTypes(0xbe, "extended", "VAR")).toThrow();
    });
  });
});

describe("decodeVariableFormOperandTypes", () => {
  test("all four fields present, mixed types", () => {
    // %00 01 10 01 → large constant, small constant, variable, small constant
    const typeByte = 0b00011001;
    expect(decodeVariableFormOperandTypes(typeByte)).toEqual([
      "large constant",
      "small constant",
      "variable",
      "small constant",
    ]);
  });

  test("all four fields omitted yields no operands", () => {
    const typeByte = 0b11111111;
    expect(decodeVariableFormOperandTypes(typeByte)).toEqual([]);
  });

  test("stops at first omitted field (one operand)", () => {
    // %10 11 11 11 → variable, then omitted stops reading
    const typeByte = 0b10111111;
    expect(decodeVariableFormOperandTypes(typeByte)).toEqual(["variable"]);
  });

  test("stops at first omitted field (two operands)", () => {
    // %01 00 11 11 → small constant, large constant, then omitted stops reading
    const typeByte = 0b01001111;
    expect(decodeVariableFormOperandTypes(typeByte)).toEqual(["small constant", "large constant"]);
  });

  test("stops at first omitted field (three operands)", () => {
    // %10 10 01 11 → variable, variable, small constant, then omitted stops reading
    const typeByte = 0b10100111;
    expect(decodeVariableFormOperandTypes(typeByte)).toEqual([
      "variable",
      "variable",
      "small constant",
    ]);
  });

  test("large constant field decodes correctly in each position", () => {
    // %00 00 00 00 → four large constants
    const typeByte = 0b00000000;
    expect(decodeVariableFormOperandTypes(typeByte)).toEqual([
      "large constant",
      "large constant",
      "large constant",
      "large constant",
    ]);
  });
});

describe("readOperandTypes", () => {
  test("delegates to decodeOperandTypes for long form (no memory read)", () => {
    const mockStory = new Uint8Array(10);
    const opcodeByte = 0x05;
    const result = readOperandTypes(mockStory, opcodeByte, 0x00, "long", "2OP");
    expect(result).toEqual({
      types: ["small constant", "small constant"],
      typeInfoBytesConsumed: 0,
    });
  });

  test("delegates to decodeOperandTypes for short form (no memory read)", () => {
    const mockStory = new Uint8Array(10);
    const opcodeByte = 0x8f;
    const result = readOperandTypes(mockStory, opcodeByte, 0x00, "short", "1OP");
    expect(result).toEqual({
      types: ["large constant"],
      typeInfoBytesConsumed: 0,
    });
  });

  test("reads the type byte immediately after the opcode for variable form", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x02;
    mockStory[opcodeAddress] = 0xe0;
    mockStory[opcodeAddress + 1] = 0b01101111;

    const result = readOperandTypes(mockStory, 0xe0, opcodeAddress, "variable", "VAR");
    expect(result).toEqual({
      types: ["small constant", "variable"],
      typeInfoBytesConsumed: 1,
    });
  });

  test("variable form reads type byte at the correct offset, not address 0", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0] = 0b11111111;
    const opcodeAddress = 0x05;
    mockStory[opcodeAddress + 1] = 0b00000000;

    const result = readOperandTypes(mockStory, 0xe0, opcodeAddress, "variable", "VAR");
    expect(result).toEqual({
      types: ["large constant", "large constant", "large constant", "large constant"],
      typeInfoBytesConsumed: 1,
    });
  });
});

describe("readOperandTypes — double-variable opcodes", () => {
  test("call_vs2 (opcode 12) reads a second type byte when first is full", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0b11101100;
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b00011000;
    mockStory[opcodeAddress + 2] = 0b01101111;

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual({
      types: [
        "large constant",
        "small constant",
        "variable",
        "large constant",
        "small constant",
        "variable",
      ],
      typeInfoBytesConsumed: 2,
    });
  });

  test("call_vn2 (opcode 26) also triggers the second type byte", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0b11111010;
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b00000000;
    mockStory[opcodeAddress + 2] = 0b11111111;

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual({
      types: ["large constant", "large constant", "large constant", "large constant"],
      typeInfoBytesConsumed: 2,
    });
  });

  test("call_vs2 with fewer than 4 operands does NOT read a second type byte", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0b11101100;
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b10111111;
    mockStory[opcodeAddress + 2] = 0xff;

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual({
      types: ["variable"],
      typeInfoBytesConsumed: 1,
    });
  });

  test("an ordinary VAR opcode (not 12 or 26) never reads a second type byte, even if first is full", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0xe0;
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b00000000;
    mockStory[opcodeAddress + 2] = 0b01010101;

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual({
      types: ["large constant", "large constant", "large constant", "large constant"],
      typeInfoBytesConsumed: 1,
    });
  });
});

describe("readOperandTypes — extended form", () => {
  test("reads the type byte at opcodeAddress + 2 (skipping the opcode-number byte)", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    mockStory[opcodeAddress] = 0xbe;
    mockStory[opcodeAddress + 1] = 0x09;
    mockStory[opcodeAddress + 2] = 0b00011011;

    const result = readOperandTypes(mockStory, 0xbe, opcodeAddress, "extended", "VAR");
    expect(result).toEqual({
      types: ["large constant", "small constant", "variable"],
      typeInfoBytesConsumed: 1,
    });
  });

  test("does not read the type byte at opcodeAddress + 1 by mistake", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    mockStory[opcodeAddress] = 0xbe;
    mockStory[opcodeAddress + 1] = 0xff;
    mockStory[opcodeAddress + 2] = 0b00000000;

    const result = readOperandTypes(mockStory, 0xbe, opcodeAddress, "extended", "VAR");
    expect(result).toEqual({
      types: ["large constant", "large constant", "large constant", "large constant"],
      typeInfoBytesConsumed: 1,
    });
  });

  test("extended form respects the same stop-at-omitted rule", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x03;
    mockStory[opcodeAddress] = 0xbe;
    mockStory[opcodeAddress + 1] = 0x00;
    mockStory[opcodeAddress + 2] = 0b11111111;

    const result = readOperandTypes(mockStory, 0xbe, opcodeAddress, "extended", "VAR");
    expect(result).toEqual({
      types: [],
      typeInfoBytesConsumed: 1,
    });
  });
});

describe("readOperand", () => {
  test("reads a large constant as a 2-byte big-endian word", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x02] = 0x03;
    mockStory[0x03] = 0xe8; // 0x03e8 = 1000

    const result = readOperand(mockStory, 0x02, "large constant");
    expect(result).toEqual({ type: "large constant", value: 1000, bytesConsumed: 2 });
  });

  test("reads a small constant as a single byte", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x05] = 42;

    const result = readOperand(mockStory, 0x05, "small constant");
    expect(result).toEqual({ type: "small constant", value: 42, bytesConsumed: 1 });
  });

  test("reads a variable operand as a raw variable number, not a resolved value", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x07] = 0x02; // variable number 2 (a local variable), not "the value of local 2"

    const result = readOperand(mockStory, 0x07, "variable");
    expect(result).toEqual({ type: "variable", value: 2, bytesConsumed: 1 });
  });

  test("throws when asked to read an omitted operand", () => {
    const mockStory = new Uint8Array(10);
    expect(() => readOperand(mockStory, 0x00, "omitted")).toThrow();
  });

  test("large constant read does not overrun into unrelated adjacent bytes", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xff;
    mockStory[0x01] = 0x00;
    mockStory[0x02] = 0xff; // if bytesConsumed math were wrong, this could bleed in

    const result = readOperand(mockStory, 0x00, "large constant");
    expect(result).toEqual({ type: "large constant", value: 0xff00, bytesConsumed: 2 });
  });
});

describe("readOperands", () => {
  test("reads zero operands for an empty type list", () => {
    const mockStory = new Uint8Array(10);
    const result = readOperands(mockStory, 0x00, []);
    expect(result).toEqual({ operands: [], totalBytesConsumed: 0 });
  });

  test("reads a single small constant operand", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 99;

    const result = readOperands(mockStory, 0x00, ["small constant"]);
    expect(result).toEqual({
      operands: [{ type: "small constant", value: 99, bytesConsumed: 1 }],
      totalBytesConsumed: 1,
    });
  });

  test("reads a mix of types in sequence, advancing the address correctly", () => {
    const mockStory = new Uint8Array(10);
    // large constant at 0x00-0x01: 0x1234
    mockStory[0x00] = 0x12;
    mockStory[0x01] = 0x34;
    // variable at 0x02
    mockStory[0x02] = 0x05;
    // small constant at 0x03
    mockStory[0x03] = 0x07;

    const types: OperandType[] = ["large constant", "variable", "small constant"];
    const result = readOperands(mockStory, 0x00, types);

    expect(result).toEqual({
      operands: [
        { type: "large constant", value: 0x1234, bytesConsumed: 2 },
        { type: "variable", value: 0x05, bytesConsumed: 1 },
        { type: "small constant", value: 0x07, bytesConsumed: 1 },
      ],
      totalBytesConsumed: 4,
    });
  });

  test("starts reading from a nonzero startAddress, not always from 0", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xff; // poison — should never be read
    mockStory[0x06] = 0x2a;

    const result = readOperands(mockStory, 0x06, ["small constant"]);
    expect(result).toEqual({
      operands: [{ type: "small constant", value: 0x2a, bytesConsumed: 1 }],
      totalBytesConsumed: 1,
    });
  });

  test("four large constants advance the address by 8 total bytes", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x00;
    mockStory[0x01] = 0x01;
    mockStory[0x02] = 0x00;
    mockStory[0x03] = 0x02;
    mockStory[0x04] = 0x00;
    mockStory[0x05] = 0x03;
    mockStory[0x06] = 0x00;
    mockStory[0x07] = 0x04;

    const types: OperandType[] = [
      "large constant",
      "large constant",
      "large constant",
      "large constant",
    ];
    const result = readOperands(mockStory, 0x00, types);

    expect(result.operands.map((o) => o.value)).toEqual([1, 2, 3, 4]);
    expect(result.totalBytesConsumed).toBe(8);
  });
});

describe("decodeOpcodeNumber", () => {
  test("long form: bottom 5 bits", () => {
    expect(decodeOpcodeNumber(0b00000101, "long")).toBe(5); // je-ish
    expect(decodeOpcodeNumber(0b01011111, "long")).toBe(31); // max long-form opcode number
  });

  test("short form: bottom 4 bits", () => {
    expect(decodeOpcodeNumber(0b10110000, "short")).toBe(0); // rtrue
    expect(decodeOpcodeNumber(0b10111111, "short")).toBe(15); // max short-form opcode number
  });

  test("variable form: bottom 5 bits", () => {
    expect(decodeOpcodeNumber(0b11100001, "variable")).toBe(1); // je-as-VAR-ish
    expect(decodeOpcodeNumber(0b11111010, "variable")).toBe(26); // call_vn2
  });

  test("throws for extended form", () => {
    expect(() => decodeOpcodeNumber(0xbe, "extended")).toThrow();
  });
});

describe("readOpcodeNumber", () => {
  test("delegates to decodeOpcodeNumber for long/short/variable", () => {
    const mockStory = new Uint8Array(10);
    expect(readOpcodeNumber(mockStory, 0b00000101, 0x00, "long")).toBe(5);
    expect(readOpcodeNumber(mockStory, 0b10110000, 0x00, "short")).toBe(0);
    expect(readOpcodeNumber(mockStory, 0b11100001, 0x00, "variable")).toBe(1);
  });

  test("reads the second byte for extended form", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x04;
    mockStory[opcodeAddress] = 0xbe;
    mockStory[opcodeAddress + 1] = 0x09; // e.g. save_undo's extended opcode number

    expect(readOpcodeNumber(mockStory, 0xbe, opcodeAddress, "extended")).toBe(9);
  });
});

describe("isDoubleVariableOpcode (post-refactor)", () => {
  test("still correctly identifies call_vs2 and call_vn2", () => {
    expect(isDoubleVariableOpcode(0b11101100)).toBe(true); // opcode 12
    expect(isDoubleVariableOpcode(0b11111010)).toBe(true); // opcode 26
  });

  test("still correctly rejects an ordinary VAR opcode", () => {
    expect(isDoubleVariableOpcode(0xe0)).toBe(false); // opcode 0
  });
});

describe("readStoreByte", () => {
  test("reads variable number 0 (the stack)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x00;

    const result = readStoreByte(mockStory, 0x00);
    expect(result).toEqual({ variableNumber: 0, bytesConsumed: 1 });
  });

  test("reads a local variable number (1-15)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x05;

    const result = readStoreByte(mockStory, 0x00);
    expect(result).toEqual({ variableNumber: 5, bytesConsumed: 1 });
  });

  test("reads a global variable number (16-255)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x10; // 16, the first global

    const result = readStoreByte(mockStory, 0x00);
    expect(result).toEqual({ variableNumber: 16, bytesConsumed: 1 });
  });

  test("reads at a nonzero address, not always address 0", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xff; // poison — should not be read
    mockStory[0x06] = 42;

    const result = readStoreByte(mockStory, 0x06);
    expect(result).toEqual({ variableNumber: 42, bytesConsumed: 1 });
  });
});

describe("hasStoreByte", () => {
  test("call (VAR, encoded opcode 0) stores", () => {
    expect(hasStoreByte("VAR", 0, 3)).toBe(true);
  });

  test("storew (VAR, encoded opcode 1) does not store", () => {
    expect(hasStoreByte("VAR", 1, 3)).toBe(false);
  });

  test("add (2OP, encoded opcode 20) stores", () => {
    expect(hasStoreByte("2OP", 20, 3)).toBe(true);
  });

  test("test_attr (2OP, encoded opcode 10) does not store (it branches instead)", () => {
    expect(hasStoreByte("2OP", 10, 3)).toBe(false);
  });

  test("store (2OP, encoded opcode 13) does not store via a store byte", () => {
    expect(hasStoreByte("2OP", 13, 3)).toBe(false);
  });

  test("jz (1OP, encoded opcode 0) does not store", () => {
    expect(hasStoreByte("1OP", 0, 3)).toBe(false);
  });

  test("rfalse (0OP, encoded opcode 1) does not store", () => {
    expect(hasStoreByte("0OP", 1, 3)).toBe(false);
  });

  test("sread (VAR, encoded opcode 4) does not store in V3", () => {
    expect(hasStoreByte("VAR", 4, 3)).toBe(false);
  });

  test("sread (VAR, encoded opcode 4) does not store in V4 either", () => {
    expect(hasStoreByte("VAR", 4, 4)).toBe(false);
  });

  test("aread (VAR, encoded opcode 4) stores from V5 onward", () => {
    expect(hasStoreByte("VAR", 4, 5)).toBe(true);
    expect(hasStoreByte("VAR", 4, 8)).toBe(true);
  });

  test("throws for an opcode not yet in the seed table", () => {
    // random is VAR, encoded opcode 7 — genuinely unseeded in our table
    expect(() => hasStoreByte("VAR", 7, 3)).toThrow();
  });
});

describe("readStoreByteIfPresent", () => {
  test("returns the store target when the opcode stores (call, VAR encoded opcode 0)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x00; // store to the stack

    const result = readStoreByteIfPresent(mockStory, 0x00, "VAR", 0, 3);
    expect(result).toEqual({ variableNumber: 0, bytesConsumed: 1 });
  });

  test("returns null when the opcode does not store (storew, VAR encoded opcode 1)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xff; // poison — should never be read

    const result = readStoreByteIfPresent(mockStory, 0x00, "VAR", 1, 3);
    expect(result).toBeNull();
  });

  test("respects the version boundary for sread/aread (VAR encoded opcode 4)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x10; // would be global 16, if read

    expect(readStoreByteIfPresent(mockStory, 0x00, "VAR", 4, 4)).toBeNull();
    expect(readStoreByteIfPresent(mockStory, 0x00, "VAR", 4, 5)).toEqual({
      variableNumber: 16,
      bytesConsumed: 1,
    });
  });

  test("propagates the throw for an opcode not yet in the seed table", () => {
    const mockStory = new Uint8Array(10);
    // random is VAR, encoded opcode 7 — genuinely unseeded
    expect(() => readStoreByteIfPresent(mockStory, 0x00, "VAR", 7, 3)).toThrow();
  });

  test("reads at the given address, not always address 0", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xff; // poison
    mockStory[0x07] = 42;

    const result = readStoreByteIfPresent(mockStory, 0x07, "2OP", 20, 3); // add — unchanged, 2OP coincides
    expect(result).toEqual({ variableNumber: 42, bytesConsumed: 1 });
  });
});

describe("hasBranchByte", () => {
  test("test_attr (2OP, encoded opcode 10) branches", () => {
    expect(hasBranchByte("2OP", 10, 3)).toBe(true);
  });

  test("jz (1OP, encoded opcode 0) branches", () => {
    expect(hasBranchByte("1OP", 0, 3)).toBe(true);
  });

  test("jump (1OP, encoded opcode 12) does not branch, despite its name", () => {
    expect(hasBranchByte("1OP", 12, 3)).toBe(false);
  });

  test("add (2OP, encoded opcode 20) does not branch", () => {
    expect(hasBranchByte("2OP", 20, 3)).toBe(false);
  });

  test("call (VAR, encoded opcode 0) does not branch", () => {
    expect(hasBranchByte("VAR", 0, 3)).toBe(false);
  });

  test("rfalse (0OP, encoded opcode 1) does not branch", () => {
    expect(hasBranchByte("0OP", 1, 3)).toBe(false);
  });

  test("throws for an opcode not yet in the seed table", () => {
    // random is VAR, encoded opcode 7 — genuinely unseeded in our table
    expect(() => hasBranchByte("VAR", 7, 3)).toThrow();
  });
});

describe("readRawBranchInfo", () => {
  test("1-byte form, branch on false, offset 20", () => {
    const mockStory = new Uint8Array(10);
    // bit7=0 (false), bit6=1 (1-byte form), offset 20 = 0b010100
    mockStory[0x00] = 0b01010100;

    const result = readRawBranchInfo(mockStory, 0x00);
    expect(result).toEqual({ senseBit: false, offset: 20, bytesConsumed: 1 });
  });

  test("1-byte form, branch on true, offset 63 (max)", () => {
    const mockStory = new Uint8Array(10);
    // bit7=1 (true), bit6=1 (1-byte form), offset 63 = 0b111111
    mockStory[0x00] = 0b11111111;

    const result = readRawBranchInfo(mockStory, 0x00);
    expect(result).toEqual({ senseBit: true, offset: 63, bytesConsumed: 1 });
  });

  test("2-byte form, branch on true, small positive offset", () => {
    const mockStory = new Uint8Array(10);
    // bit7=1 (true), bit6=0 (2-byte form), high6=0b000000, low byte=0x0a → offset 10
    mockStory[0x00] = 0b10000000;
    mockStory[0x01] = 0x0a;

    const result = readRawBranchInfo(mockStory, 0x00);
    expect(result).toEqual({ senseBit: true, offset: 10, bytesConsumed: 2 });
  });

  test("2-byte form, branch on false, negative offset via sign extension", () => {
    const mockStory = new Uint8Array(10);
    // bit7=0 (false), bit6=0 (2-byte form), high6=0b111111, low byte=0xff
    // unsigned 14-bit = 0b11111111111111 = 16383 → signed = 16383 - 16384 = -1
    mockStory[0x00] = 0b00111111;
    mockStory[0x01] = 0xff;

    const result = readRawBranchInfo(mockStory, 0x00);
    expect(result).toEqual({ senseBit: false, offset: -1, bytesConsumed: 2 });
  });

  test("2-byte form, exactly at the sign boundary (8192 → most negative)", () => {
    const mockStory = new Uint8Array(10);
    // high6=0b100000 (0x20), low byte=0x00 → unsigned 0b10000000000000 = 8192 → signed = -8192
    mockStory[0x00] = 0b00100000;
    mockStory[0x01] = 0x00;

    const result = readRawBranchInfo(mockStory, 0x00);
    expect(result).toEqual({ senseBit: false, offset: -8192, bytesConsumed: 2 });
  });

  test("2-byte form, just below the sign boundary (8191 → still positive)", () => {
    const mockStory = new Uint8Array(10);
    // high6=0b011111 (0x1f), low byte=0xff → unsigned 0b01111111111111 = 8191 → signed = 8191
    mockStory[0x00] = 0b00011111;
    mockStory[0x01] = 0xff;

    const result = readRawBranchInfo(mockStory, 0x00);
    expect(result).toEqual({ senseBit: false, offset: 8191, bytesConsumed: 2 });
  });
});

describe("interpretBranch", () => {
  test("offset 0 means return false, regardless of sense or address", () => {
    const branchInfo: RawBranchInfo = { senseBit: true, offset: 0, bytesConsumed: 1 };
    expect(interpretBranch(branchInfo, 0x5000)).toEqual({ kind: "returnFalse" });
  });

  test("offset 1 means return true, regardless of sense or address", () => {
    const branchInfo: RawBranchInfo = { senseBit: false, offset: 1, bytesConsumed: 2 };
    expect(interpretBranch(branchInfo, 0x5000)).toEqual({ kind: "returnTrue" });
  });

  test("a real forward jump computes the correct target address (1-byte form)", () => {
    // Matches the spec's own worked example: inc_chk c 0 label, offset 20, label 18 bytes forward
    const branchInfo: RawBranchInfo = { senseBit: true, offset: 20, bytesConsumed: 1 };
    const branchStartAddress = 0x1000;
    // address after branch data = 0x1001; target = 0x1001 + 20 - 2 = 0x1013
    expect(interpretBranch(branchInfo, branchStartAddress)).toEqual({
      kind: "jump",
      targetAddress: 0x1013,
    });
  });

  test("a real jump using the 2-byte form's larger bytesConsumed", () => {
    const branchInfo: RawBranchInfo = { senseBit: false, offset: 100, bytesConsumed: 2 };
    const branchStartAddress = 0x2000;
    // address after branch data = 0x2002; target = 0x2002 + 100 - 2 = 0x2064
    expect(interpretBranch(branchInfo, branchStartAddress)).toEqual({
      kind: "jump",
      targetAddress: 0x2064,
    });
  });

  test("a negative offset computes a backward jump target", () => {
    const branchInfo: RawBranchInfo = { senseBit: true, offset: -10, bytesConsumed: 2 };
    const branchStartAddress = 0x3000;
    // address after branch data = 0x3002; target = 0x3002 + (-10) - 2 = 0x2ff6
    expect(interpretBranch(branchInfo, branchStartAddress)).toEqual({
      kind: "jump",
      targetAddress: 0x2ff6,
    });
  });
});

describe("readBranchByteIfPresent", () => {
  test("returns null when the opcode does not branch (add, 2OP encoded opcode 20)", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xff; // poison — should never be read

    const result = readBranchByteIfPresent(mockStory, 0x00, "2OP", 20, 3);
    expect(result).toBeNull();
  });

  test("returns a jump outcome when the opcode branches (jz, 1OP encoded opcode 0)", () => {
    const mockStory = new Uint8Array(32);
    const address = 0x10;
    // 1-byte form, branch on true, offset 20
    mockStory[address] = 0b11010100;

    const result = readBranchByteIfPresent(mockStory, address, "1OP", 0, 3);
    // address after branch data = 0x11; target = 0x11 + 20 - 2 = 0x23
    expect(result).toEqual({
      outcome: { kind: "jump", targetAddress: 0x23 },
      bytesConsumed: 1,
    });
  });

  test("returns returnFalse for offset 0 (test_attr, 2OP encoded opcode 10)", () => {
    const mockStory = new Uint8Array(48);
    const address = 0x20;
    // 1-byte form, offset 0
    mockStory[address] = 0b11000000;

    const result = readBranchByteIfPresent(mockStory, address, "2OP", 10, 3);
    expect(result).toEqual({
      outcome: { kind: "returnFalse" },
      bytesConsumed: 1,
    });
  });

  test("correctly reports bytesConsumed=2 for the 2-byte branch form", () => {
    const mockStory = new Uint8Array(64);
    const address = 0x30;
    // 2-byte form, branch on true, high6=0, low byte=10
    mockStory[address] = 0b10000000;
    mockStory[address + 1] = 0x0a;

    const result = readBranchByteIfPresent(mockStory, address, "1OP", 0, 3); // jz
    expect(result?.bytesConsumed).toBe(2);
    expect(result?.outcome.kind).toBe("jump");
  });

  test("propagates the throw for an opcode not yet in the seed table", () => {
    const mockStory = new Uint8Array(10);
    // random is VAR, encoded opcode 7 — genuinely unseeded
    expect(() => readBranchByteIfPresent(mockStory, 0x00, "VAR", 7, 3)).toThrow();
  });
});

describe("readTextArgument", () => {
  test("decodes a single-word string and reports 2 bytes consumed", () => {
    // Reusing the same known-good single-word fixture pattern from zstring.spec.ts
    const mockStory = new Uint8Array(2);
    const word = (1 << 15) | (6 << 10) | (9 << 5) | 14; // end-bit set, 'a','d','i' in A0

    mockStory[0] = (word >> 8) & 0xff;
    mockStory[1] = word & 0xff;

    const result = readTextArgument(mockStory, 0, 5, 0);

    expect(result.bytesConsumed).toBe(2);
    expect(result.tokens).toEqual([
      { type: "zscii", value: 97 }, // 'a'
      { type: "zscii", value: 100 }, // 'd'
      { type: "zscii", value: 105 }, // 'i'
    ]);
  });

  test("multi-word string reports bytesConsumed as wordsConsumed * 2", () => {
    // Two words: first with end-bit unset, second with end-bit set
    const mockStory = new Uint8Array(4);
    const word1 = (0 << 15) | (6 << 10) | (9 << 5) | 14;
    const word2 = (1 << 15) | (0 << 10) | (0 << 5) | 0;

    mockStory[0] = (word1 >> 8) & 0xff;
    mockStory[1] = word1 & 0xff;
    mockStory[2] = (word2 >> 8) & 0xff;
    mockStory[3] = word2 & 0xff;

    const result = readTextArgument(mockStory, 0, 5, 0);

    expect(result.bytesConsumed).toBe(4); // 2 words * 2 bytes
  });

  test("passes abbreviationsTableAddress through to decodeZString correctly", () => {
    // Word 1: zchar 1 (abbreviation trigger in V5), zchar 0 (z-index within set), then a filler zchar, end-bit unset would need a 2nd word — keep it simple: word ends here with end-bit set and a 3rd zchar of 5 (arbitrary, will decode independently)
    // Simpler approach: point abbreviationsTableAddress at a known entry and confirm no crash / correct resolution.
    const mockStory = new Uint8Array(20);
    const abbrevTableAddress = 0x00;

    // Abbreviation table entry 0 (z=1,x=0 -> index 0): points to word-address 0x02 (byte address 0x04)
    mockStory[0x00] = 0x00;
    mockStory[0x01] = 0x02;

    // The abbreviation's own text at byte address 0x04: single word, 'a' (zchar 6), end-bit set
    const abbrevWord = (1 << 15) | (6 << 10) | (5 << 5) | 5; // 'a', then two zchar-5 shifts (harmless filler)
    mockStory[0x04] = (abbrevWord >> 8) & 0xff;
    mockStory[0x05] = abbrevWord & 0xff;

    // Main string at byte address 0x08: zchar 1 (abbr trigger), zchar 0 (index calc: 32*(1-1)+0=0), filler, end-bit set
    const mainWord = (1 << 15) | (1 << 10) | (0 << 5) | 5;
    mockStory[0x08] = (mainWord >> 8) & 0xff;
    mockStory[0x09] = mainWord & 0xff;

    const result = readTextArgument(mockStory, 0x08, 5, abbrevTableAddress);

    expect(result.bytesConsumed).toBe(2); // main string is still just 1 word
    expect(result.tokens[0]).toEqual({ type: "zscii", value: 97 }); // 'a' resolved via abbreviation
  });
});

describe("decodeInstruction — narrow slice (0OP, no trailing arguments)", () => {
  test("decodes rfalse (0OP:177) with no operands, store, branch, or text", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xb1; // %10110001 — short form, 0OP, opcode number 1 (rfalse)

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "short",
      operandCount: "0OP",
      opcodeNumber: 1,
      operands: [],
      storeTarget: null,
      branchOutcome: null,
      branchBytesConsumed: null,
      text: null,
      nextInstructionAddress: 0x01, // just the 1 opcode byte
    });
  });

  test("decodes new_line (0OP:187) with no operands, store, branch, or text", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x05] = 0xbb; // %10111011 — short form, 0OP, opcode number 11 (new_line)

    const result = decodeInstruction(mockStory, 0x05, 3, 0x00);

    expect(result).toEqual({
      address: 0x05,
      form: "short",
      operandCount: "0OP",
      opcodeNumber: 11,
      operands: [],
      storeTarget: null,
      branchOutcome: null,
      branchBytesConsumed: null,
      text: null,
      nextInstructionAddress: 0x06, // just the 1 opcode byte, from a nonzero start address
    });
  });
});

describe("decodeInstruction — operands, no trailing arguments", () => {
  test("decodes insert_obj (2OP:14, long form) with two small-constant operands", () => {
    const mockStory = new Uint8Array(10);
    // long form: top two bits 00; opcode number 14 = 0b01110
    // both operand-type bits = 0 (small constant, small constant): 0b00001110 = 0x0e
    mockStory[0x00] = 0b00001110;
    mockStory[0x01] = 0x04; // operand 1: object 4
    mockStory[0x02] = 0xb4; // operand 2: object 180

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "long",
      operandCount: "2OP",
      opcodeNumber: 14,
      operands: [
        { type: "small constant", value: 0x04, bytesConsumed: 1 },
        { type: "small constant", value: 0xb4, bytesConsumed: 1 },
      ],
      storeTarget: null,
      branchOutcome: null,
      branchBytesConsumed: null,
      text: null,
      nextInstructionAddress: 0x03, // 1 opcode byte + 2 operand bytes
    });
  });

  test("decodes insert_obj at a nonzero start address, confirming operand cursor math", () => {
    const mockStory = new Uint8Array(20);
    const startAddress = 0x0a;
    mockStory[startAddress] = 0b00001110;
    mockStory[startAddress + 1] = 0x11;
    mockStory[startAddress + 2] = 0x22;

    const result = decodeInstruction(mockStory, startAddress, 3, 0x00);

    expect(result.operands).toEqual([
      { type: "small constant", value: 0x11, bytesConsumed: 1 },
      { type: "small constant", value: 0x22, bytesConsumed: 1 },
    ]);
    expect(result.nextInstructionAddress).toBe(0x0d); // startAddress + 3
  });
});

describe("decodeInstruction — operands with a store byte", () => {
  test("decodes add (2OP:20, variable form) with two operands and a store to the stack", () => {
    const mockStory = new Uint8Array(10);
    // variable form, count 2OP (bit5=0), opcode number 20 = 0b10100: 0b11010100 = 0xd4
    mockStory[0x00] = 0xd4;
    // type byte: large constant, small constant, omitted, omitted = 0b00011111
    mockStory[0x01] = 0b00011111;
    mockStory[0x02] = 0x03; // large constant high byte
    mockStory[0x03] = 0xe8; // large constant low byte (0x03e8 = 1000)
    mockStory[0x04] = 0x02; // small constant (2)
    mockStory[0x05] = 0x00; // store byte: variable 0 = stack

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "variable",
      operandCount: "2OP",
      opcodeNumber: 20,
      operands: [
        { type: "large constant", value: 1000, bytesConsumed: 2 },
        { type: "small constant", value: 2, bytesConsumed: 1 },
      ],
      storeTarget: { variableNumber: 0, bytesConsumed: 1 },
      branchOutcome: null,
      branchBytesConsumed: null,
      text: null,
      nextInstructionAddress: 0x06, // opcode(1) + type(1) + operands(2+1) + store(1)
    });
  });

  test("decodes add storing to a local variable, not just the stack", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0xd4;
    mockStory[0x01] = 0b01011111; // small constant, small constant, omitted, omitted
    mockStory[0x02] = 0x05;
    mockStory[0x03] = 0x0a;
    mockStory[0x04] = 0x03; // store byte: local variable 3

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result.storeTarget).toEqual({ variableNumber: 3, bytesConsumed: 1 });
    expect(result.nextInstructionAddress).toBe(0x05);
  });
});

describe("decodeInstruction — operands with a branch byte", () => {
  test("decodes test_attr (2OP:10, long form) with a 1-byte branch", () => {
    const mockStory = new Uint8Array(10);
    // long form, opcode number 10 = 0b01010, both operands small constant: 0b00001010 = 0x0a
    mockStory[0x00] = 0x0a;
    mockStory[0x01] = 0xb4; // object 180
    mockStory[0x02] = 0x03; // attribute 3
    // branch byte: bit7=1 (true), bit6=1 (1-byte), offset=10 = 0b11001010
    mockStory[0x03] = 0b11001010;

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "long",
      operandCount: "2OP",
      opcodeNumber: 10,
      operands: [
        { type: "small constant", value: 0xb4, bytesConsumed: 1 },
        { type: "small constant", value: 0x03, bytesConsumed: 1 },
      ],
      storeTarget: null,
      // address after branch data = 0x04; target = 0x04 + 10 - 2 = 0x0c
      branchOutcome: { kind: "jump", targetAddress: 0x0c },
      branchBytesConsumed: 1,
      text: null,
      nextInstructionAddress: 0x04, // opcode(1) + operands(1+1) + branch(1)
    });
  });

  test("decodes test_attr with a 2-byte branch, confirming the extra byte after operands", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x0a;
    mockStory[0x01] = 0xb4;
    mockStory[0x02] = 0x03;
    // branch byte: bit7=0 (false), bit6=0 (2-byte), high6=0, low byte=100
    mockStory[0x03] = 0b00000000;
    mockStory[0x04] = 100;

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    // address after branch data = 0x05; target = 0x05 + 100 - 2 = 0x67
    expect(result.branchOutcome).toEqual({ kind: "jump", targetAddress: 0x67 });
    expect(result.branchBytesConsumed).toBe(2);
    expect(result.nextInstructionAddress).toBe(0x05); // opcode(1) + operands(1+1) + branch(2)
  });
});

describe("decodeInstruction — text argument", () => {
  test("decodes print (0OP:2, short form) with a single-word text argument", () => {
    const mockStory = new Uint8Array(10);
    // short form, 0OP (bits 4-5 = 11), opcode number 2: 0b10110010 = 0xb2
    mockStory[0x00] = 0xb2;
    // Z-string "adi": end-bit set, zchar 6='a', zchar 9='d', zchar 14='i' (all A0)
    const word = (1 << 15) | (6 << 10) | (9 << 5) | 14;
    mockStory[0x01] = (word >> 8) & 0xff;
    mockStory[0x02] = word & 0xff;

    const result = decodeInstruction(mockStory, 0x00, 5, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "short",
      operandCount: "0OP",
      opcodeNumber: 2,
      operands: [],
      storeTarget: null,
      branchOutcome: null,
      branchBytesConsumed: null,
      text: [
        { type: "zscii", value: 97 }, // 'a'
        { type: "zscii", value: 100 }, // 'd'
        { type: "zscii", value: 105 }, // 'i'
      ],
      nextInstructionAddress: 0x03, // opcode(1) + text word(2)
    });
  });

  test("decodes print at a nonzero address, confirming the text-start cursor", () => {
    const mockStory = new Uint8Array(10);
    const startAddress = 0x04;
    mockStory[startAddress] = 0xb2;
    const word = (1 << 15) | (6 << 10) | (9 << 5) | 14;
    mockStory[startAddress + 1] = (word >> 8) & 0xff;
    mockStory[startAddress + 2] = word & 0xff;

    const result = decodeInstruction(mockStory, startAddress, 5, 0x00);

    expect(result.text).toEqual([
      { type: "zscii", value: 97 },
      { type: "zscii", value: 100 },
      { type: "zscii", value: 105 },
    ]);
    expect(result.nextInstructionAddress).toBe(0x07); // startAddress + 3
  });
});

describe("decodeInstruction — store and branch combined", () => {
  test("decodes get_child (1OP:130, short form) with both a store and a branch byte", () => {
    const mockStory = new Uint8Array(10);
    // short form, 1OP, small constant operand type (bits 4-5 = 01), opcode number 2: 0b10010010 = 0x92
    mockStory[0x00] = 0x92;
    mockStory[0x01] = 0xb4; // operand: object 180 (the parent object)
    mockStory[0x02] = 0x05; // store byte: local variable 5
    // branch byte: bit7=1 (true), bit6=1 (1-byte), offset=15
    mockStory[0x03] = 0b11001111;

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "short",
      operandCount: "1OP",
      opcodeNumber: 2,
      operands: [{ type: "small constant", value: 0xb4, bytesConsumed: 1 }],
      storeTarget: { variableNumber: 5, bytesConsumed: 1 },
      // address after branch data = 0x04; target = 0x04 + 15 - 2 = 0x11
      branchOutcome: { kind: "jump", targetAddress: 0x11 },
      branchBytesConsumed: 1,
      text: null,
      nextInstructionAddress: 0x04, // opcode(1) + operand(1) + store(1) + branch(1)
    });
  });

  test("decodes get_child where the branch means returnFalse, store still present", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0x00] = 0x92;
    mockStory[0x01] = 0x0a; // object 10
    mockStory[0x02] = 0x00; // store to stack
    // branch byte: bit7=1 (true), bit6=1 (1-byte), offset=0 -> returnFalse
    mockStory[0x03] = 0b11000000;

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result.storeTarget).toEqual({ variableNumber: 0, bytesConsumed: 1 });
    expect(result.branchOutcome).toEqual({ kind: "returnFalse" });
    expect(result.nextInstructionAddress).toBe(0x04);
  });
});

describe("decodeInstruction — real Zork I instruction (inc_chk)", () => {
  test("decodes inc_chk (2OP:5, variable form) with a variable-reference operand and a large constant", () => {
    const mockStory = new Uint8Array(10);
    // variable form, 2OP count (bit5=0), opcode number 5: 0b11000101 = 0xc5
    mockStory[0x00] = 0xc5;
    // type byte: small constant, large constant, omitted, omitted: 0b01001111 = 0x4f
    mockStory[0x01] = 0x4f;
    mockStory[0x02] = 0x12; // operand 1: variable reference number 18 (global G02)
    mockStory[0x03] = 0x03; // operand 2 high byte
    mockStory[0x04] = 0xe7; // operand 2 low byte (0x03e7 = 999)
    // branch byte: sense=false, 1-byte form, offset=15: 0b01001111 = 0x4f
    mockStory[0x05] = 0x4f;

    const result = decodeInstruction(mockStory, 0x00, 3, 0x00);

    expect(result).toEqual({
      address: 0x00,
      form: "variable",
      operandCount: "2OP",
      opcodeNumber: 5,
      operands: [
        { type: "small constant", value: 18, bytesConsumed: 1 }, // variable reference, not a literal
        { type: "large constant", value: 999, bytesConsumed: 2 },
      ],
      storeTarget: null,
      // address after branch data = 0x06; target = 0x06 + 15 - 2 = 0x13
      branchOutcome: { kind: "jump", targetAddress: 0x13 },
      branchBytesConsumed: 1,
      text: null,
      nextInstructionAddress: 0x06, // opcode(1) + type(1) + operands(1+2) + branch(1)
    });
  });
});

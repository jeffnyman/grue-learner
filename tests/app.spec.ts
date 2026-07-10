import { describe, test, expect } from "vitest";
import {
  decodeForm,
  decodeOperandCount,
  decodeOperandTypes,
  decodeVariableFormOperandTypes,
  readOperand,
  readOperandTypes,
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
    const mockStory = new Uint8Array(10); // deliberately empty/zeroed
    const opcodeByte = 0x05; // long form, both bits 0
    const result = readOperandTypes(mockStory, opcodeByte, 0x00, "long", "2OP");
    expect(result).toEqual(["small constant", "small constant"]);
  });

  test("delegates to decodeOperandTypes for short form (no memory read)", () => {
    const mockStory = new Uint8Array(10);
    const opcodeByte = 0x8f; // short form, 1OP, large constant
    const result = readOperandTypes(mockStory, opcodeByte, 0x00, "short", "1OP");
    expect(result).toEqual(["large constant"]);
  });

  test("reads the type byte immediately after the opcode for variable form", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x02;
    mockStory[opcodeAddress] = 0xe0; // the opcode byte itself, irrelevant to type decoding here
    mockStory[opcodeAddress + 1] = 0b01101111; // small constant, variable, then omitted (%11) stops reading

    const result = readOperandTypes(mockStory, 0xe0, opcodeAddress, "variable", "VAR");
    expect(result).toEqual(["small constant", "variable"]);
  });

  test("variable form reads type byte at the correct offset, not address 0", () => {
    const mockStory = new Uint8Array(10);
    mockStory[0] = 0b11111111; // if this were read by mistake, we'd get []
    const opcodeAddress = 0x05;
    mockStory[opcodeAddress + 1] = 0b00000000; // four large constants

    const result = readOperandTypes(mockStory, 0xe0, opcodeAddress, "variable", "VAR");
    expect(result).toEqual([
      "large constant",
      "large constant",
      "large constant",
      "large constant",
    ]);
  });
});

describe("readOperandTypes — double-variable opcodes", () => {
  test("call_vs2 (opcode 12) reads a second type byte when first is full", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0b11101100; // variable form, VAR count, opcode number 12 (call_vs2)
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b00011000; // large constant, small constant, variable, large constant (4 present)
    mockStory[opcodeAddress + 2] = 0b01101111; // small constant, variable, then omitted

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual([
      "large constant",
      "small constant",
      "variable",
      "large constant",
      "small constant",
      "variable",
    ]);
  });

  test("call_vn2 (opcode 26) also triggers the second type byte", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0b11111010; // variable form, VAR count, opcode number 26 (call_vn2)
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b00000000; // four large constants (all present)
    mockStory[opcodeAddress + 2] = 0b11111111; // all omitted → zero more operands

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual([
      "large constant",
      "large constant",
      "large constant",
      "large constant",
    ]);
  });

  test("call_vs2 with fewer than 4 operands does NOT read a second type byte", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0b11101100; // call_vs2
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b10111111; // variable, then omitted (only 1 operand)
    mockStory[opcodeAddress + 2] = 0xff; // poison byte — if read, would still yield [] anyway,
    // so this test alone doesn't prove non-reading; see next test for that.

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual(["variable"]);
  });

  test("an ordinary VAR opcode (not 12 or 26) never reads a second type byte, even if first is full", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    const opcodeByte = 0xe0; // opcode number 0 — not call_vs2/call_vn2
    mockStory[opcodeAddress] = opcodeByte;
    mockStory[opcodeAddress + 1] = 0b00000000; // four large constants, all present
    mockStory[opcodeAddress + 2] = 0b01010101; // if wrongly read: small constant x4 — would fail the test below

    const result = readOperandTypes(mockStory, opcodeByte, opcodeAddress, "variable", "VAR");
    expect(result).toEqual([
      "large constant",
      "large constant",
      "large constant",
      "large constant",
    ]);
  });
});

describe("readOperandTypes — extended form", () => {
  test("reads the type byte at opcodeAddress + 2 (skipping the opcode-number byte)", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    mockStory[opcodeAddress] = 0xbe; // extended form marker
    mockStory[opcodeAddress + 1] = 0x09; // opcode number (irrelevant to type decoding itself)
    mockStory[opcodeAddress + 2] = 0b00011011; // large constant, small constant, variable, then omitted

    const result = readOperandTypes(mockStory, 0xbe, opcodeAddress, "extended", "VAR");
    expect(result).toEqual(["large constant", "small constant", "variable"]);
  });

  test("does not read the type byte at opcodeAddress + 1 by mistake", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x00;
    mockStory[opcodeAddress] = 0xbe;
    mockStory[opcodeAddress + 1] = 0xff; // if wrongly read as the type byte, this would yield []
    mockStory[opcodeAddress + 2] = 0b00000000; // four large constants

    const result = readOperandTypes(mockStory, 0xbe, opcodeAddress, "extended", "VAR");
    expect(result).toEqual([
      "large constant",
      "large constant",
      "large constant",
      "large constant",
    ]);
  });

  test("extended form respects the same stop-at-omitted rule", () => {
    const mockStory = new Uint8Array(10);
    const opcodeAddress = 0x03;
    mockStory[opcodeAddress] = 0xbe;
    mockStory[opcodeAddress + 1] = 0x00;
    mockStory[opcodeAddress + 2] = 0b11111111; // all omitted

    const result = readOperandTypes(mockStory, 0xbe, opcodeAddress, "extended", "VAR");
    expect(result).toEqual([]);
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

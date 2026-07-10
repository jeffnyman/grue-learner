import { describe, test, expect } from "vitest";
import {
  decodeForm,
  decodeOperandCount,
  decodeOperandTypes,
  decodeVariableFormOperandTypes,
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

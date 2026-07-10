import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";

export type InstructionForm = "long" | "short" | "variable" | "extended";

export type OperandCount = "0OP" | "1OP" | "2OP" | "VAR";

export type OperandType = "large constant" | "small constant" | "variable" | "omitted";

export interface DecodedOperand {
  type: OperandType;
  value: number; // raw encoded value: the literal for constants, the variable number for "variable"
  bytesConsumed: number;
}

export interface ReadOperandsResult {
  operands: DecodedOperand[];
  totalBytesConsumed: number;
}

export function decodeOperandTypes(
  opcodeByte: number,
  form: InstructionForm,
  operandCount: OperandCount,
): OperandType[] {
  if (form === "long") {
    const firstBit = (opcodeByte >> 6) & 0b1;
    const secondBit = (opcodeByte >> 5) & 0b1;
    return [longFormBitToType(firstBit), longFormBitToType(secondBit)];
  }

  if (form === "short") {
    if (operandCount === "0OP") return [];

    const typeBits = (opcodeByte >> 4) & 0b11;
    return [twoBitToType(typeBits)];
  }

  throw new Error(`decodeOperandTypes: ${form} form not yet supported`);
}

function isDoubleVariableOpcode(opcodeByte: number): boolean {
  const opcodeNumber = opcodeByte & 0b00011111; // bottom 5 bits, per §4.3.3
  return opcodeNumber === 12 || opcodeNumber === 26; // call_vs2, call_vn2
}

function longFormBitToType(bit: number): OperandType {
  return bit === 0 ? "small constant" : "variable";
}

function twoBitToType(bits: number): OperandType {
  if (bits === 0b00) return "large constant";
  if (bits === 0b01) return "small constant";
  if (bits === 0b10) return "variable";
  return "omitted";
}

export function readOperands(
  storyData: Uint8Array,
  startAddress: number,
  types: OperandType[],
): ReadOperandsResult {
  const operands: DecodedOperand[] = [];
  let currentAddress = startAddress;

  for (const type of types) {
    const operand = readOperand(storyData, currentAddress, type);
    operands.push(operand);
    currentAddress += operand.bytesConsumed;
  }

  return {
    operands,
    totalBytesConsumed: currentAddress - startAddress,
  };
}

export function readOperand(
  storyData: Uint8Array,
  address: number,
  type: OperandType,
): DecodedOperand {
  if (type === "large constant") {
    return { type, value: readWord(storyData, address), bytesConsumed: 2 };
  }

  if (type === "small constant" || type === "variable") {
    return { type, value: readByte(storyData, address), bytesConsumed: 1 };
  }

  throw new Error(`readOperand: cannot read an "omitted" operand`);
}

export function readOperandTypes(
  storyData: Uint8Array,
  opcodeByte: number,
  opcodeAddress: number,
  form: InstructionForm,
  operandCount: OperandCount,
): OperandType[] {
  if (form === "long" || form === "short") {
    return decodeOperandTypes(opcodeByte, form, operandCount);
  }

  if (form === "variable") {
    const typeByte = readByte(storyData, opcodeAddress + 1);
    const types = decodeVariableFormOperandTypes(typeByte);

    if (isDoubleVariableOpcode(opcodeByte) && types.length === 4) {
      const secondTypeByte = readByte(storyData, opcodeAddress + 2);
      const secondTypes = decodeVariableFormOperandTypes(secondTypeByte);
      return [...types, ...secondTypes];
    }

    return types;
  }

  if (form === "extended") {
    const typeByte = readByte(storyData, opcodeAddress + 2);
    return decodeVariableFormOperandTypes(typeByte);
  }

  // Exhaustiveness guard: every InstructionForm case is handled above.
  // If this ever fires, InstructionForm gained a new member without a matching branch here.
  const unreachable: never = form;
  throw new Error(`readOperandTypes: unhandled form ${unreachable}`);
}

export function decodeVariableFormOperandTypes(typeByte: number): OperandType[] {
  const types: OperandType[] = [];

  for (let fieldIndex = 0; fieldIndex < 4; fieldIndex++) {
    const shift = 6 - fieldIndex * 2; // 6, 4, 2, 0
    const bits = (typeByte >> shift) & 0b11;
    const type = twoBitToType(bits);

    if (type === "omitted") break;

    types.push(type);
  }

  return types;
}

export function decodeOperandCount(opcodeByte: number, form: InstructionForm): OperandCount {
  if (form === "long") return "2OP";
  if (form === "extended") return "VAR";

  if (form === "short") {
    const typeBits = (opcodeByte >> 4) & 0b11; // bits 4-5
    return typeBits === 0b11 ? "0OP" : "1OP";
  }

  // variable form
  const bit5 = (opcodeByte >> 5) & 0b1;
  return bit5 === 0b1 ? "VAR" : "2OP";
}

export function decodeForm(opcodeByte: number, version: number): InstructionForm {
  if (opcodeByte === 0xbe && version >= 5) {
    return "extended";
  }

  const topTwoBits = opcodeByte >> 6; // isolate bits 6-7

  if (topTwoBits === 0b11) return "variable";
  if (topTwoBits === 0b10) return "short";
  return "long"; // topTwoBits is 0b00 or 0b01
}

function main(): void {
  const path = process.argv[2];

  if (!path) {
    console.error("Usage: app.ts <path-to-story-file>");
    process.exit(1);
  }

  const storyData = loadStoryFile(path);
  const version = readVersion(storyData);
  const map: MemoryMap = readMemoryMap(storyData);

  console.log(`${version}: ${map}`);
}

if (import.meta.main) {
  main();
}

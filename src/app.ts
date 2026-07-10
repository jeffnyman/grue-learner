import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte } from "./utils.ts";

export type InstructionForm = "long" | "short" | "variable" | "extended";

export type OperandCount = "0OP" | "1OP" | "2OP" | "VAR";

export type OperandType = "large constant" | "small constant" | "variable" | "omitted";

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

function longFormBitToType(bit: number): OperandType {
  return bit === 0 ? "small constant" : "variable";
}

function twoBitToType(bits: number): OperandType {
  if (bits === 0b00) return "large constant";
  if (bits === 0b01) return "small constant";
  if (bits === 0b10) return "variable";
  return "omitted";
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
    return decodeVariableFormOperandTypes(typeByte);
  }

  throw new Error(`readOperandTypes: ${form} form not yet supported`);
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

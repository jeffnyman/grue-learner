import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";

type StoreInfo = boolean | { storesFromVersion: number };

export type BranchOutcome =
  | { kind: "returnFalse" }
  | { kind: "returnTrue" }
  | { kind: "jump"; targetAddress: number };

// prettier-ignore
const storeByteTable: Record<string, StoreInfo> = {
  // VAR
  "VAR:224": true,                      // call / call_vs — §14
  "VAR:225": false,                     // storew — §14
  "VAR:227": false,                     // put_prop — §14
  "VAR:228": { storesFromVersion: 5 },  // sread (V3/V4, no store) → aread (V5+, stores) — §14

  // 2OP
  "2OP:10": false,                      // test_attr — branches, does not store — §14
  "2OP:13": false,                      // store — writes via operand, not a store byte — §14
  "2OP:14": false,                      // insert_obj — §14
  "2OP:16": true,                       // loadb — §14
  "2OP:20": true,                       // add — §14

  // 1OP
  "1OP:128": false,                     // jz — branches, does not store — §14
  "1OP:139": false,                     // ret — §14/§15
  "1OP:140": false,                     // jump — not a branch instruction either — §15

  // 0OP
  "0OP:177": false,                     // rfalse — §14
  "0OP:178": false,                     // print — text argument, not a store — §4.8, §14
  "0OP:187": false,                     // new_line — §14
};

// prettier-ignore
const branchByteTable: Record<string, boolean> = {
  // VAR
  "VAR:224": false,  // call / call_vs — §14
  "VAR:225": false,  // storew — §14
  "VAR:227": false,  // put_prop — §14
  "VAR:228": false,  // sread/aread — §14 (no ?(label) or branch marker in either V3 or V5 row)

  // 2OP
  "2OP:10": true,    // test_attr — §14, ?(label)
  "2OP:13": false,   // store — §14
  "2OP:14": false,   // insert_obj — §14
  "2OP:16": false,   // loadb — §14
  "2OP:20": false,   // add — §14

  // 1OP
  "1OP:128": true,   // jz — §14, ?(label)
  "1OP:139": false,  // ret — §14/§15
  "1OP:140": false,  // jump — §15, explicitly "not a branch instruction"

  // 0OP
  "0OP:177": false,  // rfalse — §14
  "0OP:178": false,  // print — text argument, not branch — §4.8, §14
  "0OP:187": false,  // new_line — §14
};

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

export interface StoreTarget {
  variableNumber: number; // 0 = stack, 1-15 = local, 16-255 = global, per §4.2.2/§6.3
  bytesConsumed: number;
}

export interface RawBranchInfo {
  senseBit: boolean; // true = branch on true, false = branch on false
  offset: number; // 0-63 for 1-byte form; signed for 2-byte form
  bytesConsumed: 1 | 2;
}

export function interpretBranch(
  branchInfo: RawBranchInfo,
  branchStartAddress: number,
): BranchOutcome {
  if (branchInfo.offset === 0) {
    return { kind: "returnFalse" };
  }

  if (branchInfo.offset === 1) {
    return { kind: "returnTrue" };
  }

  const addressAfterBranchData = branchStartAddress + branchInfo.bytesConsumed;
  const targetAddress = addressAfterBranchData + branchInfo.offset - 2;

  return { kind: "jump", targetAddress };
}

export function readStoreByteIfPresent(
  storyData: Uint8Array,
  address: number,
  category: OperandCount,
  opcodeNumber: number,
  version: number,
): StoreTarget | null {
  if (!hasStoreByte(category, opcodeNumber, version)) {
    return null;
  }

  return readStoreByte(storyData, address);
}

export function readRawBranchInfo(storyData: Uint8Array, address: number): RawBranchInfo {
  const firstByte = readByte(storyData, address);
  const senseBit = (firstByte & 0b10000000) !== 0;
  const isOneByteForm = (firstByte & 0b01000000) !== 0;

  if (isOneByteForm) {
    const offset = firstByte & 0b00111111; // bottom 6 bits, unsigned 0-63
    return { senseBit, offset, bytesConsumed: 1 };
  }

  const secondByte = readByte(storyData, address + 1);
  const highSixBits = firstByte & 0b00111111;
  const unsignedFourteenBit = (highSixBits << 8) | secondByte; // 0-16383

  const offset = unsignedFourteenBit >= 8192 ? unsignedFourteenBit - 16384 : unsignedFourteenBit;

  return { senseBit, offset, bytesConsumed: 2 };
}

export function hasBranchByte(
  category: OperandCount,
  opcodeNumber: number,
  _version: number,
): boolean {
  const key = `${category}:${opcodeNumber}`;
  const entry = branchByteTable[key];

  if (entry === undefined) {
    throw new Error(
      `hasBranchByte: opcode ${key} is not yet in the seed table — spec lookup needed`,
    );
  }

  return entry;
}

export function hasStoreByte(
  category: OperandCount,
  opcodeNumber: number,
  version: number,
): boolean {
  const key = `${category}:${opcodeNumber}`;
  const entry = storeByteTable[key];

  if (entry === undefined) {
    throw new Error(
      `hasStoreByte: opcode ${key} is not yet in the seed table — spec lookup needed`,
    );
  }

  if (typeof entry === "boolean") {
    return entry;
  }

  return version >= entry.storesFromVersion;
}

export function readStoreByte(storyData: Uint8Array, address: number): StoreTarget {
  return {
    variableNumber: readByte(storyData, address),
    bytesConsumed: 1,
  };
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

function longFormBitToType(bit: number): OperandType {
  return bit === 0 ? "small constant" : "variable";
}

function twoBitToType(bits: number): OperandType {
  if (bits === 0b00) return "large constant";
  if (bits === 0b01) return "small constant";
  if (bits === 0b10) return "variable";
  return "omitted";
}

export function isDoubleVariableOpcode(opcodeByte: number): boolean {
  const opcodeNumber = decodeOpcodeNumber(opcodeByte, "variable");
  return opcodeNumber === 12 || opcodeNumber === 26; // call_vs2, call_vn2
}

export function decodeOpcodeNumber(opcodeByte: number, form: InstructionForm): number {
  if (form === "long" || form === "variable") {
    return opcodeByte & 0b00011111; // bottom 5 bits
  }

  if (form === "short") {
    return opcodeByte & 0b00001111; // bottom 4 bits
  }

  throw new Error(`decodeOpcodeNumber: ${form} form's opcode number is not in this byte`);
}

export function readOpcodeNumber(
  storyData: Uint8Array,
  opcodeByte: number,
  opcodeAddress: number,
  form: InstructionForm,
): number {
  if (form === "extended") {
    return readByte(storyData, opcodeAddress + 1);
  }

  return decodeOpcodeNumber(opcodeByte, form);
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

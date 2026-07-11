import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";
import { decodeZString, type DecodedToken } from "./zstring.ts";

type StoreInfo = boolean | { storesFromVersion: number };

export type BranchOutcome =
  | { kind: "returnFalse" }
  | { kind: "returnTrue" }
  | { kind: "jump"; targetAddress: number };

// prettier-ignore
const storeByteTable: Record<string, StoreInfo> = {
  "VAR:0": true,                        // call / call_vs
  "VAR:1": false,                       // storew
  "VAR:3": false,                       // put_prop
  "VAR:4": { storesFromVersion: 5 },    // sread → aread

  "2OP:10": false,                      // test_attr
  "2OP:13": false,                      // store
  "2OP:14": false,                      // insert_obj
  "2OP:16": true,                       // loadb
  "2OP:20": true,                       // add

  "1OP:0": false,                       // jz
  "1OP:11": false,                      // ret
  "1OP:12": false,                      // jump

  "0OP:1": false,                       // rfalse
  "0OP:2": false,                       // print
  "0OP:11": false,                      // new_line
};

// prettier-ignore
const branchByteTable: Record<string, boolean> = {
  "VAR:0": false,   // call
  "VAR:1": false,   // storew
  "VAR:3": false,   // put_prop
  "VAR:4": false,   // sread/aread

  "2OP:10": true,   // test_attr
  "2OP:13": false,  // store
  "2OP:14": false,  // insert_obj
  "2OP:16": false,  // loadb
  "2OP:20": false,  // add

  "1OP:0": true,    // jz
  "1OP:11": false,  // ret
  "1OP:12": false,  // jump

  "0OP:1": false,   // rfalse
  "0OP:2": false,   // print
  "0OP:11": false,  // new_line
};

export type InstructionForm = "long" | "short" | "variable" | "extended";

export type OperandCount = "0OP" | "1OP" | "2OP" | "VAR";

export type OperandType = "large constant" | "small constant" | "variable" | "omitted";

export interface DecodedInstruction {
  address: number;
  form: InstructionForm;
  operandCount: OperandCount;
  opcodeNumber: number;
  operands: DecodedOperand[];
  storeTarget: StoreTarget | null;
  branchOutcome: BranchOutcome | null;
  branchBytesConsumed: 1 | 2 | null;
  text: DecodedToken[] | null;
  nextInstructionAddress: number;
}

export interface OperandTypesResult {
  types: OperandType[];
  typeInfoBytesConsumed: number; // bytes read beyond the opcode byte(s) themselves, purely for type info
}

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

export interface BranchReadResult {
  outcome: BranchOutcome;
  bytesConsumed: 1 | 2;
}

export interface TextArgumentResult {
  tokens: DecodedToken[];
  bytesConsumed: number;
}

export function readTextArgument(
  storyData: Uint8Array,
  startAddress: number,
  version: number,
  abbreviationsTableAddress: number,
): TextArgumentResult {
  const { tokens, wordsConsumed } = decodeZString(
    storyData,
    startAddress,
    version,
    abbreviationsTableAddress,
  );

  return { tokens, bytesConsumed: wordsConsumed * 2 };
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

export function readBranchByteIfPresent(
  storyData: Uint8Array,
  address: number,
  category: OperandCount,
  opcodeNumber: number,
  version: number,
): BranchReadResult | null {
  if (!hasBranchByte(category, opcodeNumber, version)) {
    return null;
  }

  const rawBranchInfo = readRawBranchInfo(storyData, address);
  const outcome = interpretBranch(rawBranchInfo, address);

  return { outcome, bytesConsumed: rawBranchInfo.bytesConsumed };
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

export function decodeInstruction(
  storyData: Uint8Array,
  address: number,
  version: number,
  abbreviationsTableAddress: number,
): DecodedInstruction {
  const opcodeByte = readByte(storyData, address);
  const form = decodeForm(opcodeByte, version);
  const operandCount = decodeOperandCount(opcodeByte, form);
  const opcodeNumber = readOpcodeNumber(storyData, opcodeByte, address, form);

  const operandTypesResult = readOperandTypes(storyData, opcodeByte, address, form, operandCount);
  const operandsStartAddress =
    address + headerBytesConsumed(form, operandTypesResult.typeInfoBytesConsumed);
  const operandsResult = readOperands(storyData, operandsStartAddress, operandTypesResult.types);
  const afterOperandsAddress = operandsStartAddress + operandsResult.totalBytesConsumed;

  const storeTarget = readStoreByteIfPresent(
    storyData,
    afterOperandsAddress,
    operandCount,
    opcodeNumber,
    version,
  );
  const afterStoreAddress = afterOperandsAddress + (storeTarget?.bytesConsumed ?? 0);

  const branchResult = readBranchByteIfPresent(
    storyData,
    afterStoreAddress,
    operandCount,
    opcodeNumber,
    version,
  );
  const afterBranchAddress = afterStoreAddress + (branchResult?.bytesConsumed ?? 0);

  const text = hasTextArgument(operandCount, opcodeNumber)
    ? readTextArgument(storyData, afterBranchAddress, version, abbreviationsTableAddress)
    : null;
  const nextInstructionAddress = afterBranchAddress + (text?.bytesConsumed ?? 0);

  return {
    address,
    form,
    operandCount,
    opcodeNumber,
    operands: operandsResult.operands,
    storeTarget,
    branchOutcome: branchResult?.outcome ?? null,
    branchBytesConsumed: branchResult?.bytesConsumed ?? null,
    text: text?.tokens ?? null,
    nextInstructionAddress,
  };
}

function headerBytesConsumed(form: InstructionForm, typeInfoBytesConsumed: number): number {
  if (form === "extended") {
    return 2 + typeInfoBytesConsumed; // marker byte + opcode-number byte + type byte(s)
  }
  return 1 + typeInfoBytesConsumed; // opcode byte (+ type byte(s) for variable form)
}

function hasTextArgument(operandCount: OperandCount, opcodeNumber: number): boolean {
  return operandCount === "0OP" && (opcodeNumber === 2 || opcodeNumber === 3); // print, print_ret — §4.8
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
): OperandTypesResult {
  if (form === "long" || form === "short") {
    const types = decodeOperandTypes(opcodeByte, form, operandCount);
    return { types, typeInfoBytesConsumed: 0 }; // types packed in the opcode byte itself
  }

  if (form === "variable") {
    const typeByte = readByte(storyData, opcodeAddress + 1);
    const types = decodeVariableFormOperandTypes(typeByte);

    if (isDoubleVariableOpcode(opcodeByte) && types.length === 4) {
      const secondTypeByte = readByte(storyData, opcodeAddress + 2);
      const secondTypes = decodeVariableFormOperandTypes(secondTypeByte);
      return { types: [...types, ...secondTypes], typeInfoBytesConsumed: 2 };
    }

    return { types, typeInfoBytesConsumed: 1 };
  }

  if (form === "extended") {
    const typeByte = readByte(storyData, opcodeAddress + 2);
    const types = decodeVariableFormOperandTypes(typeByte);
    return { types, typeInfoBytesConsumed: 1 };
  }

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

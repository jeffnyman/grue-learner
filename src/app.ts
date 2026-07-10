import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile } from "./utils.ts";

export type InstructionForm = "long" | "short" | "variable" | "extended";

export type OperandCount = "0OP" | "1OP" | "2OP" | "VAR";

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

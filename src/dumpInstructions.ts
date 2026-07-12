import { readMemoryMap, readVersion } from "./header.ts";
import { loadStoryFile } from "./utils.ts";
import { decodeInstruction, readRoutineHeader, type DecodedInstruction } from "./app.ts";

function formatOperand(op: DecodedInstruction["operands"][number]): string {
  if (op.type === "large constant") return `#${op.value.toString(16).padStart(4, "0")}`;
  if (op.type === "small constant") return `#${op.value.toString(16).padStart(2, "0")}`;
  return `var(${op.value})`; // "variable" type — raw variable number, not resolved
}

function formatBranch(instruction: DecodedInstruction): string {
  if (!instruction.branchOutcome) return "";

  if (instruction.branchOutcome.kind === "returnFalse") return " [FALSE-RETURN]";
  if (instruction.branchOutcome.kind === "returnTrue") return " [TRUE-RETURN]";

  const target = instruction.branchOutcome.targetAddress.toString(16).padStart(4, "0");
  return ` ?${target}`;
}

function formatInstruction(instruction: DecodedInstruction): string {
  const address = instruction.address.toString(16).padStart(4, "0");
  const opcodeLabel = `${instruction.operandCount}:${instruction.opcodeNumber}`;
  const operands = instruction.operands.map(formatOperand).join(",");
  const store = instruction.storeTarget ? ` -> var(${instruction.storeTarget.variableNumber})` : "";
  const branch = formatBranch(instruction);
  const text = instruction.text
    ? ` "${instruction.text.map((t) => (t.type === "zscii" ? String.fromCharCode(t.value!) : "?")).join("")}"`
    : "";

  return ` ${address}:  [${opcodeLabel}]  ${operands}${store}${branch}${text}`;
}

export function dumpInstructions(
  storyData: Uint8Array,
  routineAddress: number,
  maxInstructions: number,
): void {
  const version = readVersion(storyData);
  const map = readMemoryMap(storyData);
  const header = readRoutineHeader(storyData, routineAddress, version);

  console.log(
    `Routine ${routineAddress.toString(16)}, ${header.localCount} locals (${header.localDefaults
      .map((d) => d.toString(16).padStart(4, "0"))
      .join(", ")})\n`,
  );

  let address = header.firstInstructionAddress;

  for (let i = 0; i < maxInstructions; i++) {
    try {
      const instruction = decodeInstruction(
        storyData,
        address,
        version,
        map.abbreviationsTableAddress,
      );
      console.log(formatInstruction(instruction));
      address = instruction.nextInstructionAddress;
    } catch (error) {
      console.log(`\n[Stopped at 0x${address.toString(16)}: ${(error as Error).message}]`);
      return;
    }
  }
}

function main(): void {
  const path = process.argv[2];
  const routineAddressArg = process.argv[3];
  const maxInstructions = Number(process.argv[4] ?? 40);

  if (!path || !routineAddressArg) {
    console.error(
      "Usage: dumpInstructions.ts <path-to-story-file> <routine-address-hex> [max-instructions]",
    );
    process.exit(1);
  }

  const storyData = loadStoryFile(path);
  const routineAddress = parseInt(routineAddressArg, 16);

  dumpInstructions(storyData, routineAddress, maxInstructions);
}

if (import.meta.main) {
  main();
}

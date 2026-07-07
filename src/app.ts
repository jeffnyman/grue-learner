import { readFileSync } from "node:fs";

interface MemoryMap {
  highMemoryBase: number;
  dictionaryAddress: number;
  objectTableAddress: number;
  globalsAddress: number;
  staticMemoryBase: number;
}

interface VaildationResult {
  rule: string;
  passed: boolean;
  detail: string;
}

const KNOWN_VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export function readVersion(storyData: Uint8Array): number {
  const version = storyData[0x00];

  if (version === undefined || !KNOWN_VERSIONS.includes(version)) {
    throw new Error(
      `Unrecognized Z-Machine version byte: ${version}. \
      Expected one of ${KNOWN_VERSIONS.join(", ")}.`,
    );
  }

  return version;
}

export function readMemoryMap(storyData: Uint8Array): MemoryMap {
  return {
    highMemoryBase: readWord(storyData, 0x04),
    dictionaryAddress: readWord(storyData, 0x08),
    objectTableAddress: readWord(storyData, 0x0a),
    globalsAddress: readWord(storyData, 0x0c),
    staticMemoryBase: readWord(storyData, 0x0e),
  };
}

export function validateDynamicMemoryMinimum(staticMemoryBase: number): VaildationResult {
  const MINIMUM_DYNAMIC_MEMORY = 64;
  const passed = staticMemoryBase >= MINIMUM_DYNAMIC_MEMORY;

  return {
    rule: "Dynamic memory must be at least 64 bytes (Standard §1.1)",
    passed,
    detail: passed
      ? `staticMemoryBase = ${staticMemoryBase}, dynamic memory = ${staticMemoryBase} bytes`
      : `staticMemoryBase = ${staticMemoryBase} is less than the required minimum of ${MINIMUM_DYNAMIC_MEMORY}`,
  };
}

export function validateStaticMemoryCeiling(
  staticMemoryBase: number,
  fileLength: number,
): VaildationResult {
  // Ceiling is one past 0xFFFF, the highest legal byte address.
  const ADDRESSING_CEILING = 0x10000;

  const effectiveBoundary = Math.min(fileLength, ADDRESSING_CEILING);
  const passed = staticMemoryBase <= effectiveBoundary;

  return {
    rule: "Static memory must end by EOF or $0FFFF, whichever is lower (Standard §1.1)",
    passed,
    detail: passed
      ? `staticMemoryBase = ${staticMemoryBase} is within the effective boundary of ${effectiveBoundary} (min of fileLength=${fileLength}, ceiling=${ADDRESSING_CEILING})`
      : `staticMemoryBase = ${staticMemoryBase} exceeds the effective boundary of ${effectiveBoundary} (min of fileLength=${fileLength}, ceiling=${ADDRESSING_CEILING})`,
  };
}

function readWord(storyData: Uint8Array, offset: number): number {
  const byte1 = storyData[offset];
  const byte2 = storyData[offset + 1];

  if (byte1 === undefined || byte2 === undefined) {
    throw new Error(`Cannot read word at offset ${offset}: insufficient data`);
  }

  return (byte1 << 8) | byte2;
}

function loadStoryFile(path: string): Uint8Array {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer);
}

function toHex(n: number, width: number = 4): string {
  return "0x" + n.toString(16).padStart(width, "0");
}

function main(): void {
  const path = process.argv[2];

  if (!path) {
    console.error("Usage: app.ts <path-to-story-file>");
    process.exit(1);
  }

  const storyData = loadStoryFile(path);

  console.log(`Loaded ${storyData.length} bytes from ${path}`);
  console.log(`First 16 bytes:`, Array.from(storyData.slice(0, 16)));

  const map = readMemoryMap(storyData);

  console.log(`Version: ${readVersion(storyData)}`);
  console.log({
    highMemoryBase: toHex(map.highMemoryBase),
    dictionaryAddress: toHex(map.dictionaryAddress),
    objectTableAddress: toHex(map.objectTableAddress),
    globalsAddress: toHex(map.globalsAddress),
    staticMemoryBase: toHex(map.staticMemoryBase),
  });

  console.log(validateDynamicMemoryMinimum(map.staticMemoryBase));
  console.log(validateStaticMemoryCeiling(map.staticMemoryBase, storyData.length));
}

if (import.meta.main) {
  main();
}

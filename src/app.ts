import { readFileSync } from "node:fs";

export interface MemoryMap {
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

interface RawFlags {
  flags1: number;
  flags2: number;
}

interface Flags1BitDefinition {
  bit: number;
  name: string;
  minVersion: number;
  maxVersion?: number; // undefined = no upper bound within this table's regime
}

interface Flags2BitDefinition {
  bit: number;
  name: string;
  minVersion: number;
}

const FLAGS1_V1_TO_V3: Flags1BitDefinition[] = [
  { bit: 1, name: "statusLineIsTimeBased", minVersion: 1, maxVersion: 3 },
  { bit: 2, name: "storySplitAcrossDiscs", minVersion: 1, maxVersion: 3 },
  { bit: 4, name: "statusLineNotAvailable", minVersion: 1, maxVersion: 3 },
  { bit: 5, name: "screenSplittingAvailable", minVersion: 1, maxVersion: 3 },
  { bit: 6, name: "variablePitchIsDefault", minVersion: 1, maxVersion: 3 },
];

const FLAGS1_V4_PLUS: Flags1BitDefinition[] = [
  { bit: 0, name: "coloursAvailable", minVersion: 5 },
  { bit: 1, name: "picturesAvailable", minVersion: 6 },
  { bit: 2, name: "boldfaceAvailable", minVersion: 4 },
  { bit: 3, name: "italicAvailable", minVersion: 4 },
  { bit: 4, name: "fixedSpaceAvailable", minVersion: 4 },
  { bit: 5, name: "soundEffectsAvailable", minVersion: 6 },
  { bit: 7, name: "timedInputAvailable", minVersion: 4 },
];

const FLAGS2_BITS: Flags2BitDefinition[] = [
  { bit: 0, name: "transcriptingOn", minVersion: 1 },
  { bit: 1, name: "forceFixedPitch", minVersion: 3 },
  { bit: 2, name: "wantsScreenRedraw", minVersion: 6 },
  { bit: 3, name: "wantsPictures", minVersion: 5 },
  { bit: 4, name: "wantsUndo", minVersion: 5 },
  { bit: 5, name: "wantsMouse", minVersion: 5 },
  { bit: 6, name: "wantsColours", minVersion: 5 },
  { bit: 7, name: "wantsSoundEffects", minVersion: 5 },
  { bit: 8, name: "wantsMenus", minVersion: 6 },
];

interface DecodedFlag {
  bit: number;
  name: string;
  set: boolean;
  applicable: boolean; // true only if this version defines a meaning for this bit
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

export function validateHighDynamicNonOverlap(
  highMemoryBase: number,
  staticMemoryBase: number,
): VaildationResult {
  const passed = highMemoryBase >= staticMemoryBase;

  return {
    rule: "High memory must not overlap dynamic memory (Standard §1.1)",
    passed,
    detail: passed
      ? `highMemoryBase = ${highMemoryBase} is at or after staticMemoryBase = ${staticMemoryBase}; no dynamic overlap`
      : `highMemoryBase = ${highMemoryBase} is before staticMemoryBase = ${staticMemoryBase}; high memory would overlap dynamic memory`,
  };
}

export function validateDynamicStaticMaximum(
  staticMemoryBase: number,
  fileLength: number,
): VaildationResult {
  // 64K - 2 bytes (Standard §1, Remarks)
  const MAX_DYNAMIC_PLUS_STATIC = 65534;

  const effectiveBoundary = Math.min(fileLength, MAX_DYNAMIC_PLUS_STATIC);
  const passed = staticMemoryBase <= effectiveBoundary;

  return {
    rule: "Dynamic + static memory must not exceed 64K minus 2 bytes (Standard §1, Remarks)",
    passed,
    detail: passed
      ? `staticMemoryBase = ${staticMemoryBase} is within the effective boundary of ${effectiveBoundary} (min of fileLength=${fileLength}, max=${MAX_DYNAMIC_PLUS_STATIC})`
      : `staticMemoryBase = ${staticMemoryBase} exceeds the effective boundary of ${effectiveBoundary} (min of fileLength=${fileLength}, max=${MAX_DYNAMIC_PLUS_STATIC})`,
  };
}

export function validateMemoryMap(map: MemoryMap, fileLength: number): VaildationResult[] {
  return [
    validateDynamicMemoryMinimum(map.staticMemoryBase),
    validateStaticMemoryCeiling(map.staticMemoryBase, fileLength),
    validateHighDynamicNonOverlap(map.highMemoryBase, map.staticMemoryBase),
    validateDynamicStaticMaximum(map.staticMemoryBase, fileLength),
  ];
}

export function readRawFlags(storyData: Uint8Array): RawFlags {
  return {
    flags1: readByte(storyData, 0x01),
    flags2: readWord(storyData, 0x10),
  };
}

export function decodeFlags1(flags1: number, version: number): DecodedFlag[] {
  const table = version <= 3 ? FLAGS1_V1_TO_V3 : FLAGS1_V4_PLUS;

  return table.map(({ bit, name, minVersion, maxVersion }) => ({
    bit,
    name,
    set: ((flags1 >> bit) & 1) === 1,
    applicable: version >= minVersion && (maxVersion === undefined || version <= maxVersion),
  }));
}

export function decodeFlags2(flags2: number, version: number): DecodedFlag[] {
  return FLAGS2_BITS.map(({ bit, name, minVersion }) => ({
    bit,
    name,
    set: ((flags2 >> bit) & 1) === 1,
    applicable: version >= minVersion,
  }));
}

function readByte(storyData: Uint8Array, offset: number): number {
  const b = storyData[offset];

  if (b === undefined) {
    throw new Error(`Cannot read byte at offset ${offset}: insufficient data`);
  }

  return b;
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
  const version = readVersion(storyData);

  console.log(`Loaded ${storyData.length} bytes from ${path}`);
  console.log(`First 16 bytes:`, Array.from(storyData.slice(0, 16)));

  const map = readMemoryMap(storyData);

  console.log(`Version: ${version}`);
  console.log({
    highMemoryBase: toHex(map.highMemoryBase),
    dictionaryAddress: toHex(map.dictionaryAddress),
    objectTableAddress: toHex(map.objectTableAddress),
    globalsAddress: toHex(map.globalsAddress),
    staticMemoryBase: toHex(map.staticMemoryBase),
  });

  const results = validateMemoryMap(map, storyData.length);

  results.forEach((r) => {
    console.log(r.passed ? "✅" : "❌", r.rule);
    if (!r.passed) console.log("   ", r.detail);
  });

  const flags = readRawFlags(storyData);

  console.log(`Flags 1: ${flags.flags1.toString(2).padStart(8, "0")}`);
  console.log(`Flags 2: ${flags.flags2.toString(2).padStart(16, "0")}`);

  const flags1Decoded = decodeFlags1(flags.flags1, version);

  console.log("\nFlags 1 breakdown:");

  flags1Decoded.forEach(({ bit, name, set, applicable }) => {
    const status = set ? "SET  " : "unset";
    const scope = applicable ? "applicable at this version" : "NOT applicable at this version";
    console.log(`  bit ${bit} (${name}): ${status} — ${scope}`);
  });

  const flags2Decoded = decodeFlags2(flags.flags2, version);

  console.log("\nFlags 2 breakdown:");

  flags2Decoded.forEach(({ bit, name, set, applicable }) => {
    const status = set ? "SET  " : "unset";
    const scope = applicable ? "applicable at this version" : "NOT applicable at this version";
    console.log(`  bit ${bit} (${name}): ${status} — ${scope}`);
  });
}

if (import.meta.main) {
  main();
}

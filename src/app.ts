import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";
import { decodeZString } from "./zstring.ts";

interface PropertyDefaultsTable {
  defaults: number[]; // index 0 = property 1, index 1 = property 2, etc. (see THEORY re: 1-based numbering)
  firstObjectEntryAddress: number;
}

interface ObjectEntry {
  number: number;
  attributes: boolean[]; // index 0 = attribute 0, reading topmost-bit-first per §12.3.1
  parent: number;
  sibling: number;
  child: number;
  propertyTableAddress: number;
}

function defaultsTableSize(version: number): number {
  return version <= 3 ? 31 : 63;
}

export function readPropertyDefaultsTable(
  storyData: Uint8Array,
  objectTableAddress: number,
  version: number,
): PropertyDefaultsTable {
  const size = defaultsTableSize(version);
  const defaults: number[] = [];

  for (let i = 0; i < size; i++) {
    defaults.push(readWord(storyData, objectTableAddress + i * 2));
  }

  return {
    defaults,
    firstObjectEntryAddress: objectTableAddress + size * 2,
  };
}

export function readObjectEntry(
  storyData: Uint8Array,
  firstObjectEntryAddress: number,
  objectNumber: number,
  version: number,
): ObjectEntry {
  const size = entrySize(version);
  const address = firstObjectEntryAddress + (objectNumber - 1) * size;

  if (version <= 3) {
    const attributes = readAttributes(storyData, address, 4);
    return {
      number: objectNumber,
      attributes,
      parent: readByte(storyData, address + 4),
      sibling: readByte(storyData, address + 5),
      child: readByte(storyData, address + 6),
      propertyTableAddress: readWord(storyData, address + 7),
    };
  }

  const attributes = readAttributes(storyData, address, 6);
  return {
    number: objectNumber,
    attributes,
    parent: readWord(storyData, address + 6),
    sibling: readWord(storyData, address + 8),
    child: readWord(storyData, address + 10),
    propertyTableAddress: readWord(storyData, address + 12),
  };
}

export function countObjects(
  storyData: Uint8Array,
  firstObjectEntryAddress: number,
  version: number,
): number {
  const size = entrySize(version);
  let minPropertyTableAddress = Infinity;
  let count = 0;
  let address = firstObjectEntryAddress;

  while (true) {
    if (address + size > minPropertyTableAddress) break;

    const entry = readObjectEntry(storyData, firstObjectEntryAddress, count + 1, version);
    minPropertyTableAddress = Math.min(minPropertyTableAddress, entry.propertyTableAddress);
    count++;
    address += size;
  }

  return count;
}

function readAttributes(storyData: Uint8Array, address: number, byteCount: number): boolean[] {
  const attributes: boolean[] = [];
  for (let byteIndex = 0; byteIndex < byteCount; byteIndex++) {
    const b = readByte(storyData, address + byteIndex);
    for (let bitOffset = 7; bitOffset >= 0; bitOffset--) {
      attributes.push(((b >> bitOffset) & 1) === 1);
    }
  }
  return attributes;
}

function entrySize(version: number): number {
  return version <= 3 ? 9 : 14;
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

  const propDefaults = readPropertyDefaultsTable(storyData, map.objectTableAddress, version);
  console.log(`Defaults table size: ${propDefaults.defaults.length}`);
  console.log(`First object entry address: 0x${propDefaults.firstObjectEntryAddress.toString(16)}`);
  console.log(propDefaults.defaults);

  const entry = readObjectEntry(storyData, propDefaults.firstObjectEntryAddress, 239, version);
  console.log(entry);

  const shortNameAddress = entry.propertyTableAddress + 1; // skip the text-length byte
  const shortName = decodeZString(
    storyData,
    shortNameAddress,
    version,
    map.abbreviationsTableAddress,
  );
  console.log(
    shortName.tokens
      .map((t) => (t.type === "zscii" ? String.fromCharCode(t.value!) : `[${t.type}]`))
      .join(""),
  );

  const objectCount = countObjects(storyData, propDefaults.firstObjectEntryAddress, version);
  console.log(`Object count: ${objectCount}`);

  // v1 and v2 check
  for (let i = 250; i <= 255; i++) {
    const entry = readObjectEntry(storyData, propDefaults.firstObjectEntryAddress, i, version);
    const nameAddr = entry.propertyTableAddress + 1;
    const name = decodeZString(storyData, nameAddr, version, map.abbreviationsTableAddress);
    console.log(
      i,
      name.tokens
        .map((t) => (t.type === "zscii" ? String.fromCharCode(t.value!) : `[${t.type}]`))
        .join(""),
    );
  }
}

if (import.meta.main) {
  main();
}

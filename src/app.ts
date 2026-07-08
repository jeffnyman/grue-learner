import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readWord } from "./utils.ts";

interface PropertyDefaultsTable {
  defaults: number[]; // index 0 = property 1, index 1 = property 2, etc. (see THEORY re: 1-based numbering)
  firstObjectEntryAddress: number;
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
}

if (import.meta.main) {
  main();
}

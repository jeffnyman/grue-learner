import { readFileSync } from "node:fs";

interface MemoryMap {
  highMemoryBase: number;
  dictionaryAddress: number;
  objectTableAddress: number;
  globalsAddress: number;
  staticMemoryBase: number;
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
}

if (import.meta.main) {
  main();
}

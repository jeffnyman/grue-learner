import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";

export interface DictionaryHeader {
  separatorCount: number;
  separators: number[]; // ZSCII codes
  entryLength: number;
  entryCount: number; // signed: negative means "unsorted, |entryCount| entries"
  isSorted: boolean;
  firstEntryAddress: number;
}

export function readDictionaryHeader(
  storyData: Uint8Array,
  dictionaryAddress: number,
): DictionaryHeader {
  const separatorCount = readByte(storyData, dictionaryAddress);
  const separators: number[] = [];
  for (let i = 0; i < separatorCount; i++) {
    separators.push(readByte(storyData, dictionaryAddress + 1 + i));
  }

  const entryLengthAddress = dictionaryAddress + 1 + separatorCount;
  const entryLength = readByte(storyData, entryLengthAddress);

  const rawEntryCount = readWord(storyData, entryLengthAddress + 1);
  const entryCount = toSigned16(rawEntryCount);

  return {
    separatorCount,
    separators,
    entryLength,
    entryCount,
    isSorted: entryCount >= 0,
    firstEntryAddress: entryLengthAddress + 3, // past entryLength byte + 2-byte count
  };
}

function toSigned16(value: number): number {
  return value >= 0x8000 ? value - 0x10000 : value;
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

  const dictHeader = readDictionaryHeader(storyData, map.dictionaryAddress);

  console.log(dictHeader);
}

if (import.meta.main) {
  main();
}

import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";
import { decodeZString } from "./zstring.ts";

export interface DictionaryHeader {
  separatorCount: number;
  separators: number[]; // ZSCII codes
  entryLength: number;
  entryCount: number; // signed: negative means "unsorted, |entryCount| entries"
  isSorted: boolean;
  firstEntryAddress: number;
}

export interface DictionaryEntry {
  index: number;
  address: number;
  text: string;
  data: number[];
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

export function readDictionaryEntry(
  storyData: Uint8Array,
  header: DictionaryHeader,
  index: number,
  version: number,
  abbreviationsTableAddress: number,
): DictionaryEntry {
  const address = header.firstEntryAddress + index * header.entryLength;
  const textWidth = textByteWidth(version);
  const expectedWords = textWidth / 2;

  const decoded = decodeZString(storyData, address, version, abbreviationsTableAddress);

  if (decoded.wordsConsumed !== expectedWords) {
    console.warn(
      `Dictionary entry ${index} at 0x${address.toString(16)}: expected ${expectedWords} words, got ${decoded.wordsConsumed}`,
    );
  }

  const text = decoded.tokens
    .map((t) => (t.type === "zscii" ? String.fromCharCode(t.value!) : `[${t.type}]`))
    .join("");

  const data: number[] = [];
  for (let i = textWidth; i < header.entryLength; i++) {
    data.push(readByte(storyData, address + i));
  }

  return { index, address, text, data };
}

function textByteWidth(version: number): number {
  return version <= 3 ? 4 : 6;
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

  for (let i = 0; i < 10; i++) {
    console.log(
      readDictionaryEntry(storyData, dictHeader, i, version, map.abbreviationsTableAddress),
    );
  }
}

if (import.meta.main) {
  main();
}

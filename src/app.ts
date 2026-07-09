import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile, readByte, readWord } from "./utils.ts";
import { decodeZString } from "./zstring.ts";

export interface Dictionary {
  header: DictionaryHeader;
  entries: DictionaryEntry[];
}

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

export function readDictionary(
  storyData: Uint8Array,
  dictionaryAddress: number,
  version: number,
  abbreviationsTableAddress: number,
): Dictionary {
  const header = readDictionaryHeader(storyData, dictionaryAddress);
  const count = Math.abs(header.entryCount);

  const entries: DictionaryEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(readDictionaryEntry(storyData, header, i, version, abbreviationsTableAddress));
  }

  return { header, entries };
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

  const dict = readDictionary(
    storyData,
    map.dictionaryAddress,
    version,
    map.abbreviationsTableAddress,
  );
  console.log(`Total entries: ${dict.entries.length} (header claims ${dict.header.entryCount})`);
  console.log(dict.entries[dict.entries.length - 1]); // last entry, a new data point vs. our earlier first-10 spot check

  const addr = 0x3f62; // r2, entry 347
  for (let i = 0; i < 14; i++) {
    console.log(
      `0x${(addr + i).toString(16)}: 0x${((storyData[addr + i] ?? 0).toString(16)).padStart(2, "0")}`,
    );
  }
}

if (import.meta.main) {
  main();
}

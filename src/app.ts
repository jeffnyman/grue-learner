import { loadStoryFile, readWord } from "./utils.ts";
import { readMemoryMap, type MemoryMap } from "./header.ts";

interface UnpackedWord {
  zchars: [number, number, number]; // each in range 0-31
  isEnd: boolean;
}

export function unpackWord(word: number): UnpackedWord {
  const first = (word >> 10) & 0x1f;
  const second = (word >> 5) & 0x1f;
  const third = word & 0x1f;
  const isEnd = ((word >> 15) & 1) === 1;

  return { zchars: [first, second, third], isEnd };
}

export function readAbbreviationEntry(
  storyData: Uint8Array,
  abbreviationsTableAddress: number,
  index: number,
): number {
  const wordAddress = readWord(storyData, abbreviationsTableAddress + index * 2);
  return wordAddress * 2; // convert word address to byte address, per §1.2.2
}

function unpackWordAt(storyData: Uint8Array, offset: number): UnpackedWord {
  return unpackWord(readWord(storyData, offset));
}

function main(): void {
  const path = process.argv[2];

  if (!path) {
    console.error("Usage: app.ts <path-to-story-file>");
    process.exit(1);
  }

  const storyData = loadStoryFile(path);

  const map: MemoryMap = readMemoryMap(storyData);
  const result = unpackWordAt(storyData, map.dictionaryAddress);

  console.log(result);

  console.log(`Abbreviations table address: 0x${map.abbreviationsTableAddress.toString(16)}`);

  const firstAbbrAddr = readAbbreviationEntry(storyData, map.abbreviationsTableAddress, 0);
  console.log(`First abbreviation byte address: 0x${firstAbbrAddr.toString(16)}`);

  const unpacked = unpackWordAt(storyData, firstAbbrAddr);
  console.log(unpacked);
}

if (import.meta.main) {
  main();
}

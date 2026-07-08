import { loadStoryFile, readWord } from "./utils.ts";
import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";

type Alphabet = 0 | 1 | 2;

type ZCharResult =
  | { type: "output"; zscii: number; newState: DecoderState }
  | { type: "shift"; newState: DecoderState }
  | { type: "abbreviation"; index: number; newState: DecoderState }
  | { type: "escape"; newState: DecoderState };

interface UnpackedWord {
  zchars: [number, number, number]; // each in range 0-31
  isEnd: boolean;
}

export interface DecoderState {
  current: Alphabet;
  lock: Alphabet; // only ever changes in V1-2
}

interface DecodedToken {
  type: "zscii" | "abbreviation" | "escape";
  value?: number; // for "zscii": the ZSCII code
  zchar?: number; // for "abbreviation": which trigger character (1, 2, or 3)
}

interface DecodedZString {
  tokens: DecodedToken[];
  wordsConsumed: number;
}

const A0_TABLE = Array.from({ length: 26 }, (_, i) => 97 + i); // 'a'-'z'
const A1_TABLE = Array.from({ length: 26 }, (_, i) => 65 + i); // 'A'-'Z'

// index 0 = Z-char 6 (escape placeholder, -1 = "not a real output")
// index 1 = Z-char 7 (newline)
// index 2-11 = Z-chars 8-17 ('0'-'9')
// index 12-25 = Z-chars 18-31 (punctuation)
// prettier-ignore
const A2_TABLE = [
  -1, 13,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  46, 44, 33, 63, 95, 35, 39, 34, 47, 92, 45, 58, 40, 41,
];

// prettier-ignore
const A2_TABLE_V1 = [
  -1, 60, // '<' instead of newline
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
  46, 44, 33, 63, 95, 35, 39, 34, 47, 92, 45, 58, 40, 41,
];

const SHIFT_TABLE: Record<number, Record<Alphabet, Alphabet>> = {
  2: { 0: 1, 1: 2, 2: 0 },
  3: { 0: 2, 1: 0, 2: 1 },
  4: { 0: 1, 1: 2, 2: 0 },
  5: { 0: 2, 1: 0, 2: 1 },
};

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

export function translateZCharacter(
  zchar: number,
  state: DecoderState,
  version: number,
): ZCharResult {
  if (zchar === 0) {
    return { type: "output", zscii: 32, newState: resetToLock(state) }; // space
  }

  if (zchar === 1) {
    if (version === 1) {
      return { type: "output", zscii: 13, newState: resetToLock(state) }; // newline
    }
    return { type: "abbreviation", index: zchar, newState: resetToLock(state) }; // V2+
  }

  if (zchar === 2 || zchar === 3) {
    if (version <= 2) {
      const shiftRow = SHIFT_TABLE[zchar as 2 | 3];

      if (!shiftRow) {
        throw new Error(`Invalid shift z-character: ${zchar}`);
      }

      const nextAlphabet = shiftRow[state.current];
      return { type: "shift", newState: { current: nextAlphabet, lock: state.lock } };
    }
    return { type: "abbreviation", index: zchar, newState: resetToLock(state) }; // V3+
  }

  if (zchar === 4 || zchar === 5) {
    const shiftRow = SHIFT_TABLE[zchar as 4 | 5];

    if (!shiftRow) {
      throw new Error(`Invalid shift z-character: ${zchar}`);
    }

    const nextAlphabet = shiftRow[state.current];
    if (version <= 2) {
      return { type: "shift", newState: { current: nextAlphabet, lock: nextAlphabet } }; // shift-lock
    }
    return { type: "shift", newState: { current: nextAlphabet, lock: state.lock } }; // single-shift
  }

  // Z-chars 6-31
  if (zchar === 6 && state.current === 2) {
    return { type: "escape", newState: resetToLock(state) };
  }

  const table = alphabetTableFor(state.current, version);
  const zscii = table[zchar - 6];

  if (zscii === undefined) {
    throw new Error(`Invalid z-character output: ${zchar}`);
  }

  return { type: "output", zscii, newState: resetToLock(state) };
}

export function decodeZString(
  storyData: Uint8Array,
  startAddress: number,
  version: number,
): DecodedZString {
  const tokens: DecodedToken[] = [];

  let state: DecoderState = { current: 0, lock: 0 };
  let address = startAddress;
  let wordsConsumed = 0;

  while (true) {
    const { zchars, isEnd } = unpackWordAt(storyData, address);

    wordsConsumed++;

    for (const zchar of zchars) {
      const result = translateZCharacter(zchar, state, version);

      state = result.newState;

      if (result.type === "output") {
        tokens.push({ type: "zscii", value: result.zscii });
      } else if (result.type === "abbreviation") {
        tokens.push({ type: "abbreviation", zchar });
      } else if (result.type === "escape") {
        tokens.push({ type: "escape" });
      }
      // "shift" produces no token — it only updates state, per §3.2.4
    }

    if (isEnd) break;

    address += 2;
  }

  return { tokens, wordsConsumed };
}

function alphabetTableFor(alphabet: Alphabet, version: number): number[] {
  if (alphabet === 0) return A0_TABLE;
  if (alphabet === 1) return A1_TABLE;
  return version === 1 ? A2_TABLE_V1 : A2_TABLE;
}

function resetToLock(state: DecoderState): DecoderState {
  return { current: state.lock, lock: state.lock };
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
  const version = readVersion(storyData);

  const map: MemoryMap = readMemoryMap(storyData);

  // This is no longer as useful.
  // const result = unpackWordAt(storyData, map.dictionaryAddress);
  // console.log(result);

  console.log(`Abbreviations table address: 0x${map.abbreviationsTableAddress.toString(16)}`);

  const firstAbbrAddr = readAbbreviationEntry(storyData, map.abbreviationsTableAddress, 0);
  console.log(`First abbreviation byte address: 0x${firstAbbrAddr.toString(16)}`);

  const unpacked = unpackWordAt(storyData, firstAbbrAddr);
  console.log(unpacked);

  const result = decodeZString(storyData, firstAbbrAddr, version);

  console.log(
    result.tokens
      .map((t) => (t.type === "zscii" ? String.fromCharCode(t.value!) : `[${t.type}]`))
      .join(""),
  );
}

if (import.meta.main) {
  main();
}

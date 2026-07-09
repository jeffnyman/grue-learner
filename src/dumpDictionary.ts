import { readDictionary, validateDictionarySortOrder, type Dictionary } from "./app.ts";
import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile } from "./utils.ts";

function dumpDictionary(dictionary: Dictionary): void {
  const { header, entries } = dictionary;

  console.log(`Separators: [${header.separators.map((c) => String.fromCharCode(c)).join(" ")}]`);
  console.log(
    `Entry length: ${header.entryLength}, count: ${header.entryCount} (sorted: ${header.isSorted})\n`,
  );

  const violations = validateDictionarySortOrder(dictionary);
  const violationIndices = new Set<number>();
  violations.forEach((v, i) => {
    if (!v.passed) {
      violationIndices.add(i); // entries[i-1] and entries[i]
      violationIndices.add(i + 1);
    }
  });

  for (const entry of entries) {
    const flag = violationIndices.has(entry.index) ? " ⚠ sort-order" : "";
    console.log(`${entry.index}: "${entry.text}" @0x${entry.address.toString(16)}${flag}`);
  }

  const failedSort = violations.filter((v) => !v.passed);
  console.log(`\n${entries.length} entries, ${failedSort.length} sort-order violation(s)`);
}

function main(): void {
  const path = process.argv[2];

  if (!path) {
    console.error("Usage: dumpDictionary.ts <path-to-story-file>");
    process.exit(1);
  }

  const storyData = loadStoryFile(path);
  const version = readVersion(storyData);
  const map: MemoryMap = readMemoryMap(storyData);

  const dictionary = readDictionary(
    storyData,
    map.dictionaryAddress,
    version,
    map.abbreviationsTableAddress,
  );
  dumpDictionary(dictionary);
}

if (import.meta.main) {
  main();
}

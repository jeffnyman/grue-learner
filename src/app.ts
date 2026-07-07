import { readFileSync } from "node:fs";

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

function loadStoryFile(path: string): Uint8Array {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer);
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
}

if (import.meta.main) {
  main();
}

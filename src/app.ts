import { readFileSync } from "node:fs";

function loadStoryFile(path: string): Uint8Array {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer);
}

const path = process.argv[2];

if (!path) {
  console.error("Usage: app.ts <path-to-story-file>");
  process.exit(1);
}

const storyData = loadStoryFile(path);

console.log(`Loaded ${storyData.length} bytes from ${path}`);
console.log(`First 16 bytes:`, Array.from(storyData.slice(0, 16)));

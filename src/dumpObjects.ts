import { readMemoryMap, readVersion, type MemoryMap } from "./header.ts";
import { loadStoryFile } from "./utils.ts";
import {
  readObjectTable,
  readPropertyTableHeader,
  readPropertyList,
  type ObjectTable,
  type ObjectTableEntry,
} from "./objects.ts";

function setAttributes(obj: ObjectTableEntry): number[] {
  return obj.attributes.map((set, index) => (set ? index : -1)).filter((index) => index !== -1);
}

function printObject(
  obj: ObjectTableEntry,
  depth: number,
  byNumber: Map<number, ObjectTableEntry>,
  visited: Set<number>,
): void {
  const indent = ". ".repeat(depth);
  const attrs = setAttributes(obj);
  console.log(`${indent}[${obj.number}] "${obj.shortName}" attrs=[${attrs.join(",")}]`);

  if (visited.has(obj.number)) {
    console.warn(`${indent}  ⚠ cycle detected at object ${obj.number}, stopping this branch`);
    return;
  }
  visited.add(obj.number);

  let childNum = obj.child;
  while (childNum !== 0) {
    const child = byNumber.get(childNum);
    if (!child) {
      console.warn(`${indent}  ⚠ child ${childNum} not found, stopping this branch`);
      break;
    }
    printObject(child, depth + 1, byNumber, visited);
    childNum = child.sibling;
  }
}

function dumpObjectTree(table: ObjectTable): void {
  const byNumber = new Map(table.objects.map((o) => [o.number, o]));
  const visited = new Set<number>();
  const roots = table.objects.filter((o) => o.parent === 0);

  console.log(`Total objects: ${table.objectCount}, root objects: ${roots.length}\n`);

  for (const root of roots) {
    printObject(root, 0, byNumber, visited);
  }
}

function dumpProperties(
  storyData: Uint8Array,
  table: ObjectTable,
  version: number,
  abbreviationsTableAddress: number,
): void {
  for (const obj of table.objects) {
    const header = readPropertyTableHeader(
      storyData,
      obj.propertyTableAddress,
      version,
      abbreviationsTableAddress,
    );
    const properties = readPropertyList(storyData, header.propertiesStartAddress, version);
    if (properties.length === 0) continue;
    console.log(
      `[${obj.number}] "${obj.shortName}": ${properties.map((p) => p.number).join(", ")}`,
    );
  }
}

function main(): void {
  const path = process.argv[2];
  const mode = process.argv[3] ?? "tree"; // "tree" or "properties"

  if (!path) {
    console.error("Usage: dumpObjects.ts <path-to-story-file> [tree|properties]");
    process.exit(1);
  }

  const storyData = loadStoryFile(path);
  const version = readVersion(storyData);
  const map: MemoryMap = readMemoryMap(storyData);
  const table = readObjectTable(
    storyData,
    map.objectTableAddress,
    version,
    map.abbreviationsTableAddress,
  );

  if (mode === "properties") {
    dumpProperties(storyData, table, version, map.abbreviationsTableAddress);
  } else {
    dumpObjectTree(table);
  }
}

if (import.meta.main) {
  main();
}

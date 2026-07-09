import { describe, test, expect } from "vitest";
import { countObjects, readObjectEntry, readPropertyDefaultsTable } from "../src/app.ts";

describe("tautology", () => {
  test("reality still works", () => {
    expect(1 + 1).toEqual(2);
  });
});

describe("readPropertyDefaultsTable", () => {
  test("reads 31 words for a V3 file and computes the correct offset", () => {
    const mockStory = new Uint8Array(200);
    const tableAddr = 0x10;

    mockStory[tableAddr] = 0x00;
    mockStory[tableAddr + 1] = 0x2a; // first default = 42

    const result = readPropertyDefaultsTable(mockStory, tableAddr, 3);

    expect(result.defaults.length).toBe(31);
    expect(result.defaults[0]).toBe(42);
    expect(result.firstObjectEntryAddress).toBe(tableAddr + 31 * 2);
  });

  test("reads 63 words for a V5 file and computes the correct offset", () => {
    const mockStory = new Uint8Array(200);
    const tableAddr = 0x10;

    const result = readPropertyDefaultsTable(mockStory, tableAddr, 5);

    expect(result.defaults.length).toBe(63);
    expect(result.firstObjectEntryAddress).toBe(tableAddr + 63 * 2);
  });
});

describe("readObjectEntry", () => {
  test("reads a V3 (9-byte) entry with correct attribute bit ordering", () => {
    const mockStory = new Uint8Array(20);
    const base = 0x00;

    mockStory[base + 0] = 0b10000000; // attribute 0 set (topmost bit of first byte)
    mockStory[base + 1] = 0x00;
    mockStory[base + 2] = 0x00;
    mockStory[base + 3] = 0b00000001; // attribute 31 set (bottom bit of fourth byte)
    mockStory[base + 4] = 68; // parent
    mockStory[base + 5] = 239; // sibling
    mockStory[base + 6] = 21; // child
    mockStory[base + 7] = 0x2b;
    mockStory[base + 8] = 0x53; // propertyTableAddress = 0x2b53

    const entry = readObjectEntry(mockStory, 0x00, 1, 3);

    expect(entry.attributes[0]).toBe(true);
    expect(entry.attributes[31]).toBe(true);
    expect(entry.attributes[1]).toBe(false);
    expect(entry.parent).toBe(68);
    expect(entry.sibling).toBe(239);
    expect(entry.child).toBe(21);
    expect(entry.propertyTableAddress).toBe(0x2b53);
  });

  test("reads a V5 (14-byte) entry with word-sized parent/sibling/child", () => {
    const mockStory = new Uint8Array(28);
    const base = 0x00;

    mockStory[base + 6] = 0x00;
    mockStory[base + 7] = 100; // parent = 100
    mockStory[base + 8] = 0x00;
    mockStory[base + 9] = 200; // sibling = 200
    mockStory[base + 10] = 0x00;
    mockStory[base + 11] = 50; // child = 50
    mockStory[base + 12] = 0x10;
    mockStory[base + 13] = 0x00; // propertyTableAddress = 0x1000

    const entry = readObjectEntry(mockStory, 0x00, 1, 5);

    expect(entry.attributes.length).toBe(48);
    expect(entry.parent).toBe(100);
    expect(entry.sibling).toBe(200);
    expect(entry.child).toBe(50);
    expect(entry.propertyTableAddress).toBe(0x1000);
  });
});

describe("countObjects", () => {
  test("stops correctly when the next entry would collide with property data (V3)", () => {
    const mockStory = new Uint8Array(30);
    const base = 0x00;

    // Object 1 (bytes 0-8): property pointer -> 18
    mockStory[base + 7] = 0x00;
    mockStory[base + 8] = 18;
    // Object 2 (bytes 9-17): property pointer -> 18 (property data starts right after both entries)
    mockStory[base + 16] = 0x00;
    mockStory[base + 17] = 18;

    const count = countObjects(mockStory, base, 3);
    expect(count).toBe(2);
  });

  test("correctly identifies a single-object table (V3)", () => {
    const mockStory = new Uint8Array(20);
    const base = 0x00;

    // Object 1 (bytes 0-8): property pointer -> 9 (immediately after this one entry)
    mockStory[base + 7] = 0x00;
    mockStory[base + 8] = 9;

    const count = countObjects(mockStory, base, 3);
    expect(count).toBe(1);
  });

  test("uses the MINIMUM property address seen, not just the last one (V3)", () => {
    const mockStory = new Uint8Array(40);
    const base = 0x00;

    // Object 1: property pointer -> 30 (far away)
    mockStory[base + 7] = 0x00;
    mockStory[base + 8] = 30;
    // Object 2: property pointer -> 18 (closer! this is the real boundary)
    mockStory[base + 16] = 0x00;
    mockStory[base + 17] = 18;

    // A would-be object 3 would start at 18, which collides with the object 2's property table
    const count = countObjects(mockStory, base, 3);
    expect(count).toBe(2);
  });
});

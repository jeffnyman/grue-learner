import { describe, test, expect } from "vitest";
import { readVersion } from "../src/app.js";

describe("readVersion", () => {
  test("reads a valid version byte", () => {
    const mockStory = new Uint8Array([3, 0, 0, 0]);
    expect(readVersion(mockStory)).toBe(3);
  });

  test("rejects an illegal version byte", () => {
    const mockStory = new Uint8Array([9, 0, 0, 0]);
    expect(() => readVersion(mockStory)).toThrow();
  });
});

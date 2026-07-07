export function readWord(storyData: Uint8Array, offset: number): number {
  const byte1 = storyData[offset];
  const byte2 = storyData[offset + 1];

  if (byte1 === undefined || byte2 === undefined) {
    throw new Error(`Cannot read word at offset ${offset}: insufficient data`);
  }

  return (byte1 << 8) | byte2;
}

function main(): void {
  const path = process.argv[2];

  if (!path) {
    console.error("Usage: app.ts <path-to-story-file>");
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}

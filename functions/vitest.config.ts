import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Contended Firestore transactions retry with backoff in the emulator.
    testTimeout: 60_000,
    fileParallelism: false,
  },
});

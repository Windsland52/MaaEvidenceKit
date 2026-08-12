import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      MAA_EVIDENCE_TELEMETRY: "0",
    },
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tmp/**", ".cache/**"],
  },
});

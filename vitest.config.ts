import { availableParallelism } from "node:os";

import { defineConfig } from "vitest/config";

// Half the available cores: one worker per CPU leaves several git- and file-heavy test files
// competing for the same disk, and a cgroup-limited CI runner reports fewer cores than a dev machine.
const workers = Math.max(1, Math.floor(availableParallelism() / 2));

export default defineConfig({
  test: {
    env: {
      MAA_EVIDENCE_TELEMETRY: "0",
    },
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "tmp/**", ".cache/**"],
    // Real git materialization and directory scans legitimately run for seconds, and the default
    // 5 s budget makes those tests fail on a loaded machine while the suite runs in parallel. The
    // budget is a hang detector, not a performance assertion.
    testTimeout: 30_000,
    poolOptions: { threads: { maxThreads: workers, minThreads: 1 } },
  },
});

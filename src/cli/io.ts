import { readFile, writeFile } from "node:fs/promises";

import { isInspectionResult, type InspectionResult } from "../evidence/index.js";
import { profileStage } from "../profiling.js";

export async function readInspection(file: string): Promise<InspectionResult> {
  return profileStage("inspection.load", async () => {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!isInspectionResult(parsed)) {
      throw new Error(`Input is not a ${"maa-evidence/v1"} inspection result: ${file}`);
    }
    return parsed;
  });
}

export async function emit(content: string, output?: string): Promise<void> {
  const terminated = content.endsWith("\n") ? content : `${content}\n`;
  if (output === undefined) {
    await profileStage("output.write", async () => {
      process.stdout.write(terminated);
    });
    return;
  }
  await profileStage("output.write", () => writeFile(output, terminated, "utf8"));
}

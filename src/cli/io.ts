import { readFile, writeFile } from "node:fs/promises";

import { isInspectionResult, type InspectionResult } from "../evidence/index.js";

export async function readInspection(file: string): Promise<InspectionResult> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isInspectionResult(parsed)) {
    throw new Error(`Input is not a ${"maa-evidence/v1"} inspection result: ${file}`);
  }
  return parsed;
}

export async function emit(content: string, output?: string): Promise<void> {
  const terminated = content.endsWith("\n") ? content : `${content}\n`;
  if (output === undefined) {
    process.stdout.write(terminated);
    return;
  }
  await writeFile(output, terminated, "utf8");
}

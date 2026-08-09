import os from "node:os";
import path from "node:path";

export function maaEvidenceConfigDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment["MAA_EVIDENCE_CONFIG_DIR"] !== undefined) {
    return path.resolve(environment["MAA_EVIDENCE_CONFIG_DIR"]);
  }
  if (process.platform === "win32" && environment["LOCALAPPDATA"] !== undefined) {
    return path.join(environment["LOCALAPPDATA"], "MaaEvidenceKit");
  }
  if (environment["XDG_CONFIG_HOME"] !== undefined) {
    return path.join(environment["XDG_CONFIG_HOME"], "maa-evidence-kit");
  }
  return path.join(os.homedir(), ".config", "maa-evidence-kit");
}

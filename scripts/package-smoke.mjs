import { readFile, rm, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
const packageName = String(packageJson.name);
const version = String(packageJson.version);
const archiveName = `${packageName.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined) throw new Error("package:smoke must be run through pnpm.");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "maa-evidence-package-smoke-"));
const consumerRoot = path.join(temporaryRoot, "consumer");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      MAA_EVIDENCE_AUTO_UPDATE: "0",
      MAA_EVIDENCE_TELEMETRY: "0",
    },
    shell: false,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${output.length === 0 ? "" : `:\n${output}`}`);
  }
  return result.stdout.trim();
}

function runPnpm(args, cwd) {
  return run(process.execPath, [pnpmCli, ...args], cwd);
}

try {
  runPnpm(["pack", "--pack-destination", temporaryRoot], repositoryRoot);
  const archivePath = path.join(temporaryRoot, archiveName);
  await mkdir(consumerRoot);
  await writeFile(path.join(consumerRoot, "package.json"), JSON.stringify({
    name: "maa-evidence-package-smoke-consumer",
    private: true,
    type: "module",
  }), "utf8");
  runPnpm(["add", "--ignore-scripts", archivePath], consumerRoot);
  run(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { MAA_EVIDENCE_VERSION } from ${JSON.stringify(packageName)};
if (MAA_EVIDENCE_VERSION !== ${JSON.stringify(version)}) {
  throw new Error(\`SDK version mismatch: \${MAA_EVIDENCE_VERSION}\`);
}`,
  ], consumerRoot);
  const cliVersion = runPnpm(["exec", "maa-evidence", "--version"], consumerRoot);
  if (cliVersion !== version) {
    throw new Error(`CLI version mismatch: expected ${version}, received ${JSON.stringify(cliVersion)}`);
  }
  process.stdout.write(`Package smoke test passed for ${packageName}@${version}.\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

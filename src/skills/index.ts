import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UsageError } from "../evidence/index.js";
import { MAA_EVIDENCE_VERSION } from "../version.js";

/**
 * The host-agent Skill that ships inside this package.
 *
 * The Skill and the CLI are distributed separately, so a harness can end up reading a Skill that
 * describes a different MEK release than the one it runs. Everything here exists to make that
 * comparison cheap and local: the payload is read from this package rather than from the npm
 * registry, and every file carries a digest.
 *
 * The payload deliberately states no version of its own. A version written into `SKILL.md` would
 * have to be edited on every release, and it would still be wrong for a copy installed from the
 * repository rather than from a published tarball. Comparing bytes answers the question a reader
 * actually has - "is the copy in front of me the same one this CLI ships?" - and nothing in the
 * payload has to change when the package version does.
 */
export const PACKAGED_SKILL_NAME = "maa-evidence";
export const PACKAGED_SKILL_ENTRY = "SKILL.md";

export type PackagedSkillFile = {
  path: string;
  bytes: number;
  sha256: string;
};

export type PackagedSkill = {
  name: string;
  /** Version of the running package, which is what this payload was built from. */
  version: string;
  /** Absolute path of the packaged payload directory. */
  directory: string;
  entry: string;
  files: PackagedSkillFile[];
};

export type PackagedSkillInstall = {
  directory: string;
  installedDirectory: string;
  version: string;
  files: string[];
};

export type PackagedSkillFileStatus = "same" | "different" | "missing";

export type PackagedSkillCheck = {
  directory: string;
  installedDirectory: string;
  /** Version of the running package, which is the copy the comparison is against. */
  version: string;
  /** Whether an installed Skill directory exists at all. */
  installed: boolean;
  /** True when every packaged file exists with byte-identical content. */
  match: boolean;
  files: Array<{
    path: string;
    status: PackagedSkillFileStatus;
    /** Digest of the installed file, present when it could be read. */
    installedSha256?: string;
  }>;
  /**
   * Files in the installed directory that the payload does not ship, such as agent metadata. They
   * are reported but never make a copy count as different.
   */
  extraFiles: string[];
};

/**
 * The package root, from either `dist/skills/` (published) or `src/skills/` (tests, typecheck).
 * The Skill is published through `package.json#files`, so resolving it relative to this module keeps
 * `--print` and `--install` on exactly the copy the running build was packaged with.
 */
function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function packagedSkillDirectory(root: string = packageRoot()): string {
  return path.join(root, "skills", PACKAGED_SKILL_NAME);
}

/**
 * List a payload directory.
 *
 * `reject` is for the packaged payload, which is ours and must stay plain files. `skip` is for a
 * copy someone else installed: an agent may add its own metadata or point an entry at a file
 * elsewhere, and a verification command must report that rather than fail with a filesystem error.
 */
async function collectFiles(
  directory: string,
  symlinks: "reject" | "skip" = "reject",
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(directory, absolute).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      if (symlinks === "skip") continue;
      throw new Error(`The packaged Skill must not contain symbolic links: ${relative}`);
    }
    if (entry.isDirectory()) continue;
    if (!entry.isFile()) {
      if (symlinks === "skip") continue;
      throw new Error(`The packaged Skill contains an unsupported entry: ${relative}`);
    }
    files.push(relative);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * Create an install directory chain one level at a time, refusing to walk through a link.
 *
 * `mkdir(..., { recursive: true })` is happy to follow a pre-existing `references/` symlink, which
 * would place every write below it outside the directory the caller named.
 */
async function ensureInstallDirectories(root: string, segments: readonly string[]): Promise<void> {
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const metadata = await lstat(current).catch(() => undefined);
    if (metadata === undefined) {
      await mkdir(current);
      continue;
    }
    if (metadata.isSymbolicLink()) {
      throw new UsageError(`Refusing to write through a symbolic link: ${current}`);
    }
    if (!metadata.isDirectory()) {
      throw new UsageError(`The Skill install path is not a directory: ${current}`);
    }
  }
}

export async function loadPackagedSkill(directory: string = packagedSkillDirectory()): Promise<PackagedSkill> {
  const relativePaths = await collectFiles(directory);
  if (!relativePaths.includes(PACKAGED_SKILL_ENTRY)) {
    throw new Error(`The packaged Skill is missing ${PACKAGED_SKILL_ENTRY}: ${directory}`);
  }
  const files: PackagedSkillFile[] = [];
  for (const relativePath of relativePaths) {
    const content = await readFile(path.join(directory, ...relativePath.split("/")));
    files.push({
      path: relativePath,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return {
    name: PACKAGED_SKILL_NAME,
    version: MAA_EVIDENCE_VERSION,
    directory,
    entry: PACKAGED_SKILL_ENTRY,
    files,
  };
}

export async function readPackagedSkillFile(skill: PackagedSkill, relativePath: string): Promise<string> {
  if (!skill.files.some((file) => file.path === relativePath)) {
    throw new UsageError(
      `Unknown Skill file: ${relativePath}. Available: ${skill.files.map((file) => file.path).join(", ")}.`,
    );
  }
  return readFile(path.join(skill.directory, ...relativePath.split("/")), "utf8");
}

/**
 * Write the packaged payload to `<directory>/<skill name>/`.
 *
 * The caller names the destination, so MEK never guesses an agent's Skill directory. Targets are
 * checked with `lstat` first: following a symbolic link here would write outside the chosen
 * directory, which is the one thing an explicit install must not do.
 */
export async function installPackagedSkill(
  skill: PackagedSkill,
  directory: string,
): Promise<PackagedSkillInstall> {
  const installedDirectory = path.join(directory, skill.name);
  const installedMetadata = await lstat(installedDirectory).catch(() => undefined);
  if (installedMetadata?.isSymbolicLink() === true) {
    throw new UsageError(`Refusing to install into a symbolic link: ${installedDirectory}`);
  }
  if (installedMetadata !== undefined && !installedMetadata.isDirectory()) {
    throw new UsageError(`The Skill install path is not a directory: ${installedDirectory}`);
  }
  await mkdir(installedDirectory, { recursive: true });
  const written: string[] = [];
  for (const file of skill.files) {
    const segments = file.path.split("/");
    const target = path.join(installedDirectory, ...segments);
    const targetMetadata = await lstat(target).catch(() => undefined);
    if (targetMetadata?.isSymbolicLink() === true) {
      throw new UsageError(`Refusing to overwrite a symbolic link: ${target}`);
    }
    if (targetMetadata?.isDirectory() === true) {
      throw new UsageError(`Refusing to overwrite a directory: ${target}`);
    }
    await ensureInstallDirectories(installedDirectory, segments.slice(0, -1));
    await writeFile(target, await readFile(path.join(skill.directory, ...segments)));
    written.push(file.path);
  }
  return {
    directory,
    installedDirectory,
    version: skill.version,
    files: written,
  };
}

/**
 * Compare an installed copy against the packaged payload.
 *
 * The caller names the directory, so MEK never guesses an agent's Skill path, and the comparison is
 * a byte comparison rather than a version claim: a copy that a release did not touch stays `same`
 * even though the package version moved on. Directory symlinks are followed, because the `skills`
 * CLI installs agent directories as links to one canonical copy; only writing refuses links.
 */
export async function checkPackagedSkill(
  skill: PackagedSkill,
  directory: string,
): Promise<PackagedSkillCheck> {
  const installedDirectory = path.join(directory, skill.name);
  // `stat` follows links on purpose: the skills CLI installs an agent target as a link to one
  // canonical copy. A link to a file, a broken link, or a plain file reports as "not installed"
  // rather than surfacing a raw filesystem error for a path the caller merely named.
  const installedMetadata = await stat(installedDirectory).catch(() => undefined);
  const installed = installedMetadata?.isDirectory() === true;
  const files: PackagedSkillCheck["files"] = [];
  for (const file of skill.files) {
    const target = path.join(installedDirectory, ...file.path.split("/"));
    const content = installed ? await readFile(target).catch(() => undefined) : undefined;
    files.push({
      path: file.path,
      status: content === undefined
        ? "missing"
        : createHash("sha256").update(content).digest("hex") === file.sha256
          ? "same"
          : "different",
      ...(content === undefined
        ? {}
        : { installedSha256: createHash("sha256").update(content).digest("hex") }),
    });
  }
  const packaged = new Set(skill.files.map((file) => file.path));
  const extraFiles = installed
    ? (await collectFiles(installedDirectory, "skip")).filter((file) => !packaged.has(file))
    : [];
  return {
    directory,
    installedDirectory,
    version: skill.version,
    installed,
    match: installed && files.every((file) => file.status === "same"),
    files,
    extraFiles,
  };
}

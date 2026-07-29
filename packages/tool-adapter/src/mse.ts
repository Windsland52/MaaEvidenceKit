import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  FsContentLoader,
  InterfaceBundle,
  buildDiagnosticMessage,
  performDiagnostic,
  type IContentLoader,
  type IContentWatcher,
  type IContentWatcherController,
  type IContentWatcherDelegate,
  type TaskName
} from "@nekosu/maa-pipeline-manager";

const INTERFACE_CANDIDATES = [
  "interface.json",
  "interface.jsonc",
  "assets/interface.json",
  "assets/interface.jsonc"
] as const;
const MAX_SCANNED_FILES = 10_000;
const MAX_CONFIGURATIONS = 256;
const MAX_DIAGNOSTICS = 500;
const MAX_TASK_RESOLUTION_CONFIGURATIONS = 64;
const CONFINEMENT_ERROR =
  "MSE project access escaped the configured project root.";
const NO_ACTIVE_RESOURCE_PATH_WARNING =
  "No activated MSE resource paths were readable.";

export type MseCompatibility = {
  status: "supported" | "partial" | "unsupported";
  reason: string;
};

export type MseSyntaxMode = "maafw" | "maa";

export type MseTaskBinding = {
  name: string;
  entry: string | null;
};

export type MseConfigurationSummary = {
  controller: string | null;
  resource: string | null;
  resource_paths: string[];
  task_count: number;
  pipeline_file_count: number;
  diagnostic_count: number;
  error_count: number;
  warning_count: number;
};

export type MseDiagnostic = {
  type: string;
  level: "warning" | "error";
  source_path: string;
  line: number;
  column: number;
  length: number;
  message: string;
  controller: string | null;
  resource: string | null;
};

export type MseProjectPreflightResult = {
  schema_version: "mde-mse-project-preflight/v2";
  project_root: string;
  interface_path: string | null;
  syntax_mode: MseSyntaxMode;
  compatibility: MseCompatibility;
  controllers: string[];
  resources: string[];
  task_bindings: MseTaskBinding[];
  configurations: MseConfigurationSummary[];
  configurations_truncated: boolean;
  diagnostics: MseDiagnostic[];
  diagnostics_truncated: boolean;
  warnings: string[];
};

export type MseTaskDefinition = {
  source_path: string;
  line: number;
  column: number;
  raw_config: Record<string, unknown>;
};

export type MseTaskReference = {
  kind: string;
  target: string;
  source_path: string;
  line: number;
  column: number;
};

export type MseResolvedTask = {
  name: string;
  controller: string | null;
  resource: string | null;
  found: boolean;
  definitions: MseTaskDefinition[];
  effective_config: Record<string, unknown>;
  references: MseTaskReference[];
};

export type MseTaskResolutionResult = {
  schema_version: "mde-mse-task-resolution/v2";
  project_root: string;
  interface_path: string | null;
  syntax_mode: MseSyntaxMode;
  compatibility: MseCompatibility;
  requested_tasks: string[];
  resolutions: MseResolvedTask[];
  configurations_truncated: boolean;
  warnings: string[];
};

class ProjectRootConfinement {
  private readonly root: string;
  private readonly rootReal: Promise<string>;
  private violations = 0;

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
    this.rootReal = realpath(this.root);
  }

  recordViolation(): void {
    this.violations += 1;
  }

  assertNoViolations(): void {
    if (this.violations > 0) {
      throw new Error(CONFINEMENT_ERROR);
    }
  }

  async isAllowed(target: string): Promise<boolean> {
    const resolved = path.resolve(target);
    if (!this.isContained(this.root, resolved)) {
      this.recordViolation();
      return false;
    }
    const targetReal = await this.realpathExistingTargetOrAncestor(resolved);
    if (targetReal === null) {
      this.recordViolation();
      return false;
    }
    let rootReal;
    try {
      rootReal = await this.rootReal;
    } catch {
      this.recordViolation();
      return false;
    }
    if (!this.isContained(rootReal, targetReal)) {
      this.recordViolation();
      return false;
    }
    return true;
  }

  private async realpathExistingTargetOrAncestor(target: string): Promise<string | null> {
    let current = target;
    while (this.isContained(this.root, current)) {
      try {
        return await realpath(current);
      } catch (error: unknown) {
        if (!["ENOENT", "ENOTDIR"].includes(errorCode(error) ?? "")) return null;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
      }
    }
    return null;
  }

  private isContained(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return (
      relative.length === 0
      || (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  }
}

class MseResourceAccessRecorder {
  private readonly issues = new Map<string, string>();
  private readonly expectedFiles = new Set<string>();

  constructor(private readonly projectRoot: string) {}

  get hasIssues(): boolean {
    return this.issues.size > 0;
  }

  recordMissingRoot(target: string): void {
    this.record(
      target,
      "Configured MSE resource root is missing: "
    );
  }

  recordNonDirectoryRoot(target: string): void {
    this.record(
      target,
      "Configured MSE resource root is not a directory: "
    );
  }

  recordUnreadableRoot(target: string): void {
    this.record(
      target,
      "Configured MSE resource root is unreadable: "
    );
  }

  recordExpectedFile(target: string): void {
    this.expectedFiles.add(path.resolve(target));
  }

  recordMissingFile(target: string): void {
    this.record(
      target,
      "Configured MSE project file is missing: "
    );
  }

  recordNonFile(target: string): void {
    this.record(
      target,
      "Configured MSE project file is not a file: "
    );
  }

  recordUnreadableFile(target: string): void {
    this.record(
      target,
      "Configured MSE project file is unreadable: "
    );
  }

  recordUnavailableFile(target: string): void {
    if (!this.expectedFiles.has(path.resolve(target))) return;
    this.record(
      target,
      "MSE project file was unavailable during read: "
    );
  }

  warnings(): string[] {
    return [...this.issues.values()].sort();
  }

  private record(target: string, prefix: string): void {
    this.issues.set(
      prefix + path.resolve(target),
      prefix + relativeSourcePath(this.projectRoot, target) + "."
    );
  }
}

class ConfinedContentLoader implements IContentLoader {
  private readonly inner = new FsContentLoader();

  constructor(
    private readonly confinement: ProjectRootConfinement,
    private readonly accessRecorder: MseResourceAccessRecorder
  ) {}

  async get(file: string): Promise<string | null> {
    if (!(await this.confinement.isAllowed(file))) return null;
    try {
      const content = await this.inner.get(file);
      if (content === null) this.accessRecorder.recordUnavailableFile(file);
      return content;
    } catch {
      this.accessRecorder.recordUnavailableFile(file);
      return null;
    }
  }
}

class ReadOnlySnapshotWatcher implements IContentWatcher {
  private scannedFiles = 0;

  constructor(
    private readonly confinement: ProjectRootConfinement,
    private readonly accessRecorder: MseResourceAccessRecorder
  ) {}

  async watch(
    root: string,
    isFile: boolean,
    delegate: IContentWatcherDelegate
  ): Promise<IContentWatcherController> {
    if (!(await this.confinement.isAllowed(root))) {
      return { stop() {} };
    }
    if (isFile) {
      const rootStatus = await fileScanStatus(root);
      if (rootStatus === "missing") {
        this.accessRecorder.recordMissingFile(root);
      } else if (rootStatus === "not_file") {
        this.accessRecorder.recordNonFile(root);
      } else if (rootStatus === "unreadable") {
        this.accessRecorder.recordUnreadableFile(root);
      } else {
        this.accessRecorder.recordExpectedFile(root);
      }
      return { stop() {} };
    }
    if (!isFile) {
      const rootStatus = await directoryScanStatus(root);
      if (rootStatus === "missing") {
        this.accessRecorder.recordMissingRoot(root);
        return { stop() {} };
      }
      if (rootStatus === "not_directory") {
        this.accessRecorder.recordNonDirectoryRoot(root);
        return { stop() {} };
      }
      if (rootStatus === "unreadable") {
        this.accessRecorder.recordUnreadableRoot(root);
        return { stop() {} };
      }
      this.scannedFiles = 0;
      await this.scanDirectory(path.resolve(root), delegate);
    }
    return { stop() {} };
  }

  private async scanDirectory(
    directory: string,
    delegate: IContentWatcherDelegate
  ): Promise<void> {
    if (!(await this.confinement.isAllowed(directory))) return;
    if (!delegate.filter(directory, true)) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      this.accessRecorder.recordUnreadableRoot(directory);
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (!(await this.confinement.isAllowed(target))) continue;
      if (entry.isDirectory()) {
        await this.scanDirectory(target, delegate);
      } else if (entry.isFile() && delegate.filter(target, false)) {
        this.scannedFiles += 1;
        if (this.scannedFiles > MAX_SCANNED_FILES) {
          throw new Error("MSE project scan exceeded " + MAX_SCANNED_FILES + " files.");
        }
        this.accessRecorder.recordExpectedFile(target);
        delegate.fileAdded(target);
      }
    }
  }
}

const isFile = async (
  target: string,
  confinement?: ProjectRootConfinement
): Promise<boolean> => {
  try {
    if (confinement !== undefined && !(await confinement.isAllowed(target))) return false;
    const targetStat = await stat(target);
    return targetStat.isFile();
  } catch {
    return false;
  }
};

const directoryScanStatus = async (
  target: string
): Promise<"directory" | "missing" | "not_directory" | "unreadable"> => {
  try {
    const targetStat = await stat(target);
    return targetStat.isDirectory() ? "directory" : "not_directory";
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === "ENOENT") return missingPathStatus(target, "not_directory");
    if (code === "ENOTDIR") return "not_directory";
    return "unreadable";
  }
};

const fileScanStatus = async (
  target: string
): Promise<"file" | "missing" | "not_file" | "unreadable"> => {
  try {
    const targetStat = await stat(target);
    return targetStat.isFile() ? "file" : "not_file";
  } catch (error: unknown) {
    const code = errorCode(error);
    if (code === "ENOENT") return missingPathStatus(target, "not_file");
    if (code === "ENOTDIR") return "not_file";
    return "unreadable";
  }
};

const missingPathStatus = async <T extends "not_directory" | "not_file">(
  target: string,
  blockedByFileStatus: T
): Promise<"missing" | T | "unreadable"> => {
  let current = path.dirname(path.resolve(target));
  while (true) {
    try {
      const currentStat = await stat(current);
      return currentStat.isDirectory() ? "missing" : blockedByFileStatus;
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") return "unreadable";
      const parent = path.dirname(current);
      if (parent === current) return "missing";
      current = parent;
    }
  }
};

const isDirectory = async (
  target: string,
  confinement?: ProjectRootConfinement
): Promise<boolean> => {
  try {
    if (confinement !== undefined && !(await confinement.isAllowed(target))) return false;
    const targetStat = await stat(target);
    return targetStat.isDirectory();
  } catch {
    return false;
  }
};

const errorCode = (error: unknown): string | undefined => {
  return isRecord(error) && typeof error["code"] === "string"
    ? error["code"]
    : undefined;
};

const isAbsoluteOnSupportedPlatform = (target: string): boolean => {
  return path.posix.isAbsolute(target) || path.win32.isAbsolute(target);
};

const assertInterfacePathsAreRelative = (bundle: InterfaceBundle): void => {
  for (const ref of bundle.info.refs) {
    if (
      ref.type === "interface.resource_path" ||
      ref.type === "interface.import_path" ||
      ref.type === "interface.language_path"
    ) {
      if (isAbsoluteOnSupportedPlatform(ref.target)) {
        throw new Error(CONFINEMENT_ERROR);
      }
    }
  }
};

const findInterface = async (
  projectRoot: string,
  confinement: ProjectRootConfinement
): Promise<string | null> => {
  for (const relative of INTERFACE_CANDIDATES) {
    const candidate = path.join(projectRoot, relative);
    if (await isFile(candidate, confinement)) return candidate;
  }
  return null;
};

const relativeSourcePath = (projectRoot: string, target: string): string => {
  const relative = path.relative(projectRoot, target);
  return relative.length > 0 ? relative.replaceAll(path.sep, "/") : ".";
};

const lineColumn = (content: string, offset: number): [number, number] => {
  const prefix = content.slice(0, Math.max(0, offset));
  const lines = prefix.split(/\r?\n/u);
  return [lines.length, (lines.at(-1)?.length ?? 0) + 1];
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toJsonRecord = (value: unknown): Record<string, unknown> => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return {};
  const parsed = JSON.parse(serialized) as unknown;
  return isRecord(parsed) ? parsed : {};
};

const taskBindings = (bundle: InterfaceBundle): MseTaskBinding[] => {
  const entries = new Map<string, string>();
  for (const ref of bundle.info.refs) {
    if (ref.type === "interface.task_entry") entries.set(ref.task, ref.target);
  }
  return bundle.info.decls
    .filter((decl) => decl.type === "interface.task")
    .map((decl) => ({
      name: decl.name,
      entry: entries.get(decl.name) ?? null
    }));
};

export async function runMseProjectPreflight(
  targetPath: string,
  syntaxMode: MseSyntaxMode
): Promise<MseProjectPreflightResult> {
  const projectRoot = path.resolve(targetPath);
  if (!(await isDirectory(projectRoot))) {
    throw new Error("MSE project path is not a directory: " + projectRoot);
  }
  const confinement = new ProjectRootConfinement(projectRoot);
  if (!(await confinement.isAllowed(projectRoot))) {
    throw new Error(CONFINEMENT_ERROR);
  }
  const interfacePath = await findInterface(projectRoot, confinement);
  confinement.assertNoViolations();
  const base = {
    schema_version: "mde-mse-project-preflight/v2" as const,
    project_root: projectRoot,
    syntax_mode: syntaxMode
  };
  if (interfacePath === null) {
    return {
      ...base,
      interface_path: null,
      compatibility: {
        status: "unsupported",
        reason: "No conventional interface.json or interface.jsonc was found."
      },
      controllers: [],
      resources: [],
      task_bindings: [],
      configurations: [],
      configurations_truncated: false,
      diagnostics: [],
      diagnostics_truncated: false,
      warnings: []
    };
  }

  const accessRecorder = new MseResourceAccessRecorder(projectRoot);
  const loader = new ConfinedContentLoader(confinement, accessRecorder);
  const watcher = new ReadOnlySnapshotWatcher(confinement, accessRecorder);
  const bundle = new InterfaceBundle(
    loader,
    watcher,
    syntaxMode === "maa",
    path.dirname(interfacePath),
    path.basename(interfacePath)
  );
  const diagnostics: MseDiagnostic[] = [];
  const configurations: MseConfigurationSummary[] = [];
  const fileContents = new Map<string, string>();
  const locate = async (file: string, offset: number): Promise<[number, number]> => {
    let content = fileContents.get(file);
    if (content === undefined) {
      const loadedContent = await loader.get(file);
      confinement.assertNoViolations();
      if (loadedContent === null) {
        throw new Error("MSE project file content is unavailable.");
      }
      content = loadedContent;
      fileContents.set(file, content);
    }
    return lineColumn(content, offset);
  };

  try {
    await bundle.load();
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    await bundle.flush(false);
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    const controllers = [...new Set(bundle.allControllerNames())];
    const resources = [...new Set(bundle.allResourceNames())];
    const controllerChoices: Array<string | null> =
      controllers.length > 0 ? controllers : [null];

    let configurationsTruncated = false;
    configurationLoop: for (const controller of controllerChoices) {
      const compatibleResources = [
        ...new Set(bundle.allResourceNames(controller ?? ""))
      ];
      const resourceChoices: Array<string | null> =
        compatibleResources.length > 0 ? compatibleResources : [null];
      for (const resource of resourceChoices) {
        if (configurations.length >= MAX_CONFIGURATIONS) {
          configurationsTruncated = true;
          break configurationLoop;
        }
        await bundle.switchActive(controller ?? "", resource ?? "");
        confinement.assertNoViolations();
        await bundle.flush(true);
        confinement.assertNoViolations();
        const rawDiagnostics = performDiagnostic(bundle, {});
        const counts = { error: 0, warning: 0 };
        for (const diagnostic of rawDiagnostics) {
          counts[diagnostic.level] += 1;
          if (diagnostics.length >= MAX_DIAGNOSTICS) continue;
          const [start, , message] = await buildDiagnosticMessage(
            bundle.root,
            diagnostic,
            locate,
            {}
          );
          diagnostics.push({
            type: diagnostic.type,
            level: diagnostic.level,
            source_path: relativeSourcePath(projectRoot, diagnostic.file),
            line: start[0],
            column: start[1],
            length: diagnostic.length,
            message,
            controller,
            resource
          });
        }
        const pipelineFiles = new Set(
          bundle.bundles.flatMap((resourceBundle) =>
            Object.keys(resourceBundle.files).map((file) =>
              path.join(resourceBundle.root, file)
            )
          )
        );
        configurations.push({
          controller,
          resource,
          resource_paths: bundle.paths.map((item) => item.replaceAll(path.sep, "/")),
          task_count: bundle.topLayer.getTaskList().length,
          pipeline_file_count: pipelineFiles.size,
          diagnostic_count: rawDiagnostics.length,
          error_count: counts.error,
          warning_count: counts.warning
        });
      }
    }

    const warnings: string[] = [];
    const diagnosticsTruncated = configurations.reduce(
      (total, item) => total + item.diagnostic_count,
      0
    ) > diagnostics.length;
    if (diagnosticsTruncated) {
      warnings.push("Diagnostics were truncated at " + MAX_DIAGNOSTICS + " records.");
    }
    if (configurationsTruncated) {
      warnings.push(
        "Controller/resource configurations were truncated at "
        + MAX_CONFIGURATIONS
        + " records."
      );
    }
    const hasConfigurations = configurations.some(
      (item) => item.resource_paths.length > 0
    );
    if (!hasConfigurations) {
      warnings.push(NO_ACTIVE_RESOURCE_PATH_WARNING);
    }
    warnings.push(...accessRecorder.warnings());
    const fullyLoadedConfigurations = hasConfigurations && !accessRecorder.hasIssues;
    return {
      ...base,
      interface_path: relativeSourcePath(projectRoot, interfacePath),
      compatibility: {
        status: fullyLoadedConfigurations ? "supported" : "partial",
        reason: fullyLoadedConfigurations
          ? "The interface and at least one resource configuration were loaded."
          : hasConfigurations
            ? "The interface loaded, but one or more activated resource paths could not be fully scanned."
            : "The interface loaded, but no resource paths were activated."
      },
      controllers,
      resources,
      task_bindings: taskBindings(bundle),
      configurations,
      configurations_truncated: configurationsTruncated,
      diagnostics,
      diagnostics_truncated: diagnosticsTruncated,
      warnings
    };
  } finally {
    bundle.stop();
  }
}

async function resolveTask(
  bundle: InterfaceBundle,
  projectRoot: string,
  name: string,
  controller: string | null,
  resource: string | null,
  locate: (file: string, offset: number) => Promise<[number, number]>
): Promise<MseResolvedTask> {
  const groups = bundle.topLayer.getTask(name as TaskName);
  const definitions: MseTaskDefinition[] = [];
  const references: MseTaskReference[] = [];
  for (const group of groups) {
    for (const info of group.infos) {
      const definitionPosition = await locate(info.file, info.prop.offset);
      definitions.push({
        source_path: relativeSourcePath(projectRoot, info.file),
        line: definitionPosition[0],
        column: definitionPosition[1],
        raw_config: toJsonRecord(info.obj)
      });
      for (const reference of info.info.refs) {
        if (!("target" in reference) || typeof reference.target !== "string") continue;
        const referencePosition = await locate(reference.file, reference.location.offset);
        references.push({
          kind: reference.type,
          target: reference.target,
          source_path: relativeSourcePath(projectRoot, reference.file),
          line: referencePosition[0],
          column: referencePosition[1]
        });
      }
    }
  }
  return {
    name,
    controller,
    resource,
    found: definitions.length > 0,
    definitions,
    effective_config: definitions.length > 0
      ? toJsonRecord(bundle.topLayer.evalTask(name as TaskName))
      : {},
    references
  };
}

export async function runMseTaskResolution(
  targetPath: string,
  requestedTasks: string[],
  syntaxMode: MseSyntaxMode,
  requestedController?: string,
  requestedResource?: string
): Promise<MseTaskResolutionResult> {
  const tasks = [...new Set(requestedTasks.map((item) => item.trim()))]
    .filter((item) => item.length > 0);
  if (tasks.length === 0) {
    throw new Error("MSE task resolution requires at least one task name.");
  }
  const projectRoot = path.resolve(targetPath);
  if (!(await isDirectory(projectRoot))) {
    throw new Error("MSE project path is not a directory: " + projectRoot);
  }
  const confinement = new ProjectRootConfinement(projectRoot);
  if (!(await confinement.isAllowed(projectRoot))) {
    throw new Error(CONFINEMENT_ERROR);
  }
  const interfacePath = await findInterface(projectRoot, confinement);
  confinement.assertNoViolations();
  if (interfacePath === null) {
    return {
      schema_version: "mde-mse-task-resolution/v2",
      project_root: projectRoot,
      interface_path: null,
      syntax_mode: syntaxMode,
      compatibility: {
        status: "unsupported",
        reason: "No conventional interface.json or interface.jsonc was found."
      },
      requested_tasks: tasks,
      resolutions: [],
      configurations_truncated: false,
      warnings: []
    };
  }
  const accessRecorder = new MseResourceAccessRecorder(projectRoot);
  const loader = new ConfinedContentLoader(confinement, accessRecorder);
  const watcher = new ReadOnlySnapshotWatcher(confinement, accessRecorder);
  const bundle = new InterfaceBundle(
    loader,
    watcher,
    syntaxMode === "maa",
    path.dirname(interfacePath),
    path.basename(interfacePath)
  );
  const fileContents = new Map<string, string>();
  const locate = async (file: string, offset: number): Promise<[number, number]> => {
    let content = fileContents.get(file);
    if (content === undefined) {
      const loadedContent = await loader.get(file);
      confinement.assertNoViolations();
      if (loadedContent === null) {
        throw new Error("MSE project file content is unavailable.");
      }
      content = loadedContent;
      fileContents.set(file, content);
    }
    return lineColumn(content, offset);
  };
  const resolutions: MseResolvedTask[] = [];
  let configurationsTruncated = false;
  let configurationCount = 0;
  let hasActivatedResourcePaths = false;
  try {
    await bundle.load();
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    await bundle.flush(false);
    confinement.assertNoViolations();
    assertInterfacePathsAreRelative(bundle);
    const controllers = requestedController === undefined
      ? [...new Set(bundle.allControllerNames())]
      : [requestedController];
    const controllerChoices: Array<string | null> =
      controllers.length > 0 ? controllers : [null];
    configurationLoop: for (const controller of controllerChoices) {
      const resources = requestedResource === undefined
        ? [...new Set(bundle.allResourceNames(controller ?? ""))]
        : [requestedResource];
      const resourceChoices: Array<string | null> =
        resources.length > 0 ? resources : [null];
      for (const resource of resourceChoices) {
        if (configurationCount >= MAX_TASK_RESOLUTION_CONFIGURATIONS) {
          configurationsTruncated = true;
          break configurationLoop;
        }
        configurationCount += 1;
        await bundle.switchActive(controller ?? "", resource ?? "");
        confinement.assertNoViolations();
        if (bundle.paths.length > 0) hasActivatedResourcePaths = true;
        await bundle.flush(true);
        confinement.assertNoViolations();
        for (const task of tasks) {
          resolutions.push(
            await resolveTask(bundle, projectRoot, task, controller, resource, locate)
          );
        }
      }
    }
    const warnings: string[] = [];
    if (configurationsTruncated) {
      warnings.push(
        "Controller/resource configurations were truncated at "
        + MAX_TASK_RESOLUTION_CONFIGURATIONS
        + " records."
      );
    }
    if (!hasActivatedResourcePaths) {
      warnings.push(NO_ACTIVE_RESOURCE_PATH_WARNING);
    }
    warnings.push(...accessRecorder.warnings());
    const fullyLoadedConfigurations =
      hasActivatedResourcePaths && !accessRecorder.hasIssues;
    return {
      schema_version: "mde-mse-task-resolution/v2",
      project_root: projectRoot,
      interface_path: relativeSourcePath(projectRoot, interfacePath),
      syntax_mode: syntaxMode,
      compatibility: {
        status: fullyLoadedConfigurations ? "supported" : "partial",
        reason: fullyLoadedConfigurations
          ? "Requested tasks were resolved across active configurations."
          : hasActivatedResourcePaths
            ? "Requested tasks were resolved, but one or more activated resource paths could not be fully scanned."
            : "The interface loaded, but no resource paths were activated."
      },
      requested_tasks: tasks,
      resolutions,
      configurations_truncated: configurationsTruncated,
      warnings
    };
  } finally {
    bundle.stop();
  }
}

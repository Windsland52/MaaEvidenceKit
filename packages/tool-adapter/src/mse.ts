import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  FsContentLoader,
  InterfaceBundle,
  buildDiagnosticMessage,
  performDiagnostic,
  type IContentWatcher,
  type IContentWatcherController,
  type IContentWatcherDelegate
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

export type MseCompatibility = {
  status: "supported" | "partial" | "unsupported";
  reason: string;
};

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
  schema_version: "mde-mse-project-preflight/v1";
  project_root: string;
  interface_path: string | null;
  syntax_mode: "maafw" | "maa";
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

class ReadOnlySnapshotWatcher implements IContentWatcher {
  private scannedFiles = 0;

  async watch(
    root: string,
    isFile: boolean,
    delegate: IContentWatcherDelegate
  ): Promise<IContentWatcherController> {
    if (!isFile) {
      this.scannedFiles = 0;
      await this.scanDirectory(path.resolve(root), delegate);
    }
    return { stop() {} };
  }

  private async scanDirectory(
    directory: string,
    delegate: IContentWatcherDelegate
  ): Promise<void> {
    if (!delegate.filter(directory, true)) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.scanDirectory(target, delegate);
      } else if (entry.isFile() && delegate.filter(target, false)) {
        this.scannedFiles += 1;
        if (this.scannedFiles > MAX_SCANNED_FILES) {
          throw new Error("MSE project scan exceeded " + MAX_SCANNED_FILES + " files.");
        }
        delegate.fileAdded(target);
      }
    }
  }
}

const isFile = async (target: string): Promise<boolean> => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const isDirectory = async (target: string): Promise<boolean> => {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
};

const findInterface = async (projectRoot: string): Promise<string | null> => {
  for (const relative of INTERFACE_CANDIDATES) {
    const candidate = path.join(projectRoot, relative);
    if (await isFile(candidate)) return candidate;
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
  targetPath: string
): Promise<MseProjectPreflightResult> {
  const projectRoot = path.resolve(targetPath);
  if (!(await isDirectory(projectRoot))) {
    throw new Error("MSE project path is not a directory: " + projectRoot);
  }
  const interfacePath = await findInterface(projectRoot);
  const maaMode = await isDirectory(path.join(projectRoot, "src", "MaaCore"));
  const base = {
    schema_version: "mde-mse-project-preflight/v1" as const,
    project_root: projectRoot,
    syntax_mode: maaMode ? "maa" as const : "maafw" as const
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

  const loader = new FsContentLoader();
  const watcher = new ReadOnlySnapshotWatcher();
  const bundle = new InterfaceBundle(
    loader,
    watcher,
    maaMode,
    path.dirname(interfacePath),
    path.basename(interfacePath)
  );
  const diagnostics: MseDiagnostic[] = [];
  const configurations: MseConfigurationSummary[] = [];
  const fileContents = new Map<string, string>();
  const locate = async (file: string, offset: number): Promise<[number, number]> => {
    let content = fileContents.get(file);
    if (content === undefined) {
      content = await readFile(file, "utf8");
      fileContents.set(file, content);
    }
    return lineColumn(content, offset);
  };

  try {
    await bundle.load();
    await bundle.flush(false);
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
        await bundle.flush(true);
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
    return {
      ...base,
      interface_path: relativeSourcePath(projectRoot, interfacePath),
      compatibility: {
        status: hasConfigurations ? "supported" : "partial",
        reason: hasConfigurations
          ? "The interface and at least one resource configuration were loaded."
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

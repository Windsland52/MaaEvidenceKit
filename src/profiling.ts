import { AsyncLocalStorage } from "node:async_hooks";

import { MAA_EVIDENCE_VERSION } from "./version.js";

export const PERFORMANCE_PROFILE_SCHEMA_VERSION = "maa-evidence-profile/v1" as const;

export type PerformanceProfileStage = {
  name: string;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

export type PerformanceProfile = {
  schemaVersion: typeof PERFORMANCE_PROFILE_SCHEMA_VERSION;
  mekVersion: string;
  command: string;
  status: "ok" | "error";
  durationMs: number;
  concurrentStagesMayOverlap: true;
  stages: PerformanceProfileStage[];
};

type StageAggregate = {
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

type ProfileState = {
  command: string;
  startedAt: number;
  stages: Map<string, StageAggregate>;
};

export type ProfiledOutcome<T> =
  | { ok: true; value: T; profile: PerformanceProfile }
  | { ok: false; error: unknown; profile: PerformanceProfile };

const profileStorage = new AsyncLocalStorage<ProfileState>();

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function recordStage(state: ProfileState, name: string, durationMs: number): void {
  const current = state.stages.get(name) ?? { count: 0, totalDurationMs: 0, maxDurationMs: 0 };
  current.count += 1;
  current.totalDurationMs += durationMs;
  current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);
  state.stages.set(name, current);
}

function snapshot(state: ProfileState, status: "ok" | "error"): PerformanceProfile {
  return {
    schemaVersion: PERFORMANCE_PROFILE_SCHEMA_VERSION,
    mekVersion: MAA_EVIDENCE_VERSION,
    command: state.command,
    status,
    durationMs: rounded(performance.now() - state.startedAt),
    concurrentStagesMayOverlap: true,
    stages: [...state.stages.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, stage]) => ({
        name,
        count: stage.count,
        totalDurationMs: rounded(stage.totalDurationMs),
        maxDurationMs: rounded(stage.maxDurationMs),
      })),
  };
}

export async function runProfiled<T>(command: string, operation: () => Promise<T>): Promise<ProfiledOutcome<T>> {
  const state: ProfileState = { command, startedAt: performance.now(), stages: new Map() };
  try {
    const value = await profileStorage.run(state, operation);
    return { ok: true, value, profile: snapshot(state, "ok") };
  } catch (error: unknown) {
    return { ok: false, error, profile: snapshot(state, "error") };
  }
}

export async function profileStage<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const state = profileStorage.getStore();
  if (state === undefined) return operation();
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    recordStage(state, name, performance.now() - startedAt);
  }
}

export function profileStageSync<T>(name: string, operation: () => T): T {
  const state = profileStorage.getStore();
  if (state === undefined) return operation();
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    recordStage(state, name, performance.now() - startedAt);
  }
}

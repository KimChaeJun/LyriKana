// src/correctionStore.ts

import { parseCorrectionLogsJson } from "./correctionLogSchema";
import { CorrectionLog } from "./types";

const STORAGE_KEY = "lyrikana_correction_logs";
const memoryStorage = new Map<string, string>();

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ImportCorrectionLogsOptions {
  mode?: "merge" | "replace";
}

export interface ImportCorrectionLogsResult {
  imported: number;
  added: number;
  updated: number;
  total: number;
}

function getStorage(): StorageLike {
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }

  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key) => {
      memoryStorage.delete(key);
    },
  };
}

function createId() {
  return crypto.randomUUID();
}

export function getCorrectionLogs(): CorrectionLog[] {
  const raw = getStorage().getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as CorrectionLog[];
  } catch {
    return [];
  }
}

export function addCorrectionLog(
  log: Omit<CorrectionLog, "id" | "createdAt">
): CorrectionLog {
  const logs = getCorrectionLogs();

  const newLog: CorrectionLog = {
    ...log,
    id: createId(),
    createdAt: new Date().toISOString(),
  };

  logs.push(newLog);
  getStorage().setItem(STORAGE_KEY, JSON.stringify(logs));

  return newLog;
}

export function setCorrectionLogs(logs: CorrectionLog[]) {
  getStorage().setItem(STORAGE_KEY, JSON.stringify(logs));
}

export function mergeCorrectionLogs(logs: CorrectionLog[]): ImportCorrectionLogsResult {
  const mergedById = new Map<string, CorrectionLog>();
  let added = 0;
  let updated = 0;

  for (const existingLog of getCorrectionLogs()) {
    mergedById.set(existingLog.id, existingLog);
  }

  for (const log of logs) {
    if (mergedById.has(log.id)) {
      updated += 1;
    } else {
      added += 1;
    }

    mergedById.set(log.id, log);
  }

  const mergedLogs = [...mergedById.values()].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt)
  );

  setCorrectionLogs(mergedLogs);

  return {
    imported: logs.length,
    added,
    updated,
    total: mergedLogs.length,
  };
}

export function importCorrectionLogs(
  logs: CorrectionLog[],
  options: ImportCorrectionLogsOptions = {}
): ImportCorrectionLogsResult {
  if (options.mode === "replace") {
    setCorrectionLogs(logs);

    return {
      imported: logs.length,
      added: logs.length,
      updated: 0,
      total: logs.length,
    };
  }

  return mergeCorrectionLogs(logs);
}

export function importCorrectionLogsFromJson(
  json: string,
  options?: ImportCorrectionLogsOptions
): ImportCorrectionLogsResult {
  return importCorrectionLogs(parseCorrectionLogsJson(json), options);
}

export function clearCorrectionLogs() {
  getStorage().removeItem(STORAGE_KEY);
}

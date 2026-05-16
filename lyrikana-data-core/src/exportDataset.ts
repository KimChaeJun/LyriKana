// src/exportDataset.ts

import {
  getCorrectionLogs,
  importCorrectionLogsFromJson,
  ImportCorrectionLogsOptions,
  ImportCorrectionLogsResult,
} from "./correctionStore";
import { correctionLogsToChatJsonl } from "./jsonl/exportJsonl";

export function exportCorrectionLogsAsJson() {
  const logs = getCorrectionLogs();
  return JSON.stringify(logs, null, 2);
}

export function exportCorrectionLogsAsJsonl() {
  return correctionLogsToChatJsonl(getCorrectionLogs());
}

export function downloadCorrectionLogs() {
  const json = exportCorrectionLogsAsJson();

  const blob = new Blob([json], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `lyrikana-corrections-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

export function downloadCorrectionLogsAsJsonl() {
  const jsonl = exportCorrectionLogsAsJsonl();

  const blob = new Blob([jsonl], {
    type: "application/x-ndjson",
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `lyrikana-training-${Date.now()}.jsonl`;
  a.click();

  URL.revokeObjectURL(url);
}

export async function importCorrectionLogsFromFile(
  file: File,
  options?: ImportCorrectionLogsOptions
): Promise<ImportCorrectionLogsResult> {
  return importCorrectionLogsFromJson(await file.text(), options);
}

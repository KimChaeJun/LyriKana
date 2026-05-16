// src/sample.ts

import {
  addCorrectionLog,
  clearCorrectionLogs,
  getCorrectionLogs,
  importCorrectionLogsFromJson,
} from "./correctionStore";
import { exportCorrectionLogsAsJson } from "./exportDataset";
import { correctionLogsToChatJsonl } from "./jsonl/exportJsonl";

const log = addCorrectionLog({
  type: "reading",
  song: {
    title: "Sample Song",
    artist: "Mrs. GREEN APPLE",
    album: "Attitude",
    duration: 321,
  },
  lineIndex: 12,
  originalText: "Original lyric line",
  beforeValue: "Before reading",
  afterValue: "After reading",
  source: "manual_user_edit",
});

console.log(log);
console.log(correctionLogsToChatJsonl(getCorrectionLogs()));

const exportedJson = exportCorrectionLogsAsJson();
clearCorrectionLogs();
console.log(importCorrectionLogsFromJson(exportedJson));

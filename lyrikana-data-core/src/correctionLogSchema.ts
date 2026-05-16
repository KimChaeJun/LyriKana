import { CorrectionLog, CorrectionType } from "./types";

const CORRECTION_TYPES: CorrectionType[] = [
  "reading",
  "translation",
  "sync",
  "lyrics_choice",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCorrectionType(value: unknown): value is CorrectionType {
  return typeof value === "string" && CORRECTION_TYPES.includes(value as CorrectionType);
}

export function isCorrectionLog(value: unknown): value is CorrectionLog {
  if (!isRecord(value)) return false;
  if (!isRecord(value.song)) return false;

  return (
    typeof value.id === "string" &&
    isCorrectionType(value.type) &&
    typeof value.song.title === "string" &&
    typeof value.song.artist === "string" &&
    (value.song.album === undefined || typeof value.song.album === "string") &&
    (value.song.duration === undefined || typeof value.song.duration === "number") &&
    (value.lineIndex === undefined || typeof value.lineIndex === "number") &&
    (value.originalText === undefined || typeof value.originalText === "string") &&
    (typeof value.beforeValue === "string" ||
      typeof value.beforeValue === "number") &&
    (typeof value.afterValue === "string" || typeof value.afterValue === "number") &&
    (value.source === undefined || typeof value.source === "string") &&
    (value.userId === undefined || typeof value.userId === "string") &&
    typeof value.createdAt === "string"
  );
}

export function parseCorrectionLogsJson(json: string): CorrectionLog[] {
  const parsed: unknown = JSON.parse(json);

  if (!Array.isArray(parsed)) {
    throw new Error("Correction log JSON must contain an array.");
  }

  const invalidIndex = parsed.findIndex((item) => !isCorrectionLog(item));
  if (invalidIndex !== -1) {
    throw new Error(`Invalid correction log at index ${invalidIndex}.`);
  }

  return parsed;
}

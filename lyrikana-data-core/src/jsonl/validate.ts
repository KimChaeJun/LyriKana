import { CorrectionLog } from "../types";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function normalizeValue(value: string | number): string {
  return String(value).trim();
}

export function validateCorrectionLogForTraining(
  log: CorrectionLog
): ValidationResult {
  const beforeValue = normalizeValue(log.beforeValue);
  const afterValue = normalizeValue(log.afterValue);

  if (!beforeValue) {
    return { valid: false, reason: "beforeValue is empty" };
  }

  if (!afterValue) {
    return { valid: false, reason: "afterValue is empty" };
  }

  if (beforeValue === afterValue) {
    return { valid: false, reason: "beforeValue and afterValue are identical" };
  }

  if (!log.song.title.trim()) {
    return { valid: false, reason: "song title is empty" };
  }

  if (!log.song.artist.trim()) {
    return { valid: false, reason: "song artist is empty" };
  }

  if (
    (log.type === "reading" ||
      log.type === "translation" ||
      log.type === "lyrics_choice") &&
    !log.originalText?.trim()
  ) {
    return {
      valid: false,
      reason: `${log.type} correction requires originalText`,
    };
  }

  return { valid: true };
}

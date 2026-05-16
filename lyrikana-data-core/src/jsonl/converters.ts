import { CorrectionLog, CorrectionType } from "../types";
import {
  ChatJsonlExample,
  TrainingExample,
  TrainingExampleMetadata,
  TrainingTask,
} from "./types";
import { validateCorrectionLogForTraining } from "./validate";

function toTrainingTask(type: CorrectionType): TrainingTask {
  switch (type) {
    case "reading":
      return "reading_correction";
    case "translation":
      return "translation_correction";
    case "sync":
      return "sync_correction";
    case "lyrics_choice":
      return "lyrics_choice";
  }
}

function createMetadata(log: CorrectionLog): TrainingExampleMetadata {
  return {
    correctionId: log.id,
    correctionType: log.type,
    song: log.song,
    lineIndex: log.lineIndex,
    source: log.source,
    userId: log.userId,
    createdAt: log.createdAt,
  };
}

function formatSongContext(log: CorrectionLog): string {
  const fields = [
    `Title: ${log.song.title}`,
    `Artist: ${log.song.artist}`,
    log.song.album ? `Album: ${log.song.album}` : undefined,
    typeof log.lineIndex === "number" ? `Line index: ${log.lineIndex}` : undefined,
  ];

  return fields.filter(Boolean).join("\n");
}

function createInput(log: CorrectionLog): string {
  const songContext = formatSongContext(log);
  const beforeValue = String(log.beforeValue);
  const originalText = log.originalText?.trim();

  switch (log.type) {
    case "reading":
      return [
        songContext,
        `Original lyric: ${originalText}`,
        `Current reading: ${beforeValue}`,
        "Correct the reading.",
      ].join("\n");
    case "translation":
      return [
        songContext,
        `Original lyric: ${originalText}`,
        `Current translation: ${beforeValue}`,
        "Correct the translation.",
      ].join("\n");
    case "sync":
      return [
        songContext,
        `Current sync value: ${beforeValue}`,
        "Correct the sync value.",
      ].join("\n");
    case "lyrics_choice":
      return [
        songContext,
        `Original lyric candidate: ${originalText}`,
        `Current choice: ${beforeValue}`,
        "Select the corrected lyric choice.",
      ].join("\n");
  }
}

function createSystemPrompt(task: TrainingTask): string {
  switch (task) {
    case "reading_correction":
      return "You correct lyric reading data while preserving the intended lyric meaning.";
    case "translation_correction":
      return "You correct lyric translations to better match the original lyric.";
    case "sync_correction":
      return "You correct lyric synchronization values using the provided context.";
    case "lyrics_choice":
      return "You choose the corrected lyric candidate from user correction data.";
  }
}

export function correctionLogToTrainingExample(
  log: CorrectionLog
): TrainingExample | null {
  const validation = validateCorrectionLogForTraining(log);
  if (!validation.valid) return null;

  return {
    task: toTrainingTask(log.type),
    input: createInput(log),
    output: String(log.afterValue),
    metadata: createMetadata(log),
  };
}

export function correctionLogsToTrainingExamples(
  logs: CorrectionLog[]
): TrainingExample[] {
  return logs.flatMap((log) => {
    const example = correctionLogToTrainingExample(log);
    return example ? [example] : [];
  });
}

export function trainingExampleToChatJsonlExample(
  example: TrainingExample
): ChatJsonlExample {
  return {
    messages: [
      {
        role: "system",
        content: createSystemPrompt(example.task),
      },
      {
        role: "user",
        content: example.input,
      },
      {
        role: "assistant",
        content: example.output,
      },
    ],
    metadata: {
      ...example.metadata,
      task: example.task,
    },
  };
}

export function correctionLogToChatJsonlExample(
  log: CorrectionLog
): ChatJsonlExample | null {
  const example = correctionLogToTrainingExample(log);
  return example ? trainingExampleToChatJsonlExample(example) : null;
}

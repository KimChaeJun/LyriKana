import { CorrectionLog } from "../types";
import {
  correctionLogsToTrainingExamples,
  trainingExampleToChatJsonlExample,
} from "./converters";
import { ChatJsonlExample, TrainingExample } from "./types";

function toJsonl<T>(records: T[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

export function trainingExamplesToJsonl(examples: TrainingExample[]): string {
  return toJsonl(examples);
}

export function trainingExamplesToChatJsonl(
  examples: TrainingExample[]
): string {
  return toJsonl(examples.map(trainingExampleToChatJsonlExample));
}

export function chatExamplesToJsonl(examples: ChatJsonlExample[]): string {
  return toJsonl(examples);
}

export function correctionLogsToTrainingJsonl(logs: CorrectionLog[]): string {
  return trainingExamplesToJsonl(correctionLogsToTrainingExamples(logs));
}

export function correctionLogsToChatJsonl(logs: CorrectionLog[]): string {
  return trainingExamplesToChatJsonl(correctionLogsToTrainingExamples(logs));
}

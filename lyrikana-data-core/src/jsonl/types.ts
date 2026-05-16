import { CorrectionType, SongMeta } from "../types";

export type TrainingTask =
  | "reading_correction"
  | "translation_correction"
  | "sync_correction"
  | "lyrics_choice";

export interface TrainingExampleMetadata {
  correctionId: string;
  correctionType: CorrectionType;
  song: SongMeta;
  lineIndex?: number;
  source?: string;
  userId?: string;
  createdAt: string;
}

export interface TrainingExample {
  task: TrainingTask;
  input: string;
  output: string;
  metadata: TrainingExampleMetadata;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatJsonlExample {
  messages: ChatMessage[];
  metadata: TrainingExampleMetadata & {
    task: TrainingTask;
  };
}

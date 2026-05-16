// src/types.ts

export type CorrectionType =
  | "reading"
  | "translation"
  | "sync"
  | "lyrics_choice";

export interface SongMeta {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

export interface CorrectionLog {
  id: string;
  type: CorrectionType;

  song: SongMeta;

  lineIndex?: number;
  originalText?: string;

  beforeValue: string | number;
  afterValue: string | number;

  source?: string;
  userId?: string;

  createdAt: string;
}
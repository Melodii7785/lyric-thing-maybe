/*
 * Spicy Lyrics renderer data types.
 * Adapted from Spicy Lyrics by Spikerko (Copyright 2026).
 * Licensed under GNU AGPL-3.0-or-later; see AGPL-3.0.txt.
 */

export interface SyllableData {
  Text: string;
  TransliteratedText?: string;
  StartTime: number;
  EndTime: number;
  IsPartOfWord?: boolean;
}

export interface LeadData {
  StartTime: number;
  EndTime: number;
  Syllables: SyllableData[];
}

export interface BackgroundData {
  StartTime: number;
  EndTime: number;
  Syllables: SyllableData[];
}

export interface LineData {
  Lead: LeadData;
  Background?: BackgroundData[];
  OppositeAligned?: boolean;
}

export interface LyricsData {
  Type: string;
  Content: LineData[];
  StartTime: number;
  SongWriters?: string[];
  source?: "spt" | "spl" | "aml" | "uns";
  classes?: string;
  styles?: Record<string, string>;
}

export interface SyllableLead {
  HTMLElement: HTMLElement;
  StartTime: number;
  EndTime: number;
  TotalTime: number;
  LetterGroup?: boolean;
  Letters?: Array<{
    HTMLElement: HTMLElement;
    StartTime: number;
    EndTime: number;
    AnimatorStore?: Record<string, unknown>;
  }>;
  BGWord?: boolean;
  Dot?: boolean;
  AnimatorStore?: Record<string, unknown>;
}

export interface LyricsSyllable {
  HTMLElement: HTMLElement;
  StartTime: number;
  EndTime: number;
  TotalTime?: number;
  Status?: string;
  Syllables?: { Lead: SyllableLead[] };
  DotLine?: boolean;
  BGLine?: boolean;
  AnimatorStore?: Record<string, unknown>;
  AnimatedState?: "NotSung" | "Active" | "Sung";
  Settling?: boolean;
}

export interface LyricsLine {
  HTMLElement: HTMLElement;
  StartTime: number;
  EndTime: number;
  TotalTime?: number;
  Status?: string;
  DotLine?: boolean;
  Syllables?: { Lead: SyllableLead[] };
  AnimatorStore?: Record<string, unknown>;
}

export interface LyricsStatic {
  HTMLElement: HTMLElement;
}

export type LyricsType = "Syllable" | "Line" | "Static";

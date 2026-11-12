import { ApplyIsByCommunity } from "./ApplyIsByCommunity.ts";
import { ApplyLyricsProvider } from "./ApplyProvider.ts";
import { CreditsRow } from "./CreditsRow.ts";

interface LyricsData {
  SongWriters?: string[];
  Type?: string;
  Content?: unknown;
  classes?: string;
  styles?: Record<string, string>;
}

/** Marks the scroll container when the final duet line is sung from the right. */
export function MarkLastLineSide(container: HTMLElement, opposite: boolean, rtl: boolean): void {
  container.classList.toggle("EndsOnOppositeLine", opposite && !rtl);
}

export function ApplyLyricsCredits(data: LyricsData, LyricsContainer: HTMLElement): void {
  if (!Array.isArray(data?.SongWriters) || !data.SongWriters.length || !LyricsContainer) return;

  const credits = document.createElement("div");
  credits.classList.add("Credits");
  CreditsRow(credits, "Written by", data.SongWriters.join(", "));
  LyricsContainer.appendChild(credits);
}

/** Adds songwriter, provider and community attribution together beneath the lyric list. */
export function ApplySongCredits(data: any, LyricsContainer: HTMLElement): void {
  if (!LyricsContainer) return;

  const credits = document.createElement("div");
  credits.classList.add("SongCredits");

  ApplyLyricsCredits(data, credits);
  ApplyLyricsProvider(data, credits);
  ApplyIsByCommunity(data, credits);

  if (credits.querySelector(":scope > .SongInfo")) credits.classList.add("FromCommunity");
  if (credits.childElementCount > 0) LyricsContainer.appendChild(credits);
}

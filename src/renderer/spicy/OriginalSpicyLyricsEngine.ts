import { setPageContainer } from "./original/components/Pages/PageView.ts";
import { $lyricsContainerExists, $currentLyricsType } from "./original/utils/stores.ts";
import { SpotifyPlayer } from "./original/components/Global/SpotifyPlayer.ts";
import { LyricsObject } from "./original/utils/Lyrics/lyrics.ts";
import { ApplySyllableLyrics } from "./original/utils/Lyrics/Applyer/Synced/Syllable.ts";
import { ApplyLineLyrics } from "./original/utils/Lyrics/Applyer/Synced/Line.ts";
import { ApplyStaticLyrics } from "./original/utils/Lyrics/Applyer/Static.ts";

type AnyRecord = Record<string, any>;

function createHost(host: HTMLElement) {
  host.querySelector('.SpicyLyricsPage')?.remove();
  const page = document.createElement("div");
  page.className = "SpicyLyricsPage";
  const container = document.createElement("div");
  container.className = "LyricsContainer";
  const content = document.createElement("div");
  content.className = "LyricsContent";
  container.append(content);
  page.append(container);
  host.append(page);
  setPageContainer(page);
  $lyricsContainerExists.set(true);
  return page;
}

/** Adapts the Spicy Lyrics API's native payload directly to its original applyers. */
export class OriginalSpicyLyricsEngine {
  private host: HTMLElement;
  private page: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.page = createHost(host);
  }

  setPosition(milliseconds: number) {
    SpotifyPlayer.setPosition(milliseconds);
  }

  clear() {
    this.host.querySelector('.SpicyLyricsPage')?.remove();
    LyricsObject.Types.Syllable.Lines = [];
    LyricsObject.Types.Line.Lines = [];
    LyricsObject.Types.Static.Lines = [];
  }

  apply(payload: AnyRecord) {
    const body: AnyRecord = payload?.spicyLyrics ?? payload ?? {};
    const type = String(body.Type ?? "Static");
    const content: AnyRecord[] = Array.isArray(body.Content) ? body.Content : [];

    this.clear();
    this.page = createHost(this.host);

    if (type === "Syllable") {
      const valid = content.filter(line =>
        line?.Lead && Array.isArray(line.Lead.Syllables)
      );
      if (!valid.length) return false;
      $currentLyricsType.set("Syllable");
      ApplySyllableLyrics({ ...body, Type: type, Content: valid });
      return true;
    }

    if (type === "Line") {
      const valid = content.filter(line =>
        typeof line?.Text === "string" &&
        Number.isFinite(line.StartTime) &&
        Number.isFinite(line.EndTime)
      );
      if (!valid.length) return false;
      $currentLyricsType.set("Line");
      ApplyLineLyrics({ ...body, Type: type, Content: valid });
      return true;
    }

    const lines = Array.isArray(body.Lines)
      ? body.Lines
      : content.map(line => ({ Text: line?.Lead?.Text ?? "" }));
    if (!lines.length) return false;
    $currentLyricsType.set("Static");
    ApplyStaticLyrics({ ...body, Type: "Static", Lines: lines });
    return true;
  }
}

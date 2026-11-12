import { CreditsRow } from "./CreditsRow.ts";

const ProviderMap: Record<string, string> = {
  spt: "Spotify",
  aml: "Apple Music",
  spl: "Spicy Lyrics",
  ldb: "Local DB",
  uns: "Unison",
};

const ViaMap: Record<string, { label: string; url?: string }> = {
  "lrc-red": { label: "lrc.red", url: "https://lrc.red/?utm_source=spicylyrics" },
};

export function ApplyLyricsProvider(data: any, LyricsContainer: HTMLElement): void {
  if (!data?.source || !LyricsContainer) return;

  const ProviderElement = document.createElement("div");
  ProviderElement.classList.add("LyricsProvider");

  let providerLabel = "Unknown";
  if (typeof data.source === "string") {
    const source = data.source.toLowerCase();
    const match = Object.entries(ProviderMap).find(([key]) => source.includes(key));
    if (match) providerLabel = match[1];
  }

  CreditsRow(ProviderElement, "Provided by", providerLabel);

  const via =
    typeof data.source_via === "string" && Object.hasOwn(ViaMap, data.source_via)
      ? ViaMap[data.source_via]
      : undefined;
  if (via) {
    const ViaElement = document.createElement("span");
    ViaElement.classList.add("LyricsProviderVia");
    const ViaLabelElement = document.createElement("span");
    ViaLabelElement.classList.add("LyricsProviderViaLabel");
    ViaLabelElement.textContent = "via ";
    ViaElement.append(ViaLabelElement);
    if (via.url) {
      const LinkElement = document.createElement("a");
      LinkElement.classList.add("LyricsProviderViaLink");
      LinkElement.href = via.url;
      LinkElement.target = "_blank";
      LinkElement.rel = "noopener noreferrer";
      LinkElement.textContent = via.label;
      ViaElement.append(LinkElement);
    } else {
      ViaLabelElement.append(via.label);
    }
    ProviderElement.append(" ", ViaElement);
  }

  LyricsContainer.appendChild(ProviderElement);
}

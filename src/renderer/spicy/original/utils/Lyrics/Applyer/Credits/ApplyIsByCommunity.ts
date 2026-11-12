function openProfile(userId: string | undefined): void {
  if (!userId) return;
  const url = `https://spicylyrics.org/uid/${encodeURIComponent(userId)}`;
  globalThis.open?.(url, "_blank", "noopener,noreferrer");
}

export function ApplyIsByCommunity(data: any, LyricsContainer: HTMLElement): void {
  if (!data || data.source !== "spl" || !LyricsContainer) return;

  const metadata = data.TTMLUploadMetadata;
  if (!metadata || typeof metadata !== "object") return;

  const songInfoElement = document.createElement("div");
  songInfoElement.classList.add("SongInfo");

  const note = document.createElement("span");
  note.classList.add("SongInfoNote");
  note.textContent = "These lyrics have been provided by our community";
  songInfoElement.appendChild(note);

  const communityLead = document.createElement("span");
  communityLead.classList.add("SongInfoLead");
  communityLead.textContent = "Community lyrics";
  songInfoElement.appendChild(communityLead);

  const makerUsername = metadata.Maker?.username;
  const uploaderUsername = metadata.Uploader?.username;

  const createProfileSection = (type: "Maker" | "Uploader", labelText: string): void => {
    const person = metadata[type];
    if (!person || typeof person.username !== "string") return;

    const wrapper = document.createElement("span");
    wrapper.classList.add(type);

    const profileButton = document.createElement("button");
    profileButton.type = "button";
    profileButton.classList.add("song-info-profile-section");
    profileButton.setAttribute("aria-label", `${labelText} @${person.username}; view Spicy Lyrics profile`);

    if (typeof person.avatar === "string" && person.avatar) {
      const img = document.createElement("img");
      img.src = person.avatar;
      img.alt = "";
      img.onerror = () => { img.style.display = "none"; };
      profileButton.appendChild(img);
    }

    const role = document.createElement("span");
    role.classList.add("SongInfoRole");
    role.textContent = labelText;

    const username = document.createElement("span");
    username.classList.add("SongInfoName");
    username.textContent = `@${person.username}`;

    profileButton.append(role, " ", username);
    wrapper.appendChild(profileButton);
    songInfoElement.appendChild(wrapper);

    profileButton.addEventListener("keydown", event => {
      if (event.key === " " || event.key === "Enter") event.stopPropagation();
    });
    profileButton.addEventListener("click", () => openProfile(person.id));
  };

  if (makerUsername) createProfileSection("Maker", "Made by");
  if (uploaderUsername) createProfileSection("Uploader", makerUsername ? "Uploaded by" : "Made by");

  if (songInfoElement.childElementCount > 0) LyricsContainer.appendChild(songInfoElement);
}

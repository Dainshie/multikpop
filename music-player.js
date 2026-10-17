const playlistKey = "petal-fm-mp3-playlist-v1";
const likedKey = "petal-fm-mp3-liked-v1";
const hiddenKey = "petal-fm-hidden-library-tracks-v1";
const databaseName = "petal-fm-audio-v1";
const fallbackArtwork = "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=160&q=80";
const audio = document.querySelector("#audio");
const trackList = document.querySelector("#track-list");
const searchInput = document.querySelector("#search-input");
const progress = document.querySelector("#progress");
const playButton = document.querySelector("#play-button");
const toast = document.querySelector("#toast");
const dialog = document.querySelector("#add-track-dialog");
const liked = new Set(loadSaved(likedKey));
const hiddenLibraryTracks = new Set(loadSaved(hiddenKey));
const libraryTracks = (window.MUSIC_LIBRARY || [])
  .filter((track) => track?.title && track?.artist && track?.src)
  .map((track) => ({ ...track, id: `library-${track.src}`, source: track.src, duration: Number(track.duration) || 0, artwork: track.artwork || fallbackArtwork }))
  .filter((track) => !hiddenLibraryTracks.has(track.id));
let tracks = [...libraryTracks, ...loadSaved(playlistKey).filter((track) => track?.fileId && track?.title && track?.artist)];
let currentTrack = null;
let currentIndex = -1;
let activeFilter = "all";
let onlyLiked = false;
let shuffle = false;
let repeat = false;
let toastTimer;
let activeObjectUrl = "";
let playRequest = 0;
const artworkUrls = new Map();
const artworkRequests = new Set();
const metadataRequests = new Set();

function loadSaved(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePlaylist() {
  localStorage.setItem(playlistKey, JSON.stringify(tracks.filter((track) => track.fileId)));
  localStorage.setItem(likedKey, JSON.stringify([...liked]));
  localStorage.setItem(hiddenKey, JSON.stringify([...hiddenLibraryTracks]));
}

function openAudioDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("audio");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeAudioFile(id, file) {
  const database = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("audio", "readwrite");
    transaction.objectStore("audio").put(file, id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
    transaction.onabort = () => { database.close(); reject(transaction.error); };
  });
}

async function readAudioFile(id) {
  const database = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("audio", "readonly");
    const request = transaction.objectStore("audio").get(id);
    request.onsuccess = () => { database.close(); resolve(request.result); };
    request.onerror = () => { database.close(); reject(request.error); };
  });
}

async function deleteAudioFile(id) {
  const database = await openAudioDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("audio", "readwrite");
    transaction.objectStore("audio").delete(id);
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error); };
  });
}

function readAudioDuration(source) {
  return new Promise((resolve) => {
    const metadataAudio = new Audio();
    const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : "";
    let finished = false;
    const finish = (duration) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      metadataAudio.removeAttribute("src");
      metadataAudio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(duration) ? duration : 0);
    };
    const timeout = setTimeout(() => finish(0), 8000);
    metadataAudio.preload = "metadata";
    metadataAudio.addEventListener("loadedmetadata", () => finish(metadataAudio.duration), { once: true });
    metadataAudio.addEventListener("error", () => finish(0), { once: true });
    metadataAudio.src = objectUrl || source;
  });
}

function loadTrackDuration(track) {
  if (track.duration > 0 || metadataRequests.has(track.id)) return;
  metadataRequests.add(track.id);
  (async () => {
    let source = track.source;
    if (track.fileId) source = await readAudioFile(track.fileId);
    if (!source) return;
    const duration = await readAudioDuration(source);
    if (duration > 0) {
      track.duration = duration;
      savePlaylist();
      renderTracks();
    }
  })().catch(() => {}).finally(() => metadataRequests.delete(track.id));
}

function getTrackArtwork(track) {
  if (!track.artworkFileId) return track.artwork || fallbackArtwork;
  const cached = artworkUrls.get(track.id);
  if (cached) return cached;
  if (!artworkRequests.has(track.id)) {
    artworkRequests.add(track.id);
    readAudioFile(track.artworkFileId).then((image) => {
      if (image) artworkUrls.set(track.id, URL.createObjectURL(image));
      artworkRequests.delete(track.id);
      if (image) {
        if (currentTrack?.id === track.id) document.querySelector("#current-cover").style.backgroundImage = `url('${artworkUrls.get(track.id)}')`;
        renderTracks();
      }
    }).catch(() => artworkRequests.delete(track.id));
  }
  return fallbackArtwork;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function secondsToTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "--:--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function renderFilters() {
  const artists = [...new Set(tracks.map((track) => track.artist))];
  if (activeFilter !== "all" && !artists.includes(activeFilter)) activeFilter = "all";
  const filterButtons = (includeAll) => [
    ...(includeAll ? [{ value: "all", label: "Wszystko" }] : [{ value: "all", label: "Cała kolekcja" }]),
    ...artists.map((artist) => ({ value: artist, label: artist })),
  ].map((item, index) => includeAll
    ? `<button class="filter-chip${activeFilter === item.value ? " active" : ""}" data-filter="${escapeHTML(item.value)}">${escapeHTML(item.label)}</button>`
    : `<button class="mood-item${activeFilter === item.value ? " selected" : ""}" data-filter="${escapeHTML(item.value)}"><span class="mood-dot ${index % 3 === 0 ? "dot-pink" : index % 3 === 1 ? "dot-lilac" : "dot-orange"}"></span>${escapeHTML(item.label)}</button>`).join("");
  document.querySelector("#artist-filters").innerHTML = filterButtons(true);
  document.querySelector("#artist-filters-side").innerHTML = filterButtons(false);
}

function renderTracks() {
  const query = searchInput.value.trim().toLocaleLowerCase("pl");
  const visibleTracks = tracks.filter((track) => {
    const matchesArtist = activeFilter === "all" || track.artist === activeFilter;
    const matchesSearch = `${track.title} ${track.artist}`.toLocaleLowerCase("pl").includes(query);
    return matchesArtist && matchesSearch && (!onlyLiked || liked.has(track.id));
  });

  trackList.innerHTML = visibleTracks.map((track, index) => `
    <article class="track-row${currentTrack?.id === track.id ? " is-playing" : ""}" role="row" data-id="${escapeHTML(track.id)}">
      <span class="row-number">${String(index + 1).padStart(2, "0")}</span>
      <button class="row-play" type="button" aria-label="Odtwórz ${escapeHTML(track.title)}" data-play="${escapeHTML(track.id)}"><svg><use href="#i-play" /></svg></button>
      <div class="track-info" role="cell">
        <div class="track-cover" style="background-image:url('${escapeHTML(getTrackArtwork(track))}')"></div>
        <div class="track-title-wrap"><span class="track-title">${escapeHTML(track.title)}</span><span class="track-artist">${escapeHTML(track.artist)}</span></div>
      </div>
      <span class="track-album" role="cell">${escapeHTML(track.artist)}</span>
      <button class="row-heart${liked.has(track.id) ? " liked" : ""}" type="button" aria-label="${liked.has(track.id) ? "Usuń z" : "Dodaj do"} polubionych" data-like="${escapeHTML(track.id)}"><svg><use href="#i-heart" /></svg></button>
      <span class="track-duration" role="cell">${secondsToTime(track.duration)}</span>
      <button class="row-remove" type="button" aria-label="Usuń ${escapeHTML(track.title)} z playlisty" data-remove="${escapeHTML(track.id)}">×</button>
    </article>`).join("");

  visibleTracks.forEach(loadTrackDuration);

  const emptyState = document.querySelector("#empty-state");
  emptyState.hidden = visibleTracks.length > 0;
  if (!tracks.length) emptyState.textContent = "Twoja playlista jest pusta. Dodaj plik MP3 albo wpisz utwór w music/library.js.";
  else if (!visibleTracks.length) emptyState.textContent = onlyLiked ? "Nie masz jeszcze polubionych utworów." : "Nie znaleziono utworów. Spróbuj innego hasła.";
  document.querySelector("#track-count").textContent = `${tracks.length} ${tracks.length === 1 ? "utwór" : "utworów"}`;
}

function render() {
  renderFilters();
  renderTracks();
}

function updateNowPlaying() {
  if (!currentTrack) return;
  document.querySelector("#current-title").textContent = currentTrack.title;
  document.querySelector("#current-artist").textContent = currentTrack.artist;
  document.querySelector("#current-cover").style.backgroundImage = `url('${getTrackArtwork(currentTrack)}')`;
  document.querySelector("#current-like").classList.toggle("liked", liked.has(currentTrack.id));
  document.querySelector("#duration-time").textContent = secondsToTime(currentTrack.duration);
  renderTracks();
}

function setPlaying(isPlaying) {
  playButton.classList.toggle("is-playing", isPlaying);
  playButton.setAttribute("aria-label", isPlaying ? "Wstrzymaj" : "Odtwórz");
  playButton.innerHTML = `<svg><use href="#i-${isPlaying ? "pause" : "play"}" /></svg>`;
  if (currentTrack) renderTracks();
}

async function playTrack(track) {
  currentTrack = track;
  currentIndex = tracks.findIndex((item) => item.id === track.id);
  const requestId = ++playRequest;
  audio.pause();
  updateNowPlaying();

  try {
    let source = track.source;
    if (track.fileId) {
      const file = await readAudioFile(track.fileId);
      if (!file) throw new Error("Nie znaleziono pliku MP3 w pamięci przeglądarki.");
      if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = URL.createObjectURL(file);
      source = activeObjectUrl;
    }
    if (requestId !== playRequest) return;
    if (!source) throw new Error("Brak ścieżki do pliku MP3.");
    audio.src = source;
    await audio.play();
  } catch (error) {
    if (requestId === playRequest) {
      setPlaying(false);
      showToast(error.message || "Nie udało się odtworzyć tego pliku MP3.");
    }
  }
}

function playNext(direction = 1) {
  if (!tracks.length) {
    showToast("Dodaj najpierw plik MP3 do playlisty.");
    return;
  }
  let nextIndex;
  if (shuffle && tracks.length > 1) {
    do { nextIndex = Math.floor(Math.random() * tracks.length); } while (nextIndex === currentIndex);
  } else {
    nextIndex = (currentIndex + direction + tracks.length) % tracks.length;
  }
  playTrack(tracks[nextIndex]);
}

function toggleLike(id) {
  if (liked.has(id)) liked.delete(id);
  else liked.add(id);
  savePlaylist();
  if (currentTrack?.id === id) document.querySelector("#current-like").classList.toggle("liked", liked.has(id));
  renderTracks();
}

function togglePlayback() {
  if (!currentTrack) {
    if (tracks.length) playTrack(tracks[0]);
    else showToast("Dodaj plik MP3, aby zacząć słuchać.");
  } else if (audio.paused) {
    audio.play().catch(() => showToast("Nie udało się odtworzyć tego pliku MP3."));
  } else {
    audio.pause();
  }
}

function setFilter(filter) {
  activeFilter = filter;
  onlyLiked = false;
  document.querySelector("#liked-nav").classList.remove("active");
  render();
}

async function addTrack(event) {
  event.preventDefault();
  const title = document.querySelector("#track-title-input").value.trim();
  const artist = document.querySelector("#track-artist-input").value.trim();
  const file = document.querySelector("#audio-file-input").files[0];
  const artworkFile = document.querySelector("#artwork-file-input").files[0];
  if (!file || (!file.type.startsWith("audio/") && !file.name.toLowerCase().endsWith(".mp3"))) {
    showToast("Wybierz plik audio, najlepiej w formacie MP3.");
    return;
  }

  const id = globalThis.crypto?.randomUUID?.() || `mp3-${Date.now()}`;
  try {
    const artworkFileId = artworkFile ? `artwork:${id}` : "";
    await Promise.all([
      storeAudioFile(id, file),
      artworkFile ? storeAudioFile(artworkFileId, artworkFile) : Promise.resolve(),
    ]);
    const duration = await readAudioDuration(file);
    tracks.push({ id, fileId: id, artworkFileId, title, artist, album: artist, artwork: fallbackArtwork, duration });
    savePlaylist();
    searchInput.value = "";
    setFilter("all");
    dialog.close();
    event.currentTarget.reset();
    showToast(`Dodano „${title}” do playlisty.`);
  } catch {
    showToast("Nie udało się zapisać pliku. Sprawdź dostępne miejsce w przeglądarce.");
  }
}

async function removeTrack(id) {
  const track = tracks.find((item) => item.id === id);
  tracks = tracks.filter((item) => item.id !== id);
  liked.delete(id);
  if (track?.fileId) await deleteAudioFile(track.fileId).catch(() => {});
  if (track?.artworkFileId) await deleteAudioFile(track.artworkFileId).catch(() => {});
  if (artworkUrls.has(id)) URL.revokeObjectURL(artworkUrls.get(id));
  artworkUrls.delete(id);
  if (track?.source) hiddenLibraryTracks.add(id);
  if (currentTrack?.id === id) {
    ++playRequest;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = "";
    currentTrack = null;
    currentIndex = -1;
    progress.value = "0";
    document.querySelector("#elapsed-time").textContent = "0:00";
    document.querySelector("#duration-time").textContent = "--:--";
    document.querySelector("#current-title").textContent = "Wybierz coś dla siebie";
    document.querySelector("#current-artist").textContent = "ogród czeka na pierwszy utwór";
    document.querySelector("#current-cover").style.backgroundImage = "";
    setPlaying(false);
  }
  savePlaylist();
  render();
  if (track) showToast(`Usunięto „${track.title}” z playlisty.`);
}

trackList.addEventListener("click", (event) => {
  const play = event.target.closest("[data-play]");
  const like = event.target.closest("[data-like]");
  const remove = event.target.closest("[data-remove]");
  if (play) {
    const track = tracks.find((item) => item.id === play.dataset.play);
    if (track) playTrack(track);
  }
  if (like) toggleLike(like.dataset.like);
  if (remove) removeTrack(remove.dataset.remove);
});

document.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (filter) setFilter(filter.dataset.filter);
});
searchInput.addEventListener("input", renderTracks);
document.querySelector("#focus-search").addEventListener("click", () => searchInput.focus());
document.querySelector("#liked-nav").addEventListener("click", (event) => {
  onlyLiked = !onlyLiked;
  activeFilter = "all";
  event.currentTarget.classList.toggle("active", onlyLiked);
  render();
});
document.querySelector("#hero-play").addEventListener("click", () => {
  if (tracks.length) playTrack(tracks[0]);
  else dialog.showModal();
});
document.querySelector("#add-track-button").addEventListener("click", () => dialog.showModal());
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#add-track-form").addEventListener("submit", addTrack);
playButton.addEventListener("click", togglePlayback);
document.querySelector("#next-button").addEventListener("click", () => playNext(1));
document.querySelector("#previous-button").addEventListener("click", () => {
  if (audio.currentTime > 3) audio.currentTime = 0;
  else playNext(-1);
});
document.querySelector("#shuffle-button").addEventListener("click", (event) => {
  shuffle = !shuffle;
  event.currentTarget.classList.toggle("active", shuffle);
  showToast(shuffle ? "Losowanie włączone." : "Losowanie wyłączone.");
});
document.querySelector("#repeat-button").addEventListener("click", (event) => {
  repeat = !repeat;
  audio.loop = repeat;
  event.currentTarget.classList.toggle("active", repeat);
  showToast(repeat ? "Powtarzanie włączone." : "Powtarzanie wyłączone.");
});
document.querySelector("#current-like").addEventListener("click", () => { if (currentTrack) toggleLike(currentTrack.id); });
document.querySelector("#volume").addEventListener("input", (event) => { audio.volume = Number(event.target.value); });
progress.addEventListener("input", () => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(progress.value) / 100) * audio.duration;
});
audio.addEventListener("timeupdate", () => {
  if (!Number.isFinite(audio.duration)) return;
  progress.value = String((audio.currentTime / audio.duration) * 100);
  document.querySelector("#elapsed-time").textContent = secondsToTime(audio.currentTime);
});
audio.addEventListener("loadedmetadata", () => {
  if (!currentTrack || !Number.isFinite(audio.duration)) return;
  currentTrack.duration = audio.duration;
  document.querySelector("#duration-time").textContent = secondsToTime(audio.duration);
  savePlaylist();
  renderTracks();
});
audio.addEventListener("play", () => setPlaying(true));
audio.addEventListener("pause", () => setPlaying(false));
audio.addEventListener("ended", () => { if (!repeat) playNext(1); });
audio.addEventListener("error", () => showToast("Nie udało się odczytać pliku. Sprawdź jego ścieżkę i format MP3."));
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) { event.preventDefault(); searchInput.focus(); }
  if (event.code === "Space" && document.activeElement !== searchInput && document.activeElement.tagName !== "BUTTON" && !dialog.open) { event.preventDefault(); togglePlayback(); }
});

audio.volume = Number(document.querySelector("#volume").value);
render();
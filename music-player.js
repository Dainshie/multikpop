const playlistKey = "petal-fm-mp3-playlist-v1";
const likedKey = "petal-fm-mp3-liked-v1";
const hiddenKey = "petal-fm-hidden-library-tracks-v1";
const databaseName = "petal-fm-audio-v1";
const fallbackArtwork = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cpath fill='%23100914' d='M0 0h64v64H0z'/%3E%3Cpath fill='%23ff35b8' d='M28 8h8v16h12v8H36v24h-8V32H16v-8h12z'/%3E%3Cpath fill='%2300f0ff' d='M8 8h8v8H8zm40 40h8v8h-8z'/%3E%3C/svg%3E";
const chajzerSounds = [
  { title: "Bardzo dobra", source: "chajzer/bardzodobra.mp3" },
  { title: "Ciekawostka", source: "chajzer/ciekawostka.mp3" },
  { title: "Grill u Gawrona", source: "chajzer/grillugawrona.mp3" },
  { title: "Jadłaś pizzę", source: "chajzer/jadlaspizze.mp3" },
  { title: "Kaszelek", source: "chajzer/kaszelek.mp3" },
  { title: "Naprawdę", source: "chajzer/naprawde.mp3" },
  { title: "Nosowe ą", source: "chajzer/nosoweą.mp3" },
  { title: "Pizza z kebabem", source: "chajzer/pizzazkebabem.mp3" },
  { title: "Spróbujemy w Szwecji", source: "chajzer/sprobujemywszwecji.mp3" }
];
const audio = document.querySelector("#audio");
const trackList = document.querySelector("#track-list");
const searchInput = document.querySelector("#search-input");
const progress = document.querySelector("#progress");
const playButton = document.querySelector("#play-button");
const themeToggle = document.querySelector("#theme-toggle");
const toast = document.querySelector("#toast");
const dialog = document.querySelector("#add-track-dialog");
const themeKey = "petal-fm-theme-v1";
const playlistsKey = "multikpop-user-playlists-v1";
let playlists = loadSaved(playlistsKey).filter((item) => item && item.id && item.name && Array.isArray(item.trackIds));
let activePlaylistId = null;
let editingPlaylistId = null;
let trackToAddAfterPlaylistCreate = null;
let pendingPickerTrackId = null;
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
let repeatMode = "off"; // off | all | one
let queueTrackIds = [];
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

function setTheme(isNeon) {
  document.documentElement.dataset.theme = isNeon ? "neon" : "light";
  const label = isNeon ? "Włącz jasny motyw" : "Włącz ciemny motyw";
  themeToggle.setAttribute("aria-label", label);
  themeToggle.setAttribute("aria-pressed", String(isNeon));
  themeToggle.title = label;
  document.querySelector('meta[name="theme-color"]').content = isNeon ? "#100914" : "#fff3fa";
}

try {
  setTheme(localStorage.getItem(themeKey) !== "light");
} catch (error) {
  console.error("Nie udało się odczytać zapisanego motywu.", error);
  setTheme(true);
}

function secondsToTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "--:--";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateProgressPaint() {
  progress.parentElement.style.setProperty("--progress", `${progress.value}%`);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function savePlaylists() {
  try {
    localStorage.setItem(playlistsKey, JSON.stringify(playlists));
  } catch (error) {
    console.error("Nie udało się zapisać playlist.", error);
    showToast("Nie udało się zapisać playlist w przeglądarce.");
  }
}

function makeId(prefix = "playlist") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function activePlaylist() {
  return playlists.find((item) => item.id === activePlaylistId) || null;
}

function installPlaylistUI() {
  if (document.querySelector("#user-playlists-menu")) return;

  const sidebarFilters = document.querySelector("#artist-filters-side");
  const sidebar = sidebarFilters?.parentElement;
  if (!sidebar) {
    console.error("Nie znaleziono miejsca na menu playlist.");
    return;
  }

  const styles = document.createElement("style");
  styles.textContent = `
    .user-playlists-menu{margin-top:18px;padding-top:14px;border-top:1px solid var(--border-color,rgba(255,53,184,.28));min-width:0}
    .user-playlists-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 9px;color:var(--muted,#bda9c4);font:700 9px/1.4 'Pixelify Sans',monospace;letter-spacing:.12em;text-transform:uppercase}
    .playlist-create-button{border:1px solid var(--accent,#ff35b8);background:transparent;color:var(--accent,#ff35b8);font:700 11px inherit;cursor:pointer;padding:3px 7px;min-width:25px}
    .playlist-menu-list{display:grid;gap:4px;max-height:190px;overflow-y:auto;padding-right:2px}
    .playlist-menu-row{display:grid;grid-template-columns:minmax(0,1fr) 25px 25px 25px;align-items:center;gap:2px;min-width:0}
    .playlist-open-button,.playlist-action-button,.playlist-play-button{min-height:30px;border:1px solid transparent;background:transparent;color:var(--text,#f9eafa);cursor:pointer;font:inherit}
    .playlist-play-button{font-size:14px;color:var(--accent,#ff35b8);padding:2px}
    .playlist-play-button:hover{border-color:var(--accent,#ff35b8);background:rgba(255,53,184,.13)}
    #repeat-button{position:relative}
    #repeat-button .repeat-one-badge{position:absolute;right:1px;bottom:0;font:700 9px/1 Arial,sans-serif;color:currentColor;background:var(--player-bg,#180e1c);padding:1px}
    #repeat-button.active{color:var(--accent,#ff35b8)}
    .playlist-open-button{display:flex;align-items:center;gap:7px;text-align:left;padding:6px 7px;min-width:0;font-size:11px}
    .playlist-open-button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .playlist-open-button small{margin-left:auto;color:var(--muted,#bda9c4);font-size:10px}
    .playlist-open-button.active{background:rgba(255,53,184,.13);border-color:var(--accent,#ff35b8);color:var(--accent,#ff35b8)}
    .playlist-action-button{font-size:13px;color:var(--muted,#bda9c4);padding:2px}
    .playlist-action-button:hover,.playlist-open-button:hover{border-color:var(--accent,#ff35b8);color:var(--accent,#ff35b8)}
    .playlist-menu-empty{font-size:11px;line-height:1.5;color:var(--muted,#bda9c4);padding:4px 2px}
    .row-add-playlist{border:0;background:transparent;color:var(--muted,#bda9c4);cursor:pointer;font-size:19px;line-height:1;padding:5px;min-width:25px}
    .row-add-playlist:hover{color:var(--accent,#ff35b8)}
    .playlist-dialog{width:min(420px,calc(100vw - 32px));padding:22px;background:var(--panel,#1b1020);color:var(--text,#f9eafa);border:1px solid var(--accent,#ff35b8);box-shadow:6px 6px 0 rgba(255,53,184,.16)}
    .playlist-dialog::backdrop{background:rgba(5,2,9,.78);backdrop-filter:blur(3px)}
    .playlist-dialog h2{font-family:'Pixelify Sans',monospace;font-size:22px;margin:0 0 18px}
    .playlist-dialog label{display:block;font-size:12px;color:var(--muted,#bda9c4);margin-bottom:7px}
    .playlist-dialog input{width:100%;box-sizing:border-box;background:var(--input-bg,#100914);color:var(--text,#f9eafa);border:1px solid var(--accent,#ff35b8);padding:11px;font:inherit;margin-bottom:16px}
    .playlist-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
    .playlist-dialog-actions button,.playlist-picker-option{background:transparent;border:1px solid var(--accent,#ff35b8);color:var(--text,#f9eafa);padding:9px 12px;cursor:pointer;font:inherit}
    .playlist-dialog-actions .primary{background:var(--accent,#ff35b8);color:#fff;font-weight:700}
    .playlist-picker-list{display:grid;gap:7px;max-height:45vh;overflow:auto;margin-bottom:16px}
    .playlist-picker-option{text-align:left;display:flex;justify-content:space-between;gap:10px}
    .playlist-picker-option:hover{background:rgba(255,53,184,.14)}
    @media(max-height:700px){.playlist-menu-list{max-height:120px}}
  `;
  document.head.appendChild(styles);

  const menu = document.createElement("section");
  menu.id = "user-playlists-menu";
  menu.className = "user-playlists-menu";
  menu.innerHTML = `
    <div class="user-playlists-heading"><span>Twoje playlisty</span><button type="button" class="playlist-create-button" id="create-playlist-button" aria-label="Utwórz playlistę" title="Utwórz playlistę">+</button></div>
    <div class="playlist-menu-list" id="playlist-menu-list"></div>
  `;
  sidebarFilters.insertAdjacentElement("afterend", menu);

  const editor = document.createElement("dialog");
  editor.id = "playlist-editor-dialog";
  editor.className = "playlist-dialog";
  editor.innerHTML = `
    <form id="playlist-editor-form">
      <h2 id="playlist-editor-title">Nowa playlista</h2>
      <label for="playlist-name-input">Nazwa playlisty</label>
      <input id="playlist-name-input" name="name" maxlength="60" required placeholder="np. K-pop na wieczór" autocomplete="off">
      <div class="playlist-dialog-actions">
        <button type="button" id="playlist-editor-cancel">Anuluj</button>
        <button type="submit" class="primary">Zapisz</button>
      </div>
    </form>
  `;
  document.body.appendChild(editor);

  const picker = document.createElement("dialog");
  picker.id = "playlist-picker-dialog";
  picker.className = "playlist-dialog";
  picker.innerHTML = `
    <h2>Dodaj do playlisty</h2>
    <div class="playlist-picker-list" id="playlist-picker-list"></div>
    <div class="playlist-dialog-actions">
      <button type="button" id="playlist-picker-create">+ Nowa playlista</button>
      <button type="button" id="playlist-picker-cancel">Zamknij</button>
    </div>
  `;
  document.body.appendChild(picker);

  document.querySelector("#create-playlist-button").addEventListener("click", () => openPlaylistEditor());
  document.querySelector("#playlist-editor-cancel").addEventListener("click", () => editor.close());
  document.querySelector("#playlist-editor-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.querySelector("#playlist-name-input").value.trim();
    if (!name) return;
    const duplicate = playlists.some((item) => item.name.toLocaleLowerCase("pl") === name.toLocaleLowerCase("pl") && item.id !== editingPlaylistId);
    if (duplicate) {
      showToast("Masz już playlistę o takiej nazwie.");
      return;
    }

    let playlist;
    if (editingPlaylistId) {
      playlist = playlists.find((item) => item.id === editingPlaylistId);
      if (playlist) playlist.name = name;
    } else {
      playlist = { id: makeId(), name, trackIds: [] };
      playlists.push(playlist);
      activePlaylistId = playlist.id;
      if (trackToAddAfterPlaylistCreate) {
        if (!playlist.trackIds.includes(trackToAddAfterPlaylistCreate)) playlist.trackIds.push(trackToAddAfterPlaylistCreate);
        trackToAddAfterPlaylistCreate = null;
      }
    }
    editingPlaylistId = null;
    savePlaylists();
    editor.close();
    document.querySelector("#playlist-name-input").value = "";
    activeFilter = "all";
    onlyLiked = false;
    document.querySelector("#liked-nav").classList.remove("active");
    render();
    showToast(playlist ? `Zapisano playlistę „${name}”.` : "Zapisano playlistę.");
  });

  menu.addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-playlist]");
    const playPlaylistButton = event.target.closest("[data-play-playlist]");
    const edit = event.target.closest("[data-edit-playlist]");
    const remove = event.target.closest("[data-delete-playlist]");
    if (playPlaylistButton) {
      event.preventDefault();
      event.stopPropagation();
      playPlaylist(playPlaylistButton.dataset.playPlaylist);
      return;
    }
    if (edit) {
      event.preventDefault();
      event.stopPropagation();
      openPlaylistEditor(edit.dataset.editPlaylist);
      return;
    }
    if (remove) {
      event.preventDefault();
      event.stopPropagation();
      deletePlaylist(remove.dataset.deletePlaylist);
      return;
    }
    if (open) {
      activePlaylistId = open.dataset.openPlaylist;
      activeFilter = "all";
      onlyLiked = false;
      document.querySelector("#liked-nav").classList.remove("active");
      render();
    }
  });

  picker.addEventListener("click", (event) => {
    const choose = event.target.closest("[data-pick-playlist]");
    if (choose) {
      addTrackToPlaylist(pendingPickerTrackId, choose.dataset.pickPlaylist);
      picker.close();
    }
  });
  document.querySelector("#playlist-picker-cancel").addEventListener("click", () => picker.close());
  document.querySelector("#playlist-picker-create").addEventListener("click", () => {
    picker.close();
    openPlaylistEditor(null, pendingPickerTrackId);
  });

  renderPlaylistMenu();
}

function renderPlaylistMenu() {
  const list = document.querySelector("#playlist-menu-list");
  if (!list) return;
  list.innerHTML = playlists.length ? playlists.map((playlist) => {
    const count = playlist.trackIds.filter((id) => tracks.some((track) => track.id === id)).length;
    return `<div class="playlist-menu-row">
      <button type="button" class="playlist-open-button${activePlaylistId === playlist.id ? " active" : ""}" data-open-playlist="${escapeHTML(playlist.id)}" title="Otwórz playlistę ${escapeHTML(playlist.name)}">
        <b aria-hidden="true">♫</b><span>${escapeHTML(playlist.name)}</span><small>${count}</small>
      </button>
      <button type="button" class="playlist-play-button" data-play-playlist="${escapeHTML(playlist.id)}" aria-label="Odtwórz całą playlistę ${escapeHTML(playlist.name)}" title="Odtwórz całą playlistę">▶</button>
      <button type="button" class="playlist-action-button" data-edit-playlist="${escapeHTML(playlist.id)}" aria-label="Edytuj playlistę ${escapeHTML(playlist.name)}" title="Edytuj">✎</button>
      <button type="button" class="playlist-action-button" data-delete-playlist="${escapeHTML(playlist.id)}" aria-label="Usuń playlistę ${escapeHTML(playlist.name)}" title="Usuń">×</button>
    </div>`;
  }).join("") : `<div class="playlist-menu-empty">Nie masz jeszcze playlist. Kliknij +, aby utworzyć pierwszą.</div>`;
}

function openPlaylistEditor(id = null, trackIdToAdd = null) {
  const editor = document.querySelector("#playlist-editor-dialog");
  if (!editor) return;
  editingPlaylistId = id;
  trackToAddAfterPlaylistCreate = id ? null : trackIdToAdd;
  const playlist = id ? playlists.find((item) => item.id === id) : null;
  document.querySelector("#playlist-editor-title").textContent = playlist ? "Edytuj playlistę" : "Nowa playlista";
  document.querySelector("#playlist-name-input").value = playlist?.name || "";
  editor.showModal();
  document.querySelector("#playlist-name-input").focus();
}

function deletePlaylist(id) {
  const playlist = playlists.find((item) => item.id === id);
  if (!playlist) return;
  if (!confirm(`Usunąć playlistę „${playlist.name}”? Same utwory nie zostaną usunięte.`)) return;
  playlists = playlists.filter((item) => item.id !== id);
  if (activePlaylistId === id) activePlaylistId = null;
  savePlaylists();
  render();
  showToast(`Usunięto playlistę „${playlist.name}”.`);
}

function openPlaylistPicker(trackId) {
  if (!playlists.length) {
    openPlaylistEditor(null, trackId);
    return;
  }
  pendingPickerTrackId = trackId;
  const list = document.querySelector("#playlist-picker-list");
  list.innerHTML = playlists.map((playlist) => {
    const alreadyIn = playlist.trackIds.includes(trackId);
    return `<button type="button" class="playlist-picker-option" data-pick-playlist="${escapeHTML(playlist.id)}"><span>${escapeHTML(playlist.name)}</span><span>${alreadyIn ? "✓ Dodano" : "+ Dodaj"}</span></button>`;
  }).join("");
  document.querySelector("#playlist-picker-dialog").showModal();
}

function addTrackToPlaylist(trackId, playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  const track = tracks.find((item) => item.id === trackId);
  if (!playlist || !track) return;
  if (playlist.trackIds.includes(trackId)) {
    showToast(`„${track.title}” jest już na playliście „${playlist.name}”.`);
    return;
  }
  playlist.trackIds.push(trackId);
  savePlaylists();
  render();
  showToast(`Dodano „${track.title}” do playlisty „${playlist.name}”.`);
}

function removeTrackFromActivePlaylist(trackId) {
  const playlist = activePlaylist();
  if (!playlist) return false;
  const track = tracks.find((item) => item.id === trackId);
  playlist.trackIds = playlist.trackIds.filter((id) => id !== trackId);
  savePlaylists();
  render();
  if (track) showToast(`Usunięto „${track.title}” z playlisty „${playlist.name}”.`);
  return true;
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
    const selectedPlaylist = activePlaylist();
    const matchesPlaylist = !selectedPlaylist || selectedPlaylist.trackIds.includes(track.id);
    const matchesArtist = activeFilter === "all" || track.artist === activeFilter;
    const matchesSearch = `${track.title} ${track.artist}`.toLocaleLowerCase("pl").includes(query);
    return matchesPlaylist && matchesArtist && matchesSearch && (!onlyLiked || liked.has(track.id));
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
      <button class="row-add-playlist" type="button" data-add-playlist="${escapeHTML(track.id)}" aria-label="Dodaj ${escapeHTML(track.title)} do playlisty" title="Dodaj do playlisty">＋</button>
      <span class="track-duration" role="cell">${secondsToTime(track.duration)}</span>
      <button class="row-remove" type="button" aria-label="${activePlaylistId ? "Usuń z playlisty" : "Usuń utwór"}: ${escapeHTML(track.title)}" data-remove="${escapeHTML(track.id)}">×</button>
    </article>`).join("");

  visibleTracks.forEach(loadTrackDuration);

  const emptyState = document.querySelector("#empty-state");
  emptyState.hidden = visibleTracks.length > 0;
  if (!tracks.length) emptyState.textContent = "Twoja kolekcja jest pusta. Dodaj plik MP3 albo wpisz utwór w music/library.js.";
  else if (!visibleTracks.length && activePlaylist()) emptyState.textContent = `Playlista „${activePlaylist().name}” jest pusta. Kliknij ＋ przy utworze, aby go dodać.`;
  else if (!visibleTracks.length) emptyState.textContent = onlyLiked ? "Nie masz jeszcze polubionych utworów." : "Nie znaleziono utworów. Spróbuj innego hasła.";
  document.querySelector("#track-count").textContent = `${visibleTracks.length} ${visibleTracks.length === 1 ? "utwór" : "utworów"}`;
}

function render() {
  renderFilters();
  renderPlaylistMenu();
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
  document.querySelector(".player").classList.toggle("is-playing", isPlaying);
  playButton.setAttribute("aria-label", isPlaying ? "Wstrzymaj" : "Odtwórz");
  playButton.innerHTML = `<svg><use href="#i-${isPlaying ? "pause" : "play"}" /></svg>`;
  if (currentTrack) renderTracks();
}

function getPlaylistTrackIds(playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  if (!playlist) return [];
  const validIds = new Set(tracks.map((track) => track.id));
  return playlist.trackIds.filter((id) => validIds.has(id));
}

function getDefaultQueueIds(track) {
  const selectedPlaylist = activePlaylist();
  if (selectedPlaylist) {
    const ids = getPlaylistTrackIds(selectedPlaylist.id);
    if (ids.includes(track.id)) return ids;
  }
  return tracks.map((item) => item.id);
}

function playPlaylist(playlistId) {
  const playlist = playlists.find((item) => item.id === playlistId);
  const ids = getPlaylistTrackIds(playlistId);
  const firstTrack = tracks.find((track) => track.id === ids[0]);
  if (!playlist) return;
  if (!firstTrack) {
    showToast(`Playlista „${playlist.name}” jest pusta. Dodaj do niej utwory przyciskiem ＋.`);
    return;
  }

  activePlaylistId = playlist.id;
  activeFilter = "all";
  onlyLiked = false;
  searchInput.value = "";
  document.querySelector("#liked-nav").classList.remove("active");
  queueTrackIds = ids;
  render();
  playTrack(firstTrack, ids);
  showToast(`Odtwarzam playlistę „${playlist.name}”.`);
}

async function playTrack(track, queueIds = null) {
  if (queueIds) {
    queueTrackIds = [...new Set(queueIds)].filter((id) => tracks.some((item) => item.id === id));
  } else {
    // Kliknięcie pojedynczego utworu ustawia kolejkę odpowiednią dla aktualnego widoku.
    queueTrackIds = getDefaultQueueIds(track);
  }
  if (!queueTrackIds.includes(track.id)) queueTrackIds.unshift(track.id);

  currentTrack = track;
  currentIndex = queueTrackIds.indexOf(track.id);
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
    audio.loop = repeatMode === "one";
    await audio.play();
  } catch (error) {
    if (requestId === playRequest) {
      setPlaying(false);
      showToast(error.message || "Nie udało się odtworzyć tego pliku MP3.");
    }
  }
}

function playNext(direction = 1) {
  const validQueue = queueTrackIds
    .map((id) => tracks.find((track) => track.id === id))
    .filter(Boolean);

  if (!validQueue.length) {
    if (!tracks.length) showToast("Dodaj najpierw utwór do kolekcji.");
    return;
  }

  const index = validQueue.findIndex((track) => track.id === currentTrack?.id);
  let nextIndex;

  if (shuffle && validQueue.length > 1 && direction > 0) {
    do { nextIndex = Math.floor(Math.random() * validQueue.length); } while (nextIndex === index);
  } else {
    nextIndex = index + direction;
    if (nextIndex < 0) {
      if (repeatMode === "all") nextIndex = validQueue.length - 1;
      else {
        if (currentTrack) {
          audio.currentTime = 0;
          if (audio.paused) audio.play().catch(() => {});
        }
        return;
      }
    }
    if (nextIndex >= validQueue.length) {
      if (repeatMode === "all") nextIndex = 0;
      else {
        audio.pause();
        audio.currentTime = 0;
        setPlaying(false);
        return;
      }
    }
  }

  playTrack(validQueue[nextIndex], queueTrackIds);
}

function updateRepeatButton() {
  const button = document.querySelector("#repeat-button");
  if (!button) return;
  const labels = {
    off: "Włącz powtarzanie playlisty",
    all: "Powtarzanie całej playlisty włączone. Kliknij, aby powtarzać jeden utwór.",
    one: "Powtarzanie jednego utworu włączone. Kliknij, aby wyłączyć powtarzanie."
  };
  button.classList.toggle("active", repeatMode !== "off");
  button.dataset.repeatMode = repeatMode;
  button.setAttribute("aria-label", labels[repeatMode]);
  button.title = repeatMode === "off" ? "Powtarzanie wyłączone" : repeatMode === "all" ? "Powtarzaj całą playlistę" : "Powtarzaj jeden utwór";
  let badge = button.querySelector(".repeat-one-badge");
  if (repeatMode === "one") {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "repeat-one-badge";
      badge.textContent = "1";
      button.appendChild(badge);
    }
  } else {
    badge?.remove();
  }
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
    if (tracks.length) {
      const ids = activePlaylist() ? getPlaylistTrackIds(activePlaylistId) : tracks.map((track) => track.id);
      playTrack(tracks.find((track) => ids.includes(track.id)) || tracks[0], ids);
    } else showToast("Dodaj plik MP3, aby zacząć słuchać.");
  } else if (audio.paused) {
    audio.play().catch(() => showToast("Nie udało się odtworzyć tego pliku MP3."));
  } else {
    audio.pause();
  }
}

function setFilter(filter) {
  activePlaylistId = null;
  activeFilter = filter;
  onlyLiked = false;
  document.querySelector("#liked-nav").classList.remove("active");
  render();
}

async function addTrack(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const title = document.querySelector("#track-title-input").value.trim();
  const artist = document.querySelector("#track-artist-input").value.trim();
  const file = document.querySelector("#audio-file-input").files[0];
  const artworkFile = document.querySelector("#artwork-file-input").files[0];

  if (!title || !artist) {
    showToast("Podaj tytuł i wykonawcę.");
    return;
  }

  if (!file || (!file.type.startsWith("audio/") && !file.name.toLowerCase().endsWith(".mp3"))) {
    showToast("Wybierz plik audio, najlepiej w formacie MP3.");
    return;
  }

  const data = new FormData();
  data.append("title", title);
  data.append("artist", artist);
  data.append("audio", file);
  if (artworkFile) data.append("artwork", artworkFile);

  try {
    const response = await fetch("/api/tracks", { method: "POST", body: data });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || "Nie udało się zapisać utworu.");

    tracks.push({
      ...saved,
      serverId: saved.id,
      id: `server-${saved.id}`,
      source: saved.src,
      album: saved.artist,
      artwork: saved.artwork || fallbackArtwork
    });
    const selectedPlaylist = activePlaylist();
    if (selectedPlaylist && !selectedPlaylist.trackIds.includes(`server-${saved.id}`)) {
      selectedPlaylist.trackIds.push(`server-${saved.id}`);
      savePlaylists();
    }

    searchInput.value = "";
    activeFilter = "all";
    onlyLiked = false;
    document.querySelector("#liked-nav").classList.remove("active");
    savePlaylist();
    render();
    dialog.close();
    form.reset();
    showToast(`Dodano „${title}” do playlisty i folderu music.`);
  } catch (error) {
    showToast(error.message || "Nie udało się połączyć z serwerem. Uruchom server.js.");
  }
}

async function loadServerTracks() {
  try {
    const response = await fetch("/api/tracks");
    if (!response.ok) throw new Error("Nie udało się pobrać zapisanych utworów.");
    const savedTracks = await response.json();
    const existingIds = new Set(tracks.map(track => track.serverId).filter(Boolean));

    for (const saved of savedTracks) {
      if (existingIds.has(saved.id)) continue;
      tracks.push({
        ...saved,
        serverId: saved.id,
        id: `server-${saved.id}`,
        source: saved.src,
        album: saved.artist,
        artwork: saved.artwork || fallbackArtwork
      });
    }
    render();
  } catch (error) {
    console.warn("Nie udało się wczytać utworów z serwera. Czy server.js jest uruchomiony?", error);
  }
}

async function removeTrack(id) {
  if (activePlaylistId && removeTrackFromActivePlaylist(id)) return;
  const track = tracks.find((item) => item.id === id);
  tracks = tracks.filter((item) => item.id !== id);
  liked.delete(id);
  if (track?.serverId) {
    try {
      const response = await fetch(`/api/tracks/${encodeURIComponent(track.serverId)}`, { method: "DELETE" });
      if (!response.ok) showToast("Usunięto z listy, ale serwer nie potwierdził usunięcia pliku.");
    } catch (error) {
      console.error("Nie udało się usunąć utworu z serwera:", error);
      showToast("Nie udało się połączyć z serwerem podczas usuwania.");
    }
  }
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
    updateProgressPaint();
    document.querySelector("#elapsed-time").textContent = "0:00";
    document.querySelector("#duration-time").textContent = "--:--";
    document.querySelector("#current-title").textContent = "Wybierz coś dla siebie";
    document.querySelector("#current-artist").textContent = "gotowy na pierwszy beat";
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
  const addToPlaylist = event.target.closest("[data-add-playlist]");
  if (addToPlaylist) {
    openPlaylistPicker(addToPlaylist.dataset.addPlaylist);
    return;
  }
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
themeToggle.addEventListener("click", () => {
  const isNeon = document.documentElement.dataset.theme !== "neon";
  setTheme(isNeon);
  try {
    localStorage.setItem(themeKey, isNeon ? "neon" : "light");
  } catch (error) {
    console.error("Nie udało się zapisać wybranego motywu.", error);
    showToast("Nie udało się zapisać ustawień motywu.");
  }
});
searchInput.addEventListener("input", renderTracks);
document.querySelector("#focus-search").addEventListener("click", () => searchInput.focus());
document.querySelector("#liked-nav").addEventListener("click", (event) => {
  activePlaylistId = null;
  onlyLiked = !onlyLiked;
  activeFilter = "all";
  event.currentTarget.classList.toggle("active", onlyLiked);
  render();
});
document.querySelector("#pepe-sound").addEventListener("click", () => {
  const sound = chajzerSounds[Math.floor(Math.random() * chajzerSounds.length)];
  const track = {
    id: `chajzer-${sound.source}`,
    title: sound.title,
    artist: "Chajzer",
    source: sound.source,
    duration: 0,
    artwork: fallbackArtwork
  };
  playTrack(track, [track.id]);
});
document.querySelector("#hero-play").addEventListener("click", () => {
  const selected = activePlaylist();
  if (selected) playPlaylist(selected.id);
  else if (tracks.length) playTrack(tracks[0], tracks.map((track) => track.id));
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
document.querySelector("#repeat-button").addEventListener("click", () => {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  audio.loop = repeatMode === "one";
  updateRepeatButton();
  const messages = {
    off: "Powtarzanie wyłączone.",
    all: "Powtarzanie całej playlisty włączone.",
    one: "Powtarzanie jednego utworu włączone."
  };
  showToast(messages[repeatMode]);
});
document.querySelector("#current-like").addEventListener("click", () => { if (currentTrack) toggleLike(currentTrack.id); });
document.querySelector("#volume").addEventListener("input", (event) => { audio.volume = Number(event.target.value); });
progress.addEventListener("input", () => {
  updateProgressPaint();
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(progress.value) / 100) * audio.duration;
});
audio.addEventListener("timeupdate", () => {
  if (!Number.isFinite(audio.duration)) return;
  progress.value = String((audio.currentTime / audio.duration) * 100);
  updateProgressPaint();
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
audio.addEventListener("ended", () => {
  if (repeatMode === "one") return;
  playNext(1);
});
audio.addEventListener("error", () => showToast("Nie udało się odczytać pliku. Sprawdź jego ścieżkę i format MP3."));
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== searchInput) { event.preventDefault(); searchInput.focus(); }
  if (event.code === "Space" && document.activeElement !== searchInput && document.activeElement.tagName !== "BUTTON" && !dialog.open) { event.preventDefault(); togglePlayback(); }
});

audio.volume = Number(document.querySelector("#volume").value);
updateProgressPaint();
installPlaylistUI();
updateRepeatButton();
render();
loadServerTracks();

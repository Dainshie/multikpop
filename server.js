const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const app = express();
const PORT = 3000;
const musicDir = path.join(__dirname, "music");
const databaseFile = path.join(musicDir, "user-tracks.json");

fs.mkdirSync(musicDir, { recursive: true });

function readTracks() {
  try {
    const value = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveTracks(tracks) {
  fs.writeFileSync(databaseFile, JSON.stringify(tracks, null, 2), "utf8");
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, musicDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `user-${randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use(express.static(__dirname));

app.get("/api/tracks", (_req, res) => res.json(readTracks()));

app.post("/api/tracks", upload.fields([
  { name: "audio", maxCount: 1 },
  { name: "artwork", maxCount: 1 }
]), (req, res) => {
  const audioFile = req.files?.audio?.[0];
  const imageFile = req.files?.artwork?.[0];
  const title = String(req.body.title || "").trim();
  const artist = String(req.body.artist || "").trim();

  if (!audioFile || !title || !artist) {
    for (const file of [audioFile, imageFile]) {
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
    return res.status(400).json({ error: "Podaj tytuł, wykonawcę i wybierz plik audio." });
  }

  const track = {
    id: randomUUID(),
    title,
    artist,
    src: `music/${audioFile.filename}`,
    artwork: imageFile ? `music/${imageFile.filename}` : "",
    duration: 0
  };

  const tracks = readTracks();
  tracks.push(track);
  saveTracks(tracks);
  res.status(201).json(track);
});

app.delete("/api/tracks/:id", (req, res) => {
  const tracks = readTracks();
  const track = tracks.find(item => item.id === req.params.id);
  if (!track) return res.status(404).json({ error: "Nie znaleziono utworu." });

  for (const url of [track.src, track.artwork]) {
    if (!url) continue;
    const filename = path.basename(url);
    if (!filename.startsWith("user-")) continue;
    const filePath = path.join(musicDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  saveTracks(tracks.filter(item => item.id !== track.id));
  res.json({ success: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`MultiKpop działa na http://127.0.0.1:${PORT}`);
});

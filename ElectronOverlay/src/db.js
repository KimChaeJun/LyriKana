const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 2;
let db = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeSongKey(songInfo) {
  const title = String(songInfo?.title ?? "").trim().toLowerCase();
  const artist = String(songInfo?.artist ?? "").trim().toLowerCase();
  const duration = Number.isFinite(Number(songInfo?.duration))
    ? Math.round(Number(songInfo.duration))
    : "";

  return `${title}::${artist}::${duration}`;
}

function initDatabase(app) {
  if (db) return db;

  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });

  const dbPath = path.join(userDataPath, "lyrikana-cache.sqlite");
  db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lyric_sources (
      song_key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration INTEGER,
      release_year TEXT,
      provider TEXT NOT NULL,
      provider_payload TEXT NOT NULL,
      synced_lyrics TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_readings (
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      reading TEXT NOT NULL,
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (original, engine_version)
    );

    CREATE TABLE IF NOT EXISTS reading_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      source TEXT NOT NULL,
      reading TEXT NOT NULL,
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      reasons TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE(original, engine_version, source, reading)
    );

    CREATE TABLE IF NOT EXISTS reading_corrections (
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      reading TEXT NOT NULL,
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (original, engine_version)
    );

    CREATE INDEX IF NOT EXISTS idx_reading_candidates_original_version
      ON reading_candidates(original, engine_version);
  `);

  db.prepare(
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)`
  ).run(String(SCHEMA_VERSION));

  console.log(`[LyriKana] cache database ready: ${dbPath}`);
  return db;
}

function getCachedLyrics(songInfo) {
  const songKey = normalizeSongKey(songInfo);
  const row = db
    .prepare(
      `SELECT provider_payload, synced_lyrics
       FROM lyric_sources
       WHERE song_key = ?`
    )
    .get(songKey);

  if (!row) return null;

  return {
    songKey,
    providerPayload: JSON.parse(row.provider_payload),
    syncedLyrics: row.synced_lyrics,
  };
}

function saveCachedLyrics({ songInfo, providerPayload, syncedLyrics }) {
  const songKey = normalizeSongKey(songInfo);
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO lyric_sources (
      song_key, title, artist, duration, release_year, provider,
      provider_payload, synced_lyrics, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'lrclib', ?, ?, ?, ?)
    ON CONFLICT(song_key) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      duration = excluded.duration,
      release_year = excluded.release_year,
      provider = excluded.provider,
      provider_payload = excluded.provider_payload,
      synced_lyrics = excluded.synced_lyrics,
      updated_at = excluded.updated_at`
  ).run(
    songKey,
    songInfo.title ?? "",
    songInfo.artist ?? "",
    Number.isFinite(Number(songInfo.duration)) ? Math.round(Number(songInfo.duration)) : null,
    songInfo.releaseYear ?? null,
    JSON.stringify(providerPayload ?? {}),
    syncedLyrics ?? "",
    timestamp,
    timestamp
  );

  return { songKey };
}

function getCachedLineReadings({ originals, engineVersion }) {
  const version = Number(engineVersion);
  const correctionStmt = db.prepare(
    `SELECT original, reading, kr, jp, en, 'correction' AS source
     FROM reading_corrections
     WHERE original = ? AND engine_version = ?`
  );
  const lineStmt = db.prepare(
    `SELECT original, reading, kr, jp, en
     FROM line_readings
     WHERE original = ? AND engine_version = ?`
  );

  const lines = [];

  for (const original of Array.isArray(originals) ? originals : []) {
    const text = String(original);
    const row = correctionStmt.get(text, version) ?? lineStmt.get(text, version);
    if (row) lines.push(row);
  }

  return { lines };
}

function saveCachedLineReading({ line, engineVersion }) {
  const version = Number(engineVersion);
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO line_readings (
      original, engine_version, reading, kr, jp, en, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(original, engine_version) DO UPDATE SET
      reading = excluded.reading,
      kr = excluded.kr,
      jp = excluded.jp,
      en = excluded.en,
      updated_at = excluded.updated_at`
  ).run(
    line.original ?? "",
    version,
    line.reading ?? "",
    line.kr ?? "",
    line.jp ?? "",
    line.en ?? "",
    timestamp,
    timestamp
  );

  saveReadingCandidate({
    original: line.original,
    engineVersion: version,
    source: "lyrikana-precise",
    reading: line.reading,
    kr: line.kr,
    jp: line.jp,
    en: line.en,
    score: 1,
    reasons: ["selected precise reading"],
  });

  return { ok: true };
}

function getReadingCandidates({ original, engineVersion }) {
  const rows = db
    .prepare(
      `SELECT original, engine_version AS engineVersion, source, reading, kr, jp, en,
        score, reasons, created_at AS createdAt
       FROM reading_candidates
       WHERE original = ? AND engine_version = ?
       ORDER BY score DESC, created_at DESC`
    )
    .all(String(original ?? ""), Number(engineVersion));

  return {
    candidates: rows.map((row) => ({
      ...row,
      reasons: JSON.parse(row.reasons),
    })),
  };
}

function saveReadingCandidate({
  original,
  engineVersion,
  source,
  reading,
  kr,
  jp,
  en,
  score = 0,
  reasons = [],
}) {
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO reading_candidates (
      original, engine_version, source, reading, kr, jp, en, score, reasons, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(original, engine_version, source, reading) DO UPDATE SET
      kr = excluded.kr,
      jp = excluded.jp,
      en = excluded.en,
      score = excluded.score,
      reasons = excluded.reasons`
  ).run(
    String(original ?? ""),
    Number(engineVersion),
    String(source ?? "unknown"),
    String(reading ?? ""),
    String(kr ?? ""),
    String(jp ?? ""),
    String(en ?? ""),
    Number(score),
    JSON.stringify(Array.isArray(reasons) ? reasons : []),
    timestamp
  );

  return { ok: true };
}

function saveReadingCorrection({ line, engineVersion, note }) {
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO reading_corrections (
      original, engine_version, reading, kr, jp, en, note, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(original, engine_version) DO UPDATE SET
      reading = excluded.reading,
      kr = excluded.kr,
      jp = excluded.jp,
      en = excluded.en,
      note = excluded.note,
      updated_at = excluded.updated_at`
  ).run(
    line.original ?? "",
    Number(engineVersion),
    line.reading ?? "",
    line.kr ?? "",
    line.jp ?? "",
    line.en ?? "",
    note ?? null,
    timestamp,
    timestamp
  );

  saveReadingCandidate({
    original: line.original,
    engineVersion,
    source: "user-correction",
    reading: line.reading,
    kr: line.kr,
    jp: line.jp,
    en: line.en,
    score: 100,
    reasons: note ? [String(note)] : ["manual correction"],
  });

  return { ok: true };
}

function closeDatabase() {
  db?.close();
  db = null;
}

module.exports = {
  closeDatabase,
  getCachedLineReadings,
  getCachedLyrics,
  getReadingCandidates,
  initDatabase,
  saveCachedLineReading,
  saveCachedLyrics,
  saveReadingCandidate,
  saveReadingCorrection,
};

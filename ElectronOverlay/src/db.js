const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 4;
let db = null;

function nowIso() {
  return new Date().toISOString();
}

function tableHasColumn(tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function ensureLineReadingColumns() {
  const columns = [
    ["spoken_reading", "TEXT NOT NULL DEFAULT ''"],
    ["reading_source", "TEXT NOT NULL DEFAULT 'legacy'"],
    ["reading_confidence", "REAL NOT NULL DEFAULT 0"],
  ];

  for (const [name, definition] of columns) {
    if (!tableHasColumn("line_readings", name)) {
      db.exec(`ALTER TABLE line_readings ADD COLUMN ${name} ${definition}`);
    }
  }
}

function migrateReadingCandidates() {
  if (tableHasColumn("reading_candidates", "song_id")) return;

  db.exec(`
    DROP INDEX IF EXISTS idx_reading_candidates_original_version;
    ALTER TABLE reading_candidates RENAME TO reading_candidates_v3;

    CREATE TABLE reading_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT NOT NULL DEFAULT '',
      line_no INTEGER NOT NULL DEFAULT -1,
      span_start INTEGER NOT NULL DEFAULT -1,
      span_end INTEGER NOT NULL DEFAULT -1,
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      source TEXT NOT NULL,
      reading TEXT NOT NULL,
      spoken_reading TEXT NOT NULL DEFAULT '',
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 0,
      reasons TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE(
        song_id, line_no, span_start, span_end, original,
        engine_version, source, reading
      )
    );

    INSERT INTO reading_candidates (
      song_id, line_no, span_start, span_end, original, engine_version,
      source, reading, spoken_reading, kr, jp, en, score, confidence,
      selected, reasons, created_at
    )
    SELECT
      '', -1, -1, -1, original, engine_version,
      source, reading, reading, kr, jp, en, score, score,
      0, reasons, created_at
    FROM reading_candidates_v3;

    DROP TABLE reading_candidates_v3;
  `);
}

function migrateReadingCorrections() {
  if (tableHasColumn("reading_corrections", "song_id")) return;

  db.exec(`
    ALTER TABLE reading_corrections RENAME TO reading_corrections_v3;

    CREATE TABLE reading_corrections (
      song_id TEXT NOT NULL DEFAULT '',
      line_no INTEGER NOT NULL DEFAULT -1,
      span_start INTEGER NOT NULL DEFAULT -1,
      span_end INTEGER NOT NULL DEFAULT -1,
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      reading TEXT NOT NULL,
      spoken_reading TEXT NOT NULL DEFAULT '',
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (
        song_id, line_no, span_start, span_end, original, engine_version
      )
    );

    INSERT INTO reading_corrections (
      song_id, line_no, span_start, span_end, original, engine_version,
      reading, spoken_reading, kr, jp, en, note, created_at, updated_at
    )
    SELECT
      '', -1, -1, -1, original, engine_version,
      reading, reading, kr, jp, en, note, created_at, updated_at
    FROM reading_corrections_v3;

    DROP TABLE reading_corrections_v3;
  `);
}

function migrateReadingSchema() {
  ensureLineReadingColumns();
  migrateReadingCandidates();
  migrateReadingCorrections();
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reading_candidates_scope
      ON reading_candidates(song_id, line_no, original, engine_version);
    CREATE INDEX IF NOT EXISTS idx_reading_corrections_scope
      ON reading_corrections(song_id, line_no, original, engine_version);
  `);
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

    CREATE TABLE IF NOT EXISTS line_readings (
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      reading TEXT NOT NULL,
      spoken_reading TEXT NOT NULL DEFAULT '',
      reading_source TEXT NOT NULL DEFAULT 'legacy',
      reading_confidence REAL NOT NULL DEFAULT 0,
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (original, engine_version)
    );

    CREATE TABLE IF NOT EXISTS reading_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id TEXT NOT NULL DEFAULT '',
      line_no INTEGER NOT NULL DEFAULT -1,
      span_start INTEGER NOT NULL DEFAULT -1,
      span_end INTEGER NOT NULL DEFAULT -1,
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      source TEXT NOT NULL,
      reading TEXT NOT NULL,
      spoken_reading TEXT NOT NULL DEFAULT '',
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 0,
      reasons TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE(
        song_id, line_no, span_start, span_end, original,
        engine_version, source, reading
      )
    );

    CREATE TABLE IF NOT EXISTS reading_corrections (
      song_id TEXT NOT NULL DEFAULT '',
      line_no INTEGER NOT NULL DEFAULT -1,
      span_start INTEGER NOT NULL DEFAULT -1,
      span_end INTEGER NOT NULL DEFAULT -1,
      original TEXT NOT NULL,
      engine_version INTEGER NOT NULL,
      reading TEXT NOT NULL,
      spoken_reading TEXT NOT NULL DEFAULT '',
      kr TEXT NOT NULL,
      jp TEXT NOT NULL,
      en TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (
        song_id, line_no, span_start, span_end, original, engine_version
      )
    );
  `);

  migrateReadingSchema();

  db.prepare(
    `INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)`
  ).run(String(SCHEMA_VERSION));

  console.log(`[LyriKana] cache database ready: ${dbPath}`);
  return db;
}

function normalizeLineLookups({ lines, originals }) {
  if (Array.isArray(lines)) {
    return lines.map((line, index) => ({
      original: String(line?.original ?? ""),
      lineNo: Number.isFinite(Number(line?.lineNo)) ? Number(line.lineNo) : index,
    }));
  }

  return (Array.isArray(originals) ? originals : []).map((original, index) => ({
    original: String(original),
    lineNo: index,
  }));
}

function getCachedLineReadings({ lines, originals, engineVersion, songId = "" }) {
  const version = Number(engineVersion);
  const scopedSongId = String(songId ?? "");
  const correctionStmt = db.prepare(
    `SELECT original, reading, spoken_reading AS spokenReading,
       kr, jp, en, 'correction' AS readingSource, 1 AS readingConfidence
     FROM reading_corrections
     WHERE song_id = ? AND original = ? AND engine_version = ?
       AND line_no IN (?, -1)
     ORDER BY CASE WHEN line_no = ? THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`
  );
  const lineStmt = db.prepare(
    `SELECT original, reading, spoken_reading AS spokenReading,
       reading_source AS readingSource,
       reading_confidence AS readingConfidence,
       kr, jp, en
     FROM line_readings
     WHERE original = ? AND engine_version = ?`
  );

  const cachedLines = [];

  for (const lookup of normalizeLineLookups({ lines, originals })) {
    const scopedCorrection = correctionStmt.get(
      scopedSongId,
      lookup.original,
      version,
      lookup.lineNo,
      lookup.lineNo
    );
    const globalCorrection = scopedSongId
      ? correctionStmt.get(
          "",
          lookup.original,
          version,
          lookup.lineNo,
          lookup.lineNo
        )
      : null;
    const row =
      scopedCorrection ??
      globalCorrection ??
      lineStmt.get(lookup.original, version);
    if (row) cachedLines.push({ ...row, lineNo: lookup.lineNo });
  }

  return { lines: cachedLines };
}

function saveCachedLineReading({ line, engineVersion, songId = "", lineNo = -1 }) {
  const version = Number(engineVersion);
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO line_readings (
      original, engine_version, reading, spoken_reading, reading_source,
      reading_confidence, kr, jp, en, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(original, engine_version) DO UPDATE SET
      reading = excluded.reading,
      spoken_reading = excluded.spoken_reading,
      reading_source = excluded.reading_source,
      reading_confidence = excluded.reading_confidence,
      kr = excluded.kr,
      jp = excluded.jp,
      en = excluded.en,
      updated_at = excluded.updated_at`
  ).run(
    line.original ?? "",
    version,
    line.reading ?? "",
    line.spokenReading ?? line.reading ?? "",
    line.readingSource ?? "lyrikana-precise",
    Number(line.readingConfidence ?? 0),
    line.kr ?? "",
    line.jp ?? "",
    line.en ?? "",
    timestamp,
    timestamp
  );

  saveReadingCandidate({
    original: line.original,
    engineVersion: version,
    songId,
    lineNo,
    source: "lyrikana-precise",
    reading: line.reading,
    spokenReading: line.spokenReading ?? line.reading,
    kr: line.kr,
    jp: line.jp,
    en: line.en,
    score: 1,
    confidence: Number(line.readingConfidence ?? 0),
    selected: true,
    reasons: ["selected precise reading"],
  });

  return { ok: true };
}

function getReadingCandidates({ original, engineVersion, songId = "", lineNo = -1 }) {
  const scopedSongId = String(songId ?? "");
  const scopedLineNo = Number(lineNo ?? -1);
  const rows = db
    .prepare(
      `SELECT song_id AS songId, line_no AS lineNo,
        span_start AS spanStart, span_end AS spanEnd,
        original, engine_version AS engineVersion, source, reading,
        spoken_reading AS spokenReading, kr, jp, en,
        score, confidence, selected, reasons, created_at AS createdAt
       FROM reading_candidates
       WHERE original = ? AND engine_version = ?
         AND song_id IN ('', ?)
         AND line_no IN (-1, ?)
       ORDER BY
         CASE WHEN song_id = ? THEN 0 ELSE 1 END,
         CASE WHEN line_no = ? THEN 0 ELSE 1 END,
         selected DESC, score DESC, created_at DESC`
    )
    .all(
      String(original ?? ""),
      Number(engineVersion),
      scopedSongId,
      scopedLineNo,
      scopedSongId,
      scopedLineNo
    );

  return {
    candidates: rows.map((row) => ({
      ...row,
      selected: Boolean(row.selected),
      reasons: JSON.parse(row.reasons),
    })),
  };
}

function saveReadingCandidate({
  songId = "",
  lineNo = -1,
  spanStart = -1,
  spanEnd = -1,
  original,
  engineVersion,
  source,
  reading,
  spokenReading = "",
  kr,
  jp,
  en,
  score = 0,
  confidence = 0,
  selected = false,
  reasons = [],
}) {
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO reading_candidates (
      song_id, line_no, span_start, span_end, original, engine_version,
      source, reading, spoken_reading, kr, jp, en, score, confidence,
      selected, reasons, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(
      song_id, line_no, span_start, span_end, original,
      engine_version, source, reading
    ) DO UPDATE SET
      spoken_reading = excluded.spoken_reading,
      kr = excluded.kr,
      jp = excluded.jp,
      en = excluded.en,
      score = excluded.score,
      confidence = excluded.confidence,
      selected = excluded.selected,
      reasons = excluded.reasons`
  ).run(
    String(songId ?? ""),
    Number(lineNo ?? -1),
    Number(spanStart ?? -1),
    Number(spanEnd ?? -1),
    String(original ?? ""),
    Number(engineVersion),
    String(source ?? "unknown"),
    String(reading ?? ""),
    String(spokenReading ?? reading ?? ""),
    String(kr ?? ""),
    String(jp ?? ""),
    String(en ?? ""),
    Number(score),
    Number(confidence),
    selected ? 1 : 0,
    JSON.stringify(Array.isArray(reasons) ? reasons : []),
    timestamp
  );

  return { ok: true };
}

function saveReadingCorrection({
  line,
  engineVersion,
  note,
  songId = "",
  lineNo = -1,
  spanStart = -1,
  spanEnd = -1,
}) {
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO reading_corrections (
      song_id, line_no, span_start, span_end, original, engine_version,
      reading, spoken_reading, kr, jp, en, note, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(
      song_id, line_no, span_start, span_end, original, engine_version
    ) DO UPDATE SET
      reading = excluded.reading,
      spoken_reading = excluded.spoken_reading,
      kr = excluded.kr,
      jp = excluded.jp,
      en = excluded.en,
      note = excluded.note,
      updated_at = excluded.updated_at`
  ).run(
    String(songId ?? ""),
    Number(lineNo ?? -1),
    Number(spanStart ?? -1),
    Number(spanEnd ?? -1),
    line.original ?? "",
    Number(engineVersion),
    line.reading ?? "",
    line.spokenReading ?? line.reading ?? "",
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
    songId,
    lineNo,
    spanStart,
    spanEnd,
    source: "user-correction",
    reading: line.reading,
    spokenReading: line.spokenReading ?? line.reading,
    kr: line.kr,
    jp: line.jp,
    en: line.en,
    score: 100,
    confidence: 1,
    selected: true,
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
  getReadingCandidates,
  initDatabase,
  saveCachedLineReading,
  saveReadingCandidate,
  saveReadingCorrection,
};

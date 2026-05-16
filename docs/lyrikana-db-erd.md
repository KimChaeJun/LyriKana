# LyriKana DB ERD

## Goal

LyriKana stores lyrics by artist and track, then caches line-level pronunciation
results so repeat playback can render immediately.

## ERD

```mermaid
erDiagram
  ARTISTS ||--o{ TRACK_ARTISTS : performs
  TRACKS ||--o{ TRACK_ARTISTS : has
  TRACKS ||--o{ LYRIC_SOURCES : has
  LYRIC_SOURCES ||--o{ LYRIC_LINES : contains
  LYRIC_LINES ||--o{ READING_CANDIDATES : has
  LYRIC_LINES ||--o| FINAL_READINGS : selects
  LYRIC_LINES ||--o| READING_CORRECTIONS : overrides
  READING_CORRECTIONS ||--o{ CORRECTION_EVENTS : records

  ARTISTS {
    integer id PK
    text name
    text normalized_name UK
    text provider
    text provider_artist_id
    text created_at
    text updated_at
  }

  TRACKS {
    integer id PK
    text title
    text normalized_title
    integer duration_seconds
    text release_year
    text album_name
    text provider
    text provider_track_id
    text created_at
    text updated_at
  }

  TRACK_ARTISTS {
    integer track_id FK
    integer artist_id FK
    text role
    integer display_order
  }

  LYRIC_SOURCES {
    integer id PK
    integer track_id FK
    text provider
    text provider_lyric_id
    text synced_lyrics
    text plain_lyrics
    integer duration_seconds
    text source_payload_json
    integer is_selected
    text created_at
    text updated_at
  }

  LYRIC_LINES {
    integer id PK
    integer lyric_source_id FK
    integer line_index
    real start_time_seconds
    real end_time_seconds
    text original
    text original_hash
    text created_at
    text updated_at
  }

  READING_CANDIDATES {
    integer id PK
    integer lyric_line_id FK
    integer engine_version
    text source
    text reading
    text kr
    text jp
    text en
    real score
    text reasons_json
    text created_at
  }

  FINAL_READINGS {
    integer lyric_line_id PK
    integer selected_candidate_id FK
    integer engine_version
    text reading
    text kr
    text jp
    text en
    text selected_reason
    text created_at
    text updated_at
  }

  READING_CORRECTIONS {
    integer lyric_line_id PK
    integer engine_version
    text reading
    text kr
    text jp
    text en
    text note
    text created_at
    text updated_at
  }

  CORRECTION_EVENTS {
    integer id PK
    integer correction_id FK
    text type
    text before_json
    text after_json
    text source
    text created_at
  }
```

## Table Notes

`ARTISTS`
: Stores artists once. Use `normalized_name` for matching names from YouTube
Music and LRCLIB.

`TRACKS`
: Stores song metadata independent of lyric provider. The best identity key is
`normalized_title + primary_artist + duration_seconds`.

`TRACK_ARTISTS`
: Supports multiple artists, features, and collaborations while still letting
lyrics be browsed by artist.

`LYRIC_SOURCES`
: Stores raw LRCLIB or future provider data. Multiple sources can exist for one
track, and `is_selected` marks the chosen synced lyric.

`LYRIC_LINES`
: Stores each synced lyric line with timestamp and original text.

`READING_CANDIDATES`
: Stores competing readings from `kuromoji`, `sudachi`, `yahoo`, future models,
or rule-based passes.

`FINAL_READINGS`
: Stores the selected result for fast playback.

`READING_CORRECTIONS`
: Stores manual/user-approved corrections. These override `FINAL_READINGS`.

`CORRECTION_EVENTS`
: Keeps correction history for later JSONL training data generation.

## Recommended Indexes

```sql
CREATE UNIQUE INDEX idx_artists_normalized_name
  ON artists(normalized_name);

CREATE INDEX idx_tracks_lookup
  ON tracks(normalized_title, duration_seconds);

CREATE INDEX idx_track_artists_artist
  ON track_artists(artist_id, track_id);

CREATE INDEX idx_lyric_sources_track_selected
  ON lyric_sources(track_id, is_selected);

CREATE UNIQUE INDEX idx_lyric_lines_source_index
  ON lyric_lines(lyric_source_id, line_index);

CREATE INDEX idx_lyric_lines_original_hash
  ON lyric_lines(original_hash);

CREATE INDEX idx_reading_candidates_line_version
  ON reading_candidates(lyric_line_id, engine_version, score DESC);
```

## Current Migration Direction

The current SQLite cache can map into this ERD like this:

- `lyric_sources` cache table becomes `ARTISTS`, `TRACKS`,
  `TRACK_ARTISTS`, and `LYRIC_SOURCES`.
- Current line-level `line_readings` becomes `LYRIC_LINES` plus
  `FINAL_READINGS`.
- Current `reading_candidates` maps directly to `READING_CANDIDATES`.
- Current `reading_corrections` maps directly to `READING_CORRECTIONS`.

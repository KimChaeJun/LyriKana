# LyriKana Backend DB ERD

The backend separates a musical work from each concrete recording. A studio track, live performance,
and creator cover may share a work but always have different recording IDs and timing data.

```mermaid
erDiagram
  WORKS ||--o{ SONG_INFO : has_recordings
  SONG_INFO ||--o{ LYRICS : contains
  SONG_INFO ||--o{ ANALYSIS_JOBS : analyzed_by
  SONG_INFO ||--o{ AUDIO_ASSETS : owns
  AUDIO_ASSETS ||--o{ ANALYSIS_JOBS : supplies
  LYRICS ||--o{ LYRIC_UNITS : contains
  LYRICS ||--o{ LYRIC_READING_CANDIDATES : considers

  WORKS {
    string id PK
    string title
    string artist
    string normalized_title UK
    string normalized_artist UK
  }

  SONG_INFO {
    string id PK "recording id"
    string work_id FK
    string recording_key UK
    string provider
    string provider_recording_id "YouTube video ID"
    string performer
    string version_type "studio live cover remix unknown"
    string audio_fingerprint
    string title
    string artist
    integer duration
    string source
    text raw_lrc
    string status
  }

  LYRICS {
    integer id PK
    string song_id FK
    integer line_no
    float time
    float end_time
    text original
    text reading "written reading"
    text sung_reading "acoustically selected reading"
    float confidence
    string source
    boolean user_edit
  }

  LYRIC_UNITS {
    integer id PK
    integer lyric_id FK
    integer unit_no
    string unit_type "word mora phoneme"
    text surface
    text reading
    string phoneme
    float start_time
    float end_time
    float confidence
    boolean user_edit
  }

  LYRIC_READING_CANDIDATES {
    integer id PK
    integer lyric_id FK
    text surface
    integer surface_start
    integer surface_end
    text reading
    text spoken_reading
    string source
    float score
    float acoustic_score
    boolean selected
  }

  AUDIO_ASSETS {
    string id PK
    string song_id FK
    string original_filename
    text stored_path UK
    integer byte_size
    string sha256 UK
    string media_type
  }

  ANALYSIS_JOBS {
    string id PK
    string song_id FK
    string status
    string current_stage
    text audio_path
    string audio_asset_id FK
    string pipeline_version
    string aligner
    float progress
    integer attempt_count
    string worker_id
    datetime heartbeat_at
    datetime lease_expires_at
    datetime started_at
    datetime completed_at
    text result_summary
    text error_message
  }
```

`recording_key` is provider identity when possible, for example `youtube_music:<videoId>`. Metadata-only
requests fall back to a normalized title/artist hash for backward compatibility. The old unique constraint
on `normalized_title + normalized_artist` is removed during SQLite migration so multiple recordings can
coexist.

`lyrics` stores presentation lines. `lyric_units` stores the word/mora/phoneme timeline used for karaoke
highlighting and re-segmentation. Display text, dictionary reading, and the acoustically selected sung
reading are deliberately independent.

`audio_assets` contains only audio explicitly supplied by the user and de-duplicates each recording by
SHA-256. `analysis_jobs` is a persistent queue. A worker claims each row with a lease, renews its heartbeat
during long model calls, and safely re-queues an expired lease up to the configured attempt limit.

# Karaoke analysis pipeline

## `karaoke-v2` runtime

The analysis path is a separate process so source separation and alignment cannot block the FastAPI event
loop. Its persisted stages are:

1. `ingest`
2. `separate_vocals`
3. `normalize_lyrics`
4. `generate_reading_candidates`
5. `forced_align`
6. `segment_lines`
7. `quality_review`
8. `completed`

Run the API and worker in separate terminals:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-backend.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run-analysis-worker.ps1
```

The worker atomically claims a queued DB row, renews a lease during long-running model commands, and
re-queues stale jobs after a crash. After the maximum attempt count it records `analysis_failed`. Results
below `ANALYSIS_LOW_CONFIDENCE_THRESHOLD` are stored but remain `review_required`; user-edited lines are
never overwritten.

## Audio input

Only audio that the user is authorized to process should be uploaded. LyriKana does not download YouTube
audio. The raw-body endpoint streams into managed local storage and de-duplicates by SHA-256:

```text
PUT /api/v1/songs/{recording_id}/audio?filename=authorized.wav
Content-Type: audio/wav

<binary audio body>
```

Use the returned asset ID when queuing a job:

```json
{
  "audioAssetId": "asset-id",
  "aligner": "auto"
}
```

```text
POST /api/v1/songs/{recording_id}/analysis
GET  /api/v1/songs/{recording_id}/analysis/{job_id}
POST /api/v1/songs/{recording_id}/analysis/{job_id}/retry
```

`audioPath` remains available for local development, but `audioAssetId` is the normal API path.

## Vocal separation

`ANALYSIS_SEPARATOR=auto` selects the first installed adapter:

1. `audio-separator` (maintained UVR model runner)
2. Demucs, when importable in the backend environment
3. `passthrough`, which keeps the mix and forces low-confidence review

Models are cached under `ANALYSIS_MODEL_DIR`. The default
`UVR-MDX-NET-Inst_HQ_3.onnx` uses ONNX Runtime so the Windows GPU path does not depend on a CUDA-enabled
Torch model, but `audio-separator` still uses Torch CUDA detection to enable its ONNX CUDA provider. The
GPU setup therefore installs the matching official PyTorch `cu130` wheel and fails early if CUDA cannot be
initialized.

On Windows, `setup-analysis.ps1` also installs a project-local FFmpeg binary under
`ANALYSIS_FFMPEG_DIR`. The worker injects that directory only into analysis subprocesses, leaving the
system-wide `PATH` unchanged.

Install `audio-separator` in its isolated environment so its Torch/ONNX dependencies cannot destabilize
the API environment:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-analysis.ps1 -Runtime gpu
```

Validate the complete isolated path with a generated WAV and temporary database:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-analysis-runtime.ps1
```

The check runs the real separator model but never touches the user's LyriKana database or audio library.

The current RTX 4050 6 GB machine should start with the default batch sizes. If a selected model exceeds
VRAM, select a low-resource model/preset or use the CPU runtime.

## Alignment adapters

`ANALYSIS_ALIGNER=auto` chooses adapters in this order:

1. a configured external singing aligner command;
2. the project-local Japanese phoneme CTC aligner;
3. MFA, when installed;
4. the deterministic timed-lyrics fallback.

The Japanese baseline uses `prj-beatrice/japanese-hubert-base-phoneme-ctc-v4`, a 94.4 M parameter
Apache-2.0 HuBERT model trained to recognize OpenJTalk-style Japanese phonemes. The runner evaluates up
to `ANALYSIS_CTC_MAX_PATHS` candidate pronunciations against one set of acoustic emissions. Consequently,
forms such as `1991` can select the sung English-style candidate instead of being locked to the highest
text-only prior. Audio is processed in bounded chunks for 6 GB GPUs, and all model loads use the local
cache only. Network access is limited to the explicit setup command.

This model was trained on speech, so it is a strong acoustic baseline rather than the final
singing-specific model. SOFA is designed for singing but its readily available default checkpoints and
dictionary are Chinese-oriented; it should only replace this baseline after a Japanese checkpoint is
trained and wins the same benchmark. MFA is likewise retained as a speech baseline.

Run the licensed Japanese singing benchmark:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-japanese-aligner.ps1
```

The command downloads only the official `pjs056_song.wav` sample from the CC BY-SA 4.0 PJS corpus and
the corresponding human-corrected HTK labels. On the initial RTX 4050 run, 69 of 71 reference phonemes
matched (97.18% coverage), boundary MAE was 42.822 ms, 80.43% of boundaries were within 50 ms, and 89.13%
were within 100 ms. These numbers verify the baseline and are not a claim about the full PJS corpus or
commercial J-pop recordings.

The external command adapter isolates future singing models behind a JSON contract. Configure either a
quoted command string or a JSON string array containing all three placeholders:

```dotenv
ANALYSIS_ALIGNER_COMMAND=["python","singing_aligner.py","--audio","{audio}","--request","{request}","--output","{output}"]
```

The request contains every Sudachi reading candidate plus numeric alternatives such as Japanese digits,
English digits, and an English year reading for `1991`. The aligner returns:

```json
{
  "units": [
    {
      "lineNo": 0,
      "surface": "1991",
      "reading": "ないんてぃーんないんてぃーわん",
      "phoneme": "...",
      "startTime": 12.4,
      "endTime": 14.1,
      "confidence": 0.91,
      "acousticScore": -3.2,
      "unitType": "token",
      "source": "singing-model"
    }
  ]
}
```

Decorative punctuation is removed only from analysis text. Original text and offset mappings remain
intact, so forms such as `⌈私は⌋` still identify `は` as a particle and store its sung reading as `わ`.

## Recording identity

`POST /api/v1/songs/resolve` accepts a provider recording ID such as a YouTube video ID. The same video ID
continues to resolve to the same recording after title changes, while live and cover video IDs keep their
own timing data and can share one canonical work.

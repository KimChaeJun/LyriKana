# LyriKana 🎵

[English README](README.md)

LyriKana는 YouTube Music 오버레이이자 로컬 J-pop 노래방 가사 제작 시스템입니다. 싱크 가사를 항상 위에 표시하면서, 사용자가 직접 제공한 음원과 원문 가사로 녹음본별 노래방 타임라인을 만들 수 있습니다. 일본어 원문, 표시용 읽기, 실제 가창 발음, 한글 발음, 로마자를 분리 저장하므로 라이브·커버 버전, 특수 표기와 다른 발음도 원문을 훼손하지 않고 교정할 수 있습니다.

## 구현된 기능

- YouTube Music 제목, 아티스트, 비디오 ID, 곡 길이, 곡별 재생 위치 감지
- FastAPI 백엔드와 현재 공급자 fallback인 LRCLIB를 통한 싱크 LRC 조회
- 하나의 작품과 스튜디오·라이브·커버·리믹스 녹음본을 분리하는 로컬 노래방 DB
- 제목 파싱에만 의존하지 않고 YouTube 비디오 ID 같은 공급자 녹음 ID를 사용하는 안정적 식별
- SQLite 기반 가사, 음원 asset, 분석 작업, 토큰 타임라인, 읽기 후보 영속 저장
- 싱크 여부, 제목, 아티스트, 앨범, 재생시간을 이용한 LRCLIB 후보 선택
- LRCLIB 후보 메타데이터가 YouTube Music의 기준 제목·가수 식별자를 덮어쓰지 않도록 보호
- 과거 공급자 메타데이터로 가수 정보가 오염된 캐시 레코드 자동 복구
- kuromoji, 가사 전용 읽기 규칙, 선택적 Sudachi 분석, 제한된 원격 후리가나 fallback을 이용한 일본어 읽기 분석
- 표시용/발음용 읽기 분리: 조사 `は`는 화면에서 `は`를 유지하면서 발음 출력에는 문맥에 따라 `와/wa` 적용
- `⌈私は⌋`, 따옴표, 괄호 같은 장식 특수문자는 분석용 텍스트에서만 제거하고 원문 offset은 보존
- 숫자와 중의적 표기에 일본어 숫자 읽기, 영어 숫자 읽기, `1991` 같은 영어식 연도 읽기를 포함한 복수 후보 생성
- 프로젝트 내 일본어 음소 CTC 정렬기로 음향 기반 읽기 후보 선택
- `audio-separator` GPU 보컬 분리와 Demucs/원음 통과 fallback
- 원자적 작업 선점, heartbeat, lease, 장애 복구, 제한 재시도와 검수 상태를 갖춘 영속 분석 worker
- 한글 발음과 로마자 생성 및 라인 단위 재사용 캐시
- 현재 가사, 한글 발음, 일본어 읽기, 다음 가사와 선택적 전주/간주 표시
- YouTube Music의 곡별 progress를 사용해 누적되는 `<video>.currentTime`과 gapless MediaSource 전환 처리
- 최초 가사 요청도 재생을 강제로 멈추지 않는 비차단 처리
- 곡 변경 시 이전 요청 취소와 오래된 응답 차단
- 표시 항목, 테마, 폰트, 투명도, 위치, 타이밍을 조절하는 Manifest V3 Extension 팝업
- 이전 곡, 재생/정지, 다음 곡 제어가 가능한 프레임 없는 always-on-top Electron 오버레이
- FastAPI와 Electron을 실행하는 Windows Native Messaging 런처
- 마지막 YouTube Music 탭/PWA 종료 시 오버레이 숨김, 다시 열면 기존 창 복원

## 실행 아키텍처

```text
YouTube Music
  └─ Chrome Extension
       ├─ content script
       │    ├─ 곡 메타데이터와 곡별 progress 감지
       │    ├─ 비차단 가사 로딩과 곡 전환 타임라인 조정
       │    └─ 발음 생성/캐시 및 오버레이 상태 전송
       ├─ service worker
       │    ├─ FastAPI/Electron 요청 중계
       │    └─ Windows Native Messaging 런처 호출
       ├─ FastAPI 백엔드 (127.0.0.1:8000)
       │    ├─ 녹음본 식별, LRCLIB fallback, 음원 ingest
       │    └─ SQLite 작품, 녹음본, 가사, unit, asset, 작업
       ├─ 분석 worker
       │    ├─ 보컬 분리와 일본어 forced alignment
       │    └─ 영속 lease, 재시도, confidence 검수
       └─ Electron 오버레이 (127.0.0.1:17654)
            ├─ always-on-top 표시와 재생 제어
            └─ Sudachi 브리지와 읽기 분석 캐시
```

곡 가사 공급의 단일 책임은 FastAPI에 있습니다. Extension은 LRCLIB를 직접 호출하지 않습니다. Electron은 곡 단위 가사를 소유하지 않고 현재 상태 표시, 재생 명령 전달, 재사용 가능한 읽기 분석 데이터 저장을 담당합니다.

노래방 가사 제작은 모델 추론이 FastAPI event loop를 막지 않도록 별도 worker 프로세스에서 실행됩니다.

```text
사용 권한이 있는 음원 + 원문 가사
  └─ FastAPI ingest
       ├─ 작품 / 녹음본 식별
       ├─ SHA-256 중복 제거 음원 asset
       └─ 영속 분석 작업
            └─ 분석 Worker
                 ├─ audio-separator → vocals
                 ├─ 가사 정규화와 읽기 후보 생성
                 ├─ 일본어 음소 CTC / 외부 aligner / MFA
                 ├─ 라인·토큰 타임라인
                 └─ confidence 검수 → 로컬 노래방 DB
```

## 가사와 재생 처리 흐름

1. content script가 현재 제목, 가수, 가능한 경우 비디오 ID, 곡 길이와 플레이어 바의 곡별 progress를 읽습니다.
2. Extension service worker가 `POST /api/v1/songs/resolve` 요청을 FastAPI에 중계합니다.
3. FastAPI는 완료된 로컬 캐시를 반환하거나 LRCLIB fallback 작업을 만들고 즉시 `202`를 반환합니다.
4. Extension은 제한된 backoff로 상태를 조회하지만, 최초 DB miss에서도 재생은 계속됩니다.
5. 원문이 준비되면 캐시된 읽기를 먼저 표시하고, 없는 라인은 현재 재생 위치 우선순위로 변환해 점진적으로 저장합니다.
6. 별도로 제작한 노래방 결과에는 녹음본 전용 라인·단어·모라·음소 경계와 음향적으로 선택된 실제 가창 읽기를 저장할 수 있습니다.

오버레이 경로는 `pending`, `fetching`, `processing`, `completed`, `partial`, `failed` 등을 사용합니다. 제작 경로에는 `awaiting_audio`, `awaiting_lyrics`, `analysis_queued`, `analysis_running`, `review_required`, `analysis_failed` 상태가 추가됩니다.

## 요구사항

- 자동 실행을 위한 Windows 10 또는 11
- Manifest V3를 지원하는 Chrome, Edge 또는 Chromium
- 포함된 Task와 F5 compound 사용을 위한 VSCode 권장
- Python 3.11 이상
- Node.js 20 이상과 `npm`
- PowerShell
- LRCLIB 네트워크 연결. 문맥 후리가나 fallback은 Extension manifest에 설정된 Worker에도 연결합니다.
- 선택적 노래방 분석 환경: NVIDIA CUDA GPU 권장. 현재 RTX 4050 Laptop GPU 6 GB에서 검증했습니다.

## 빠른 시작

1. 저장소를 clone하고 VSCode에서 프로젝트 루트를 엽니다.
2. `Tasks: Run Task` → `LyriKana: Install Dependencies`를 한 번 실행합니다.
3. `LyriKana: Build Extension`을 실행하거나 F5로 `LyriKana: Full Development`를 시작합니다.
4. Chrome에서 `chrome://extensions`를 열고 개발자 모드를 켠 다음, **압축해제된 확장 프로그램을 로드**에서 `Extension/dist`를 선택합니다.
5. YouTube Music을 열고 곡을 재생합니다.

설치 Task가 수행하는 작업:

- `backend/.venv` 생성과 Python 의존성 설치
- `Extension`, `ElectronOverlay`, `lyrikana-data-core`에서 `npm ci`
- 루트 `.env`가 없을 때 `.env.example` 복사
- 백엔드 DB 초기화
- Windows Native Messaging Host 빌드 및 등록

동일한 명령:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

분리된 GPU 분석 환경, FFmpeg, 보컬 분리 모델과 일본어 CTC 모델을 설치하려면 다음을 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-analysis.ps1 -Runtime gpu
```

분석 환경은 `backend/.venv-analysis`에 격리됩니다. 모델 cache, 업로드 음원, 생성 stem, benchmark 데이터와 로컬 FFmpeg 도구는 Git에서 제외됩니다.

저장소를 이동했거나 런처 또는 Extension manifest key를 변경했다면 `LyriKana: Register Native Host`를 다시 실행하고 unpacked Extension을 새로고침해야 합니다.

## 개발 환경 실행

Run and Debug에서 `LyriKana: Full Development`를 선택하고 F5를 누르면 네 개의 전용 integrated terminal이 실행됩니다.

1. Uvicorn reload가 적용된 FastAPI
2. 영속 노래방 분석 worker
3. Vite Extension build watcher
4. 제한된 백엔드 health check 후 Electron 오버레이

compound를 중지하면 네 개발 터미널이 모두 종료됩니다. `Tasks: Run Task` → `LyriKana: Start All`로도 같은 프로세스를 실행할 수 있습니다.

제공 Task:

- `LyriKana: Backend`
- `LyriKana: Analysis Worker`
- `LyriKana: Extension Watch`
- `LyriKana: Electron Overlay`
- `LyriKana: Start All`
- `LyriKana: Install Dependencies`
- `LyriKana: Install Analysis Runtime`
- `LyriKana: Check Analysis Runtime`
- `LyriKana: Benchmark Japanese Aligner`
- `LyriKana: Register Native Host`
- `LyriKana: Build Extension`
- `LyriKana: Run Tests`

일반 브라우저 사용 중 Native Host가 시작하는 백엔드는 자동 reload를 사용하지 않습니다. F5 환경 밖에서 백엔드 코드를 변경했다면 검증 전에 해당 백엔드 프로세스를 재시작해야 합니다.

## Extension 로드와 업데이트

production build 경로는 `Extension/dist`입니다.

1. `LyriKana: Build Extension`을 실행하거나 `Extension`에서 `npm.cmd run build`를 실행합니다.
2. `Extension/dist`를 unpacked Extension으로 로드합니다.
3. watcher가 다시 빌드한 뒤 Chrome이 자동 반영하지 않았다면 `chrome://extensions`에서 LyriKana 새로고침 버튼을 누릅니다.
4. YouTube Music 탭을 새로고침해 새 content script를 주입합니다.

개발용 Extension ID는 `ngdhgdbmndejbjcbglonhpgpflccnfdj`로 고정됩니다. 다른 폴더를 로드하거나 고정 key가 없는 manifest를 사용하면 ID가 바뀌어 등록된 Native Host origin과 맞지 않습니다.

## 오버레이 사용

Electron 창에는 곡 이름, 원문 가사, 일본어 읽기, 한글 발음과 선택적 다음 가사가 표시됩니다. 하단 버튼은 활성 YouTube Music 플레이어에 이전 곡, 재생/정지, 다음 곡 명령을 전달합니다.

- `Ctrl+Alt+L`: 클릭 통과 모드 전환
- `−`: 최소화
- `×`: 오버레이 창 닫기

Extension 팝업 설정은 `chrome.storage.sync`에 저장됩니다.

| 설정 | 기능 |
| --- | --- |
| Overlay | 가사 영역 활성화/숨김 |
| 일본어 발음 | 읽기 라인 표시 여부 |
| 한국어 가사 | 한글 발음 표시 여부 |
| 다음 가사 | 다음 원문 미리보기 표시 여부 |
| 전주/간주 | 명시적 또는 추정된 공백 구간 표시 |
| 테마 | 시스템, 다크, 라이트 |
| 글씨 크기 | 원문, 읽기, 한글 발음의 최소 크기 |
| 투명도 | Electron 카드 투명도 |
| 하단 위치 | 저장되는 레이아웃 위치 설정 |
| 미리보기 시간 | -1.5초에서 +1.5초까지 가사 전환 시점 보정 |

## 자동 실행과 생명주기

YouTube Music 탭 또는 설치형 PWA가 열리면 Extension이 두 로컬 서비스 상태를 확인합니다. Native Host는 누락된 백엔드를 먼저 시작해 `/health`를 확인한 다음 Electron을 시작합니다. health check, 런처 mutex, Electron single-instance lock으로 중복 서비스와 창을 방지합니다.

Extension은 같은 브라우저 프로필의 모든 YouTube Music 탭과 PWA 창을 추적합니다. 하나라도 남아 있으면 오버레이를 표시하고, 마지막 항목이 닫히면 숨기며, 다시 열면 실행 중인 Electron 창을 복원합니다. 창을 숨겨도 FastAPI와 Electron 프로세스는 종료되지 않습니다.

자동 실행은 현재 Windows만 지원합니다. 브라우저 Extension을 실행할 수 없는 별도 YouTube Music 클라이언트는 이 경로를 사용하지 못합니다.

## 환경변수

백엔드와 실행 스크립트는 루트 `.env`를 읽습니다. 기본값은 `.env.example`과 같습니다.

```env
APP_ENV=development
HOST=127.0.0.1
PORT=8000
DATABASE_URL=sqlite:///./lyrikana.db
LRCLIB_BASE_URL=https://lrclib.net
CORS_ORIGINS=http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173,https://music.youtube.com
LOG_LEVEL=INFO
LRCLIB_TIMEOUT_SECONDS=10
VITE_BACKEND_URL=http://127.0.0.1:8000
LYRIKANA_BACKEND_URL=http://127.0.0.1:8000

# 노래방 분석 주요 기본값
ANALYSIS_DATA_DIR=backend/.analysis-data
ANALYSIS_MODEL_DIR=backend/.analysis-data/models
ANALYSIS_SEPARATOR=auto
ANALYSIS_SEPARATOR_MODEL=UVR-MDX-NET-Inst_HQ_3.onnx
ANALYSIS_DEVICE=cuda
ANALYSIS_ALIGNER=auto
ANALYSIS_CTC_MODEL=prj-beatrice/japanese-hubert-base-phoneme-ctc-v4
ANALYSIS_CTC_MAX_PATHS=8
ANALYSIS_CTC_CHUNK_SECONDS=25
ANALYSIS_WORKER_LEASE_SECONDS=900
ANALYSIS_WORKER_MAX_ATTEMPTS=3
ANALYSIS_LOW_CONFIDENCE_THRESHOLD=0.55
```

`VITE_*` 값은 Extension 빌드에 포함되므로 비밀값을 넣으면 안 됩니다.
분리기, 외부 aligner, MFA, timeout, 업로드 크기와 worker의 전체 설정은 [`.env.example`](.env.example)을 참고하세요.

로컬 서비스:

| 서비스 | 기본 주소 | 역할 |
| --- | --- | --- |
| FastAPI | `http://127.0.0.1:8000` | 가사, 상태, 캐시, API 문서 |
| Electron | `http://127.0.0.1:17654` | 오버레이, 설정, 재생 명령, 읽기 캐시 |

FastAPI는 설정된 개발 origin, 고정 YouTube Music origin, Extension origin, loopback Private Network preflight를 허용합니다. 그 외 일반 웹 origin은 차단됩니다.

## DB와 캐시

기본 백엔드 DB는 `backend/lyrikana.db`입니다.

`works`
: 관련 녹음본이 공유하는 기준 제목·가수 작품 식별자를 저장합니다.

`song_info`
: 공급자 식별자, 실연자, 버전 유형, 길이, 원문 가사, 처리 상태, 진행률과 오류를 가진 하나의 실제 녹음본입니다.

`lyrics`
: 시작/종료 시각, 원문, 표기 읽기, 음향적으로 선택된 가창 읽기, 발음 출력, confidence, 출처와 편집 상태를 가진 표시 라인입니다.

`lyric_units`와 `lyric_reading_candidates`
: 단어·모라·음소 타이밍과 정렬 과정에서 검토한 텍스트/음향 읽기 후보를 저장합니다.

`audio_assets`와 `analysis_jobs`
: SHA-256으로 중복 제거한 사용자 제공 음원과 lease 기반 영속 worker queue를 저장합니다.

가능하면 `recording_key`는 `youtube_music:<videoId>` 같은 공급자 식별자를 사용합니다. 따라서 스튜디오 음원, 라이브 공연, 크리에이터 커버가 하나의 작품을 공유하면서도 서로 다른 가사 타이밍과 교정을 유지할 수 있습니다. 메타데이터만 있는 요청은 호환성을 위해 정규화된 제목·가수 fallback을 사용합니다. LRCLIB 후보 메타데이터는 YouTube Music의 기준 식별자를 덮어쓰지 않습니다.

시작 마이그레이션은 작품·녹음본 및 분석 테이블을 채우고, 기존 단수형 `lyric` JSON 행을 원본 테이블이나 DB 삭제 없이 `lyrics`로 복사합니다. 자세한 구조는 [DB ERD](docs/lyrikana-db-erd.md)를 참고하세요.

Electron은 읽기 결과, 분석 후보와 교정을 위한 별도 로컬 SQLite 캐시를 사용합니다. 가능한 경우 엔진 버전, 곡, 라인 범위를 캐시 키에 포함합니다.

## API

FastAPI 대화형 문서는 `http://127.0.0.1:8000/docs`에서 볼 수 있습니다.

```text
GET   /
GET   /health
POST  /api/v1/songs/resolve
GET   /api/v1/songs/{song_id}
GET   /api/v1/songs/{song_id}/lyrics
GET   /api/v1/songs/{song_id}/status
PATCH /api/v1/songs/{song_id}/lyrics
PUT   /api/v1/songs/{song_id}/source-lyrics
PUT   /api/v1/songs/{recording_id}/audio?filename=authorized.wav
GET   /api/v1/songs/{recording_id}/audio
POST  /api/v1/songs/{recording_id}/analysis
GET   /api/v1/songs/{recording_id}/analysis/{job_id}
POST  /api/v1/songs/{recording_id}/analysis/{job_id}/retry
```

곡 요청 예시:

```json
{
  "title": "GOOD DAY",
  "artist": "Mrs. GREEN APPLE",
  "duration": 258,
  "playbackTime": 2,
  "videoId": "youtube-video-id",
  "provider": "youtube_music",
  "versionType": "studio"
}
```

`POST /resolve`는 현재 처리 상태와 함께 `202`를 반환합니다. 이전 호출자를 위한 `/api/lyrics/*` 호환 경로도 유지합니다.

노래방 가사를 제작할 때는 처리 권한이 있는 음원만 업로드하고, 필요한 경우 원문 가사를 넣은 뒤 반환된 `audioAssetId`로 분석 작업을 생성합니다. LyriKana는 의도적으로 YouTube 음원을 다운로드하지 않습니다. 요청 예시와 외부 aligner JSON 계약은 [노래방 분석 파이프라인 문서](docs/karaoke-analysis-pipeline.md)를 참고하세요.

## 노래방 분석 환경

`ANALYSIS_SEPARATOR=auto`는 `audio-separator`, Demucs, 낮은 confidence를 강제하는 원음 통과 adapter 순서로 선택합니다. `ANALYSIS_ALIGNER=auto`는 설정된 외부 singing aligner, 프로젝트 내 일본어 CTC aligner, MFA, 결정적 timed-lyrics fallback 순서로 선택합니다.

일본어 baseline은 Apache-2.0 `prj-beatrice/japanese-hubert-base-phoneme-ctc-v4` 모델과 OpenJTalk 계열 음소를 사용합니다. 하나의 음향 emission에 여러 가사 읽기 후보를 대조하고, 검증된 6 GB GPU에서도 동작하도록 구간을 나누어 처리합니다. 일반 worker 실행에서는 로컬 cache만 사용하며 모델 다운로드는 명시적 설치 과정에서만 발생합니다.

설치된 분석 환경과 격리된 실제 분리기 경로를 검증합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-analysis-runtime.ps1
```

라이선스가 확인된 PJS 가창 sample benchmark를 실행합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-japanese-aligner.ps1
```

초기 RTX 4050 실행에서 `pjs056` sample은 기준 음소 71개 중 69개가 대응되어 coverage 97.18%, 경계 MAE 42.822 ms, 50 ms 이내 80.43%, 100 ms 이내 89.13%를 기록했습니다. 이는 하나의 sample에서 재현 가능한 baseline이며 전체 corpus나 상용 J-pop 품질을 보장하는 수치가 아닙니다.

## 디렉터리 구조

```text
backend/                 FastAPI, SQLite, 분석 worker/aligner, LRCLIB, 테스트
Extension/               Manifest V3, Vite, TypeScript, kuromoji 사전
ElectronOverlay/         Electron 오버레이, 읽기 DB, Sudachi 브리지
lyrikana-data-core/      교정 스키마와 JSONL 데이터셋 도구
native-host/             Windows Native Messaging 런처 소스/빌드 결과
docs/                    DB와 노래방 분석 문서
scripts/                 설치, runtime 검증, worker, 등록, 테스트 스크립트
.vscode/                 Task와 F5 compound 설정
```

## 테스트와 빌드

`LyriKana: Run Tests`를 실행하거나 다음 명령을 사용합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

검증 범위:

- 백엔드 API, DB 마이그레이션, 녹음본 식별, 분석 queue/lease, adapter/pipeline, 정렬 benchmark, 정규화, LRCLIB 후보 선택, LRC, 재시도, 캐시, 부분 완료 상태
- Extension 백엔드/Electron 중계, 곡 전환, 발음 테스트
- Extension production build
- `lyrikana-data-core` TypeScript build

Electron Sudachi 브리지의 Python 테스트는 `ElectronOverlay/tests`에 있지만 현재 `scripts/test.ps1`에는 포함되지 않습니다.
실제 분리기와 CTC 모델 검증은 선택적 분석 환경, 다운로드된 모델과 더 긴 실행 시간이 필요하므로 일반 단위 테스트와 분리되어 있습니다.

## 문제 해결

### Extension을 수정했는데 YouTube Music에서 예전 코드가 실행됨

`Extension/dist`를 다시 빌드하고 `chrome://extensions`에서 LyriKana를 새로고침한 뒤 YouTube Music 탭도 새로고침하세요. Vite watcher 빌드만으로는 Chrome이 content script를 다시 주입하지 않을 수 있습니다.

### 백엔드 변경 사항이 적용되지 않음

F5 백엔드는 `--reload`를 사용하지만 Native Host가 시작한 백엔드는 사용하지 않습니다. 8000번 포트를 사용 중인 백엔드를 종료한 뒤 YouTube Music을 다시 열거나, 개발 중에는 `LyriKana: Backend`를 실행하세요.

### `Backend unavailable` 또는 `Lyrics request error` 표시

`http://127.0.0.1:8000/health`를 확인하고 필요하면 백엔드를 재시작한 뒤 곡을 다시 선택하세요. 서버 오류는 캐시를 삭제하기 전에 백엔드 터미널 traceback을 확인하세요. 완료된 캐시는 재시작과 identity 복구 후에도 유지되도록 설계되어 있습니다.

### 싱크 가사가 없다고 표시됨

재생은 가사를 기다리지 않고 계속됩니다. plain LRCLIB 가사를 저장할 수는 있지만 시간 기반 표시는 timestamp가 있는 LRC 또는 제작된 노래방 분석 결과가 필요합니다. LRCLIB 결과가 **Synced**인지 확인하거나, 분석 API로 처리 권한이 있는 음원과 원문 가사를 제공하세요.

### 분석 worker가 작업을 가져가지 않음

FastAPI와 별도로 `LyriKana: Analysis Worker`를 실행하고 작업이 `awaiting_audio` 또는 `awaiting_lyrics` 상태인지 확인하세요. `LyriKana: Check Analysis Runtime`으로 FFmpeg, CUDA, ONNX Runtime, 분리 모델과 격리된 Python 환경을 검증할 수 있습니다.

### 오버레이가 자동으로 실행되지 않음

`LyriKana: Register Native Host`를 실행하고 unpacked Extension을 새로고침한 뒤 ID가 `ngdhgdbmndejbjcbglonhpgpflccnfdj`인지 확인하세요. Native Host manifest에는 실행 파일의 절대경로가 들어가므로 저장소를 옮겼다면 다시 등록해야 합니다.

### 오버레이에서 마우스 입력이 되지 않음

`Ctrl+Alt+L`을 눌러 클릭 통과 모드를 끄세요.

## 알려진 제약

- YouTube Music DOM이 변경되면 selector 수정이 필요할 수 있습니다.
- timestamp가 없는 plain 가사는 제작 파이프라인을 거쳐야 정확한 시간 기반 표시가 가능합니다.
- 현재 일본어 CTC checkpoint는 가창이 아닌 음성으로 학습되었습니다. 긴 음, melisma, 보컬 효과와 특이한 라이브 프레이징은 수동 교정 또는 향후 가창 전용 모델이 필요할 수 있습니다.
- 현재 공개한 PJS 결과는 라이선스가 확인된 sample 하나만 대상으로 하며, 전체 corpus와 실제 J-pop 평가는 아직 완료되지 않았습니다.
- 낮은 confidence 결과는 `review_required`로 저장되며 모델 결과가 사용자 편집 라인을 자동으로 덮어쓰지 않습니다.
- 분석 API와 worker는 구현됐지만 Extension의 음원 업로드·검수 UI 및 현재 곡 자동 queue 연결은 아직 없습니다.
- LyriKana는 YouTube 음원을 다운로드하지 않으며 사용자가 처리 권한이 있는 음원을 직접 제공해야 합니다.
- LRCLIB fallback은 기존 in-process 작업 registry를 사용하고, 모델 분석 작업은 lease 기반 영속 queue를 사용합니다.
- 자동 실행과 생명주기 연동은 Windows Native Messaging이 필요합니다.
- Chrome local-network 정책 변화에 따라 새 권한 승인이나 Extension 재로드가 필요할 수 있습니다.

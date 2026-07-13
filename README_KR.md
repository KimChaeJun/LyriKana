# LyriKana 🎵

[English README](README.md)

LyriKana는 YouTube Music에서 재생 중인 곡을 감지하고, 싱크 가사와 일본어 읽기·한글 발음·로마자 발음을 화면 및 데스크톱 오버레이에 표시하는 노래 연습 도구입니다.

## 현재 구현 기능

- YouTube Music 곡 제목·아티스트·재생 시간 감지
- FastAPI 우선 가사 조회와 SQLite 영속 캐시
- LRCLIB 후보 검색 및 제목·아티스트·앨범·길이 기반 선택
- LRC 라인 파싱과 재생 위치 기반 현재/다음 가사 표시
- kuromoji, 기존 예외 규칙, Sudachi 보조 분석을 이용한 일본어 읽기 변환
- 한글 발음과 로마자 발음 동시 표시
- Chrome Extension Overlay 및 Electron always-on-top 오버레이
- 곡 변경 시 이전 요청 취소, 요청 키 검증, 제한된 지수형 polling
- 라인 단위 변환 결과와 부분 실패 상태 저장
- VSCode F5 또는 단일 Task로 전체 개발환경 실행

## 아키텍처

```text
YouTube Music
  └─ Chrome Extension: 곡/재생 위치 감지, 발음 변환, 화면 표시
       ├─ FastAPI : 곡 정규화, DB 캐시, LRCLIB 조회, 상태/라인 저장
       │    └─ SQLite : song_info 1 ─ N lyrics
       └─ Electron Overlay : always-on-top 표시, 재생 제어, Sudachi/읽기 캐시
```

곡 가사 조회의 단일 책임은 FastAPI에 있습니다. Extension은 LRCLIB를 직접 호출하지 않습니다. Electron은 가사 공급자가 아니며 표시, 재생 명령 중계, 재사용 가능한 라인 읽기 분석 캐시만 담당합니다.

## 디렉터리 구조

```text
backend/                 FastAPI, SQLAlchemy, SQLite, LRCLIB 연동, 테스트
Extension/               Manifest V3 Chrome Extension, Vite, TypeScript
ElectronOverlay/         Electron always-on-top 오버레이와 Sudachi 브리지
lyrikana-data-core/      읽기 교정 데이터/JSONL 도구
docs/                    DB 문서
scripts/                 설치·백엔드·Electron·테스트 실행 스크립트
.vscode/                 F5 compound와 통합 Task
```

## 가장 빠른 시작 방법

요구사항은 Windows, VSCode, Python 3.11 이상, Node.js 20 이상입니다.

1. 저장소를 clone하고 VSCode에서 프로젝트 루트를 엽니다.
2. `Tasks: Run Task`에서 `LyriKana: Install Dependencies`를 한 번 실행합니다.
3. Run and Debug에서 `LyriKana: Full Development`를 선택하고 F5를 누릅니다.

F5는 다음 프로세스를 별도 integrated terminal에서 함께 실행합니다.

1. `python -m uvicorn app.main:app --reload` FastAPI
2. `vite build --watch` Extension 빌드
3. 백엔드 `/health` 준비를 확인한 뒤 Electron Overlay

Electron은 백엔드 준비가 늦어져도 종료되지 않고 재연결 가능한 안내 상태로 실행됩니다. 디버깅을 중지하면 compound의 `stopAll`이 세 프로세스를 함께 종료합니다.

동일한 실행은 `Tasks: Run Task` → `LyriKana: Start All`로도 시작할 수 있습니다.

## VSCode Task

- `LyriKana: Backend`
- `LyriKana: Extension Watch`
- `LyriKana: Electron Overlay`
- `LyriKana: Start All`
- `LyriKana: Install Dependencies`
- `LyriKana: Build Extension`
- `LyriKana: Run Tests`

## Chrome Extension 등록

1. F5 또는 `LyriKana: Build Extension`을 실행합니다.
2. Chrome에서 `chrome://extensions`를 엽니다.
3. 개발자 모드를 켜고 `압축해제된 확장 프로그램을 로드`를 선택합니다.
4. `Extension/dist`를 지정합니다.
5. watch 빌드 후 변경 사항을 적용하려면 확장 프로그램을 새로고침합니다.

Manifest에는 YouTube Music, FastAPI `127.0.0.1:8000`, Electron `127.0.0.1:17654`, 기존 후리가나 Worker 권한만 포함됩니다. LRCLIB host 권한은 백엔드로 이동했기 때문에 필요하지 않습니다.

## 환경변수

설치 Task는 루트 `.env`가 없으면 `.env.example`을 복사합니다. `.env`는 Git에 포함되지 않습니다.

```env
APP_ENV=development
HOST=127.0.0.1
PORT=8000
DATABASE_URL=sqlite:///./lyrikana.db
LRCLIB_BASE_URL=https://lrclib.net
CORS_ORIGINS=http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173
LOG_LEVEL=INFO
LRCLIB_TIMEOUT_SECONDS=10
VITE_BACKEND_URL=http://127.0.0.1:8000
LYRIKANA_BACKEND_URL=http://127.0.0.1:8000
```

Chrome Extension origin은 FastAPI의 안전한 정규식 CORS 규칙으로 허용됩니다. 민감한 API 키는 Extension에 포함하지 마세요.

## DB 구조와 처리 흐름

개발 DB는 기본적으로 `backend/lyrikana.db`입니다. 기존 `lyric` JSON 테이블이 있는 DB는 시작 시 새 라인 테이블로 안전하게 복사됩니다. 원본 테이블이나 DB 파일을 삭제하지 않습니다.

`song_info`
: 정규화된 제목/아티스트 unique identity, 메타데이터, 원본 LRC, 처리 상태, 진행률을 저장합니다.

`lyrics`
: `song_id` FK, `line_no`, `time`, `original`, `reading`, `kr`, `jp`, nullable `en`, 사용자 편집 여부와 사유 태그를 라인별로 저장합니다.

처리 상태는 `pending → fetching → processing → completed`이며 일부 라인 실패 시 `partial`, 공급자/검색 실패 시 `failed`가 됩니다. 동일 곡 요청은 정규화 identity와 결정적 ID, DB unique constraint, 프로세스 내 작업 registry로 합쳐집니다. 재시작 후에도 DB 캐시와 완료된 변환은 유지됩니다.

## API

```text
GET   /health
POST  /api/v1/songs/resolve
GET   /api/v1/songs/{song_id}
GET   /api/v1/songs/{song_id}/lyrics
GET   /api/v1/songs/{song_id}/status
PATCH /api/v1/songs/{song_id}/lyrics
```

`POST /resolve`은 외부 API와 전체 변환이 끝날 때까지 연결을 점유하지 않고 `202`와 현재 상태를 즉시 반환합니다. Extension은 `pending/fetching` 동안에만 최대 1.5초 간격의 bounded backoff로 조회하며, 원문 라인이 준비되면 바로 표시와 발음 변환을 시작합니다.

이전 `/api/lyrics/*` 경로는 기존 호출자 호환을 위해 유지됩니다.

## 테스트와 빌드

VSCode에서 `LyriKana: Run Tests`를 실행하거나 다음 명령을 사용합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

이 Task는 다음을 검증합니다.

- FastAPI/SQLite API, 정규화, 중복 작업 방지, LRC, 캐시, 부분 실패
- Extension 백엔드 계약과 오류 구분
- Extension production build
- data-core TypeScript build

## 알려진 제약

- YouTube Music DOM 변경 시 곡 감지 selector를 조정해야 할 수 있습니다.
- LRCLIB에 싱크 가사가 없으면 원문을 저장할 수 있어도 시간 기반 표시는 제한됩니다.
- 발음 변환은 기존 예외 규칙을 보존하지만 고유명사와 특수 가사는 추가 교정이 필요할 수 있습니다.
- 작업 registry는 개발용 단일 프로세스 구조입니다. 다중 서버 프로세스가 필요해질 때만 별도 queue 도입을 검토합니다.
- Chrome의 local network 정책에 따라 새 권한 승인 또는 Extension 재로드가 필요할 수 있습니다.

## 다음 개발 계획

- Electron 읽기 캐시를 백엔드 라인 후보/교정 모델로 완전히 통합
- 사용자 교정 UI와 교정 이력 API
- 더 많은 언어의 읽기/번역 모듈
- 대규모 배포가 필요해질 때 영속 작업 queue 및 PostgreSQL 검토

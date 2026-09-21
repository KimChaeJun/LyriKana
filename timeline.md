# LyriKana 프로젝트 작업 기록

YouTube Music의 일본어 가사를 재생 위치에 맞춰 표시하고, 읽기·발음 변환과 로컬 노래방 타임라인 제작을 연결한 개인 프로젝트다. 김채준이 전 과정을 직접 구현했다는 사용자 확인과 실제 저장소 코드를 함께 근거로 기록한다.

## 기록 범위

| 항목 | 값 |
| --- | --- |
| 프로젝트명 | LyriKana |
| 원본 저장소 / 소유자 | `KimChaeJun/LyriKana` / `KimChaeJun` |
| 본인 소유 여부 / 확인 근거 | 사용자 확인: 개인 프로젝트이며 처음부터 끝까지 직접 구현함. Git 작성자만으로 기여를 추정하지 않음. E01 |
| 저장소 공개 범위 | GitHub 메타데이터상 public. 다만 사용자가 허용한 포트폴리오 공개 범위는 **구현 방식까지**이며, 코드·원본 데이터·음원·로컬 환경 공개로 확대하지 않음. E01, E02 |
| 기본 브랜치 / 현재 브랜치 | `main` / `main`. 기본 브랜치는 GitHub 조회로 확인. E02 |
| 확인한 커밋 | `02594bdfcfa7fecca85041fedb5fa5f043db2004` 및 조사 시점의 미커밋 작업 트리 |
| 조사 기준일 | 2026-09-21, Asia/Seoul |
| 기본 브랜치 루트 문서 반영 범위 | `main` 루트의 `timeline.md`. 초안 작성 후 사용자 요청으로 이 문서만 커밋·푸시 대상으로 지정했으며, 원격 반영 여부는 해당 문서의 Git 이력으로 확인한다. |
| 프로젝트 상태 / 실제 개발 기간 | 주요 기능 구현과 후속 변경이 존재함. 실제 착수·종료일 및 현재 진행/완료 상태는 확인 필요. 확인 가능한 커밋 구간은 2026-03-11~2026-07-21이며 개발 기간과 동일시하지 않음. |
| 본인 참여 기간 | 전 과정 참여는 사용자 확인. 정확한 시작일·종료일은 미확인. |
| 개인·팀 / 역할 분담 | 개인 프로젝트. 확장 프로그램, Electron, 백엔드, 발음 처리, 분석 파이프라인, 실행 도구를 본인이 담당. 별도 팀원 분담 없음. |
| 조사 범위 | README, 실행 진입점, 코드·스키마, 설정, 테스트, Git 변경 이력, 기존 벤치마크 결과, 사용자 진술, 로컬 포트폴리오 타입 정의 |

커밋된 구현과 미커밋 변경을 구분한다. 기존 작업 트리에 있던 팝업·표시 언어·설정 변경과 PostgreSQL/Docker 구성은 이번 문서 작성의 구현 성과가 아니며, 실제 작성일을 알 수 없는 변경으로 따로 기록한다.

## 포트폴리오 공개용 데이터

아래 JSON은 구현 방식과 개인 담당 업무를 공개하는 전달 형식이다. 소스 코드, 내부 경로, 원본 가사·음원, 개인 환경 정보와 근거 ID는 넣지 않았다. 실제 참여 기간과 수상은 확인되지 않아 빈 값이며, 수치 카드는 공개 범위에 맞춰 비웠다. 이 문서만으로 사이트에 자동 등록되지는 않는다.

```json
{
  "slug": "lyrikana",
  "title": "LyriKana",
  "subtitle": "일본어 노래를 따라 부르는 사용자를 위한 YouTube Music 가사·발음 오버레이와 로컬 노래방 제작 도구",
  "category": "음악 · 가사 동기화 · 데스크톱 도구",
  "role": "Full Stack Developer",
  "roleTags": [],
  "year": "2026",
  "period": "",
  "award": "",
  "summaryLines": [
    "개인 프로젝트로 브라우저 확장 프로그램, 데스크톱 오버레이, 가사 API와 데이터 처리를 직접 구현했습니다.",
    "가사 준비와 재생을 분리하고, 곡 전환 시 오래된 응답을 차단하는 동기화 흐름을 구성했습니다.",
    "일본어 원문·표시용 읽기·실제 발음을 분리하고, 사용자가 제공한 음원으로 녹음본별 가창 타임라인을 만드는 구조로 확장했습니다."
  ],
  "overviewLines": [
    "YouTube Music의 곡 정보와 재생 위치를 읽어 현재 가사, 일본어 읽기, 한글 발음과 로마자를 표시하는 도구입니다.",
    "브라우저 확장 프로그램은 재생 상태를 수집하고, 백엔드는 가사 조회와 저장을, Electron은 항상 위에 표시되는 창과 재생 제어를 담당합니다.",
    "형태소 분석과 가사 전용 읽기 규칙을 결합하고, 표시할 읽기와 발음할 읽기를 분리해 원문을 보존합니다.",
    "사용자가 제공한 음원과 원문 가사는 별도 분석 워커에서 보컬 분리와 일본어 음소 정렬을 거쳐 녹음본별 타임라인으로 저장됩니다.",
    "음원 업로드와 결과 검수는 API 중심으로 구현되어 있으며, 확장 프로그램의 업로드·검수 화면은 후속 과제로 남아 있습니다."
  ],
  "tags": ["TypeScript", "Electron", "Python", "FastAPI", "SQLite", "SudachiPy", "PyTorch"],
  "roles": [
    {
      "title": "브라우저 확장 프로그램과 재생 동기화",
      "description": "곡 정보와 곡별 재생 위치를 감지하고, 가사 로딩·취소·점진적 발음 변환과 곡 전환 보호 로직을 구현했습니다."
    },
    {
      "title": "데스크톱 오버레이와 로컬 실행 연동",
      "description": "항상 위에 표시되는 가사 창, 클릭 통과, 재생 제어와 읽기 캐시를 구현하고 Windows Native Messaging으로 로컬 서비스 실행을 연결했습니다."
    },
    {
      "title": "가사 API와 녹음본 중심 데이터 모델",
      "description": "가사 공급자 조회·후보 선택·캐시를 백엔드로 모으고, 작품과 라이브·커버 등 개별 녹음본을 분리해 타이밍과 교정을 저장하도록 설계했습니다."
    },
    {
      "title": "일본어 읽기와 가창 분석",
      "description": "형태소 분석, 읽기 규칙, 발음 변환을 연결하고, 복수 읽기 후보를 음향 점수로 비교하는 일본어 음소 CTC 정렬 경로를 구현했습니다."
    },
    {
      "title": "분석 작업 복구와 교정 데이터 도구",
      "description": "분석 작업의 선점·생존 신호·재시도·검수 상태를 영속화하고, 교정 이력을 검증·중복 제거·분할해 JSONL로 내보내는 도구를 구현했습니다."
    },
    {
      "title": "개발 환경과 회귀 검증",
      "description": "설치·실행·테스트 스크립트를 정리하고, API·DB·곡 전환·발음 규칙을 검증하는 테스트와 음소 경계 평가 도구를 작성했습니다."
    }
  ],
  "technologyStack": [
    {
      "category": "Browser Extension",
      "description": "Manifest V3 확장 프로그램의 재생 상태 수집, 메시지 중계와 설정 화면 구현",
      "technologies": ["TypeScript", "Chrome Extensions Manifest V3", "HTML", "CSS", "Vite"]
    },
    {
      "category": "Desktop & Native Integration",
      "description": "데스크톱 가사 표시, 로컬 캐시와 Windows 자동 실행 연동",
      "technologies": ["Electron", "JavaScript", "Node.js", "C#", "Windows Native Messaging"]
    },
    {
      "category": "Backend & Storage",
      "description": "가사 조회 API, 작품·녹음본·분석 작업 저장과 외부 가사 공급자 요청",
      "technologies": ["Python", "FastAPI", "Pydantic", "SQLAlchemy", "SQLite", "HTTPX", "Uvicorn"]
    },
    {
      "category": "Japanese Reading",
      "description": "형태소 분석과 규칙 기반 보정으로 표시용 읽기와 발음용 읽기 생성",
      "technologies": ["kuromoji", "SudachiPy"]
    },
    {
      "category": "Optional Audio Analysis",
      "description": "별도 분석 환경에서 보컬을 분리하고 사전 학습 모델로 일본어 음소 타이밍 정렬",
      "technologies": ["audio-separator", "FFmpeg", "PyTorch", "Hugging Face Transformers", "NumPy"]
    },
    {
      "category": "Data & Development Tools",
      "description": "교정 이력의 JSONL 변환, 개발 프로세스 실행과 회귀 테스트",
      "technologies": ["TypeScript", "Node.js", "PowerShell", "pytest", "Vitest", "Git"]
    }
  ],
  "metrics": [],
  "pipeline": [
    {
      "label": "곡 식별",
      "description": "확장 프로그램이 곡 정보, 공급자 녹음 ID와 곡별 재생 위치를 수집합니다."
    },
    {
      "label": "가사 준비",
      "description": "백엔드가 녹음본과 저장된 가사를 확인하고, 필요한 경우 공급자를 조회하는 동안 재생을 유지합니다."
    },
    {
      "label": "읽기와 표시",
      "description": "캐시를 먼저 적용하고 부족한 줄의 읽기·발음을 점진적으로 생성해 오버레이에 전달합니다."
    },
    {
      "label": "선택적 노래방 제작",
      "description": "사용자가 별도로 제공한 음원과 가사를 분석 워커가 처리해 가창 읽기와 시간 경계를 저장합니다."
    },
    {
      "label": "검수와 재사용",
      "description": "신뢰도가 낮은 분석은 검수 상태로 남기고, 사용자 교정을 보존하며 녹음본별 결과를 재사용합니다."
    }
  ],
  "improvements": [
    {
      "before": "가사 처리가 끝나지 않은 상태를 재생 대기 조건으로 사용했습니다.",
      "after": "첫 가사 요청과 캐시 미적중에서도 재생을 유지하고 가사를 백그라운드에서 준비하도록 변경했습니다.",
      "evidence": "변경 전후 재생 대기 조건을 대조하고, 캐시 미적중·미완료·실패 상태에 대한 회귀 테스트를 확인했습니다."
    },
    {
      "before": "제목과 가수 중심의 식별만으로는 같은 작품의 라이브·커버 녹음본을 구분하기 어려웠습니다.",
      "after": "작품과 녹음본을 분리하고 공급자 녹음 ID를 우선 사용해 녹음본별 타이밍과 교정을 보존하도록 했습니다.",
      "evidence": "동일 작품의 다른 영상 분리와 같은 영상의 제목 변경에 대한 API 회귀 테스트를 확인했습니다."
    },
    {
      "before": "표시용 읽기만으로는 조사나 숫자처럼 표기와 실제 발음이 다른 경우를 표현하기 어려웠습니다.",
      "after": "표시용·발음용 읽기를 분리하고, 선택적 음향 분석에서 복수 후보를 비교하도록 구성했습니다.",
      "evidence": "조사 발음, 장식 문자 처리와 복수 읽기 후보 생성 테스트를 확인했습니다. 음향 분석의 가창 품질은 별도 평가 대상입니다."
    }
  ],
  "timeline": [
    {"date": "2026-03-13", "title": "초기 가사·발음 MVP", "description": "일본어 분석 사전과 발음 변환을 포함한 확장 프로그램 MVP 변경을 기록했습니다."},
    {"date": "2026-03-16", "title": "점진적 가사 처리", "description": "발음 변환을 점진적으로 진행하고 비동기 응답이 섞이는 문제를 방어하는 로직을 추가했습니다."},
    {"date": "2026-05-16", "title": "Electron·교정 데이터 확장", "description": "데스크톱 오버레이, 로컬 읽기 캐시, Sudachi 연동과 교정 데이터 변환 도구를 추가했습니다."},
    {"date": "2026-06-18", "title": "가사 백엔드 도입", "description": "FastAPI와 데이터베이스를 이용한 가사 조회·저장 경로를 추가했습니다."},
    {"date": "2026-07-13", "title": "API 중심 가사 처리 정리", "description": "백엔드 작업 처리, 상태 조회, DB 이전과 개발·테스트 실행 흐름을 정비했습니다."},
    {"date": "2026-07-15", "title": "재생 전환·자동 실행 안정화", "description": "곡 전환 보호, 서비스 워커 중계, Native Messaging 실행과 발음 회귀 테스트를 보강했습니다."},
    {"date": "2026-07-21", "title": "녹음본별 노래방 제작", "description": "음원 수집 API, 영속 분석 워커, 일본어 음소 CTC 정렬과 평가 도구를 추가했습니다."}
  ]
}
```

공개 연혁의 날짜는 해당 변경이 기록된 커밋 날짜다. 기능의 최초 개발일·배포일을 뜻하지 않는다. 미커밋 후속 변경은 위 연혁에 임의의 구현일을 부여하지 않았다.

## 문제와 설계 배경

- **대상 사용자와 문제:** 일본어 노래를 들으며 원문과 발음을 함께 확인하고 따라 부르려는 사용자. 일반적인 형태소 분석의 읽기와 실제 가창 발음이 다를 수 있고, 라이브·커버는 같은 곡이라도 시간축이 다르다. E03, E05, E08
- **접근 방식:** 브라우저는 곡·재생 상태, FastAPI는 가사 공급과 영속 저장, Electron은 표시와 재생 제어, 별도 워커는 무거운 음원 분석을 담당하도록 분리했다. E04, E06~E10
- **성공 판단 기준:** 가사 준비 때문에 재생이 멈추지 않을 것, 곡 전환 뒤 이전 응답이 새 곡을 덮지 않을 것, 서로 다른 녹음본의 타이밍과 사용자 교정이 보존될 것. 음성 정렬은 참조 음소 경계와 비교해 별도로 평가한다. 정량 목표치나 사용자 지표가 확정됐다는 근거는 없다.
- **데이터 흐름:** 곡 식별 → 캐시/공급자 가사 조회 → 원문 우선 표시와 점진적 읽기 생성 → 재생 위치에 따른 오버레이 표시. 별도 제작 경로에서는 사용자 제공 음원·가사 → 보컬 분리 → 정규화·읽기 후보 → 음소 정렬 → 라인·토큰 저장 → 신뢰도 검수를 수행한다.
- **데이터 구분:** 작품, 녹음본, 가사 줄, 정렬 단위, 읽기 후보, 음원 자산, 분석 작업을 분리한다. 원문, 표시용 읽기, 가창 읽기, 발음 출력, 사용자 편집 상태를 별도로 보존한다. E08
- **현재 한계:** YouTube Music DOM 변경 대응, 음성용 모델의 가창 표현 한계, 단일 샘플에 한정된 음향 평가, 확장 프로그램 업로드·검수 UI 부재가 남아 있다. 자동 실행은 Windows 중심이며, 가사 공급자 조회 작업은 여전히 프로세스 내부 작업 목록을 사용한다. 영속 큐는 모델 분석 작업에 적용된다. E03, E07, E09

## 본인 역할과 기여

대표 역할은 **Full Stack Developer**로 기록한다. 전 과정 직접 구현이라는 사용자 진술(E01)에 FE·BE·데스크톱·데이터·실행 도구의 실제 코드가 대응한다. AI PM 역할을 선택하거나 수행했다고 확인하지 않았으므로 `roleTags`는 빈 배열이다. 아래 담당은 사용자 진술에 근거하며, 구현 내용은 별도 코드 근거로 확인했다.

| 담당 영역 / 기능 | 본인이 수행한 일과 결정 | 팀원이 담당한 범위 | 결과 / 근거 ID |
| --- | --- | --- | --- |
| 확장 프로그램 | 콘텐츠 스크립트, 서비스 워커, 설정 UI와 곡별 재생 상태 감지·취소·응답 보호 구현 | 해당 없음 | 재생·가사 처리 분리, 점진적 변환. E01, E04, E13 |
| Electron·로컬 연동 | 항상 위 표시, 클릭 통과, 재생 명령, 읽기 캐시, 서비스 실행과 창 생명주기 연결 | 해당 없음 | 확장 프로그램과 별도 창의 상태 연동. E01, E06, E12 |
| API·데이터 모델 | 가사 조회 책임 집중, 공급자 후보 순위화, 작품/녹음본 식별, 기존 데이터 이전 | 해당 없음 | 가사 공급자 메타데이터와 정식 곡 식별 분리. E01, E07, E08 |
| 일본어 읽기 | kuromoji·Sudachi와 규칙·사전을 결합하고 표시/발음 읽기 및 변환 결과 분리 | 해당 없음 | 원문을 유지하며 발음 보정. E01, E05 |
| 음원 분석 | 교체 가능한 분석 단계, 음소 CTC 정렬, 후보 비교, 작업 복구와 사용자 편집 보호 구현 | 해당 없음 | 별도 프로세스의 분석 결과를 검수 가능한 데이터로 저장. E01, E09, E10 |
| 교정 데이터·개발 도구 | 교정 스키마, 검증·중복 제거·분할·JSONL 출력 및 설치·테스트 스크립트 구현 | 해당 없음 | 데이터 준비와 검증 경로 마련. 모델 학습 완료를 의미하지 않음. E01, E11, E12 |

## 기술별 사용 내역

공개 스택은 실제 실행 경로에 연결된 기술을 기준으로 한다. 코드에 사용되는 것과 이번 조사에서 실제 실행한 것은 구분한다. 아래의 본인 사용 확인은 E01의 전 과정 구현 진술에 근거한다.

| 그룹 | 기술 | 실제 사용 목적과 위치 | 본인 사용 여부 | 현재·과거·검토 상태 | 근거 ID |
| --- | --- | --- | --- | --- | --- |
| Extension | TypeScript, Manifest V3 | `Extension/src/content.ts`, `background.ts`, `pagePlaybackBridge.ts`, `public/manifest.json`: 상태 수집과 메시지 중계 | 확인 | 현재 구현 | E01, E04 |
| Extension | HTML, CSS, Vite | `Extension/popup/`, `overlay/`, `vite.config.ts`: 화면과 실제 빌드 진입점 | 확인 | 현재 구현. 이 조사에서 빌드 미실행 | E01, E04, E13 |
| Desktop | Electron, JavaScript, Node.js | `ElectronOverlay/src/main.js`, `renderer.js`, `preload.js`: 창·HTTP 브리지·렌더링 | 확인 | 현재 구현. GUI 직접 시연 미실행 | E01, E06 |
| Native | C#, Windows Native Messaging | `native-host/Launcher.cs`, `scripts/register-native-host.ps1`: 메시지 수신·헬스 확인·중복 실행 방지 | 확인 | 현재 구현, Windows 대상 | E01, E12 |
| Backend | Python, FastAPI, Uvicorn | `backend/app/main.py`, `routers/lyrics.py`, `scripts/run-backend.ps1`: API와 로컬 실행 | 확인 | 현재 구현 | E01, E07, E12 |
| Backend | Pydantic, HTTPX | `backend/app/schemas.py`, `services/lrclib.py`: 입력 스키마와 비동기 공급자 요청 | 확인 | 현재 구현 | E01, E07 |
| Storage | SQLAlchemy, SQLite | `backend/app/database.py`, `models.py`: 관계형 저장·이전. `ElectronOverlay/src/db.js`: Node SQLite 읽기 캐시 | 확인 | 현재 기본 로컬 저장 경로 | E01, E06, E08 |
| Reading | kuromoji | `Extension/src/utils/pronunciation/reading.ts`, `public/dict/`: 브라우저 형태소 분석 | 확인 | 현재 구현, 관련 통합 테스트 실행 | E01, E05, E16 |
| Reading | SudachiPy | `ElectronOverlay/src/sudachi_analyze.py`, `backend/app/services/analysis_adapters.py`: 문맥 읽기·후보 생성 | 확인 | 현재 구현, 선택적 Electron 분석 경로 | E01, E05, E09 |
| Audio | PyTorch, Transformers, NumPy | `backend/aligners/japanese_ctc_aligner.py`: 로컬 모델 로딩·구간별 추론·CTC 정렬 | 확인 | 현재 선택적 분석 경로. 기존 CUDA 결과 있음, 이번 GPU 재실행 없음 | E01, E10, E17 |
| Audio | audio-separator, FFmpeg | `backend/app/services/analysis_adapters.py`, `scripts/setup-analysis.ps1`: 보컬 분리 subprocess·별도 분석 환경 | 확인 | 현재 선택적 어댑터. 이번 모델 실행 없음 | E01, E09 |
| Audio | ONNX Runtime | 분석 환경 설치와 audio-separator 모델 실행 설정 | 확인: 구성 범위 | 선택적 런타임 구성. 독립적인 ONNX 모델 개발·튜닝 실적으로 확대하지 않음 | E01, E09 |
| Data | TypeScript, Node.js, JSONL 형식 | `lyrikana-data-core/src/`: 교정 검증, 중복 제거, 교정 ID 기반 안정적 분할, 학습용 파일 출력 | 확인 | 현재 도구. 학습 수행 근거 없음 | E01, E11 |
| Dev / QA | PowerShell, Git, pytest, Vitest | `scripts/`, Git 이력, `backend/tests/`, `Extension/src/**/*.test.ts` | 확인 | 현재 사용. 이번 백엔드·Extension 테스트 실행 | E01, E12, E15, E16 |
| 후속 저장 구성 | PostgreSQL, Psycopg, Docker Compose | `compose.yaml`, `backend/Dockerfile`, `backend/app/database.py`: DB·API 서비스와 dialect별 INSERT 구성 | 확인: 코드·구성 범위 | 미커밋 구현. 컨테이너 실행·실제 PostgreSQL 연동 미확인, 공개 스택에서는 제외 | E01, E14 |
| 외부 연동 | 원격 후리가나 API / Cloudflare Worker 호출 | `Extension/src/utils/pronunciation/reading.ts`: 제한된 원격 읽기 fallback | 확인: 클라이언트 연동 범위 | 호출 코드 존재. Worker 서버 소스·배포는 이번 저장소에서 검증하지 않음 | E01, E05 |
| 대체 경로 | Demucs, MFA, 외부 JSON aligner | `backend/app/services/analysis_adapters.py`: 설치·설정에 따른 대체 어댑터 | 어댑터 구현 확인, 각 엔진 실사용 미확인 | 지원 경로 구현. 공개 핵심 스택에서는 제외 | E01, E09 |
| 검토 / 비활성 | SOFA / React | SOFA는 분석 문서의 향후 검토 대상. `.tsx` 파일은 있으나 현재 Vite 진입점은 HTML·TypeScript이며 React 런타임 의존성 없음 | 직접 운영 사용 미확인 | SOFA는 검토, React는 현재 진입점 아님. 공개 스택에서 제외 | E04, E09 |

## 성과와 검증

공개용 `metrics`는 구현 방식만 공개한다는 요청에 따라 비웠다. 아래는 기록을 위한 검증 근거이며 포트폴리오 수치 카드로 자동 전재하지 않는다. 서로 다른 테스트 집합을 합산하지 않는다.

| 지표 / 값 / 단위 | 측정일 | 환경과 집계 대상 | 방법 / 결과 출처 | 제한 / 근거 ID |
| --- | --- | --- | --- | --- |
| 백엔드: 36 passed, 1 skipped, 1 warning | 2026-09-21 | Windows, 기존 `backend/.venv`, 현재 작업 트리의 백엔드 테스트 | `backend`에서 `.venv/Scripts/python.exe -m pytest -q`, 종료 코드 0 | CTC Viterbi 테스트 1개는 NumPy 선택 의존성 부재로 건너뜀. HTTPX 기반 TestClient 사용 중단 예정 경고 1건. 실제 GPU·PostgreSQL 통합 검증 아님. E16 |
| Extension: 57 passed, 10 test files passed | 2026-09-21 | Windows, 설치된 Vitest 4.1.10, 현재 `Extension/src` 테스트 | `Extension`에서 `npm.cmd test -- --reporter=dot`, 종료 코드 0 | 설정·언어 표시 미커밋 테스트 포함. 브라우저 E2E·Electron GUI·production build 결과 아님. E16 |
| 기존 음소 정렬: 69/71 참조 음소 일치, coverage 97.18% | 실제 측정일 미확인; 결과 확인일 2026-09-21 | PJS `pjs056` 단일 샘플. 기존 JSON은 CUDA 사용, README는 RTX 4050 Laptop GPU 6 GB 환경으로 설명 | 저장된 벤치마크 JSON과 README 수치를 대조 | 출력 음소는 74개. coverage는 일치 참조 음소/참조 음소이며 전반적인 발음 정확도가 아님. 이번 재실행 없음. E17 |
| 기존 경계 오차: MAE 42.822 ms, 50 ms 이내 80.43%, 100 ms 이내 89.13% | 실제 측정일 미확인; 결과 확인일 2026-09-21 | 위와 동일한 샘플에서 일치한 69개 음소의 시작·끝 경계, 총 138개 비교 | `backend/app/alignment_benchmark.py`의 평가식과 저장 결과 대조 | 전체 음소·전체 곡·상용 J-pop 성능으로 일반화하지 않음. 이전 버전과 비교한 개선율이 아님. E17 |
| 교정 출력 예제: 입력 1, 채택 1, 학습 1, 검증 0 | 실제 생성일 미확인; 관련 파일은 2026-05-16 커밋에 존재 | 저장소의 예제 교정 출력 리포트 | `lyrikana-data-core/data/lyrikana-jsonl-report.json` 확인 | 실제 학습 데이터 규모나 모델 학습 완료 실적이 아님. 이번 생성기 재실행 없음. E11 |

Electron의 별도 Python 테스트, Extension/data-core 빌드, 실시간 YouTube Music 연동, 음원 분리·CTC 모델 실행과 컨테이너 기동은 이번 조사에서 실행하지 않았다. `scripts/test.ps1`에는 백엔드·Extension 테스트와 두 TypeScript 프로젝트 빌드가 포함되지만 Electron Python 테스트와 실모델 검사는 별도다.

### 수상·외부 평가

수상·대회·사용자 수·외부 평가 자료는 확인되지 않았다. `award`는 빈 문자열이며, 수상 없음이 확정된 것으로 해석하지 않는다.

## 문제 해결과 개선

| 이전 문제 / 원인 | 변경 내용과 선택 이유 | 검증 방법 / 결과 | 남은 한계 / 근거 ID |
| --- | --- | --- | --- |
| 가사 미완료 상태를 재생 대기 조건으로 사용 | 가사 준비 여부와 재생 지속 여부를 분리. 원문·캐시 우선 표시 후 추가 처리 | `02594bd` 전후 재생 대기 함수 diff와 이번 Extension 회귀 테스트 확인 | 가사 공급 지연 자체를 없앤다는 뜻은 아님. E04, E15, E16 |
| gapless 재생에서 media 시간과 곡별 시간이 다를 수 있음 | 플레이어 바의 곡별 progress와 로드 세대·비디오 식별을 함께 사용 | 누적 시간, 새 곡 인식, 오래된 미디어 배제 테스트 통과 | 실사이트 DOM·브라우저 정책 변화는 별도 대응 필요. E04, E16 |
| 제목·가수만으로는 작품과 개별 녹음본을 구분하기 어려움 | 작품과 녹음본 분리, 공급자 ID 우선 식별, 공급자 후보 메타데이터의 식별값 덮어쓰기 방지 | 라이브/커버 분리, 제목 변경 시 ID 유지, 기존 캐시 식별 복구 API 테스트 통과 | 공급자 ID가 없는 요청은 정규화 메타데이터 fallback 사용. E07, E08, E16 |
| 표기와 실제 발음이 다르거나 장식 문자가 형태소 문맥을 끊음 | 표시·발음 읽기 분리, 분석용 문자 정리와 원문 offset 보존, 숫자 복수 후보 생성 | 발음 통합 테스트와 정규화·읽기 후보 테스트 통과 | 사전 학습 음성 모델의 결과는 가창·장음·특수 표현에서 수동 교정 필요. E05, E09, E10, E16 |
| 긴 모델 작업은 처리 프로세스 장애와 재시도를 고려해야 함 | 별도 워커에 DB 선점·heartbeat·lease·제한 재시도 구현, 저신뢰 결과는 검수 상태로 저장 | 분석 워커의 작업 저장·만료 복구·최대 재시도 테스트 통과 | 모든 공급자 조회 작업이 영속 큐로 바뀐 것은 아님. E07, E09, E16 |
| 재분석이 사용자가 교정한 결과를 덮을 수 있음 | 사용자 편집 줄을 분석 결과 교체 대상에서 제외하고 원문 교체에도 명시적 병합 요구 | 워커 저장 경로와 원문 갱신 API의 보호 분기 확인 | 전체 편집 UI의 사용자 시나리오 검증은 미실시. E08, E09 |
| SQLite 전용 INSERT 문법이 다른 DB에서 동작하지 않음 | dialect별 충돌 무시 INSERT로 변경하고 PostgreSQL/DB·API 컨테이너 설정 추가 | 현재 diff와 SQL 컴파일 단위 테스트 확인 | 미커밋 변경. 실제 PostgreSQL 마이그레이션·운영 검증은 미실시. E14, E16 |

## 상세 작업 기록

다음 날짜는 별도 표기가 없으면 Git 커밋 기록일이다. 각 항목의 개인 담당은 E01로 확인하며, 구현이 저장소에 존재한다는 것과 당시 실행·배포가 검증됐다는 것은 구분한다.

### 2026-03-11~2026-03-13 / 저장소 생성과 초기 MVP

- 상태: 저장소 이력 확인. 실제 프로젝트 착수일은 미확인.
- 수행 내용: 2026-03-11 첫 커밋은 빈 README였으며, 이후 확장 프로그램과 일본어 발음 처리 코드를 추가했다. 2026-03-13에는 사전 데이터, 발음 변환과 빌드 구성을 보강했다.
- 문제와 결정: 일본어 원문에 읽기·발음을 붙이는 초기 사용 흐름을 구현.
- 결과와 검증: `4d0ea7f`, `3af0c88`, `5326d6b` 이력 및 초기 MVP 파일 변경 확인. 당시 배포나 테스트 통과 기록으로 취급하지 않음.
- 근거: E04, E05, E15.

### 2026-03-14~2026-03-16 / 읽기 보정과 점진적 처리

- 상태: 구현 변경 기록 확인.
- 수행 내용: 원격 후리가나 fallback, 발음 처리 리팩터링, 점진적 백그라운드 변환과 비동기 응답 보호를 추가했다.
- 문제와 결정: 모든 줄의 변환 완료를 기다리는 부담과 곡 변경 후 늦게 도착하는 응답을 줄이기 위한 구조 변경.
- 결과와 검증: `41b0952`, `92fbd01`, `19fc848`, `8dcd208` 이력 확인. 정량 지연 감소율이나 당시 원격 Worker 배포 결과는 확인하지 않음.
- 근거: E04, E05, E15.

### 2026-05-16 / Electron과 교정 데이터 코어 추가

- 상태: 구현 변경 기록 확인.
- 수행 내용: Electron 창·읽기 SQLite 캐시·Sudachi 브리지·팝업 설정과 교정 데이터 스키마, 검증·중복 제거·분할·JSONL 출력 도구를 추가했다.
- 문제와 결정: 브라우저와 별도 창의 표시를 연결하고, 읽기 결과와 교정 이력을 재사용 가능한 형태로 저장.
- 결과와 검증: `d842d30` 파일 추가 이력과 현재 코드·예제 리포트 확인. 모델 학습 수행 기록은 없음.
- 근거: E05, E06, E11, E15.

### 2026-05-20 / 가사 전용 읽기 규칙과 표시 흐름 개선

- 상태: 구현 변경 기록 확인.
- 수행 내용: 가사 읽기 사전과 발음 처리, 콘텐츠 스크립트·오버레이·팝업 구성을 보강했다.
- 문제와 결정: 일반적인 분석 결과만으로 처리하기 어려운 가사 표현에 별도 규칙 적용.
- 결과와 검증: `db3953c` 변경 파일 및 현재 가사 사전 사용 경로 확인. 정확도 개선율은 미측정.
- 근거: E04~E06, E15.

### 2026-06-18 / FastAPI 가사 저장 백엔드 도입

- 상태: 구현 변경 기록 확인.
- 수행 내용: API, 스키마, DB 모델과 LRCLIB·LRC 처리 모듈, Extension 백엔드 클라이언트를 추가했다.
- 문제와 결정: 가사 조회·저장을 서비스로 분리하고 이후 캐시 재사용을 위한 기반 마련.
- 결과와 검증: `7135225`의 백엔드 신규 코드 확인. 서버 운영 시작일로 해석하지 않음.
- 근거: E07, E08, E15.

### 2026-07-13 / 가사 처리 책임과 개발 환경 정리

- 상태: 구현 변경 기록 확인.
- 수행 내용: 백엔드 작업 처리, 상태 조회, 정규화, 공급자 후보 처리, DB 이전, 테스트와 실행 스크립트를 정비했다.
- 문제와 결정: 가사 공급은 백엔드가 맡고 Extension은 상태·표시에 집중하도록 역할 분리.
- 결과와 검증: `493e9ec` 이력과 현재 API·작업 처리·테스트 스크립트 확인.
- 근거: E04, E07, E08, E12, E15.

### 2026-07-15 / 곡 전환·캐시·Native Messaging 연동

- 상태: 구현 변경 기록 확인.
- 수행 내용: 서비스 워커 중계, 페이지 재생 브리지, 곡 전환 보호, 표시/발음 읽기 분리, 읽기 후보 캐시, C# Native Host와 회귀 테스트를 추가·보강했다.
- 문제와 결정: 실제 곡 전환과 이전 요청의 응답을 구분하고, 로컬 서비스를 일관되게 연결하기 위한 변경.
- 결과와 검증: `4104860`의 관련 파일 변경과 현재 호출 경로 확인. 이번 조사에서는 Native Host 등록·브라우저 조작을 수행하지 않음.
- 근거: E04~E08, E12, E15.

### 2026-07-21 / 녹음본별 분석 파이프라인과 평가 도구

- 상태: 구현 변경 기록 확인.
- 수행 내용: 작품/녹음본 데이터 구조, 음원 자산과 중복 제거, 영속 분석 워커, 보컬 분리 어댑터, 일본어 음소 CTC 정렬, 읽기 후보와 타임라인 저장, 런타임 검사·벤치마크를 추가했다. 첫 가사 요청에서 재생을 대기시키던 조건도 제거했다.
- 문제와 결정: 녹음본마다 다른 가창 타이밍을 원문·표시용 읽기와 분리하고, 긴 분석의 재시도·복구·수정 보호를 지원.
- 결과와 검증: `02594bd`는 제목이 README 수정이지만 실제 diff에는 위 코드가 포함된다. 저장된 단일 샘플 벤치마크를 대조했으며 실제 측정일은 별도로 확인되지 않음.
- 근거: E08~E10, E15, E17.

### 구현일 미상 / 2026-09-21 확인한 미커밋 후속 변경

- 상태: 작업 트리 구현·설정 확인, 원격 반영 미확인.
- 수행 내용: 한국어·영어·일본어 설정/발음 표시 선택, 색상·설정 정규화, 현재 가사 상태를 보존하는 임시 미리보기, Electron 표시 보강, PostgreSQL 충돌 처리와 Docker DB·API 구성을 확인했다.
- 문제와 결정: 표시 설정의 일관성과 로컬 저장·실행 구성 확장을 위한 변경으로 읽힌다. 작성 의도는 코드와 README에서 확인한 범위만 기록.
- 결과와 검증: 설정·표시 언어·DB SQL 생성 관련 테스트는 이번 실행에 포함. 컨테이너 기동이나 실제 PostgreSQL 검증은 미실시. 관찰일을 구현 완료일로 바꾸지 않음.
- 근거: E13, E14, E16.

### 2026-09-21 / 포트폴리오 근거 문서 작성

- 상태: 로컬 문서 작성 및 JSON 구조 검증.
- 수행 내용: 사용자에게 개인 프로젝트·전 과정 직접 구현·구현 방식만 공개라는 범위를 확인하고, 코드·Git·테스트·기존 측정 결과를 연결한 이 문서를 작성했다.
- 결과와 검증: 백엔드와 Extension 테스트 결과를 별도로 기록. 공개 JSON의 필수 키·목록 항목 구조를 로컬 포트폴리오 타입과 대조하고 JSON 파서로 검증.
- 반영 범위: 초안 작성 이후 사용자가 이 문서의 커밋·푸시를 요청했다. 포트폴리오 콘텐츠 수정·배포는 별도 작업이다.
- 근거: E01, E16, E18.

## 다음 계획

다음은 README의 한계와 현재 코드에서 도출한 후속 후보이며, 사용자가 확정한 일정이나 완료 실적이 아니다.

- 확장 프로그램에서 음원·원문 업로드와 분석 결과 검수를 수행하는 UI 연결.
- 복수 곡·라이브·커버로 평가 범위를 넓히고, 같은 평가 조건에서 가창 특화 모델과 비교.
- 가사 공급자 작업의 영속 처리 필요성 검토와 분석 워커 복구 시나리오 추가 검증.
- 미커밋 Docker/PostgreSQL 구성의 실제 기동·마이그레이션 검증과 변경 반영.
- 실제 참여 기간과 프로젝트 진행 상태를 확인한 후 공개 요약 보완.

## 공개 자료

| 항목 | 값 | 공개 가능 여부 / 확인 근거 |
| --- | --- | --- |
| 서비스·데모 URL (`liveUrl`) | `""` | 확인된 공개 데모 없음. 로컬 서비스 주소를 공개 서비스로 기재하지 않음. |
| 공개 저장소 URL (`githubUrl`) | `""` | 원본 저장소는 public이지만 사용자의 포트폴리오 공개 범위는 구현 방식까지이므로 코드 링크 전재 제외. E01, E02 |
| 대표 이미지 (`coverImage`) | `""` | 대표 이미지 지정·사용 허용 확인 없음. |
| 이미지 대체 텍스트 / 설명 | `""` | 확정된 이미지가 없어 비움. |
| 시연·발표 자료 | `""` | 공개 허용된 자료 미확인. |

공개 JSON 이외의 근거표·검증 기록에는 재확인을 위한 최소한의 상대 경로와 커밋 식별자만 사용한다. 원본 가사·음원, 코드 본문, 자격 증명, 계정 이메일, 개인 장치의 절대 경로는 전재하지 않는다.

## 근거 색인

코드 출처의 기본 시점은 확인 커밋과 2026-09-21 작업 트리다. 별도로 표시한 미커밋 변경은 해당 커밋에 포함되지 않는다. 사용자 진술은 담당 범위의 근거이며, 자동 테스트·실모델 실행 결과와 구별한다.

| ID | 뒷받침하는 필드·주장 | 출처 종류 / 안전한 위치·참조 | 출처 시점 | 확인 내용과 한계 | 공개 범위 |
| --- | --- | --- | --- | --- | --- |
| E01 | 소유·개인 프로젝트, `role`, `roleTags`, `roles`, 기술별 본인 사용, 공개 제한 | 사용자 진술: 개인 프로젝트이며 처음부터 끝까지 직접 구현, 구현 방식까지만 공개 | 2026-09-21 | 정확한 참여 날짜·AI PM 역할·소스 공개 허용은 별도 확인되지 않음 | 역할과 구현 방식만 공개 |
| E02 | 저장소 식별·소유자 표기·기본/현재 브랜치·현재 버전 | `git remote -v`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short`; GitHub CLI 저장소 메타데이터 조회 | 2026-09-21 | `main`, public 확인. 로컬 원격 추적 ref와 실제 원격 최신 상태를 동일시하지 않음 | 저장소 식별은 근거용, 공개 코드 링크 제외 |
| E03 | `title`, `subtitle`, `category`, `summaryLines`, `overviewLines`, 배경·한계 | 문서: `README_KR.md`의 구현된 기능·실행 아키텍처·알려진 한계; `README.md`의 대응 절 | 현재 작업 트리 | 제품 범위를 코드와 교차 확인. README 성능 문구만으로 실측을 새로 주장하지 않음 | 구현 개요 |
| E04 | `roles[0]`, `technologyStack[0]`, `pipeline[0:3]`, `improvements[0]`, 재생 전환 | 코드·설정: `Extension/vite.config.ts`, `package.json`, `public/manifest.json`, `src/content.ts`, `src/background.ts`, `src/pagePlaybackBridge.ts`, `src/utils/playback/` | HEAD + 미커밋 변경 | 실제 진입점과 요청 ID·취소·캐시·곡별 progress 경로 확인. React는 활성 스택 아님 | 구현 방식 |
| E05 | 일본어 읽기, `roles[3]`, `technologyStack[3]`, `improvements[2]` | 코드: `Extension/src/utils/pronunciation/reading.ts`, `readingVariants.ts`, `lyricReadingDictionary.ts`, `converters.ts`; `ElectronOverlay/src/sudachi_analyze.py` | HEAD | 표시/발음 분리, 사전·규칙·원격 fallback, 한글·로마자 변환 확인. 번역 모델 실적으로 표현하지 않음 | 구현 방식 |
| E06 | `roles[1]`, `technologyStack[1]`, 읽기 캐시 | 코드: `ElectronOverlay/src/main.js`, `renderer.js`, `preload.js`, `db.js`, `sudachi.js`; `ElectronOverlay/package.json` | HEAD + 표시 관련 미커밋 변경 | Electron·Node SQLite·HTTP 브리지 확인. 실제 GUI는 이번에 조작하지 않음 | 구현 방식 |
| E07 | `roles[2]`, `technologyStack[2]`, 가사 공급과 상태 처리 | 코드: `backend/app/main.py`, `schemas.py`, `routers/lyrics.py`, `services/jobs.py`, `services/lrclib.py`, `services/lrc.py`; `backend/requirements.txt` | 현재 작업 트리 | FastAPI·Pydantic·HTTPX 사용, LRCLIB 후보와 상태 처리 확인. 공급자 작업은 프로세스 내부 관리 | 구현 방식 |
| E08 | 데이터 모델·녹음본 식별, `improvements[1]`, `pipeline[4]` | 코드·설계 문서: `backend/app/models.py`, `database.py`, `services/normalization.py`; `docs/lyrikana-db-erd.md` | HEAD + DB 호환 미커밋 변경 | 작품/녹음본·가사·읽기 후보·음원·작업 구조 및 기존 데이터 이전 확인 | 구조 설명 |
| E09 | `roles[4]`, `technologyStack[4]`, `pipeline[3:5]`, 작업 복구·검수 | 코드·문서: `backend/app/services/karaoke_pipeline.py`, `analysis_worker.py`, `analysis_adapters.py`, `audio_assets.py`; `docs/karaoke-analysis-pipeline.md`; `scripts/setup-analysis.ps1` | `02594bd` | 별도 워커, 조건부 UPDATE 선점, lease, SHA-256, 사용자 편집 보호, 교체 가능 어댑터 확인. 대체 엔진 설치·실행과 구분 | 구현 방식 |
| E10 | 일본어 음소 정렬, `roles[3]`, `technologyStack[4]` | 코드: `backend/aligners/japanese_ctc_aligner.py`; 평가 코드 `backend/app/alignment_benchmark.py` | `02594bd` | PyTorch·Transformers·NumPy, 로컬 모델 로드, 음성 구간 분할, 복수 후보 비교 확인. 모델 자체 사전 학습을 본인이 수행했다는 뜻 아님 | 구현 방식 |
| E11 | 교정 도구, `roles[4:6]`, `technologyStack[5]` | 코드·예제 결과: `lyrikana-data-core/src/correctionLogSchema.ts`, `src/jsonl/`, `src/scripts/generateJsonl.ts`, `data/lyrikana-jsonl-report.json`, `package.json` | `d842d30`부터 존재, 조사 시점 확인 | 검증·중복 제거·교정 ID별 분할·출력 확인. 예제 규모를 모델 학습 실적으로 사용하지 않음 | 처리 방식; 원본 교정 데이터 제외 |
| E12 | Native 실행, `roles[1]`, `roles[5]`, 개발 도구 | 코드·실행 설정: `native-host/Launcher.cs`, `scripts/register-native-host.ps1`, `setup.ps1`, `run-backend.ps1`, `run-analysis-worker.ps1`, `test.ps1`, `.vscode/tasks.json` | HEAD | C#·PowerShell, mutex·헬스 확인과 실행 흐름 확인. 이번 설치·등록·서비스 기동 없음 | 구현 방식 |
| E13 | 미커밋 UI·설정 변경 | 코드·diff: `Extension/src/settings.ts`, `contentSettings.ts`, `utils/pronunciation/displayLanguage.ts`, `popup/`; `ElectronOverlay/src/main.js`, `renderer.js` | 구현일 미상, 2026-09-21 확인 | 언어 선택·색상·설정 검증·미리보기 보존 코드 확인. 날짜는 관찰일 | 구현 방식, 미커밋 표시 |
| E14 | 미커밋 PostgreSQL·Docker 구성과 제한 | 설정·diff: `compose.yaml`, `backend/Dockerfile`, `backend/.dockerignore`, `backend/app/database.py`, `backend/tests/test_database.py` | 구현일 미상, 2026-09-21 확인 | API·DB 컨테이너, 볼륨·헬스 확인, dialect INSERT 구현. worker 서비스는 Compose에 없고 실제 PostgreSQL 기동 미검증 | 구성 방식, 배포 성과 제외 |
| E15 | `year`, `timeline`, 상세 연혁·변경 전후 | Git 로그·stat·선택 diff: `4d0ea7f`, `3af0c88`, `5326d6b`, `41b0952`, `92fbd01`, `19fc848`, `8dcd208`, `d842d30`, `db3953c`, `7135225`, `493e9ec`, `4104860`, `02594bd` | 2026-03-11~2026-07-21, +09:00 | 커밋 날짜를 구현 변경 기록일로 사용. 착수·종료·배포일과 구별 | 구현 연혁 |
| E16 | 이번 회귀 테스트 결과, 개선 항목의 테스트 근거 | 실행 결과: 백엔드 `pytest -q`; Extension `npm.cmd test -- --reporter=dot`. 테스트 소스: `backend/tests/`, `Extension/src/**/*.test.ts` | 2026-09-21 | 백엔드 36 통과/1 건너뜀, Extension 57 통과. 두 집합 분리. 실서비스 E2E·모델 추론·컨테이너 검증 아님 | 근거 기록; 공개 수치 카드 제외 |
| E17 | 기존 단일 샘플 음향 평가 | 기존 실행 결과: `backend/.analysis-data/benchmarks/pjs/alignment-benchmark.json`; 설명: `README_KR.md`, `docs/karaoke-analysis-pipeline.md`; 평가식: `backend/app/alignment_benchmark.py` | 생성일 미확인, 2026-09-21 확인 | 숫자와 CUDA 기록 대조. 결과 파일은 Git 제외 로컬 자료이며 다른 환경에서 접근 불가할 수 있음. 이번 재실행 아님 | 집계 근거만 기록, 음원·가사·로컬 파일 공개 제외 |
| E18 | 공개 JSON 필드와 사이트 반영 경계 | 로컬 포트폴리오 저장소: `src/data/timelineProjects.ts`, `src/data/engineering.ts`, `src/data/roleTags.ts`, `src/types/content.ts`, `README.md`; 스킬 항목 기준·양식 | 2026-09-21 | 실제 인터페이스와 콘텐츠 원칙 대조. 포트폴리오 빌드·렌더링·배포 검증은 미실시 | 타입·콘텐츠 기준 |

색인의 배열 구간은 끝 인덱스를 포함하지 않는 설명용 표기다. `slug`는 이번 문서에서 정한 프로젝트명 기반 주소이며 기존 사이트 등록값이 확인됐다는 뜻은 아니다.

## 확인 필요 / 해당 없음

| 항목 | 상태 | 현재 알려진 사실 | 추가로 필요한 정보 |
| --- | --- | --- | --- |
| 개인 기여·소유 | 확인 | 개인 프로젝트, 전 과정 직접 구현. 원본 소유자와 사용자 확인 기록 있음 | 없음. E01, E02 |
| 실제 참여 기간·프로젝트 상태 | 미확인 | 코드 이력은 2026년이며 후속 미커밋 변경 존재. `year`는 2026, `period`는 빈 문자열 | 실제 시작·종료일 또는 현재 진행 중 여부 |
| 팀 규모·분담 | 해당 없음: 별도 팀 | 개인 프로젝트 | 없음 |
| 추가 역할 `AI PM` | 미선택 | AI 기능 구현만으로 역할을 추가하지 않음. `roleTags: []` | 향후 본인이 선택한다면 수행 범위 근거 |
| 수상·외부 평가 | 미확인 | 근거 자료 없음, `award: ""` | 수상·평가가 있다면 공식 명칭·일자·출처 |
| 공개 수치 카드 | 이번 공개 범위에서 제외 | 구현 방식 공개 요청에 따라 `metrics: []` | 공개 범위가 바뀔 때 개별 수치·범위 재확인 |
| 실제 이용자·성능 개선율 | 미확인 | 이용량·동일 조건 전후 측정 자료 없음 | 측정 환경·시점·집계 방법·원본 결과 |
| 음향 결과 측정 날짜 | 미확인 | 단일 샘플 결과와 평가 코드 존재, 결과 JSON에 날짜 없음 | 당시 실행 로그. 파일 수정일·커밋일로 대체하지 않음 |
| PostgreSQL 운영·Docker 배포 | 미확인 | 구성 파일과 SQL 단위 테스트 존재 | 실제 연결·이전·재시작·영속 저장 검증 결과 |
| 본인이 모델을 학습했는지 | 미확인 | 사전 학습 모델 추론과 JSONL 준비 도구 확인 | 별도 학습이 있었다면 실행·모델·평가 근거 |
| 공개 코드·데이터·음원 링크 | 이번 공개 범위에서 제외 | 구현 방식까지만 공개하도록 요청 | 현 범위에서는 링크 추가하지 않음 |
| 대표 이미지·시연 자료 | 미확인 | 지정된 자료 없음 | 공개 가능한 이미지·시연 자료 |
| 원격 기본 브랜치 문서 | 사용자 요청에 따른 반영 대상 | `main` 루트의 이 문서만 커밋·푸시 범위에 포함 | 문서를 포함한 커밋과 원격 `main`의 일치 여부로 확인 |

## 사이트 반영 메모

- 로컬 포트폴리오의 `TimelineProject`와 `TechnologyGroup` 구조를 직접 읽고 모든 필수 키와 사용한 목록 항목의 하위 키를 맞췄다. JSON 파싱·키·타입 검사를 수행했다. 사이트 실행 호환성까지 검증한 것은 아니다.
- 소유 저장소의 기본 브랜치 루트 문서 요건은 이 문서를 포함한 커밋이 원격 `main`에 반영됐는지로 판단한다. 사용자 요청에 따른 커밋·푸시는 `timeline.md`만 대상으로 하며, 기존 코드 변경과 포트폴리오 사이트 데이터 수정·배포는 포함하지 않는다.
- `period`, `award`, `metrics`가 비어 있으므로 실제 사이트 반영 시 빈 기간·수상 배지·수치 카드의 표시를 조정해야 한다. 수상형 일러스트를 그대로 재사용하지 않고 프로젝트에 맞는 시각 자료를 별도로 준비한다.
- 공개용 데이터와 원본 근거 기록은 용도가 다르다. 포트폴리오에는 구현 방식 중심 JSON을 사용하고, 코드·로컬 경로·측정 원본·음원·개인 환경은 추가 공개하지 않는다.
- 이 프로젝트를 기록했다는 이유로 프로필의 대표 직무나 전체 기술 목록을 변경하지 않는다.

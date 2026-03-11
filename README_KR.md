# LyriKana 🎵

**English version → README.md**

**LyriKana**는 YouTube Music에서 재생 중인 노래의 싱크 가사를 표시하고 일본어 발음을 제공하여 노래 연습을 돕는 Chrome 확장 프로그램입니다.

특히 J-pop과 같은 **영어 이외의 노래를 연습할 때** 가사를 실시간으로 확인하고 발음을 함께 볼 수 있도록 설계되었습니다.

---

## ✨ 주요 기능

* 🎧 **YouTube Music 재생 곡 자동 인식**
* 📝 **싱크 가사 표시 (LRC 지원)**
* 🇯🇵 **일본어 발음 지원**

  * 한글 발음
  * 로마자 발음
  * 두 발음 동시 표시 가능
* 📺 **YouTube Music 화면 위 Overlay 가사 UI**
* 🪟 **별도 가사 창 (PIP / Popup)**
* 🎤 **노래 연습 및 가라오케 스타일 가사 지원**

---

## 🚀 기술 스택

Frontend

* React
* TypeScript
* Vite
* Chrome Extension API

Lyrics Sources

* LRCLIB (기본 가사 API)
* Netease (추후 지원 예정)

Future Backend (계획)

* FastAPI
* Redis
* PostgreSQL

---

## 🏗️ 아키텍처

```id="azyns8"
LyriKana
 ├ extension
 │   ├ content script (YouTube Music 곡 감지)
 │   ├ overlay UI (가사 표시)
 │   ├ PIP 창
 │   └ 설정 팝업
 │
 └ backend (추후 예정)
     ├ 가사 API 통합
     ├ 캐싱
     └ 사용자 가사 수정 기능
```

동작 흐름

```id="h2ky2c"
YouTube Music
      ↓
현재 재생 곡 감지
      ↓
LRCLIB 가사 요청
      ↓
LRC 가사 파싱
      ↓
발음 생성
      ↓
Overlay / PIP 가사 표시
```

---

## 📌 개발 로드맵

### MVP

* [ ] YouTube Music 현재 재생 곡 감지
* [ ] LRCLIB 가사 연동
* [ ] LRC 싱크 가사 파싱
* [ ] Overlay 가사 표시
* [ ] 일본어 → 로마자 발음 변환

### 다음 단계

* [ ] 일본어 → 한글 발음 변환
* [ ] PIP 가사 창
* [ ] 가사 UI 개선

### 장기 목표

* [ ] FastAPI 기반 Backend 구축
* [ ] 가사 캐싱 시스템
* [ ] 사용자 가사 수정 기능
* [ ] 다양한 언어 노래 지원 (프랑스어, 중국어 등)
* [ ] 음정 / 박자 분석 기능

---

## 🎯 프로젝트 목표

LyriKana는 다음 세 가지 기능을 결합하여 **외국어 노래 연습을 더 쉽게 만드는 것**을 목표로 합니다.

* 싱크 가사
* 발음 지원
* 노래방 스타일 UI

사용자가 음악을 들으면서 자연스럽게 따라 부르고 발음을 익힐 수 있는 가벼운 도구를 만드는 것이 목표입니다.

---

## 📜 라이선스

현재 개발 중인 프로젝트입니다.
라이선스는 추후 추가될 예정입니다.

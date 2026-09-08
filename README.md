# InterReview

자기소개서 분석과 AI 모의면접을 제공하는 서비스입니다. 자소서에서 면접에 대비할 지점을 찾고, 지원자 답변에 근거한 질문으로 면접을 연습합니다. 답변 내용은 텍스트 피드백으로, 시선과 음성은 점수 없이 측정값과 시각화로 확인합니다.

## 주요 기능

- **Track A — 자소서 분석:** 자유 형식 또는 기업 문항·답변 입력 → 주장·경험 분석 → 약점·예상 질문과 원문 하이라이트. `/essay`에서 입력하고 `/essay/result`에서 결과를 확인합니다.
- **Track B — 모의면접:** `/interview`에서 지원자 정보·자소서 확인 → 질문 생성 → 장치 설정·시선 보정 → 질문별 답변 → 결과 확인. 자동 진행과 수동 답변 종료·재답변을 지원합니다.
- 자소서 초안과 지원자 정보는 같은 브라우저 탭의 `sessionStorage`로 두 Track에서 공유합니다.
- 여섯 항목에서 질문을 선택하며 직무·기술 및 문제 해결 후보에는 지원 직무 필터를 적용합니다. `resume`·`job_technology`는 지원자 답변에 근거한 생성 질문으로 교체할 수 있고, 검증 실패 시 질문은행 질문을 사용합니다. 선택된 은행 질문은 개인화하며 원문을 보존합니다.
- 질문 생성·답변 리뷰의 지원자 근거에는 기업 문항을 제외한 **지원자 답변만** 사용합니다. 질문은행 전체를 LLM에 전달하지 않습니다.
- Supertonic 3 로컬 TTS, 음성 성별에 맞는 면접관 이미지, 질문 음성 사전 준비를 지원합니다.
- Silero VAD와 세션 음성 기준 보정으로 발화·무음 구간을 측정하고, CLOVA Speech로 질문별 답변을 전사합니다.
- MediaPipe 시선 추출, EMA 평활화, 이동·고정점 캘리브레이션을 거쳐 질문별 Heatmap을 표시합니다.
- 결과 화면은 답변 내용의 **요약·잘한 점·개선점**, 음성 활동 타임라인·발화 속도, 시선 Heatmap을 제공합니다. 시선·음성 점수나 합격 가능성을 만들지 않습니다.

## 구조

```text
backend/     FastAPI · Python 3.12+ · uv
             자소서 분석 / 질문 선택·개인화 / 답변 리뷰 / STT / 로컬 TTS / 측정값 집계
frontend/    Next.js 16 · React 19 · TypeScript · Tailwind
             자소서·면접 UI / 브라우저 녹음·VAD·시선 분석 / 결과 시각화
docs/        역할 분담, 계획, Track B 진행 기록
```

브라우저가 카메라·마이크 수집과 시선·음성 측정을 담당합니다. 백엔드는 외부 LLM·STT 호출, 로컬 TTS 합성, 측정값 집계와 API 키 관리를 담당합니다.

## 로컬 실행

### 1. 백엔드

Python 3.12 이상과 uv가 필요합니다. 저장소 루트에서 다음을 실행합니다.

```powershell
cd backend
Copy-Item .env.example .env  # 최초 설정 시에만 복사하고 필요한 값을 입력
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

환경변수 전체 목록은 [backend/.env.example](backend/.env.example)을 참고하세요.

| 기능 | 설정 |
| --- | --- |
| LLM 공급자 | `LLM_PROVIDER=anthropic` 또는 `gemini` |
| LLM 인증 | 선택한 공급자의 `ANTHROPIC_API_KEY` 또는 `GEMINI_API_KEY` |
| LLM 모델 | `ANTHROPIC_EVAL_MODEL`·`ANTHROPIC_PERSONALIZE_MODEL` 또는 `GEMINI_EVAL_MODEL`·`GEMINI_PERSONALIZE_MODEL` |
| CLOVA STT | `CLOVA_SPEECH_INVOKE_URL`, `CLOVA_SPEECH_SECRET` |
| 로컬 TTS | `LOCAL_TTS_MODEL`, `LOCAL_TTS_MODEL_DIR`, 음성·속도·스레드 설정 |
| CORS | `CORS_ORIGINS` — 브라우저가 백엔드에 직접 접속할 때 허용할 출처 |

공급자별 모델 설정이 기존 `EVAL_MODEL`·`PERSONALIZE_MODEL`보다 우선합니다. 공급자를 전환할 때는 기존 공통 모델 값을 비우고, 설정·클라이언트 캐시가 갱신되도록 백엔드를 완전히 재시작하세요.

LLM 개인화 실패 시 원문 질문을 유지하고, 답변 리뷰 실패 시 피드백 불가 안내로 면접을 계속합니다. 자소서 분석 실패는 오류로 표시합니다. STT 키가 없으면 `not_configured`를 반환하며, STT 실패가 면접 세션을 종료시키지는 않습니다.

### 2. 질문은행과 로컬 TTS 준비

질문은행 데이터와 TTS 모델은 Git에 포함하지 않습니다. 새 checkout에서는 별도로 준비해야 합니다.

- 질문은행 기본 위치: `backend/question_banks/ict/`. `new/` 아래 `resume.json`, `motivation_commitment.json`, `job_technology.json`, `problem_solving.json`, `collaboration_organization.json`, `values_personality.json`이 필요합니다. 다른 위치는 `QUESTION_BANK_ROOT` 환경변수로 지정합니다.
- 데이터 검증: `backend`에서 `uv run python tools/validate_ict_question_bank.py`.
- 로컬 TTS 최초 설치: `backend`에서 아래 명령을 실행합니다. 고정된 모델 revision을 내려받고 해시를 검증한 뒤 음성별 안내 WAV를 준비합니다. 기존 설치 폴더는 덮어쓰지 않습니다.

```powershell
uv run python tools/install_local_tts.py
```

기본 설치 위치는 `backend/models/tts/supertonic3`입니다. `--destination`으로 변경했다면 `.env`의 `LOCAL_TTS_MODEL_DIR`도 맞추세요.

### 3. 프론트엔드

프로젝트의 Next.js와 TypeScript 테스트 실행을 지원하는 Node.js 환경에서, 별도 터미널을 열어 실행합니다.

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

[http://localhost:3000](http://localhost:3000)에서 접속합니다. Windows 외 환경에서는 `npm.cmd` 대신 `npm`을 사용하세요.

기본 API 주소는 `/api`이며 Next.js가 `http://localhost:8000`으로 프록시합니다. 변경이 필요하면 `frontend/.env.local`에 다음 중 필요한 값을 설정하고 프론트엔드를 재시작합니다.

- `BACKEND_ORIGIN`: Next.js 프록시가 연결할 백엔드 주소.
- `NEXT_PUBLIC_API_BASE`: 브라우저가 사용할 API 기본 주소. 별도 백엔드에 직접 연결할 때 사용하며 빌드 시 반영됩니다.

카메라·마이크는 **localhost 또는 HTTPS** 환경에서 사용합니다.

## API

| 메서드·경로 | 역할 |
| --- | --- |
| `GET /health` | 백엔드 상태 확인 |
| `POST /essay/analyze` | 자소서 분석 |
| `POST /questions` | 여섯 항목 질문 선택·근거 기반 생성·개인화 |
| `POST /tts` | 질문·안내 문장을 WAV로 합성 |
| `POST /stt` | multipart 오디오를 CLOVA Speech로 전사 |
| `POST /answers/review` | 질문별 답변 내용 피드백 |
| `POST /measurements` | 질문별 측정값 및 세션 요약 집계 |

요청·응답 스키마는 실행 중인 백엔드의 [Swagger UI](http://localhost:8000/docs)에서 확인할 수 있습니다.

## 검증

```powershell
# backend 디렉터리
uv run pytest

# frontend 디렉터리
npm.cmd run lint
npx.cmd tsc --noEmit
node --test lib/*.test.mts
npm.cmd run build
```

백엔드 테스트는 실제 `.env`·환경변수와 실패 로그를 격리하고 `tests/`만 수집합니다. 질문은행 데이터 검증 테스트에는 별도로 준비한 데이터가 필요합니다. 외부 LLM·STT 호출은 mock으로 검증합니다.

2026-09-09 통합 검증에서는 프론트 lint·TypeScript·production build와 테스트 52개, 백엔드 테스트 142개가 통과했습니다. Windows 심볼릭 링크 생성 권한으로 1개 테스트는 건너뛰었습니다. 실제 카메라·마이크·외부 API E2E 및 배포 환경 검증은 별도로 필요합니다.

## 데이터와 문서

- API 키는 백엔드 환경변수에서 읽으며 `.env`는 Git에서 제외합니다.
- 오디오는 STT 처리를 위해 백엔드와 CLOVA Speech로 전송합니다. 시선은 브라우저에서 처리하고 요약값을 전달하며, raw audio/video를 불필요하게 영구 저장하지 않습니다.
- STT 원문은 장치 설정 테스트에서 확인할 수 있고, 면접·결과 화면에는 노출하지 않습니다. 답변 내용 리뷰에는 내부적으로 전사문을 사용합니다.
- LLM 실패 기록 `docs/log.txt`에는 프롬프트와 응답이 포함될 수 있습니다. Git에서 제외하며 외부 공유 전에 내용을 확인해야 합니다.
- 역할·계획: [RoleDivision](docs/RoleDivision.md), [전체 계획](docs/plan.md), [Track A](docs/plan-A.md), [Track B](docs/plan-B.md). 진행 기록은 [progress-B](docs/progress-B.md)를 참고하세요. 계획의 과거 예시와 현재 구현 차이는 별도로 확인해야 합니다.

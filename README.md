# InterReview

AI 모의면접 서비스. 지원자가 가상 면접관의 질문을 받고 → 카메라·마이크로
답변하고 → 답변 내용은 LLM으로 확인하고 시선·음성은 측정값으로 확인한다.

**아키텍처:** Next.js(프론트) + FastAPI(백엔드). 캠·마이크·시선 캡처는
브라우저가 담당하고, 서버는 STT/LLM 호출과 시크릿 보관만 맡는다.
(최종 범위와 현재 상태는 `docs/plan.md`를 기준으로 한다.)

## 구조

```
backend/    FastAPI + uv — 질문은행 / STT / 내용 확인 /health
frontend/   Next.js (App Router, TS, Tailwind) — 면접·결과 UI
docs/       plan.md, reference/(구 로직 참고)
```

## 실행

### 백엔드 (FastAPI)

```bash
cd backend
cp .env.example .env      # CLOVA 키 등 채우기 (.env는 git-ignore)
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

- `POST /questions` — 질문은행 항목별 Random Pick → 선택 질문 개인화
- `POST /stt` — 오디오 blob(multipart) → CLOVA Speech 전사
- `POST /measurements` — {답변들} → 질문별 시선·음성 측정값과 세션 평균

답변 내용 판별과 질문 개인화 LLM은 Track A의 `/answers/review`와
`personalize_question()` 계약으로 연결한다. B 런타임은 LLM 클라이언트나
내용 판별 fallback을 소유하지 않는다.
- 테스트: `uv run pytest`

필수/선택 환경변수는 `backend/.env.example` 참고. 주요 키:
`CLOVA_SPEECH_INVOKE_URL`, `CLOVA_SPEECH_SECRET` (STT),
`ANTHROPIC_API_KEY` (질문 개인화·내용 확인 — 없으면 원문/측정값 fallback).

### 프론트엔드 (Next.js)

```bash
cd frontend
npm install
npm run dev               # http://localhost:3000
```

백엔드 주소는 `frontend/.env.local`의 `NEXT_PUBLIC_API_BASE`
(기본 `http://localhost:8000`).

> 캠·마이크 권한은 **localhost 또는 HTTPS**에서만 열린다. 배포 시 HTTPS 필수.

## Track B 상태 (2026-08-21)

- ✅ 질문은행 6개 항목별 Random Pick·중복 방지·선택 원문 보존
- ✅ 프로필 기반 질문 개인화 및 LLM 실패 시 원문 fallback
- ✅ 장치 선택·5점 시선 캘리브레이션·질문별 기존 CLOVA STT 흐름
- ✅ 발화 시간·실제 발화 시간·발화 속도·무음·긴 무음 계산
- ✅ 질문별 시선 Heatmap·평균 위치·x/y 표준편차·유효 프레임 비율
- ✅ 질문별 내용 상태/이유/빠진 내용 결과 화면
- ⏳ 실제 카메라·마이크 권한을 포함한 브라우저 E2E는 별도 장치에서 확인 필요

시선과 음성은 측정값으로만 제공하며, raw audio/video는 브라우저 측정 후 결과에 필요한
요약값만 전송합니다.

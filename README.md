# InterReview

AI 모의면접 서비스. 지원자가 가상 면접관의 질문을 받고 → 카메라·마이크로
답변하고 → 답변 내용과 태도를 AI가 평가한다.

**아키텍처:** Next.js(프론트) + FastAPI(백엔드). 캠·마이크·시선 캡처는
브라우저가 담당하고, 서버는 STT/LLM 호출과 시크릿 보관만 맡는다.
(Streamlit 기반 구버전에서 전환 — 배경은 `docs/migration-plan.md` 참고.)

## 구조

```
backend/    FastAPI + uv — /questions /stt /evaluate /health
frontend/   Next.js (App Router, TS, Tailwind) — 면접 UI
docs/       migration-plan.md, reference/(구 로직 참고)
```

## 실행

### 백엔드 (FastAPI)

```bash
cd backend
cp .env.example .env      # CLOVA 키 등 채우기 (.env는 git-ignore)
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

- `POST /questions` — 프로필 → 룰 기반 6문항
- `POST /stt` — 오디오 blob(multipart) → CLOVA Speech 전사
- `POST /evaluate` — {프로필, 답변들} → 평가 리포트
- 테스트: `uv run pytest`

필수/선택 환경변수는 `backend/.env.example` 참고. 주요 키:
`CLOVA_SPEECH_INVOKE_URL`, `CLOVA_SPEECH_SECRET` (STT),
`ANTHROPIC_API_KEY` (LLM 평가 — 없으면 룰기반으로 자동 fallback).

### 프론트엔드 (Next.js)

```bash
cd frontend
npm install
npm run dev               # http://localhost:3000
```

백엔드 주소는 `frontend/.env.local`의 `NEXT_PUBLIC_API_BASE`
(기본 `http://localhost:8000`).

> 캠·마이크 권한은 **localhost 또는 HTTPS**에서만 열린다. 배포 시 HTTPS 필수.

## 상태 (2026-07-19)

- ✅ 백엔드 코어: 질문 생성 / STT(CLOVA) / 룰기반 평가
- ✅ 프론트: setup → 면접(캠+녹음+STT) → 평가 리포트
- ⏸️ 시선 추적(Milestone C): 인계 예정 — 계약은 `docs/migration-plan.md` §8
- ⏳ LLM 평가 경로: `ANTHROPIC_API_KEY` 확보 후 (현재는 룰기반)

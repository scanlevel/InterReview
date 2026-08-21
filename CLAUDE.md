# InterReview

자기소개서의 면접 취약점을 LLM으로 분석하고, 질문은행 기반 개인화 면접에서 답변 내용은 LLM으로 확인하며,
시선·음성은 **점수화하지 않고** 측정값과 시각화로 제공하는 2-Track 면접 연습 시스템.

- Track A — 자소서 첨삭 (주장/경험 분리 → 약점 → 예상 질문)
- Track B — 발표/면접 연습 (질문 개인화 → 답변 → 시선/음성/STT → 내용 확인)

문서: [`docs/plan.md`](docs/plan.md) 전체 계획 · [`docs/RoleDivision.md`](docs/RoleDivision.md) 역할 분담 · [`docs/plan-A.md`](docs/plan-A.md) **내 담당 계획**

---

## 이 저장소에서 나는 A 담당이다

**A 담당 = Track A + 공용 LLM 기능.**

내가 만드는 것:
- 공용 LLM 레이어 (`app/services/llm.py`, `app/prompts/`)
- 자소서 분석 (`POST /essay/analyze`) 및 Track A 결과 UI
- 질문 개인화 함수 `personalize_question()` (B가 호출)
- 답변 내용 판별 (`POST /answers/review`)
- LLM JSON validation / fallback

**내가 건드리지 않는 것 (B 담당, read-only):**
`app/services/questions.py`, `app/routers/questions.py`, `app/services/stt.py`, `app/routers/stt.py`,
`frontend/components/{InterviewView,AnalysisView,SetupView}.tsx`, MediaPipe/시선/Heatmap/발화속도 관련 전부.

**공유 파일 — 수정 시 반드시 B에게 알린다:**
`app/schemas.py`, `frontend/lib/types.ts`, `frontend/lib/api.ts`, `frontend/components/InterviewApp.tsx`, `app/main.py`
→ A는 **신규 모델/함수 append만** 한다. 기존 정의 변경은 합의 후.

---

## 미해결 합의 사항 (코드 작성 전 확인)

**점수 스키마 폐기.** 현재 `EvaluationReport.total_score`와 `EvaluationItem.score`는 규칙 기반 점수를 반환하지만,
plan.md §10·§12·§16은 "숫자 점수를 만들지 않는다"를 명시한다. 이 스키마를 걷어내면 B의 결과 화면과 프론트 타입이 깨진다.
→ **B와 합의하기 전에는 `services/evaluate.py` / `routers/evaluate.py` / `AnalysisView.tsx`를 수정하지 않는다.**
자세한 계약 내용은 `docs/plan-A.md` §3.

---

## 스택 / 실행

```
backend/   FastAPI + Pydantic v2 + pydantic-settings, uv, pytest   (Python >=3.12)
frontend/  Next.js 16.2.10 + React 19 + Tailwind v4 + TypeScript
```

```bash
# backend
cd backend && uv run uvicorn app.main:app --reload    # http://localhost:8000
cd backend && uv run pytest

# frontend
cd frontend && npm run dev                            # http://localhost:3000
cd frontend && npm run lint
```

`backend/.env`는 git-ignored. 키 목록은 `backend/.env.example` 참고.

---

## 코드 원칙 (plan.md §14)

1. 현재 저장소 구조를 우선한다. 대규모 refactor 금지.
2. 이미 구현된 기능은 재작성하지 말고 연결·수정한다.
3. **LLM 프롬프트와 API 호출 코드를 UI에서 분리한다** — 프롬프트는 `app/prompts/`, 호출은 `app/services/`.
4. Vision/Audio feature 계산도 UI 코드와 분리한다.
5. **API key는 `.env`에서만 읽는다.** 하드코딩 금지, 프롬프트·메시지에 넣지 않는다.
6. LLM 응답 JSON은 반드시 validation한다.
7. **LLM 실패가 면접 세션을 종료시키면 안 된다** — 개인화 실패 → 원문 질문, 답변 판별 실패 → `unavailable`.
8. 질문마다 모델/클라이언트를 새로 만들지 않는다 (`@lru_cache`).
9. raw audio/video를 불필요하게 영구 저장하지 않는다.

---

## LLM 호출 규칙 (Anthropic Python SDK)

모델은 `config.py`의 `EVAL_MODEL`(기본 `claude-sonnet-5`) / `PERSONALIZE_MODEL`(기본 `claude-haiku-4-5-20251001`)에서 읽는다. 하드코딩 금지.

**400 에러를 부르는 것들 — 절대 넣지 말 것:**
- `temperature` / `top_p` / `top_k` — Sonnet 5에서 비기본값은 400. 톤·다양성은 프롬프트로 제어한다.
- `thinking={"type": "enabled", "budget_tokens": N}` — 제거된 파라미터. 깊이 조절은 `output_config={"effort": ...}`.
- assistant prefill (마지막 턴을 `role: "assistant"`로 채우기) — 400. JSON 강제는 structured outputs로.

**해야 할 것:**
- JSON 응답은 `json.loads()` + try/except가 아니라 `client.messages.parse(output_format=<Pydantic 모델>)` 를 쓴다. 스키마 강제 + 검증이 한 번에 된다.
- `max_tokens`는 비스트리밍 기준 16000 근처. 너무 낮으면 응답이 잘린다.
- 짧고 빠른 호출(질문 개인화)은 `output_config={"effort": "low"}` 검토.
- 자세한 API 레퍼런스가 필요하면 `claude-api` 스킬을 먼저 읽는다.

---

## 주의사항

- **Next.js 16은 학습 데이터와 다르다.** `frontend/AGENTS.md`의 경고대로, 프론트 코드를 쓰기 전
  `frontend/node_modules/next/dist/docs/`의 해당 가이드를 먼저 읽는다.
- **질문은행 전체를 LLM에 넘기지 않는다.** 항목별 Random Pick(B) → 선택된 질문 1개만 개인화(A).
- **자소서에 없는 사실을 LLM이 생성하지 않도록** 프롬프트에 명시하고 수동 검수한다. Track A 신뢰도의 핵심.
- 테스트는 실제 LLM API를 호출하지 않는다. 응답을 mock하고, 실패 경로는 예외 주입으로 검증한다.
- `risk_level`(자소서 경험 위험도)은 허용되는 분석 지표다. 금지된 것은 Vision/Audio 점수화, 멀티모달 종합 점수,
  합격 가능성 예측, 채용 적합도 점수다 (plan.md §12).

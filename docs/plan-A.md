# InterReview — A 담당 실행 계획 (LLM · 자소서 분석)

> 상위 문서: [`docs/plan.md`](./plan.md) (최종 방향), [`docs/RoleDivision.md`](./RoleDivision.md) (역할 분담)
> 이 문서는 **A 담당(LLM·자소서 분석)** 의 작업 범위·설계·완료 기준만 다룬다.
> B 담당(면접·멀티모달) 영역은 "계약(Contract)" 절에서 인터페이스로만 언급한다.

---

## 1. 내 담당 범위

RoleDivision.md 기준 A 담당 = **Track A 전체 + 공용 LLM 기능**.

| # | 작업 | plan.md 대응 | 산출물 |
|---|------|--------------|--------|
| A-0 | 공용 LLM 레이어 (client / JSON validation / fallback) | §14-3, §14-6, §14-7 | `app/services/llm.py`, `app/prompts/` |
| A-1 | 자소서 주장/경험 분리 → 약점 → 예상 질문 | §2, Phase 1 | `POST /essay/analyze` |
| A-2 | Track A 결과 UI | §2 "UI" | `frontend/components/EssayView.tsx` |
| A-3 | 질문 개인화 LLM | §4.2, Phase 2 | `personalize_question()` (B가 호출) |
| A-4 | 답변 내용 판별 (good/partial/off_topic/insufficient) | §10, Phase 5 | `POST /answers/review` |

**내가 하지 않는 것**: 질문은행 Random Pick, 면접 세션/UI, STT, 발화속도·무음 계산, 시선 추출·Heatmap, 질문별 결과 화면 조립, E2E 통합. (전부 B 담당)

---

## 2. 현재 저장소 실태 (Phase 0 감사 결과)

이미 있는 것 — **다시 만들지 않는다**:

- `backend/app/config.py:50-52` — `ANTHROPIC_API_KEY`, `EVAL_MODEL`, `PERSONALIZE_MODEL` 이미 선언됨. `.env.example`에도 키가 있다.
- `backend/app/services/evaluate.py:258-261` — LLM 엔진 자리표시자(`pass`)가 비워져 있음. A-4가 이 자리를 메운다.
- `backend/app/services/questions.py` — 룰 기반 Random Pick 완성. 개인화 단계만 없음(파일 docstring에 "personalization will be reintroduced later" 명시).
- `backend/app/schemas.py` — 공용 Pydantic 스키마. **A/B 공유 파일**.
- `frontend/lib/api.ts`, `frontend/lib/types.ts` — 백엔드 스키마 미러. 여기도 공유.

없는 것 — **A가 만들어야 함**:

- `anthropic` 패키지가 `backend/pyproject.toml` 의존성에 없음 → 첫 작업은 의존성 추가.
- `app/services/llm.py`, `app/prompts/` 디렉터리 자체가 없음.
- 자소서 관련 라우터/스키마/UI 전무.

---

## 3. B 담당과의 계약 (Contract) — 착수 전 합의 필요

> ⚠️ **이 절은 코드를 쓰기 전에 B 담당과 합의한다.** 합의 없이 진행하면 `schemas.py` / `types.ts`를 두 번 고치게 된다.

### C-1. 점수 스키마 폐기 (파급 큼)

현재 `EvaluationReport`는 `total_score: int` + 항목별 `score: int`를 반환한다. 그런데 새 plan.md는

- §12 "Vision 점수화 / Audio 점수화 / 멀티모달 종합 점수" 를 **하지 않을 것**으로 명시
- §10 "여기서도 별도 숫자 점수는 만들지 않는다"
- §16 DoD "Vision/Audio에는 점수를 부여하지 않는다"

따라서 **`total_score` / `EvaluationItem.score` / `_score_delivery()`(시선 점수화)는 제거 대상**이다.

- 제거 범위: `schemas.py`의 `EvaluationItem`·`QuestionResult`·`EvaluationReport`, `services/evaluate.py` 전체, `frontend/lib/types.ts`, `frontend/components/AnalysisView.tsx`(점수 색상/총점 표시).
- 합의 사항: **A가 새 스키마를 정의하고, B가 결과 화면에서 소비한다.** `AnalysisView.tsx` 수정은 B 담당(질문별 결과 화면 소유자)이 맡는다.

### C-2. `EyeTrackingSummary` 필드 변경 (B 주도, A는 스키마만 확인)

현재 `front_gaze_ratio / face_detected_ratio / std_gaze` → plan.md §6은 `mean_gaze_x/y`, `gaze_std_x/y`, `valid_gaze_ratio` + Heatmap을 요구. **B가 정의하고 A는 건드리지 않는다.** 단 A-4의 답변 판별에는 시선 데이터가 전혀 들어가지 않으므로(내용만 판단) 의존성 없음.

### C-3. 질문 개인화 호출 경계

`POST /questions`는 B 소유 라우터다. A는 **부작용 없는 순수 함수 하나**만 제공한다:

```python
# app/services/personalize.py  (A 소유)
def personalize_question(
    profile: dict[str, Any],
    essay: str | None,
    question: Question,
) -> str:
    """개인화된 질문 한 문장. 실패 시 question.text 그대로 반환(fallback)."""
```

B는 `generate_questions()` 결과를 순회하며 이 함수를 호출해 `Question.text`를 갈아끼운다. **A는 `questions.py`와 `routers/questions.py`를 수정하지 않는다.**

### C-4. 파일 소유권 표

| 파일 | 소유 | 비고 |
|------|------|------|
| `app/services/llm.py`, `personalize.py`, `essay.py`, `answer_review.py` | **A** | 신규 |
| `app/prompts/*.py` | **A** | 신규 |
| `app/routers/essay.py`, `answers.py` | **A** | 신규 |
| `app/schemas.py` | **공유** | 변경 시 상대에게 알림. A는 Track A/답변판별 모델만 추가 |
| `app/services/questions.py`, `routers/questions.py`, `services/stt.py` | **B** | A는 read-only |
| `app/services/evaluate.py`, `routers/evaluate.py` | **A가 폐기·대체** | C-1 합의 후 |
| `frontend/components/EssayView.tsx`, `lib/essayApi 관련` | **A** | 신규 |
| `frontend/components/InterviewView.tsx`, `AnalysisView.tsx`, `SetupView.tsx` | **B** | A는 read-only |
| `frontend/components/InterviewApp.tsx`, `lib/api.ts`, `lib/types.ts` | **공유** | A는 Track A 진입점/타입만 추가 |

---

## 4. 공용 LLM 레이어 설계 (A-0)

plan.md §14 코드 원칙을 그대로 구현한다.

### 4.1 디렉터리

```text
backend/app/
├── prompts/
│   ├── __init__.py
│   ├── essay.py          # 자소서 분석 프롬프트
│   ├── personalize.py    # 질문 개인화 프롬프트
│   └── answer_review.py  # 답변 내용 판별 프롬프트
└── services/
    ├── llm.py            # 공용 client + 호출 래퍼 + fallback
    ├── essay.py          # A-1
    ├── personalize.py    # A-3
    └── answer_review.py  # A-4
```

원칙 §14-3(프롬프트/API 호출을 UI에서 분리), §14-5(`.env`에서 키), §14-6(JSON validation), §14-7(실패 시 fallback)을 이 구조가 만족한다.

### 4.2 클라이언트 (§14-8: 질문마다 모델 재로딩 금지)

`config.get_settings()`가 이미 `@lru_cache`이므로, 클라이언트도 동일하게 프로세스당 1회만 만든다.

```python
# app/services/llm.py
from functools import lru_cache
import anthropic

@lru_cache(maxsize=1)
def get_client() -> anthropic.Anthropic:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise LLMNotConfiguredError("ANTHROPIC_API_KEY가 설정되지 않았습니다.")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)
```

### 4.3 JSON 검증 — 파싱 대신 Structured Outputs

plan.md §14-6 "LLM JSON은 validation한다"를 **직접 파싱 + try/except로 구현하지 않는다.**
Anthropic Python SDK의 `client.messages.parse(output_format=<Pydantic 모델>)`가 스키마를 강제하고 검증된 객체를 돌려주므로, `json.loads()` 실패 경로 자체가 사라진다.

```python
resp = get_client().messages.parse(
    model=settings.eval_model,
    max_tokens=16000,
    system=ESSAY_SYSTEM_PROMPT,
    messages=[{"role": "user", "content": essay_text}],
    output_format=EssayAnalysis,   # Pydantic 모델
)
return resp.parsed_output            # 검증된 EssayAnalysis 인스턴스
```

### 4.4 모델 ID 및 호출 파라미터 주의사항

`.env.example`에 이미 `EVAL_MODEL=claude-sonnet-5`, `PERSONALIZE_MODEL=claude-haiku-4-5-20251001`이 지정돼 있다. 그대로 사용하되 아래를 지킨다.

- **`temperature` / `top_p` / `top_k` 금지.** `claude-sonnet-5`에서 비기본값을 넘기면 **400 에러**다. 톤·다양성은 프롬프트로 제어한다.
- **`thinking` 파라미터 미설정.** Sonnet 5는 생략 시 adaptive thinking이 기본 ON이다. 개인화처럼 짧고 빠른 호출은 비용 절감을 위해 `output_config={"effort": "low"}`를 검토한다.
- **assistant prefill 금지.** 마지막 턴을 `role: "assistant"`로 채우면 400이다. JSON 강제는 §4.3의 structured outputs로 한다.
- `max_tokens`는 비스트리밍 기준 16000 근처를 기본값으로 둔다(너무 낮으면 응답이 중간에 잘린다).

### 4.5 Fallback 정책 (§14-7)

| 호출 | 실패 시 동작 | 근거 |
|------|--------------|------|
| 자소서 분석 (A-1) | 재시도 1회 → 실패 시 HTTP 502 + 사용자용 메시지 | Track A는 이 결과가 전부라 대체값이 무의미 |
| 질문 개인화 (A-3) | 재시도 1회 → 실패 시 **원본 질문 반환** | plan.md §4.2 "실패 시 원문 질문 사용" 명시 |
| 답변 판별 (A-4) | 재시도 1회 → 실패 시 `answer_status="unavailable"` + 이유 문구 | plan.md §14-7 "LLM 실패 시 전체 면접이 종료되지 않도록" |

**A-3/A-4는 절대 예외를 위로 던지지 않는다.** 면접 진행 중 LLM 장애가 세션 전체를 죽이면 안 된다.

---

## 5. A-1: 자소서 분석

### 5.1 흐름 (plan.md §2)

```text
자기소개서 → LLM → 주장/경험 분리 → 경험별 위험도 → 약점 → 예상 질문
```

### 5.2 스키마 (`app/schemas.py`에 추가)

```python
class EssayWeakness(BaseModel):
    description: str                    # 약점 설명
    expected_questions: list[str]        # 이 약점에서 파생되는 예상 질문

class EssayExperience(BaseModel):
    experience: str                      # 경험 요약
    claims: list[str]                    # 이 경험이 뒷받침한다고 주장하는 것
    risk_level: int                      # 1~5, 면접에서 공격받을 가능성
    risk_reason: str
    weaknesses: list[EssayWeakness]

class EssayAnalysis(BaseModel):
    experiences: list[EssayExperience]   # 위험도 내림차순 정렬
    unsupported_claims: list[str]         # 경험 근거가 없는 주장

class EssayAnalyzeRequest(BaseModel):
    essay: str
    profile: dict[str, Any] = Field(default_factory=dict)
```

> `risk_level`은 **자소서 텍스트에 대한 분석 지표**이지 사용자 평가 점수가 아니다.
> plan.md §12가 금지한 것은 Vision/Audio 점수화와 합격 가능성 예측이며, §2는 "가능하면 위험도가 높은 경험부터 정렬한다"고 명시적으로 요구한다.

### 5.3 API

```text
POST /essay/analyze
  req: {"essay": "...", "profile": {...}}
  res: EssayAnalysis
```

### 5.4 프롬프트 규칙 (`prompts/essay.py`)

1. 문장을 `주장`과 `경험`으로 분리한다.
2. 경험 단위로 면접관이 파고들 약점을 추출한다 (기여도 불명확, 정량 결과 부재, 인과 비약 등).
3. 약점마다 예상 질문을 만든다.
4. **자소서에 없는 사실을 만들지 않는다.**
5. 답변을 대신 작성하지 않는다.

### 5.5 완료 기준 (plan.md Phase 1)

- [ ] 자소서 하나를 넣으면 경험별 분석 결과가 검증된 JSON으로 나온다
- [ ] `risk_level` 내림차순으로 확인할 수 있다
- [ ] 약점별 예상 면접 질문이 생성된다
- [ ] 근거 없는 주장이 `unsupported_claims`로 분리된다

---

## 6. A-2: Track A 결과 UI

최소 화면 (plan.md §2):

```text
자기소개서 입력 → [분석하기] → 위험도순 경험 카드 → 약점 → 예상 질문
```

- 신규 컴포넌트 `frontend/components/EssayView.tsx`
- `frontend/lib/api.ts`에 `analyzeEssay(essay, profile)` 추가, `lib/types.ts`에 위 스키마 미러
- `InterviewApp.tsx`의 `Phase` 유니온에 Track A 진입점 추가 — **여기가 B와 겹치는 유일한 프론트 파일이므로 최소 변경**(`"essay"` 상태 하나 추가)으로 끝낸다.

> ⚠️ `frontend/AGENTS.md` 경고: 이 프로젝트의 Next.js(16.2.10)는 학습 데이터와 API·규약이 다를 수 있다. 컴포넌트 작성 전 `frontend/node_modules/next/dist/docs/`의 해당 가이드를 먼저 읽는다.

완료 기준:
- [ ] 자소서를 붙여넣고 분석 결과를 위험도순으로 볼 수 있다
- [ ] 분석 중 로딩/에러 상태가 표시된다 (기존 `Busy` 컴포넌트 재사용)

---

## 7. A-3: 질문 개인화

### 7.1 입력/출력 (plan.md §4.2)

입력: 자기소개서, 지원 직무, 기술 스택, 프로젝트 경험, 선택된 원본 질문
출력: **개인화된 질문 한 문장**

### 7.2 규칙

- 원본 질문의 의도를 유지한다
- 자기소개서에 없는 경험을 만들지 않는다
- 답변을 생성하지 않는다
- 설명을 붙이지 않는다
- 한 문장 질문만 반환한다

### 7.3 구현 메모

- 질문은행 전체를 LLM에 넘기지 않는다 (plan.md §4.1). 함수 시그니처가 `Question` 하나만 받으므로 구조적으로 보장됨.
- 출력이 한 문장이므로 structured outputs 대신 짧은 텍스트 응답 + 후처리 검증(줄바꿈 제거, 길이 상한, 물음표 유무)이 더 저렴하다.
- 모델은 `PERSONALIZE_MODEL`(Haiku 4.5) 사용.
- 실패/재시도 1회 실패 → **원본 텍스트 그대로 반환**. 예외를 던지지 않는다.

완료 기준 (Phase 2):
- [ ] 원문 의도 유지
- [ ] 프로필에 없는 사실 생성 금지
- [ ] 실패 시 원문 fallback (테스트로 강제 검증)

---

## 8. A-4: 답변 내용 판별

### 8.1 입력 (plan.md §10)

자기소개서 + 현재 질문 + 사용자 답변 transcript → "질문에 올바르게 답변했는가?"

### 8.2 스키마

```python
AnswerStatus = Literal["good", "partial", "off_topic", "insufficient", "unavailable"]

class AnswerReview(BaseModel):
    answer_status: AnswerStatus
    reason: str
    missing_points: list[str]
    follow_up_question: str | None

class AnswerReviewRequest(BaseModel):
    question: str
    transcript: str
    essay: str | None = None
    profile: dict[str, Any] = Field(default_factory=dict)
```

`unavailable`은 plan.md의 4개 상태에 없는 **fallback 전용 값**이다(LLM 장애 시). UI에서는 "판단할 수 없음"으로 표시하고 통계에서 제외한다.

### 8.3 API

```text
POST /answers/review    # 질문 1개 단위
  req: AnswerReviewRequest
  res: AnswerReview
```

질문 단위로 나눈 이유: plan.md §5의 면접 진행이 "질문 표시 → 답변 → 처리 → 다음 질문" 순차 구조라, 답변 직후 바로 호출해 결과 화면 조립 시점의 지연을 없앨 수 있다. 전체 배치 호출이 필요하면 B가 이 엔드포인트를 N회 호출한다.

### 8.4 기존 `/evaluate` 처리

C-1 합의 후:
1. `services/evaluate.py`의 규칙 기반 점수 엔진 전체 삭제 (`_score_specificity`, `_score_structure`, `_score_relevance`, `_score_delivery`, `_rule_based_evaluate`)
2. `routers/evaluate.py` 삭제, `main.py:28`의 라우터 등록 제거
3. `backend/tests/test_evaluate.py` 삭제 후 `test_answer_review.py`로 대체

완료 기준 (Phase 5):
- [ ] 숫자 점수 없이 내용 피드백이 생성된다
- [ ] 4개 상태 중 하나가 반환된다
- [ ] LLM 실패 시 `unavailable`로 떨어지고 예외가 전파되지 않는다

---

## 9. 작업 순서

```text
Step 0  B와 계약 합의 (C-1 점수 폐기, C-3 개인화 경계)   ← 코드 작성 전 필수
Step 1  anthropic 의존성 추가 + services/llm.py + prompts/ 골격
Step 2  A-1 자소서 분석 (백엔드) → 테스트
Step 3  A-2 자소서 분석 UI
Step 4  A-3 질문 개인화 함수 → B에게 인계
Step 5  A-4 답변 판별 + 기존 evaluate 폐기
Step 6  A 담당 테스트 정리, B의 E2E에 합류
```

Step 2와 Step 4는 서로 의존하지 않으므로 순서를 바꿔도 된다. **Step 5는 C-1 합의 없이 착수하지 않는다.**

---

## 10. 테스트 (plan.md §15 중 A 담당분)

`backend/tests/` 에 추가. 기존 테스트는 `httpx` + FastAPI TestClient 패턴을 쓰고 있으므로 동일하게 맞춘다.

| 테스트 | 대상 | 방식 |
|--------|------|------|
| `test_essay.py::test_analysis_schema` | 자소서 분석 JSON parsing | LLM 응답 mock, 스키마 검증 |
| `test_essay.py::test_risk_sorted` | 위험도 정렬 | mock |
| `test_personalize.py::test_fallback_on_failure` | 개인화 실패 fallback | LLM 예외 주입 → 원문 반환 확인 |
| `test_personalize.py::test_single_sentence` | 한 문장 보장 | 여러 줄 응답 mock → 후처리 확인 |
| `test_answer_review.py::test_status_values` | 답변 판별 JSON validation | mock |
| `test_answer_review.py::test_unavailable_on_failure` | LLM 장애 시 세션 유지 | 예외 주입 |
| `test_config.py` (기존 확장) | LLM 설정 로딩 | 키 미설정 시 동작 |

**모든 테스트는 실제 API를 호출하지 않는다.** CI에서 키 없이 돌아야 하고, 비용도 들면 안 된다.

---

## 11. 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| C-1 미합의 상태로 진행 | `schemas.py`/`types.ts` 재작업 2회 | Step 0에서 먼저 합의 |
| `schemas.py` 동시 수정 충돌 | git conflict | A는 신규 모델만 append, 기존 모델 수정은 합의 후 |
| 프롬프트가 자소서에 없는 사실을 생성 | Track A 신뢰도 붕괴 | 프롬프트 명시 + 수동 검수 케이스 3건 이상 |
| LLM 비용 | 개인화가 질문당 1회 = 면접당 6회 | Haiku 4.5 + `effort: low` |
| Next.js 16 API 차이 | 프론트 작성 실패 | `node_modules/next/dist/docs/` 선독 |

---

## 12. A 담당 Definition of Done

plan.md §16 Track A 전체 + Track B 중 LLM 항목:

**Track A**
- [ ] 자기소개서를 입력할 수 있다
- [ ] 주장과 경험을 LLM이 분리한다
- [ ] 경험별 위험도를 반환한다
- [ ] 약점을 반환한다
- [ ] 예상 질문을 반환한다

**Track B 중 A 담당분**
- [ ] 질문이 자소서/프로필 기반으로 개인화된다
- [ ] 개인화 실패 시 원문 질문을 사용한다
- [ ] LLM이 답변 내용의 적합성을 판단한다
- [ ] 답변 판별에 숫자 점수를 부여하지 않는다

**공통**
- [ ] API key는 `.env`에서만 읽는다
- [ ] LLM JSON이 검증된다
- [ ] LLM 실패가 면접 세션을 종료시키지 않는다
- [ ] 프롬프트/API 호출 코드가 UI와 분리돼 있다

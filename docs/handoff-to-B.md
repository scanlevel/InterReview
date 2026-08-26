# A → B 인계 문서 (E2E 합류 준비)

> 상위 문서: [`docs/plan.md`](./plan.md) (최종 방향), [`docs/plan-A.md`](./plan-A.md) (A 담당 계획), [`docs/RoleDivision.md`](./RoleDivision.md) (역할 분담)
> A 담당(Track A + 공용 LLM) 작업이 끝났다. 이 문서는 B가 E2E 통합 시 필요한 것만 담는다.

---

## 1. 인계 요약 — A 담당 완료 상태

| # | 작업 | 산출물 | 상태 |
|---|------|--------|------|
| A-0 | 공용 LLM 레이어 (client / structured output / fallback) | `app/services/llm.py`, `app/prompts/` | 완료 |
| A-1 | 자소서 분석 (주장·경험 분리 → 약점 → 예상 질문) | `POST /essay/analyze` | 완료 |
| A-2 | Track A 결과 UI | `frontend/components/EssayView.tsx` | 완료 |
| A-3 | 질문 개인화 | `app/services/personalize.py` — `personalize_question()` | 완료 |
| A-4 | 답변 내용 판별 | `POST /answers/review` | 완료 |
| C-1 | 점수 스키마 폐기 | `/evaluate` 라우트·`services/evaluate.py`·점수 스키마 **삭제됨** | 완료 |

점수(숫자 평가)는 어디에서도 만들지 않는다 (plan.md §10·§12). LLM 실패는 어떤 경로에서도
면접 세션을 중단시키지 않는다 (plan.md §14-7) — 아래 계약의 fallback이 그 구현이다.

---

## 2. 질문 개인화 통합 방법 (C-3)

B가 질문 생성 직후 호출한다. 시그니처:

```python
from app.services.personalize import personalize_question

def personalize_question(
    profile: dict[str, Any],
    essay: str | None,
    question: Question,
) -> str: ...
```

- `generate_questions()` 결과를 순회하며 갈아끼운다:

  ```python
  questions = generate_questions(profile, seed)
  questions = [
      q.model_copy(update={"text": personalize_question(profile, essay, q)})
      for q in questions
  ]
  ```

- **try/except 불필요.** 이 함수는 예외를 절대 던지지 않는다 — LLM 미설정·호출 실패·
  응답 검증 실패(비어 있음, 200자 초과, `?`로 안 끝남) 전부 원문 `question.text`를 그대로 반환한다.
- 자소서가 없으면 `essay=None`을 넘긴다. 프로필만으로 개인화하거나 원문에 가깝게 유지된다.
- 모델은 `PERSONALIZE_MODEL`(기본 `claude-haiku-4-5-20251001`), 호출당 한 문장. 질문은행
  전체를 넘기지 말 것 — 선택된 질문 1개씩만 (plan.md §4.1).

---

## 3. 답변 내용 판별 계약 — `POST /answers/review`

요청(`AnswerReviewRequest`):

```json
{
  "question": "가장 기억에 남는 프로젝트 경험은 무엇인가요?",
  "transcript": "쇼핑몰 백엔드 프로젝트에서 주문 처리 모듈을 담당했습니다.",
  "essay": "자기소개서 본문 (선택, 없으면 생략 또는 null)",
  "profile": {}
}
```

- `essay`·`profile`은 선택. `profile`은 현재 프롬프트에서 사용하지 않지만 계약상 유지된다.
- `transcript`는 STT 결과를 그대로 넣는다. 발음·문장 어색함은 내용 판단에서 제외하도록
  프롬프트에 명시되어 있다.

응답(`AnswerReview`) — **항상 HTTP 200**:

```json
{
  "answer_status": "partial",
  "reason": "프로젝트 경험은 답했으나 본인 역할이 드러나지 않았다.",
  "missing_points": ["본인이 담당한 역할", "정량적 결과"],
  "follow_up_question": "그 프로젝트에서 직접 담당한 부분은 무엇인가요?"
}
```

- `answer_status`: `good` | `partial` | `off_topic` | `insufficient` | `unavailable`.
- `unavailable`은 LLM 장애·미설정 시 fallback 전용 값이다 (plan-A §8.2). UI에서는
  **"판단할 수 없음"으로 표시하고 통계·집계에서 제외**한다. LLM 판단 결과가 아니므로
  good/partial 등과 같은 축에 놓지 말 것.
- 실패 시에도 200이므로 프론트에서 상태 코드 분기가 필요 없다. (`/essay/analyze`는 다르다 —
  그쪽은 fallback이 없어 502/503을 반환한다.)

---

## 4. B가 갱신해야 할 프론트 파일 (C-1 후속)

백엔드 `/evaluate`가 삭제되어 지금 호출하면 **404**다. 다음을 갱신해야 한다:

| 파일 | 갱신 내용 |
|------|-----------|
| `frontend/lib/api.ts` | `evaluateInterview()`(`/evaluate` 호출) 제거, `/answers/review` 호출 함수로 대체 |
| `frontend/lib/types.ts` | `EvaluationItem`·`QuestionResult`·`EvaluationReport` 제거, 아래 미러 타입 추가 |
| `frontend/components/AnalysisView.tsx` | 점수 표시 제거, `AnswerReview` 기반 결과 화면으로 재작성 |
| `frontend/components/InterviewApp.tsx` | `evaluateInterview` 호출부(§`handleFinish`)를 질문별 `/answers/review` 호출로 교체 |

TS 미러 제안 (`backend/app/schemas.py`의 정의와 1:1):

```typescript
export type AnswerStatus =
  | "good"
  | "partial"
  | "off_topic"
  | "insufficient"
  | "unavailable";

export interface AnswerReview {
  answer_status: AnswerStatus;
  reason: string;
  missing_points: string[];
  follow_up_question: string | null;
}

export interface AnswerReviewRequest {
  question: string;
  transcript: string;
  essay?: string | null;
  profile?: Record<string, unknown>;
}
```

---

## 5. 테스트 현황

- backend pytest **54개 전부 통과** (`54 passed`, 실측 2026-08-24). 전부 LLM mock 기반이라
  API 키·네트워크 없이 돈다: `cd backend && uv run pytest`
- 파일별: test_essay 11 · test_llm 11 · test_answer_review 8 · test_personalize 8 ·
  test_stt 6 · test_config 5 · test_questions 5. (`test_evaluate.py`는 C-1과 함께 삭제됨.)
- 실패 경로(LLM 미설정·호출 실패·스키마 불일치·검증 실패)는 전부 예외 주입으로 검증되어 있다.
  B의 E2E에서 새로 검증할 것은 프론트 연결뿐이다.

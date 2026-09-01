# InterReview Track B 진행 현황

> 기준일: 2026-09-01
> 브랜치: `B/question_bank`
> 기준 커밋: `9ba8165 feat: add question personalization and answer coaching`
> 요구사항 기준: `docs/plan-B.md`

이 문서는 현재 브랜치의 Track B 구현과 검증 결과를 기록한다. 이번 범위는 질문 개인화와 질문별 답변 LLM coaching이며, 음성·시선 고도화와 저장·점수화는 포함하지 않는다.

## 구현 현황

| 항목 | 상태 | 근거 |
|---|---|---|
| 질문 6개 선택 | 완료 | 기존 `POST /questions`가 질문은행 6개 그룹에서 한 문항씩 선택한다. |
| 질문 개인화 | 완료 | 선택된 문항마다 기존 `personalize_question()`과 공용 `llm.call_text()`를 호출한다. `job`, `resume_text`, `technologies`, `projects`, 원본 질문을 문맥으로 사용한다. |
| 개인화 fallback | 완료 | LLM 미설정·호출·출력 검증 실패 시 해당 문항만 원본 질문을 유지한다. 원본은 `original_text`로 보존한다. |
| 답변 LLM feedback | 완료 | `POST /answers/review`가 원본 질문, 개인화 질문, profile, transcript를 받아 `summary`, `strengths`, `improvements`를 반환한다. |
| 실패·빈 답변 처리 | 완료 | 빈·짧은 transcript는 LLM을 호출하지 않으며, LLM 실패는 해당 질문만 unavailable 문구와 빈 배열로 반환한다. |
| 결과 화면 | 완료 | `AnalysisView`에서 개인화 질문, 원문, transcript, summary, strengths, improvements를 표시한다. |
| 음성·시선·STT | 기존 유지 | 이번 작업에서 고도화·계약 변경을 하지 않았다. |
| 점수·저장·비동기 최적화 | 제외 | 이번 작업 범위에 포함하지 않았다. |

## 현재 데이터 흐름

프로필 입력 → `POST /questions` → 6개 질문 선택 → 문항별 질문 개인화 → `InterviewView`에서 개인화 질문으로 답변 → `POST /measurements` → 질문별 `POST /answers/review` → 질문 결과 병합 → `AnalysisView`

원본 질문은 `original_text`/`original_question`, 개인화 질문은 `text`/`personalized_question`으로 review 단계까지 전달한다.

## 질문 개인화 계약

선택된 각 문항에 대해 기존 개인화 서비스가 다음 문맥을 사용한다.

- 지원 직무와 profile의 기타 값
- `resume_text`
- `technologies`
- `projects`
- 원본 질문

개인화 결과는 한 문장 질문인지, 길이 제한을 지키는지, 답변·힌트나 근거 없는 경력 표현을 포함하지 않는지 검증한다. 검증이나 LLM 호출이 실패하면 문항 단위로 원본 질문을 사용한다.

## Answer review 계약

요청:

~~~json
{
  "profile": {
    "job": "...",
    "resume_text": "...",
    "technologies": "...",
    "projects": "..."
  },
  "original_question": "...",
  "personalized_question": "...",
  "transcript": "..."
}
~~~

응답:

~~~json
{
  "summary": "...",
  "strengths": ["..."],
  "improvements": ["..."]
}
~~~

`summary`와 `strengths`는 transcript에 근거하도록 prompt에서 제한한다. `profile`과 이력서는 질문과 답변을 이해하기 위한 문맥일 뿐 답변 근거로 사용하지 않는다. `improvements`는 다음 답변에서 시도할 보완 방향이다. 점수·등급·합격/불합격·심리 추론·꼬리질문은 포함하지 않는다. 기존 클라이언트 호환을 위해 request의 `question`도 입력으로만 허용한다.

빈 transcript 또는 공백 제거 후 4자 미만인 답변은 안전한 기본 응답을 반환한다. LLM이 설정되지 않았거나 호출에 실패하면 HTTP 오류로 전체 면접을 중단하지 않고 해당 질문의 feedback만 unavailable 응답으로 반환한다.

## 결과 화면

`AnalysisView`는 질문별로 다음을 표시한다.

1. 개인화 질문과 원본 질문(서로 다를 때)
2. STT transcript
3. `summary`
4. `strengths`
5. `improvements`

이번 작업에서는 음성·시선 표시 구조와 측정 계약을 변경하지 않았고, 점수나 등급을 표시하지 않는다.

## 검증 결과

구현 중 다음 검증을 실행했다.

~~~text
backend ruff: passed
backend pytest: 70 passed
answer_review/personalize targeted pytest: 26 passed
frontend TypeScript: passed
frontend ESLint: passed
frontend production build: passed
frontend gaze tests: 13 passed
frontend audio tests: 3 passed
~~~

이번 문서 커밋 직전에는 테스트를 다시 실행하지 않았다. 실제 LLM·카메라·마이크 기반 E2E는 수행하지 않았다.

## 남은 작업과 제한

1. 실제 LLM API를 사용한 prompt 품질과 응답 사례 검증이 필요하다.
2. 실제 한국어 transcript를 포함한 answer_review E2E가 필요하다.
3. 카메라·마이크·외부 STT E2E는 별도 환경에서 확인해야 한다.
4. 음성·시선 고도화, 질문별 background job, DB/history, percentile, Rule-based scoring은 후속 범위다.

## 로컬 실행

백엔드:

~~~powershell
cd D:\Projects\InterReview\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
~~~

프론트엔드:

~~~powershell
cd D:\Projects\InterReview\frontend
npm.cmd run dev -- --hostname localhost
~~~

접속 주소: `http://localhost:3000`

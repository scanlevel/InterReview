# InterReview Agent Rules

이 저장소는 Track A와 Track B를 분리해 작업한다. 작업을 시작하기 전에 담당 범위와 관련 계획을 먼저 읽는다.

## 문서 우선순위

1. 사용자의 현재 요청
2. docs/RoleDivision.md
3. docs/plan.md
4. 담당별 실행 계획
   - A 담당: docs/plan-A.md
   - B 담당: docs/plan-B.md
5. 기존 코드와 주석

계획과 구현이 다르면 구현을 기준으로 계획을 다시 쓰지 않는다. 먼저 차이를 보고하고 담당 간 계약을 확인한다.

## 역할

### A 담당

- Track A 자소서 분석
- 공용 LLM 클라이언트와 프롬프트
- 질문 개인화 함수
- 답변 내용 판별
- LLM JSON validation과 fallback

A 담당은 B 소유 면접 세션, STT, VAD, 시선, Heatmap, 결과 화면을 임의로 수정하지 않는다.

### B 담당

- 질문은행 항목별 Random Pick과 POST /questions
- 면접 세션·장치·질문 진행 UI
- 기존 STT 유지와 질문별 연결
- 발화시간·발화속도·무음 계산
- 시선 추출 안정화·Heatmap·표준편차
- 질문별 결과와 전체 세션 측정값
- Track B E2E 통합

B 담당은 A 소유 자소서 분석, 공용 LLM 구현, 답변 내용 판별 프롬프트를 임의로 재작성하지 않는다.

## 공유 파일

다음 파일은 A/B 공유 계약이다.

~~~text
backend/app/schemas.py
backend/app/main.py
frontend/lib/types.ts
frontend/lib/api.ts
frontend/components/InterviewApp.tsx
~~~

공유 타입을 삭제하거나 기존 필드를 바꿀 때는 상대 담당 계약을 먼저 확인한다. 신규 모델·함수는 가능한 한 append한다.

## 확정 제품 규칙

- follow-up 질문을 생성하거나 표시하지 않는다.
- Vision, Audio, 멀티모달 숫자 점수를 만들지 않는다.
- 답변 내용은 상태·이유·빠진 내용으로 표시한다.
- 시선과 음성은 측정값과 시각화로만 표시한다.
- 참고 평균과 사용자 측정값을 비교해 우열을 판단하지 않는다.
- 기존 STT를 유지한다.
- 질문은행 전체를 LLM에 전달하지 않는다.
- 질문은행 데이터는 코드와 별도로 관리한다.
- raw audio/video를 불필요하게 영구 저장하지 않는다.
- API key는 환경변수에서만 읽고 커밋하지 않는다.

## 오류 처리

- 질문 개인화 실패 시 원문 질문을 사용한다.
- STT 실패가 면접 세션을 종료시키면 안 된다.
- 시선 측정값이 없으면 빈 요약을 반환한다.
- 답변 내용 판별 실패는 “판단 불가”로 표시하고 세션을 유지한다.
- fallback을 위해 사실이나 transcript를 만들어내지 않는다.

## 테스트

- 실제 LLM API는 기본 테스트에서 mock한다.
- 실제 카메라·마이크·외부 API E2E는 명시적으로 승인된 환경에서만 수행한다.
- 정적·단위 테스트 결과를 실제 장치 E2E 완료로 표현하지 않는다.
- 프론트 작업에서는 중첩된 frontend/AGENTS.md 규칙도 함께 따른다.

## 범위 밖

- 런타임 벤치마크와 gold dataset 구축
- 감정·성격 분석
- 합격 가능성·채용 적합도 예측
- 질문은행 데이터 제작·업로드
- 승인 없는 대규모 refactor

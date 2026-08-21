# InterReview — B 담당 실행 계획 (면접 · 멀티모달)

> 상위 문서: docs/plan.md
> 역할 분담: docs/RoleDivision.md
> A 담당 계약: docs/plan-A.md
> 이 문서는 B 담당 범위와 완료 기준을 구현 상태와 독립적으로 정의한다.
> 아래 체크박스는 현재 구현 여부가 아니라 B 작업의 요구사항이다.

---

## 1. B 담당 범위

RoleDivision.md 기준 B 담당은 Track B 실행 파이프라인 전체다.

| # | 작업 | 상위 계획 대응 | B 산출물 |
|---|---|---|---|
| B-0 | 현재 저장소와 A/B 계약 확인 | plan.md Phase 0 | 충돌 없는 작업 경계 |
| B-1 | 질문은행 항목별 Random Pick | plan.md §4, Phase 2 | 질문 선택 서비스와 POST /questions 연결 |
| B-2 | 면접 세션·장치·질문 진행 UI | plan.md §5 | setup → interview 상태 흐름 |
| B-3 | 기존 STT 유지 및 질문별 연결 | plan.md §9, Phase 3 | 녹음 → WAV → STT → transcript |
| B-4 | 발화시간·발화속도·무음 계산 | plan.md §7~8 | 질문별 SpeechMetrics |
| B-5 | 시선 추출 안정화·Heatmap | plan.md §6, Phase 4 | 질문별 EyeTrackingSummary |
| B-6 | 질문별 결과·세션 요약 화면 | plan.md §10~11, Phase 6 | 내용·음성·시선 통합 UI |
| B-7 | 전체 E2E 통합 | plan.md Phase 7 | 처음부터 결과 화면까지 완주 |

B는 질문은행 선택부터 면접 종료 결과 화면까지의 실행 흐름을 소유한다.

---

## 2. 담당 경계

### B가 소유하는 영역

- 질문은행 로딩, 항목별 필터링, Random Pick, 중복 방지
- POST /questions 라우터와 질문 순서
- 카메라·마이크 장치 확인 및 면접 세션 상태
- 질문별 녹음, WAV 변환, 기존 STT 호출과 transcript 연결
- VAD, 발화시간, 발화속도, 무음 측정
- MediaPipe 기반 시선 좌표, 유효 프레임 처리, Heatmap
- 질문별 결과 화면과 전체 세션 측정값 요약
- Track B E2E 통합

주요 B 소유 파일:

~~~text
backend/app/services/questions.py
backend/app/routers/questions.py
backend/app/services/stt.py
backend/app/routers/stt.py
frontend/components/SetupView.tsx
frontend/components/DeviceSetupView.tsx
frontend/components/InterviewView.tsx
frontend/components/AnalysisView.tsx
frontend/lib/recorder.ts
frontend/lib/gaze.ts
~~~

### A가 제공하고 B가 소비하는 영역

- 공용 LLM 클라이언트와 JSON validation
- 선택된 질문 한 건의 개인화 함수
- 답변 내용 판별
- LLM 장애 fallback 계약

B는 질문은행 전체를 LLM에 전달하지 않는다. Random Pick 이후 선택된 질문만 A의 개인화 함수에 넘긴다.

### 공유 파일

~~~text
backend/app/schemas.py
backend/app/main.py
frontend/lib/types.ts
frontend/lib/api.ts
frontend/components/InterviewApp.tsx
~~~

공유 파일은 기존 정의를 일방적으로 변경하지 않는다. B는 SpeechMetrics, EyeTrackingSummary, 면접 결과 소비 계약을 제안하고 A와 합의한다.

---

## 3. 확정 제품 결정

다음 결정은 plan.md의 예시보다 우선하는 Track B 확정사항이다.

1. follow-up 질문은 생성하거나 결과 화면에 표시하지 않는다.
2. 숫자 점수, 감점, 멀티모달 종합 점수를 만들지 않는다.
3. 답변 내용은 상태, 이유, 빠진 내용만 표시한다.
4. 시선과 음성은 측정값과 시각화만 표시한다.
5. 참고 평균과 사용자 측정값을 비교해 우열을 판단하지 않는다.
6. 기존 STT를 유지하고 새로운 STT 모델로 교체하지 않는다.
7. 질문은행 데이터 내용은 별도 관리한다. B는 로더와 선택 로직만 소유한다.
8. raw audio/video를 불필요하게 영구 저장하지 않는다.
9. 얼굴 검출·유효 프레임·정면 응시 비율과 평균/표준편차는 외부 결과 계약에 포함하지 않는다.
10. 시선 피드백은 질문별 Heatmap으로 제공하고, 보정·평활화 값은 내부 처리에만 사용한다.

---

## 4. 질문 생성 계약

### 4.1 Random Pick

질문은행은 다음 여섯 서비스 항목으로 취급한다.

~~~text
자기소개·이력
가치관·성향
직무·기술
문제 해결
협업·조직생활
지원동기·직무몰입
~~~

한 세션에서 각 항목별 질문 하나를 선택한다.

요구사항:

- 항목마다 후보를 먼저 필터링한다.
- 항목별로 독립적인 Random Pick을 수행한다.
- 같은 question_id가 한 세션에서 중복되지 않는다.
- 선택된 원문을 보존한다.
- 질문은행 전체를 LLM에 보내지 않는다.
- 질문은행 파일이 없거나 항목 후보가 비었으면 명시적인 오류를 반환한다.
- 질문은행 데이터 추가·교체는 코드 변경과 분리한다.

### 4.2 A 개인화 함수와의 경계

A가 제공하는 계약:

~~~python
def personalize_question(
    profile: dict,
    essay: str | None,
    question: Question,
) -> str:
    """개인화된 질문 한 문장. 실패 시 원문 질문을 반환한다."""
~~~

B의 책임:

- Random Pick을 먼저 수행한다.
- 선택된 질문과 지원자 맥락만 A 함수에 전달한다.
- 개인화 질문과 원문 질문을 모두 결과에 보존한다.
- A 함수 실패가 면접 세션을 종료시키지 않도록 원문을 사용한다.

질문 최소 계약:

~~~text
question_id
category
subcategory
experience
text
original_text
~~~

---

## 5. 면접 세션과 UI

### 5.1 상태 흐름

~~~text
프로필 입력
→ 질문 생성
→ 장치 선택·권한 확인
→ 시선 캘리브레이션
→ 질문별 면접
→ 질문별 처리
→ 전체 결과
~~~

질문별 흐름:

~~~text
질문 표시
→ 녹음·시선 수집 시작
→ 답변
→ 답변 종료
→ WAV·VAD·시선 요약 생성
→ STT
→ A 답변 내용 판별
→ 다음 질문
~~~

### 5.2 세션 요구사항

- 질문을 순서대로 진행한다.
- 사용자가 답변 시작과 종료를 명시적으로 제어할 수 있다.
- 질문 이동 시 이전 질문의 transcript와 측정값을 잃지 않는다.
- STT나 LLM 실패가 다음 질문 진행을 막지 않는다.
- 카메라·마이크 권한 거부와 장치 없음 상태를 표시한다.
- 실제 장치 사용은 localhost 또는 HTTPS 환경을 전제로 한다.
- 카메라 미리보기 좌우반전이 분석 좌표를 뒤집지 않도록 분리한다.

---

## 6. Audio + STT

### 6.1 기존 STT 유지

RoleDivision.md의 “기존 STT 유지”를 따른다. B는 STT 공급자를 교체하거나 별도 모델을 추가하지 않는다.

~~~text
브라우저 녹음
→ WAV 16 kHz mono
→ 기존 백엔드 STT
→ transcript
~~~

요구사항:

- 질문별 오디오만 전송한다.
- 빈 오디오, 무음, 키 미설정, 외부 API 오류를 구분한다.
- STT 오류를 사용자에게 표시하되 세션은 유지한다.
- API 키는 백엔드 환경변수에서만 읽는다.
- 질문마다 서버 모델이나 클라이언트를 새로 생성하지 않는다.

### 6.2 발화·무음 측정

Audio VAD를 Track B의 기준 측정 방식으로 사용한다. STT word timestamp가 제공되더라도 필수 의존성으로 두지 않는다.

질문별 SpeechMetrics:

~~~text
total_duration_sec
speech_duration_sec
speech_rate_eojeol_per_min
silence_duration_sec
silence_ratio
long_pause_count
max_pause_sec
long_pause_threshold_sec
~~~

계산 규칙:

- 총 답변 시간은 녹음된 전체 오디오 길이다.
- 실제 발화 시간은 VAD가 speech로 판정한 프레임 합이다.
- 무음 시간은 총 답변 시간에서 실제 발화 시간을 뺀 값이다.
- 무음 비율은 무음 시간 / 총 답변 시간이다.
- 발화 속도는 STT transcript의 어절 수 / 실제 발화 시간 × 60이다.
- 긴 무음 기준은 설정값으로 관리하며 기본 참고값은 2초다.
- 빈 오디오에서는 0 또는 null을 일관되게 반환하고 NaN/Infinity를 만들지 않는다.

참고값:

~~~text
평균 답변 길이: 약 131어절
평균 답변 시간: 약 90초
상한 참고: 약 120초
~~~

참고값은 설명용이며 점수나 권장 판정으로 변환하지 않는다.

---

## 7. Vision

### 7.1 목적

MediaPipe Face Landmarker로 질문별 시선 패턴을 측정하고 사용자가 직접 확인할 수 있도록 한다.

질문별 EyeTrackingSummary:

~~~text
gaze_heatmap
~~~

Heatmap 최소 계약:

~~~text
columns
rows
counts
total
~~~

### 7.2 안정화 요구사항

- 질문 녹음 구간에만 시선 샘플을 누적한다.
- 프레임 timestamp가 매 세션에서 단조 증가하도록 초기화한다.
- 얼굴 미검출, 눈 간격 부족, 양안 불일치, 비정상 좌표를 유효 샘플에서 제외한다.
- 카메라 preview의 CSS 좌우반전과 분석 좌표계를 분리한다.
- 원시 시선 좌표에는 시간축 EMA 평활화를 적용해 저화질·원거리 얼굴의 순간적인 떨림을 줄인다.
- 캘리브레이션은 3×3 그리드 9점을 사용하고, 각 점마다 `중앙 → 목표점 → 중앙` 순서로 진행한다.
- 점 이동 시간은 정규화 화면 거리 / 고정 속도로 계산해 가까운 점과 먼 점의 이동 속도를 같게 한다.
- 각 목표점에서 안정화·수집한 샘플의 중앙값으로 화면 좌표 보정을 만든다.
- 유효 좌표만 Heatmap 범위에 clamp·누적한다.
- 유효 샘플이 없어도 예외 없이 빈 요약을 반환한다.
- 얼굴 검출은 시선 추출의 내부 전제와 디버그 상태로만 사용하며 검출 비율은 출력하지 않는다.
- 원본 video frame이나 얼굴 landmark 전체를 서버에 영구 저장하지 않는다.

시선 측정값은 점수와 성격·감정·합격 가능성 추론에 사용하지 않는다.

---

## 8. 답변 내용 판별 계약

A가 답변 내용 판별을 소유한다. B는 질문과 transcript를 전달하고 결과를 표시한다.

입력:

~~~text
자기소개서 또는 프로필
현재 질문
사용자 답변 transcript
~~~

내용 상태:

~~~text
good
partial
off_topic
insufficient
~~~

출력:

~~~text
answer_status
reason
missing_points
~~~

확정사항:

- follow_up_question은 B 계약에서 제외한다.
- 숫자 점수는 받거나 표시하지 않는다.
- 시선·음성 측정값을 답변 내용 판별 입력으로 사용하지 않는다.
- A가 unavailable fallback을 제공하면 B는 “내용 판단 불가”로 표시하고 내용 통계에서 제외한다.
- LLM 실패가 질문 진행이나 최종 결과 화면을 막지 않는다.

A 계획의 POST /answers/review 계약을 우선한다. B가 별도의 LLM 평가 엔진을 만들지 않는다.

---

## 9. 질문별 결과 화면

각 질문은 다음 세 영역을 표시한다.

~~~text
질문
질문은행 원문
답변 transcript

[내용]
- 답변 상태
- 이유
- 빠진 내용

[음성]
- 총 답변 시간
- 실제 발화 시간
- 발화 속도
- 무음 시간·비율
- 긴 무음 횟수
- 최대 무음 시간

[시선]
- Heatmap
~~~

누락된 측정값은 0으로 꾸미지 않고 “측정값 없음”으로 표시한다.

---

## 10. 전체 세션 요약

최종 화면은 참고값과 이번 세션의 평균 측정값을 있는 그대로 제공한다.

~~~text
ICT 참고 평균 답변시간
ICT 참고 평균 답변 어절
내 평균 총 답변시간
내 평균 실제 발화시간
내 평균 답변 어절
내 평균 무음시간·무음비율
내 평균 긴 무음 횟수
~~~

시선은 질문별 Heatmap에서 확인하며, 세션 요약에 얼굴 검출률·유효률·정면 응시율·평균·표준편차를 추가하지 않는다.

금지사항:

- 평균 사용자보다 좋음/나쁨 판정
- 권장 범위 이탈 경고
- 수치를 점수로 변환
- 합격 가능성이나 채용 적합도 추론

질문별 유효 측정값만 평균에 포함하고, 값이 하나도 없으면 null로 표시한다.

---

## 11. API와 데이터 흐름

B가 기대하는 전체 흐름:

~~~text
POST /questions
  B Random Pick
  → A personalize_question
  → 질문 목록

질문별 브라우저 처리
  녹음 → SpeechMetrics
  시선 → EyeTrackingSummary
  WAV → 기존 STT → transcript

POST /answers/review
  A 내용 판별
  → answer_status / reason / missing_points

프론트엔드
  질문별 결과 보관
  → 최종 결과 화면과 세션 평균 조립
~~~

B는 별도 벤치마크 라우터, 벤치마크 UI, gold dataset 실행 경로를 애플리케이션 런타임에 추가하지 않는다.

---

## 12. 오류와 fallback

| 상황 | B 동작 |
|---|---|
| 질문은행 없음·항목 비어 있음 | 질문 생성 실패를 명시적으로 표시 |
| 질문 개인화 실패 | 원문 질문 사용 |
| 녹음 데이터 없음 | transcript와 측정값 없음으로 기록 |
| STT 미설정·실패 | 빈 transcript와 STT 상태를 보존하고 진행 |
| 얼굴·눈 시선 샘플 없음 | 빈 시선 요약을 보존하고 진행 |
| A 답변 판별 실패 | 내용 판단 불가로 표시하고 진행 |
| 일부 질문 처리 실패 | 성공한 질문 결과는 유지 |
| 최종 세션 평균 대상 없음 | null 또는 “측정값 없음” 표시 |

---

## 13. 테스트

### Backend

- 항목별 Random Pick
- 한 세션 질문 중복 방지
- 질문은행 누락·빈 항목 오류
- 개인화 실패 시 원문 fallback
- STT 빈 오디오·키 미설정·오류 응답
- SpeechMetrics/EyeTrackingSummary 스키마 validation
- 숫자 점수와 follow-up 필드가 B 계약에 없음

### Frontend

- WAV 16kHz mono 생성
- VAD 발화·무음·긴 무음 계산
- 빈 오디오와 0초 입력
- Vision empty/invalid frame 처리
- Heatmap bin 누적
- 시선 EMA 평활화와 반복 이동 캘리브레이션
- 질문 이동 시 결과 보존
- 질문별 결과 렌더링
- 측정값 없는 항목 표시
- production build와 TypeScript 검사

### E2E

~~~text
프로필 입력
→ 질문 Random Pick
→ 질문 개인화
→ 장치 설정
→ 질문별 답변
→ STT
→ 음성·시선 측정
→ A 내용 판별
→ 질문별 결과
→ 전체 세션 요약
~~~

실제 카메라·마이크·외부 API를 포함한 E2E는 명시적으로 승인된 장치 환경에서 수행한다. 정적·단위 검증만으로 실제 장치 E2E 완료를 주장하지 않는다.

---

## 14. 하지 않을 것

- 질문은행 데이터 자체 제작·업로드
- A 소유 자소서 분석 UI와 API 구현
- 별도 LLM 클라이언트 또는 프롬프트 엔진 구현
- 기존 STT 공급자 교체
- Vision/Audio/멀티모달 숫자 점수
- follow-up 질문
- 감정·성격 분류
- 합격 가능성·채용 적합도 예측
- 런타임 벤치마크 기능
- raw audio/video 영구 저장
- 대규모 refactor

---

## 15. 작업 순서

~~~text
Step 0  A/B 공유 계약 확인
Step 1  질문은행 Random Pick과 질문 계약
Step 2  면접 세션·장치 흐름
Step 3  질문별 녹음·기존 STT 연결
Step 4  VAD·발화 지표
Step 5  시선 안정화·반복 이동 캘리브레이션·Heatmap
Step 6  A 개인화·답변 판별 계약 연결
Step 7  질문별 결과와 세션 요약
Step 8  단위·정적 검증
Step 9  승인된 장치 환경에서 E2E
~~~

Step 6 전에도 B의 음성·시선 파이프라인은 독립적으로 검증할 수 있다. A 계약은 mock으로 대체하되 production fallback을 새로 만들지는 않는다.

---

## 16. B 담당 Definition of Done

- [ ] 항목별 Random Pick이 동작한다.
- [ ] 한 세션에서 질문이 중복되지 않는다.
- [ ] 선택된 원문 질문이 보존된다.
- [ ] A 개인화 실패 시 원문 질문을 사용한다.
- [ ] 카메라·마이크 장치 선택과 권한 상태가 표시된다.
- [ ] 질문별 녹음이 WAV 16kHz mono로 처리된다.
- [ ] 기존 STT가 질문별 transcript를 반환한다.
- [ ] 발화 속도가 출력된다.
- [ ] 총 답변시간과 실제 발화시간이 출력된다.
- [ ] 무음 시간·비율·긴 무음 횟수·최대 무음이 출력된다.
- [ ] 질문별 시선 Heatmap이 출력된다.
- [ ] 저화질·원거리 입력에 대비한 시선 EMA 평활화가 적용된다.
- [ ] 9점 중앙 왕복 캘리브레이션과 중앙값 기반 화면 좌표 보정이 적용된다.
- [ ] A의 내용 상태·이유·빠진 내용을 표시한다.
- [ ] follow-up 질문을 생성·표시하지 않는다.
- [ ] 숫자 점수와 우열 판단을 생성·표시하지 않는다.
- [ ] 질문별 결과를 한 화면에서 확인한다.
- [ ] 참고 평균과 세션 평균 측정값을 그대로 확인한다.
- [ ] 일부 외부 호출 실패에도 면접 세션을 완료할 수 있다.
- [ ] 실제 장치 E2E를 완료하거나 미실시 상태를 명시한다.

---

## 17. 구현 감사 원칙

이 문서를 먼저 확정한 다음 현재 구현을 대조한다.

감사 결과는 다음 셋으로만 분류한다.

~~~text
충족
부분 충족
미충족
~~~

구현에 이미 존재한다는 이유로 이 계획의 요구사항을 변경하지 않는다. 구현이 계획과 다르면 구현 차이 또는 A/B 계약 차이로 기록한다.

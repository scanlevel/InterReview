# B에게 전달: A 작업 중 공유/B 파일 변경 내역

작성일: 2026-09-07 · 작성: A (LeeJongWon) · 브랜치: `LeeJW`

A 담당 작업(Track A 자소서 첨삭) 중 공유 파일과 B 소유 파일에 생긴 변경을 정리한다.
**1~3은 이미 LeeJW에 푸시된 append성 변경(공지)**이고, **4는 아직 커밋 전이며 B 소유
파일 수정이 포함되어 있어 합의가 필요**하다.

---

## 1. 커밋 `48910e4` — 라우트 분리 & 자소서 연동

- **`frontend/components/InterviewApp.tsx`** (공유)
  - 홈(/) · 자소서 첨삭(/essay) · 모의 인터뷰(/interview) 라우트 분리에 따라
    essay phase와 "자소서 첨삭 먼저 하기" 버튼 제거. `<InterviewApp />`은
    `/interview` 페이지에서 렌더된다.
  - 헤더 h1에 홈으로 가는 `<Link>` 추가.
  - 첨삭 탭에서 넘어온 자소서를 setup 단계에서 배너로 보여주고, 자소서 미입력 시
    `profile.resume_text`로 합쳐 넣는 연동 로직 추가. (→ 4에서 구조 변경됨)
- PR/merge 잔재였던 중복 `Phase` 타입 선언 1개 제거 (TS 중복 식별자 에러).
- 참고: `frontend/next.config.ts`에 `experimental.proxyTimeout: 180_000` 추가
  — LLM 분석이 Next dev 프록시 기본 30초 타임아웃에 걸려 500이 나던 문제 수정.

## 2. 커밋 `310d3e7` — 분석 근거 문장(source_quotes)

- **`backend/app/schemas.py`** (공유, append만)
  - `EssayExperience.source_quotes: list[str] = []` 추가
  - `EssayWeakness.source_quotes: list[str] = []` 추가
  - 용도: 분석 결과가 어느 원문 문장에서 나왔는지 프론트에서 하이라이트 매칭.
- **`frontend/lib/types.ts`** (공유, append만)
  - `EssayExperience` / `EssayWeakness`에 동일한 `source_quotes: string[]` 추가.
- 기존 필드는 변경 없음. B 코드에 영향 없음(기본값 빈 리스트).

## 3. 커밋 `1dfab7f` — 문항형(질문+답변) 자소서 입력

- **`backend/app/schemas.py`** (공유, append만)
  - `EssayQAItem` 모델 신규 (question ≤1,000자·비워도 됨 / answer 필수).
  - `EssayAnalyzeRequest.items: list[EssayQAItem] = []` 추가.
    `essay` 필드는 그대로 필수라 기존 호출 방식은 깨지지 않는다.
- **`frontend/lib/types.ts`** (공유, append만)
  - `EssayQAItem` 인터페이스 추가.
- **`frontend/lib/api.ts`** (공유)
  - `analyzeEssay(essay, profile, items?)` — 선택 파라미터 `items` 추가.
    기존 두-인자 호출은 그대로 동작한다.
- A 소유 신규 파일: `frontend/components/EssayDraftEditor.tsx` (문항별/자유형식
  자소서 편집기 — 4에서 SetupView도 사용하게 됨).

## 4. ⚠️ 커밋 전 — 두 탭 입력 구조 통일 (B 합의 필요)

목표: 모의면접 정보 입력 화면과 자소서 첨삭 입력 페이지의 입력 구조를 동일하게
만들고, 자소서·이름·직무를 두 탭이 sessionStorage로 공유한다.

- **`frontend/components/SetupView.tsx`** (**B 소유 — 합의 요청**)
  - "자기소개·이력" textarea → 공용 `EssayDraftEditor`로 교체
    (문항별 입력 ↔ 자유 형식 토글, 문항 추가/삭제).
  - **"기술 스택"·"프로젝트 경험" 필드 삭제** — 자소서 내용에 포함된다는 판단.
  - 이름/직무/자소서 값은 로컬 state 대신 props(`applicant`, `draft` +
    change 핸들러)로 받는다. 제출 시 `resume_text`에는 문항을 합친
    `"[문항 N] 질문\n답변"` 텍스트가 들어간다.
- **`frontend/components/InterviewApp.tsx`** (공유)
  - 자소서 연동 배너·연동 해제 버튼·머지 로직 제거 — 자소서가 설정 화면에
    직접 보이므로 필요 없어짐.
  - 공유 draft(`interreview.essay.draft`)와 이름·직무
    (`interreview.essay.applicant`)를 읽고 저장해 SetupView에 내려준다.
- **`frontend/lib/essayStore.ts`** (A 소유, 참고)
  - handoff 슬롯(`interreview.interview.essay`) 제거, `ApplicantInfo` 슬롯 추가.

## 5. ⚠️ 커밋 전 — 면접 진행 중 질문 사이 대기 화면 (B 합의 필요)

- **`frontend/components/InterviewView.tsx`** (**B 소유 — 합의 요청**)
  - 질문 화면 하단의 "다음 질문"/"제출하고 결과 보기" 버튼을 **"답변 완료"**
    버튼으로 교체. 누르면 대기 화면(intermission)으로 전환된다.
  - 대기 화면: "질문 N 답변이 끝났습니다" 안내 + **[다시 답변하기]** /
    **[다음 질문으로]**(마지막 질문이면 **[제출하고 결과 보기]**) 버튼.
    다시 답변하면 기존 답변·측정값은 유지되고 재녹음 시 덮어쓴다.
  - 대기 중에도 질문 화면 UI는 `display:none`으로 마운트를 유지한다 —
    언마운트하면 카메라 `<video>`·시선 트래커 참조가 끊어지기 때문.
    녹음/전사/시선/이전 버튼 로직은 변경 없음.

### B에게 묻는 것

1. SetupView 변경(위 내용) 그대로 진행해도 되는지.
2. `frontend/lib/types.ts`의 `Profile.technologies` / `Profile.projects` —
   이제 채우는 곳이 없는 죽은 필드다. 함께 삭제해도 되는지 (공유 파일이라
   기존 정의 삭제는 합의 대상). 백엔드는 `profile: dict[str, Any]`라 영향 없음.
3. 질문 개인화 프롬프트가 technologies/projects 키를 특별 취급한다면 알려달라
   — 현재 검색으로는 참조처가 타입 정의 두 줄뿐이었다.
4. InterviewView 대기 화면 변경(5번) 그대로 진행해도 되는지.

### 영향 범위 요약

- B 소유 화면(InterviewView, AnalysisView, DeviceSetupView)과 백엔드
  questions/stt 서비스는 건드리지 않았다.
- `generateQuestions` 요청 shape 변화: `technologies`/`projects`가 더 이상
  전송되지 않고, `resume_text`에 `[문항 N]` 머리글이 붙은 텍스트가 올 수 있다.

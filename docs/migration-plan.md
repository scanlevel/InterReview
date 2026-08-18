# InterReview — Next.js + FastAPI 전환 계획

> Streamlit → Next.js(프론트) + FastAPI(백엔드) 마이그레이션
> 브랜치: `new_framework` (base: `LeeJW`) · 최종 갱신: 2026-07-19

---

## 1. 왜 전환하는가

Streamlit은 상호작용마다 스크립트를 rerun하는 모델이라, 이 앱의 핵심인
**실시간 캠·마이크·시선·타이머**와 구조적으로 충돌한다. 그 대가가 이미 코드에
남아 있다 — STT가 `session_state`를 못 쓰고 별도 스레드에 락 걸린
`AudioBuffer`로 오디오 프레임을 서버에서 모아야 했던 것.

핵심 통찰: **캠·마이크·시선은 서버가 아니라 브라우저가 해야 한다.**
전환의 본질은 "무거운 실시간 처리를 브라우저로 내리고, 서버는 STT/LLM
호출과 시크릿 보관만 담당"하도록 역할을 재배치하는 것이다.

## 2. 역할 재배치

| 관심사 | Streamlit(현재) | 전환 후 |
|---|---|---|
| 캠/마이크 캡처 | streamlit-webrtc(서버) | 브라우저 `getUserMedia` / `MediaRecorder` |
| 오디오 버퍼/리샘플 | 서버 `AudioBuffer`(스레드+락) | **삭제** — 브라우저가 blob 생성 |
| 시선 추적 | Python MediaPipe(서버) | 브라우저 MediaPipe Tasks for Web |
| STT(CLOVA) | 서버 | 서버(FastAPI) — blob 받아 프록시 |
| LLM 평가/개인화 | 미구현 | 서버(FastAPI) — 시크릿 보관 |
| UI/페이지 흐름 | Streamlit 페이지 | Next.js App Router |

## 3. 이식 표 (버리는 것 / 살리는 것)

| 현재 | 전환 후 | 비고 |
|---|---|---|
| `module/config.py` | `backend/app/config.py` | ✅ 이식+일반화(LLM/CORS 추가). **완료** |
| `module/stt.py` `transcribe_wav` | `backend/app/services/stt.py` | CLOVA 호출부만 이식, `AudioBuffer` 삭제 |
| `module/evaluate.py` | `backend/app/services/evaluate.py` | **재작성** — 실제 LLM 평가 ★ |
| `module/question_generator.py` + `rules.json` | `backend/app/services/questions.py` | 룰 기반 로직 이식 |
| `module/kanana_*.py` | — | ❌ 폐기 |
| `module/eyetracking.py` | `frontend/lib/gaze.ts` | JS로 재작성, `face_landmarker.task` 재사용 |
| `page/*.py` | `frontend/app/*` | React로 재작성 |
| `app.py`, streamlit-webrtc | — | ❌ 폐기 |

## 4. 목표 구조

```
InterReview/  (new_framework)
├── backend/          FastAPI + uv
│   ├── app/
│   │   ├── main.py        # 앱 + CORS + 라우터
│   │   ├── config.py      # 설정(환경변수)
│   │   ├── schemas.py     # pydantic 요청/응답 모델
│   │   └── services/
│   │       ├── stt.py         # CLOVA 프록시
│   │       ├── questions.py   # 질문 생성(룰)
│   │       ├── llm.py         # Anthropic 클라이언트
│   │       └── evaluate.py    # LLM 평가 ★
│   └── question_banks/        # 데이터
├── frontend/         Next.js(App Router) + TS + Tailwind
│   ├── app/          setup / interview / analysis
│   ├── lib/          gaze.ts · recorder.ts · api.ts
│   └── public/face_landmarker.task
└── docs/migration-plan.md
```

## 5. API 계약 (초안)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 헬스체크. **완료** |
| POST | `/questions` | 프로필 → 질문 6개(+개인화) |
| POST | `/stt` | 오디오 blob(multipart) → transcript |
| POST | `/evaluate` | {프로필, 질문, transcripts, 시선요약} → 평가 리포트 |

평가 응답 스키마는 기존 계약을 유지·확장:
`{ total_score, status, summary_feedback, results[] }`

## 6. 단계

- **Phase 0 — 스캐폴드 & 연결** *(완료)*
  - [x] `new_framework` 브랜치/워크트리 (base `LeeJW`)
  - [x] FastAPI 스켈레톤 + `/health` + config + CORS
  - [x] Next.js 스캐폴드 + `/health` 호출로 연결 확인 (CORS 검증됨)
- **Phase 1 — 백엔드 코어** *(진행 중)*
  - [x] `services/questions.py` (룰 기반 이식) + `POST /questions`
  - [x] `services/evaluate.py` **룰기반 평가** + `POST /evaluate` (키 없이 동작)
  - [x] `services/stt.py` (CLOVA 프록시, multipart 수신) + `POST /stt`
  - [ ] `services/llm.py` (Anthropic, JSON 스키마 강제)
  - [ ] `services/evaluate.py` **LLM 평가 경로** ★ — 키 확보 후 (룰기반 fallback 유지)
- **Phase 2 — 프론트 캡처** *(A·B 완료, C 인계)*
  - [x] A: setup → questions → interview(텍스트) → evaluate → 리포트 세로 슬라이스
  - [x] B: `lib/recorder.ts`(녹음 + 16kHz WAV 변환) + 캠 미리보기 + `/stt` 전사
  - [ ] C: `lib/gaze.ts` (MediaPipe Tasks for Web, 시선 요약) — **다른 담당자 인계**(§8)
- **Phase 3 — 흐름 완성**
  - [x] setup → interview → analysis 전체 배선 (InterviewApp 상태기계)
  - [x] 로딩/에러/무응답/권한거부 처리 (STT 실패 시 직접입력 fallback)
- **Phase 4 — 검증**
  - [ ] e2e 리허설 1회 완주 (실제 음성 포함)
  - [x] 키 없는 환경 graceful degradation (룰기반 평가 + STT not_configured)

## 8. 시선 추적(Milestone C) 인계 계약

브라우저에서 시선을 계산해 **질문별 요약**을 `eye_tracking`에 실으면 끝난다.
백엔드·평가·요청 스키마는 이미 이 필드를 받도록 준비돼 있다.

- **넣을 곳:** `frontend/components/InterviewView.tsx`의 `submit()` — 지금 각
  answer의 `eye_tracking: null`을 질문별 요약 객체로 교체.
- **계약(필드, 전부 optional):**
  ```ts
  eye_tracking: {
    front_gaze_ratio: number,     // 정면 응시 프레임 비율 0..1
    face_detected_ratio: number,  // 얼굴 검출 프레임 비율 0..1
    std_gaze: number,             // 시선 좌표 표준편차(흔들림), >0.15면 감점
  }
  ```
  (타입은 `frontend/lib/types.ts`의 `EyeTrackingSummary`.)
- **평가 반영:** 백엔드 `services/evaluate.py._score_delivery()`가 이 세 값으로
  "전달 태도" 점수·코멘트를 산출. 값이 없으면 `na`로 처리.
- **참고 로직:** `docs/reference/eyetracking.py`(옛 Streamlit 정면 응시 판정 등)와
  `frontend/public/face_landmarker.task`(동일 모델, 브라우저용은
  `@mediapipe/tasks-vision`의 FaceLandmarker로 `"/face_landmarker.task"` 로드) 재사용.
- **캡처 시점:** 질문별 녹음 구간 동안 프레임을 누적해 요약 → 그 질문 answer에 매핑.

## 7. 열린 결정 / 리스크

- 평가 LLM: **Claude Sonnet 5**(개인화 Haiku 4.5) 잠정. ANTHROPIC_API_KEY 필요.
- 세션/상태 보관: MVP는 프론트 상태 + 무상태 백엔드(파일/DB 저장 없음).
- 배포: 프론트(Vercel 등) + 백엔드(별도). 캠/마이크 위해 HTTPS 필수.
- 시선→점수 반영은 초기엔 **코멘트 근거로만**(직접 점수화는 신뢰도 논란).
```

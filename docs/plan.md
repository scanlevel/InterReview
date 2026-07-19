# InterReview 개발 계획 (Development Plan)

> AI 모의면접 서비스 · Streamlit 기반
> 최종 갱신: 2026-07-19

---

## 1. 목표

지원자가 웹에서 **가상 면접관의 질문을 받고 → 카메라·마이크로 답변하고 →
답변 내용과 태도(시선/발화)를 AI가 평가받는** 모의면접 서비스를 완성한다.

현재 골격(페이지 흐름, 시선 추적, 질문은행)은 있으나 **"음성 인식"과 "AI
평가"가 비어 있어** 서비스로서 동작하지 않는다. 이 계획의 핵심은 이 두 뇌를
채우는 것이다.

### 아키텍처 방향 (확정)

- **STT: 클라우드 STT API** 사용 (서버 오프라인 모델 아님)
- **평가 · 질문 개인화: LLM API** 사용
- **Kanana 로컬 모델은 전면 제거** — `kanana_llm.py`, `kanana_personalizer.py`,
  `pyproject.toml`의 `kanana` extra, 관련 환경변수/문서 삭제

---

## 2. 현재 상태 (Baseline)

### 완성된 부분
| 영역 | 파일 | 상태 |
|------|------|------|
| 페이지 라우팅 · 세션 상태 | `app.py` | ✅ 동작 |
| 카메라/마이크 설정 | `page/setup_page.py` | ✅ 동작 |
| 프로필 입력 | `page/input_page.py` | ✅ 동작 |
| 시선 추적 (MediaPipe) | `module/eyetracking.py` | ✅ 완성 — gaze_x/y, 정면 응시 비율, 얼굴 검출 비율 |
| 질문은행 룰 기반 생성 | `module/question_generator.py` | ✅ 동작 (6문항, `rules.json` 기반) |
| WebRTC 카메라 스트리밍 | `interview_page.py` | ✅ 동작 (단, audio=False) |

### 비어 있는 부분 (Mock)
| 영역 | 파일 | 문제 |
|------|------|------|
| **STT** | `module/stt.py` | 더미. 오디오 캡처 안 함, transcript 항상 `""` |
| **평가** | `module/evaluate.py` | 랜덤 딜레이만. 모든 점수 `None`, `not_implemented` |
| 질문 개인화 | `module/kanana_personalizer.py` | Kanana 의존 → 제거 대상 |

### 현재 데이터 흐름
```
setup → input(profile) → generating(질문 6개 생성)
     → interview(질문별: 카메라+시선, [STT 없음]) → analysis(평가)
```
`finish_interview()`가 `submitted_data`를 만들어 `evaluate_interview()`에 넘김:
```json
{ "profile": {...}, "questions": [...], "answers": {...}, "features": { "<qid>": {"stt": {...}, "eye_tracking": {...}} } }
```

---

## 3. 개발 단계 (Phases)

### Phase 0 — 정리 & 기반 (Kanana 제거 + 설정)
- [ ] `module/kanana_llm.py`, `module/kanana_personalizer.py` 삭제
- [ ] `question_generator.py`에서 Kanana import·호출 제거
- [ ] `pyproject.toml`의 `[optional-dependencies].kanana` 삭제, `README.md` Kanana 섹션 삭제
- [ ] **`module/config.py`** 신설 — API 키/모델명/타임아웃을 환경변수에서 로드
      (`.streamlit/secrets.toml` 또는 env). 키는 커밋 금지 (`.gitignore` 확인)
- [ ] `requirements.txt` / `pyproject.toml`에 LLM·STT SDK 추가

### Phase 1 — LLM 클라이언트 추상화
- [ ] **`module/llm_client.py`** 신설: 단일 진입점
  - `chat(messages, *, response_format=None) -> str | dict`
  - JSON 강제 출력(구조화 응답) 지원 — 평가 결과 파싱 안정성 확보
  - 재시도/타임아웃/에러 래핑 (`LLMError`)
  - 키 없을 때 graceful degradation (질문은행 원문 사용, 평가는 룰 기반 최소치)
- [ ] 프로바이더/모델명은 config로 주입 (기본값: 권장 최신 모델)

### Phase 2 — STT (클라우드 API)
핵심 난이도: **Streamlit-WebRTC에서 오디오를 모아 → 문장으로 변환**.
- [ ] `interview_page.py` WebRTC `media_stream_constraints`에서 `audio: True`
- [ ] `audio_frame_callback`으로 PCM 프레임 버퍼링 (질문별 세그먼트)
- [ ] **`module/stt.py` 재작성**:
  - `AudioBuffer` — WebRTC 오디오 프레임 누적 → WAV/PCM 인코딩
  - `transcribe(audio_bytes, *, language="ko") -> {transcript, duration_sec, ...}` — 클라우드 STT API 호출
  - `get_stt_status()`는 실시간 상태(녹음중/발화감지/누적시간) 표시용으로 유지·연결
- [ ] "녹음 시작/중지" 버튼이 실제 버퍼 start/stop을 제어하도록 배선
- [ ] 질문 이동/종료 시 해당 세그먼트 transcribe → `answers[qid]`에 저장
- [ ] 마이크 미허용/무음/API 실패 fallback 처리
- 프로바이더 후보: OpenAI `gpt-4o-transcribe`/Whisper, Google STT, Naver CLOVA(한국어 강점) — **결정 필요(§6)**

### Phase 3 — 질문 개인화 (LLM)
- [ ] **`module/question_personalizer.py`** 신설 (기존 kanana_personalizer 대체)
  - 입력: 프로필 + 질문은행에서 뽑은 6개 원문
  - LLM으로 지원자 맥락(직무/기술스택/프로젝트/자기소개)에 맞게 자연스럽게 재작성
  - 실패 시 원문 그대로 사용(fallback), `question_generator`의 progress_callback 유지
- [ ] `question_generator.generate_questions()`가 새 personalizer 호출하도록 교체

### Phase 4 — AI 평가 (LLM) ★핵심
- [ ] **`module/evaluate.py` 재작성**: `submitted_data` → 구조화 평가 리포트
  - 입력 조합: 질문 + STT transcript + eye_tracking snapshot + 룰(카테고리)
  - LLM 프롬프트로 항목별 채점 + 코멘트 생성 (JSON 스키마 강제):
    - 질문 적합성 / 답변 구체성 / 논리 구조(STAR) / 전달 태도
  - 전달 태도는 **시선 데이터(front_gaze_ratio, std_gaze)**를 근거로 반영
  - `total_score`, `summary_feedback`, 질문별 `results[]` 채우기
  - transcript 없음/무응답 질문 처리 규칙
- [ ] `analysis_page.py`가 실제 점수/피드백을 렌더하도록 확인·보강

### Phase 5 — UX·안정화
- [ ] `analysis_page` 결과 시각화 개선(점수 요약, 항목별 바/레이더 등)
- [ ] 로딩/에러 상태 메시지 정리, API 실패 시 사용자 안내
- [ ] 결과 다운로드(JSON/텍스트) 옵션(선택)
- [ ] 배포 시 HTTPS/TURN 관련 README 갱신

### Phase 6 — 검증
- [ ] 핵심 모듈 단위 테스트 (`llm_client`, `stt` 파서, `evaluate` 스키마)
- [ ] end-to-end 수동 리허설: 6문항 전체 흐름 1회 완주
- [ ] API 키 없는 환경에서 graceful degradation 확인

---

## 4. 신규/변경 모듈 요약

| 파일 | 동작 | 상태 |
|------|------|------|
| `module/config.py` | 키/모델/타임아웃 설정 로드 | 신규 |
| `module/llm_client.py` | LLM API 단일 진입점(+JSON 출력) | 신규 |
| `module/stt.py` | 클라우드 STT 연동 + 오디오 버퍼 | 전면 재작성 |
| `module/question_personalizer.py` | LLM 질문 개인화 | 신규(kanana 대체) |
| `module/evaluate.py` | LLM 기반 평가 리포트 | 전면 재작성 |
| `module/question_generator.py` | 새 personalizer 연결, kanana 제거 | 수정 |
| `page/interview_page.py` | audio=True, 오디오 콜백·녹음 배선 | 수정 |
| `module/kanana_llm.py`, `module/kanana_personalizer.py` | — | **삭제** |

---

## 5. 데이터 계약 (유지)

평가 입력 `submitted_data`와 출력 리포트의 형태는 기존 구조를 **깨지 않게**
확장한다 (analysis_page 호환). 출력 예:
```json
{
  "total_score": 78,
  "status": "ok",
  "summary_feedback": "...",
  "results": [
    { "question_id": "q1", "question": "...", "category": "...",
      "evaluation_items": [{"name": "질문 적합성", "score": 80, "status": "ok", "comment": "..."}],
      "feedback": "..." }
  ]
}
```

---

## 6. 열린 결정 (Open Decisions)

1. **STT 프로바이더** — OpenAI / Google / Naver CLOVA 중 택1 (한국어 정확도 vs 비용 vs 셋업)
2. **LLM 프로바이더/모델** — 어떤 API를 쓸지 (기본 추천: 최신 상위 모델)
3. **API 키 관리** — `.streamlit/secrets.toml` vs 환경변수 (배포 플랫폼에 맞게)
4. 실시간 STT(스트리밍) vs 질문 세그먼트 단위 배치 변환 — MVP는 **배치** 권장

---

## 7. 리스크

- WebRTC 오디오를 서버 콜백에서 안정적으로 모으는 부분(프레임 유실/샘플레이트)
- 클라우드 배포 시 카메라·마이크 위해 **HTTPS 필수**, WebRTC용 **TURN** 필요 가능
- LLM JSON 출력 파싱 실패 → 스키마 강제 + 재시도로 방어
- API 비용/레이트리밋 → 캐싱·타임아웃·fallback

---

## 8. 진행 순서 요약

**Phase 0(정리) → 1(LLM 클라이언트) → 2(STT) → 3(개인화) → 4(평가) → 5(UX) → 6(검증)**

가장 먼저 착수 권장: **Phase 0 + Phase 1** (기반을 깔면 STT·평가가 그 위에 얹힘).

# InterReview Track B 진행 현황

> 기준일: 2026-08-25
> 브랜치: `feature/vision-web`
> 요구사항 기준: `docs/plan-B.md`

이 문서는 Track B의 현재 구현과 검증 결과를 기록한다. 요구사항 자체는 `plan-B.md`를 따른다.

## 구현 현황

| 항목 | 상태 | 근거 |
|---|---|---|
| B-1 질문 Random Pick | 충족 | `POST /questions`가 6개 항목의 질문을 반환하고 백엔드 테스트를 통과한다. |
| B-2 면접 세션·장치 UI | 충족 | 프로필 입력 → 질문 생성 → 장치 설정 → 면접 흐름을 실제 Chrome에서 완주했다. |
| B-3 질문별 STT | 충족 | 브라우저 WAV를 CLOVA Speech 장문 인식 `/recognizer/upload`에 전송하고 HTTP 200을 확인했다. |
| B-4 음성 측정 | 충족 | VAD 기반 질문별 오디오 활동 타임라인과 발화·무음 측정 테스트가 통과한다. |
| B-5 시선·Heatmap | 부분 충족 | `+`·`X` 중앙 왕복 경로, 고정 3×3 9-point, MLP 보정, EMA 평활화, 질문별 Heatmap이 연결됐다. 새 캘리브레이션 UI의 실제 사람 응시 정확도 검증은 남아 있다. |
| B-6 결과 화면 | 부분 충족 | 측정 결과 화면은 완주한다. A 소유 `POST /answers/review`가 현재 백엔드에 없어 내용 피드백은 `unavailable` fallback으로 표시된다. |
| B-7 전체 E2E | 부분 충족 | 실제 카메라·마이크와 외부 CLOVA 호출로 결과 화면까지 도달했다. A 답변 판별 API 연결 이후 최종 완주 상태가 된다. |

## 2026-08-25 반영 사항

- `+` 경로를 중앙↔좌·우·상·하, `X` 경로를 중앙↔네 모서리의 8개 왕복 선분으로 변경했다.
- 사용자 화면을 `1 / 2 이동 경로`(Moving: `+`·`X`)와 `2 / 2 고정점`(Static: 9-point)으로 분리했다. 3초 대기 후 각 phase 전환 전에 중앙/첫 고정점을 1500ms 동안 흐릿하게 깜빡이며 동작을 안내하고, 안내 중에는 sample을 수집하지 않는다.
- 중앙 출발 선분에만 점 주변의 짧은 화살표를 표시하며 선 두께 5px, 불투명도 약 0.62로 조정했다. 바깥점 도착 후 중앙 복귀는 끊지 않고 연속으로 진행하며, 복귀 구간에는 별도 안내 문구를 표시하지 않는다.
- 연속 경로의 실제 이동시간은 경로당 7초로 유지하고, 이동 sample에는 기존 150ms target 지연 정렬을 유지한다.
- Static phase의 첫 고정점은 phase 안내가 기존 preview를 대체하고, 이후 9-point는 1초 preview, 300ms 안정화, 500ms 동안만 `rawGaze`를 수집한다.
- `+`·`X`·9-point sample을 정제·통합해 작은 MLP를 학습하며 validation 평균·중앙값 pixel error와 source·point별 진단값을 표시한다.
- 이번 UI 변경은 gaze 테스트 13개, ESLint, TypeScript, Next.js production build를 통과했다. 실제 카메라·시선 장치 E2E는 수행하지 않았다.

## 2026-08-24 반영 사항

- 개발 주소의 Next.js Origin 차단과 API CORS 문제를 동일 Origin `/api` 프록시로 정리했다.
- 카메라·마이크는 `localhost` 또는 HTTPS에서만 사용할 수 있음을 장치 화면에서 명확히 안내한다.
- 면접 중 가상 면접관 패널을 데스크톱 `768×432` 크기로 고정하고 질문 길이에 따른 스크롤 폭 변화를 막았다.
- 시선 출력 평활화를 One Euro에서 단순 EMA(`alpha=0.15`)로 변경했다.
- CLOVA Speech 장문 인식 Invoke URL과 Secret 설정을 실제 요청으로 검증했다. 비밀값은 저장소에 포함하지 않는다.

## 검증 결과

~~~text
backend pytest: 16 passed
frontend gaze: 13 passed
frontend audio: 3 passed
ESLint: passed
TypeScript: passed
Next.js production build: passed
git diff --check: passed
~~~

2026-08-24의 실제 장치·외부 API E2E는 `http://localhost:3000`에서 테스트 전용 Chrome 프로필과 실제 기본 장치를 사용했다. 2026-08-25에 변경한 캘리브레이션 UI는 실제 카메라로 다시 검증하지 않았다.

~~~text
프로필 입력
→ POST /questions 200
→ 카메라 640×480 live / 마이크 live
→ 장치 STT POST 200
→ 면접 녹음 STT POST 200
→ 질문 1에서 질문 2로 전환
→ 가상 면접관 패널 768×432 유지
→ 6개 질문 제출
→ POST /measurements 200
→ 면접 결과 화면 도달
~~~

CLOVA 연결 검증용 합성 WAV는 HTTP 200과 `no_speech`를 반환했다. 이는 인증·업로드 연결 성공을 의미하지만 실제 한국어 전사 정확도 검증은 아니다.

## 남은 작업과 제한

1. A 담당 `POST /answers/review`가 OpenAPI에 없어 질문별 호출이 404다. 현재는 “답변 내용 판단 불가” fallback으로 세션을 유지한다.
2. 사람이 테스트 문장을 말하는 CLOVA 한국어 전사 품질 확인이 필요하다.
3. 사람이 `+`·`X` 중앙 왕복 경로와 3×3 아홉 점을 직접 응시하는 새 캘리브레이션의 안내성·정확도 확인이 필요하다.
4. LAN의 일반 HTTP 주소에서는 브라우저 보안 정책상 카메라·마이크를 사용할 수 없다. 실제 장치 테스트는 `localhost` 또는 HTTPS를 사용한다.

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

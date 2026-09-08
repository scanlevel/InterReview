# 수동 답변 종료 유지 · VAD 캘리브레이션 구현 계획서

작성일: 2026-09-08. 다음 세션의 구현 담당 에이전트에게 전달하는 계획서다. 이 세션에서는 코드 확인, 기존 단위 테스트 실행, 이 문서 작성만 수행했다. 제품 코드 구현·커밋·푸시는 수행하지 않았다.

확인 기준: `D:\Projects\InterReview`, 브랜치 `codex/merge-test-b-leejw`, HEAD `606826cdff1a529dc57ef7e5a8456f37e14fbaf5`. 시작 시 Git 상태는 기존 미추적 `.agents/`만 있었다. 아래 줄 번호는 이 HEAD 기준이며 다음 세션에서 다시 확인한다.

**수동 종료는 이미 구현되어 있다. 신규 분기를 만드는 대신 기존 버튼과 공통 종료 처리를 보존·검증한다. VAD는 Silero 확률 임계값을 보정하고, 녹음 후 분석과 기존 RMS fallback까지 같은 세션 설정을 전달한다.**

| 항목 | 현재 구현 — 코드 확인 결과 | 수정 방향 | 판정 |
|---|---|---|---|
| 답변 종료 | 자동 모드에도 `■ 답변 종료` 버튼이 표시되며 자동·수동 모두 `finalizeAnswer`로 합류 | 기존 경로 보존, 버튼 수명·경쟁 상황 검증, 필요한 안내만 보완 | 핵심 요구 충족, 실제 UI/경쟁 검증 필요 |
| 자동 종료 시점 | 유효 발화 후 Silero가 종료를 판정하면 답변 처리 시작. `redemptionMs=4000` | 기존 정책 유지. 버튼을 별도 4초 타이머로 숨기지 않음 | 기본 흐름 유지 |
| VAD | 실시간·녹음 후 분석은 Silero legacy, 확률 기준 `0.6 / 0.35` 고정 | 준비 단계에서 주변 소음·발화 샘플로 보정 | 미구현 |
| RMS | 녹음 후 Silero 분석 실패 시 `0.015` 기준으로 대체 분석 | RMS 보정값은 RMS fallback에 별도 적용 | 주 VAD와 구분 필요 |
| 장치 준비 | 시선 보정과 마이크·STT 확인 존재. 음성 보정 상태·전달값 없음 | 기존 마이크·STT 영역 안에 보정 절차 추가 | 기존 화면 확장 |

## 1. 자동 종료와 수동 종료를 함께 유지

### 현재 구현

| 확인 내용 | 코드 근거 |
|---|---|
| 자동 진행 기본값은 켜짐 | [InterviewView.tsx:313](D:/Projects/InterReview/frontend/components/InterviewView.tsx:313) `useState(true)` |
| 자동 모드에서도 녹음 중 종료 버튼 표시 | [InterviewView.tsx:1013](D:/Projects/InterReview/frontend/components/InterviewView.tsx:1013). 표시 조건은 `question_ready` 또는 `recording`; 자동 모드는 준비 상태의 녹음 시작만 비활성화 |
| 수동 클릭은 기존 종료 함수 실행 | [InterviewView.tsx:836](D:/Projects/InterReview/frontend/components/InterviewView.tsx:836) `toggleRecording` → `finalizeAnswer(question, true, true)` |
| 자동 종료도 같은 함수 실행 | [InterviewView.tsx:711](D:/Projects/InterReview/frontend/components/InterviewView.tsx:711) `handleLongSilence` → `finalizeAnswer(question, true, false, guide)` |
| 종료 중 중복 진입 방지 존재 | [InterviewView.tsx:610](D:/Projects/InterReview/frontend/components/InterviewView.tsx:610) `sttRequestInFlightRef`와 `processingAnswerIdsRef`를 첫 await 전에 설정 |
| 녹음 종료 후 STT·측정 처리 | [InterviewView.tsx:509](D:/Projects/InterReview/frontend/components/InterviewView.tsx:509), [InterviewView.tsx:526](D:/Projects/InterReview/frontend/components/InterviewView.tsx:526). VAD·시선·녹음 정지 후 Blob 확보, WAV 변환·기존 STT·측정 수행 |
| 처리 단계에서 종료 버튼 사라짐 | `finalizeAnswer`가 `step=processing`으로 전환. 시간만으로 버튼을 숨기는 로직은 없음 |
| 실시간 VAD 초기화 실패 시 수동 전환 | [InterviewView.tsx:437](D:/Projects/InterReview/frontend/components/InterviewView.tsx:437) 오류 콜백이 `autoMode=false`와 안내 설정. 기존 녹음은 유지 |
| 자동 모드에서 수동 클릭해도 다음 질문 자동 진행은 유지 | 클릭이 예약 작업을 취소하지만 `autoMode`는 끄지 않음. 처리 후 `waiting_next`에서 1,500ms 뒤 다음 질문/최종 제출 |
| 완전 수동 모드도 존재 | 자동 체크박스 해제. `waiting_next`에서 다시 답변하기·다음 질문·최종 제출 제공. 녹음·처리 중 체크박스는 비활성화 |

자동 종료에만 종료 안내 음성이 붙고, 현재 수동 클릭 경로는 안내 없이 처리한다. 이 차이는 [progress-B.md:10](D:/Projects/InterReview/docs/progress-B.md:10)에도 명시되어 있다. 요청 범위에서 수동 경로에 새 TTS를 추가할 필요는 없다.

### 유지할 동작과 최소 수정

1. `recording` 동안 자동/수동 모드와 무관하게 기존 `답변 종료` 버튼을 유지한다. 최초 발화가 감지되지 않거나 VAD가 소음을 계속 발화로 판단하는 경우에도 사용할 수 있어야 한다.
2. Silero 자동 종료 또는 수동 클릭 중 먼저 수락된 요청이 기존 `finalizeAnswer`를 실행한다. `processing` 진입과 함께 버튼을 숨기고 현재 처리 중 표시를 재사용한다.
3. 독립적인 버튼 삭제용 4초 타이머, 두 번째 녹음 종료 함수, 별도의 수동 면접 화면을 만들지 않는다. **4초가 지나도 종료가 시작되지 않았다면 버튼은 계속 남는다.**
4. 자동 모드 녹음 중 짧은 안내를 추가하는 정도로 기능을 명확히 한다. 예: `답변이 끝나면 자동으로 종료됩니다. 직접 종료할 수도 있습니다.` 정확한 초 단위 카운트다운은 이번 범위에 넣지 않는다.
5. 기존 중복 실행 방지와 질문 ID 검사를 먼저 검증한다. 실패가 재현되는 경우에만 공통 진입점에서 최소 수정한다. 이미 충족된 동작을 재작성하지 않는다.
6. 완전 수동 모드의 재답변·다음 질문 흐름을 보존한다. 수동 종료 버튼을 누를 때 자동 모드를 강제로 끄는 변경은 하지 않는다.

이 버튼은 자동 종료 판정 미발생의 복구 경로다. `MediaRecorder.stop()` 자체가 완료되지 않는 문제 등 하위 녹음 장치 장애까지 해결한다고 보고하지 않는다. 해당 문제가 재현되면 별도 근거와 범위를 기록한다.

### 4초의 정확한 의미와 문서 차이

[recorder.ts:20](D:/Projects/InterReview/frontend/lib/recorder.ts:20)의 초기 정책은 양성 `0.6`, 음성 `0.35`, 최소 발화 `250ms`, 종료 대기 `4000ms`, 앞부분 패딩 `250ms`다. `LONG_PAUSE_SEC=2`는 결과 측정용이며 자동 종료 대기와 다르다.

[createSpeechEndGate:613](D:/Projects/InterReview/frontend/lib/recorder.ts:613)는 `onSpeechRealStart` 이후에만 종료를 한 번 통지한다. 초기 침묵만으로 종료하지 않는다.

설치된 `@ricky0123/vad-web@0.0.30`의 [frame-processor.js:118](D:/Projects/InterReview/frontend/node_modules/@ricky0123/vad-web/dist/frame-processor.js:118)는 양성 임계값 이상이면 무음 카운터를 초기화하고 음성 임계값 미만일 때 증가시킨다. 두 임계값 사이의 프레임은 카운터를 증가시키지도 초기화하지도 않는다. legacy는 96ms 프레임과 내림한 프레임 수를 사용한다. 따라서 기존 문서의 ‘연속 무음 4초’는 정확한 벽시계 타이머와 일치하지 않는다.

이번에는 라이브러리 종료 의미를 보존한다. 엄밀한 연속 4초로 바꾸는 것은 별도의 정책 변경이다. 기존 계획을 코드에 맞춰 조용히 덮어쓰지 말고 이 차이를 인계한다. 과거 메모의 ‘5초 후 확인 질문·확인 STT’ 흐름은 현재 상태 머신에 없으며 복원하지 않는다.

## 2. 면접 준비 단계에 VAD 캘리브레이션 추가

### 현재 구현

| 경로 | 현재 처리 | 수정할 지점 |
|---|---|---|
| 실시간 자동 종료 | [createRealtimeVadMonitor:735](D:/Projects/InterReview/frontend/lib/recorder.ts:735), Silero `MicVAD`, 고정 확률 임계값 | 보정된 Silero 양성·음성 임계값 주입 |
| 녹음 후 지표·타임라인 | [blobToWav16kWithMetrics:589](D:/Projects/InterReview/frontend/lib/recorder.ts:589) → `analyzeSileroVad` → `NonRealTimeVAD` | 동일한 세션의 Silero 임계값 주입 |
| 녹음 후 모델 실패 | `analyzeVad`의 20ms RMS 판정 | 보정된 RMS 임계값 적용 |
| 기존 순수 RMS 계산 | [calculateSpeechMetrics:327](D:/Projects/InterReview/frontend/lib/recorder.ts:327), 현재 직접 호출은 테스트 | 선택 인자를 추가할 경우 기본값과 fallback의 판정 일관성 보존 |
| 화면 마이크 막대 | `useMicLevel`, RMS를 dB와 평활화로 화면에 표시 | 표시값을 VAD 확률 또는 보정 원본으로 사용하지 않음 |
| 장치 준비 | [DeviceSetupView.tsx:279](D:/Projects/InterReview/frontend/components/DeviceSetupView.tsx:279), mono·echo cancellation·noise suppression 요청, AGC ideal false | 이 공유 스트림으로 보정. 별도 `getUserMedia` 호출 불필요 |
| STT 확인 | [DeviceSetupView.tsx:580](D:/Projects/InterReview/frontend/components/DeviceSetupView.tsx:580), 기존 안내 문장 녹음 → WAV → STT → 사용자 확인 | 발화 보정 샘플 수집과 기존 녹음을 겹쳐 사용 가능 |
| 전달 계약 | [DeviceSetupResult:83](D:/Projects/InterReview/frontend/components/DeviceSetupView.tsx:83)는 stream·시선 calibration·voiceId만 보유 | 선택적 `vadCalibration` 필드 추가 |

**RMS 기준만 바꾸면 자동 종료에는 효과가 없다.** Silero가 주 경로이므로 음성 확률 보정과 RMS fallback 보정을 분리해야 한다. 실시간 모델 로딩 실패는 현재처럼 수동 종료로 전환하며, 실시간 RMS 자동 종료라는 새 fallback을 추가하지 않는다.

### 사용자 흐름

기존 `2. 마이크·STT 확인` 영역을 확장한다. 시선 보정 과정은 유지한다.

| 단계 | 사용자 동작 | 내부 처리 |
|---|---|---|
| 주변 소음 측정 | `음성 테스트 시작` 후 약 3초간 말하지 않기 | VAD 준비 완료 후 공유 마이크에서 프레임 확률·RMS 수집. 준비 시간은 측정에 포함하지 않음 |
| 발화 확인 | 기존 안내 문장을 평소 목소리로 읽고 기존 종료 버튼 누르기 | 같은 스트림의 프레임 확률·RMS 수집 및 기존 STT 테스트 녹음. 준비 침묵은 STT 녹음에서 제외 |
| 보정 적용 | 결과 상태 확인 | 보정 성공 여부와 STT 성공 여부를 독립 판정. STT 미설정이어도 VAD 보정 가능 |
| 실패·재시도 | 원인을 확인하고 다시 테스트 | 발화 부족·분리 불가·모델 실패를 완료로 표시하지 않음 |
| 건너뛰기 | 기본 설정으로 진행 선택 | 보정은 skipped, `vadCalibration=null`. 기존 값 사용 사실을 안내하고 수동 종료 유지 |

보정 안내는 화면 텍스트로 제공한다. 음성 미리듣기는 보정 시작 시 기존 `cancelVoicePreview`로 취소하고 보정 중 재생 버튼을 잠근다. 시스템 TTS 소리가 보정 샘플에 들어가지 않게 한다.

기존 STT 확인 결과 화면과 사용자 확인 버튼은 유지한다. STT만 건너뛰는 것과 VAD 보정까지 건너뛰는 것을 상태상 구분한다. 보정 중단·실패 후에도 사용자가 재시도하거나 기본값으로 진행할 수 있어야 한다.

### 보정값 산출 계획

새 모델이나 라이브러리를 추가하지 않는다. 설치된 [real-time-vad.d.ts:7](D:/Projects/InterReview/frontend/node_modules/@ricky0123/vad-web/dist/real-time-vad.d.ts:7)의 `onFrameProcessed(probabilities, frame)`으로 `isSpeech` 확률과 해당 PCM 프레임의 RMS를 수집한다. 기존 `percentile`과 `rmsForFrame` 계산을 재사용한다. 보정용 모니터는 자동 종료 콜백을 호출하지 않는다.

아래는 **구현 출발점으로 제안하는 휴리스틱이며 장치 검증을 마친 최적값이 아니다.** 무음·발화 샘플의 분리가 불충분할 때 임계값을 억지로 만들지 않는 것이 전제다.

1. 주변 소음 확률의 상위 분위수(초기안 P95)를 `N`, 안내 문장 구간 확률의 상위 분위수(초기안 P75)를 `S`로 계산한다. 발화 구간 전체를 음성 정답으로 취급하지 않는다.
2. 충분한 샘플과 유효한 분리 폭이 있으면 `negative = N + (S-N)/3`, `positive = N + 2*(S-N)/3`를 후보로 삼는다. 확률 분리 폭 초기안 `0.1`, 최소 각 구간 수집량 초기안 `1초`는 이름 있는 상수로 두고 테스트·장치 검증 결과를 기록한다. NaN/Infinity·빈 입력·범위 밖 값은 실패로 처리하며 `0 <= negative < positive <= 1`을 보장한다.
3. 수집한 확률 시퀀스에 후보를 적용해 주변 소음이 최소 유효 발화로 오인되지 않는지, 안내 문장에서는 최소 유효 발화가 성립하는지 확인한다. 기존 프레임 판정 의미와 동일하게 검증한다. 단순히 percentile 사이에 값이 있다는 이유만으로 성공시키지 않는다. 이 검증은 같은 샘플에 대한 건전성 검사이며 일반 환경 성능 보장이 아니다.
4. RMS fallback은 주변 소음 RMS P95와 발화 후보 프레임 RMS의 대표값 사이에 별도 임계값을 둔다. 발화 후보는 보정된 Silero 양성 기준 이상인 프레임으로 선택한다. 두 RMS 수준이 분리되지 않으면 RMS 보정은 적용하지 않고 기존 `0.015`를 유지하며 부분 보정 상태를 명확히 안내한다. Silero 보정 실패를 RMS 성공으로 덮지 않는다.
5. `4000ms`, `250ms`, `LONG_PAUSE_SEC=2`는 보정 대상이 아니다. 시간 상수를 바꿔 소음 문제를 가리지 않는다.

성공한 보정값은 면접 시작 전에 확정하고 세션 동안 고정한다. 면접 도중 자동 적응, 영구 저장, 서버 전송, 민감도 슬라이더는 최초 범위에 추가하지 않는다. 샘플 통계가 모든 소음·목소리를 구분할 수 없으므로 실패·기본값·수동 종료 경로를 유지한다.

### 값 전달과 수명 관리

내부 타입 `VadCalibration`은 B 소유 `recorder.ts`에 둔다. 최소 필드는 `positiveSpeechThreshold`, `negativeSpeechThreshold`, `rmsThreshold: number | null`이다. 부분 보정 표시는 RMS 값 null 여부로 판단할 수 있다. 원시 샘플과 보정 진행 상태는 DeviceSetupView에만 둔다.

```text
DeviceSetupView: 주변 소음·발화 수집 → VadCalibration | null
  → DeviceSetupResult.vadCalibration (선택 필드 append)
  → InterviewApp: 기존 deviceSetup 상태에 보관하고 prop 전달
  → InterviewView: 해당 세션 보정값 사용
      ├─ createRealtimeVadMonitor → Silero 확률 임계값
      └─ blobToWav16kWithMetrics → offline Silero → 기존 RMS fallback
```

기존 인자를 바꾸지 않고 끝에 선택 인자를 추가한다. 예: `blobToWav16kWithMetrics(raw, "", vadCalibration)` 및 `createRealtimeVadMonitor(stream, onEnd, onError, vadCalibration)`. 최종 호출 계약은 구현 시작 시 두 작업 담당이 먼저 맞춘다. 보정값이 없으면 현재 상수를 그대로 사용한다.

오프라인 VAD는 현재 `offlineVadPromise` 하나를 모듈 전역에 캐시한다([recorder.ts:682](D:/Projects/InterReview/frontend/lib/recorder.ts:682)). 인자만 추가하고 첫 생성 옵션을 계속 재사용하면 다음 세션 보정값이 무시된다. 현재 타입에서 `NonRealTimeVAD`는 공개 `setOptions`가 없고 `frameProcessor` 인터페이스에도 없다. private 접근·형 강제 변환으로 우회하지 않는다. **임계값 키가 같으면 기존 인스턴스를 재사용하고 다르면 캐시를 교체하는 단일 항목 캐시**를 기본안으로 한다. 질문마다 모델을 재생성하지 않는다. 세션 전환 시 이전 분석 완료/취소를 확인하고 실행 중 인스턴스의 옵션을 변경하지 않는다.

장치 `configureDevices`는 카메라 변경 시에도 전체 스트림을 다시 연다. 마이크 ID 비교만으로 보정을 살려두지 말고, 현재 구조에서는 스트림을 재생성할 때 보정과 미완료 샘플을 모두 초기화한다. 취소·건너뛰기·재시험·장치 변경·언마운트·면접 진입에서 이전 비동기 결과를 run ID 또는 취소 플래그로 무효화한다.

보정용 VAD는 종료 시 `destroy()`로 리소스를 정리하되 공유 마이크 트랙을 중지하지 않도록 기존 getStream/pauseStream/resumeStream 소유권 규칙을 따른다. 현재 실시간 모니터의 `stop()`은 `pause()`만 호출한다. 보정 모니터에 이 수명 관리 방식을 그대로 복제하지 말고, 해당 공통 코드를 건드리는 경우 녹음과 공유 트랙을 보존하면서 VAD 리소스만 해제되는지 검증한다.

설정 완료 버튼의 현재 조건은 시선 보정과 STT의 success/skipped다([DeviceSetupView.tsx:679](D:/Projects/InterReview/frontend/components/DeviceSetupView.tsx:679), [DeviceSetupView.tsx:1001](D:/Projects/InterReview/frontend/components/DeviceSetupView.tsx:1001)). 여기에 VAD 보정의 success/skipped 및 보정 중 busy 조건을 추가한다. 클릭 핸들러 `continueToInterview`에서도 진행 중 보정 결과가 뒤늦게 섞이지 않도록 검증한다.

`buildAudioTimeline`에서 쓰는 `VAD_RMS_THRESHOLD`는 에너지 표시 정규화 하한으로도 쓰인다. 판정 임계값 주입을 이유로 이 표시 스케일까지 일괄 교체하지 않는다. 오프라인 결과는 현재 Silero segment를 20ms 표시 프레임에 투영하므로 실시간 콜백 시점과 결과 프레임이 완전히 같다고 주장하지 않는다. segment 경계·패딩 재설계는 이번 범위가 아니다.

## 진행 순서와 검증 계획

### 다음 세션 작업 순서와 파일 경계

두 항목 모두 Track B 소유다. 실행 전에 `AGENTS.md`, `docs/RoleDivision.md`, `docs/plan.md`, `docs/plan-B.md`, `frontend/AGENTS.md`를 읽고, 최신 경과는 `docs/progress-B.md`의 후반 Silero/자동 종료 계약과 대조한다. 프론트 코드를 쓰기 전에 설치된 Next.js 문서 중 관련 가이드를 읽는다.

| 순서 | 작업 묶음 | 예상 수정 파일 | 완료 조건 |
|---|---|---|---|
| 0 | 기준 확인·계약 확정 | 읽기 전용. `InterviewApp.tsx` 공유 변경 범위 확인 | 실제 브랜치·차이 확인, VAD 타입/선택 인자/실패 상태 합의 |
| 1 | 수동 종료 보존 | `frontend/components/InterviewView.tsx`, 관련 기존 테스트 | 기존 버튼 유지, 자동 실패 시 수동 종료 가능, 동시 종료 한 번만 처리 |
| 2 | 보정 계산·VAD 주입 | `frontend/lib/recorder.ts`, `frontend/lib/recorder.test.mts` | 순수 산출/검증, 실시간·오프라인·RMS fallback 적용, 캐시 갱신 |
| 3 | 장치 UI·세션 연결 | `frontend/components/DeviceSetupView.tsx`, `frontend/components/InterviewApp.tsx`, `frontend/components/InterviewView.tsx` | 보정·재시도·건너뛰기, 공유 스트림 보존, props 연결 |
| 4 | 통합·회귀 검증 | 기존 테스트와 필요한 최소 추가 테스트, 이 계획의 결과 기록 | 아래 수락 조건 충족, 미검증 장치 항목 명시 |

여러 에이전트에게 넘길 때 계산/VAD 담당과 UI/연결 담당으로 나눌 수 있다. 이는 다음 세션의 배정안이며 이 세션에서 다른 에이전트를 실행한 것은 아니다. 두 UI 작업이 `InterviewView.tsx`를 동시에 수정하지 않도록 한 담당이 소유하고, VAD 계약을 먼저 확정한 뒤 연결한다. `InterviewApp.tsx` 공유 파일은 보정 prop 전달만 추가하며 A 소유 draft·자소서·답변 판별·review revision 캐시는 유지한다.

예상 제품 변경은 위 네 TS/TSX 파일을 중심으로 한다. 함수 추출은 실제 검증에 필요한 작은 범위만 허용한다. 새 상태 머신/범용 캘리브레이션 프레임워크/백엔드 API를 만들지 않는다. `frontend/lib/types.ts`, `frontend/lib/api.ts`, 백엔드 결과 스키마의 변경은 기본안에 없다.

### 수락 조건

| 항목 | 확인할 동작 |
|---|---|
| 버튼 수명 | 자동 모드 `recording`에서 표시, VAD 종료 미발생 시 계속 표시, `processing`에서 숨김 |
| 처음부터 무음 | 자동 종료하지 않으며 수동 버튼으로 종료 가능 |
| 정상 자동 종료 | 유효 발화 → 기존 Silero 종료 정책 → 공통 처리. 별도 4초 UI 타이머 없음 |
| 발화 재개 | 대기 중 양성 발화 재개 시 라이브러리 정책에 따라 종료 카운터 초기화. 중간 확률 구간의 의미도 테스트 |
| 경쟁·중복 | 클릭 먼저/VAD 먼저/더블 클릭/정지 후 늦은 콜백 모두 recorder stop·STT·onAnswerFinalized가 한 번만 호출 |
| 모드 보존 | 자동 모드에서 수동 클릭 후 기존 다음 질문 자동 이동 유지. 완전 수동 모드의 재답변·다음·최종 제출 보존 |
| 오류 | VAD 초기화 실패 시 녹음 유지·수동 전환. STT 실패/종료 TTS 실패에도 결과 보존 및 다음 단계 가능 |
| 보정 입력 | 빈 샘플·비유한 값·발화 부족·소음/발화 겹침 실패. 정상 샘플은 유효 범위의 임계값 생성 |
| 보정 독립성 | STT 미설정/실패여도 VAD 보정 성공 가능. 실패/건너뛰기를 성공으로 표시하지 않음 |
| 보정값 전달 | 실시간·offline Silero가 같은 확률 설정 사용. 실패 시 RMS fallback은 해당 RMS 설정 사용 |
| 캐시 | 동일 설정 질문 간 모델 재사용. 다른 보정값의 다음 세션에서 이전 설정이 남지 않음 |
| 수명 | 재시험·장치 변경·취소·언마운트 후 늦은 결과 무시, 보정 모니터 해제, 면접용 공유 트랙 유지 |
| 결과 계약 | 네 발화 분류 시간의 합=총 분석 시간, 정렬 정보 없으면 classification null, transcript는 내부 평가 유지 |

기존 `recorder.test.mts`는 상수·종료 gate·RMS 측정·분류를 검사한다. `interviewFlow.test.mts`는 상태 전이와 안내/답변 대기를 검사한다. **이 테스트만으로 실제 React 버튼 조건이나 `finalizeAnswer` 경쟁 처리가 검증되지는 않는다.** 기존 `node:test`를 사용해 보정 계산과 설정 전달은 fake 모델/콜백으로 검사하고, 종료 경쟁은 실제 공통 종료 경로에 닿는 최소 mock 검사를 추가한다. 상태 머신 테스트만 늘려 중복 처리를 검증했다고 보고하지 않는다. UI 표시는 장치를 요청하지 않는 mocked MediaStream/MediaRecorder/VAD 환경에서 확인한다. 검증 도구가 없으면 억지로 대규모 테스트 의존성을 추가하지 말고 미검증 범위와 필요한 브라우저 확인을 명시한다.

실행할 정적·단위 검증(구현 완료 후 `frontend` 디렉터리):

```powershell
npm.cmd run test:audio
npm.cmd run test:interview
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
```

저장소 루트에서 `git diff --check`와 변경 파일 범위를 확인한다. 카메라·마이크·외부 STT/TTS 실제 E2E는 사용자 승인된 환경에서만 별도 실행한다. 장치 검증은 조용한 방·지속 소음·작은 목소리·발화 중 잠깐 침묵·마이크 교체를 포함하고, 보정 휴리스틱의 성능 한계와 조정한 상수를 기록한다. 실측 전에는 ‘소음 환경 문제 해결 완료’라고 보고하지 않는다.

### 이번 세션의 확인 결과

| 확인 | 결과 |
|---|---|
| 종료 UI·호출부·공통 처리·모드 전환 | 현재 소스 직접 확인 |
| 실시간·offline Silero·RMS fallback·장치/STT 설정 | 현재 소스 직접 확인 |
| 설치된 VAD API와 프레임 종료 규칙 | `@ricky0123/vad-web@0.0.30`의 JS·타입 직접 확인 |
| `npm.cmd run test:audio` | 6 passed |
| `npm.cmd run test:interview` | 19 passed |
| 실제 버튼 조작·종료 경쟁·VAD 모델 추론 | 이번 세션 미실행 |
| lint·TypeScript·production build | 문서 작업이므로 이번 세션 미실행. 이전 문서의 통과 기록과 구분 |
| 실제 카메라·마이크·외부 API E2E | 미실행 |

현재 shell 기본 실행은 `CreateProcess ... helper_unknown_error: setup refresh had errors`로 실패했지만, 승인된 대체 실행 권한에서 코드 읽기와 위 단위 테스트가 실제 실행됐다. 다음 세션에서도 환경 오류가 재현되면 명령 문법이나 제품 코드를 바꿔 해결하려 하지 않는다. `.env`와 비밀 파일은 읽지 않았다.

최종 인계 보고는 이 문서의 현재/수정/판정 표를 유지하고, 구현한 파일·실행한 검증·남은 장치 확인만 갱신한다. 기존 `.agents/`와 무관한 사용자 파일은 건드리지 않는다. 커밋·푸시는 별도 요청 범위로 남긴다.

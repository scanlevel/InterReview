# Track B — 로컬 TTS·음성 종료 구현 계획 및 검증 기록

작성: 2026-09-07
상태: Supertonic 3 구현·설치·질문 TTS 선생성·종료 안내 병행·서비스 smoke·회귀 검증 완료. 실제 장치·목표 노트북·청취 품질은 미검증.

## 1. 목표와 경계

질문과 고정 안내를 설치된 로컬 한국어 TTS로 재생한다. 설치 뒤 질문 합성은 외부 네트워크 없이 동작하며, 질문 음성을 서버 디스크에 저장하지 않는다. 기존 CLOVA STT, 질문 생성, LLM, 음성·시선 결과 계약은 유지한다.

실제 .env는 읽거나 수정하지 않았다. 모델 설치는 backend/models/tts/의 무시된 경로에만 수행했고 커밋·푸시는 하지 않는다. 실제 카메라·마이크·스피커·외부 API E2E는 승인되지 않아 실행하지 않았다.

## 2. 모델 선정

| 항목 | 결정 |
|---|---|
| 1차 모델 | Supertonic 3, supertonic-3 |
| Python SDK | supertonic==1.3.1 |
| 모델 revision | 724fb5abbf5502583fb520898d45929e62f02c0b |
| CPU 설정 | 기본 intra-op 2 thread, inter-op 1 |
| 화자 | 허용 목록 M1~M5, F1~F5; 기본 M1 |
| 라이선스 | 모델 저장소의 OpenRAIL-M, Python SDK 저장소의 MIT |
| 다음 후보 | Supertonic 2. 이번 작업에서는 다운로드·비교 측정을 하지 않음 |

Supertonic 공식 프로젝트가 개발·지원 종료 상태임을 전제로 revision, SDK 버전, 필수 파일 SHA-256을 고정했다. Voice Builder를 새 화자 생성 절차로 사용하지 않는다. 이미지에서 성별·연령을 추정하지 않으며, 장치 설정에서 고른 voice_id를 세션 전체에 전달한다.

공식 출처: [Supertonic 프로젝트](https://github.com/supertone-inc/supertonic), [Supertonic Python SDK](https://github.com/supertone-inc/supertonic-py), [Supertonic 3 모델](https://huggingface.co/Supertone/supertonic-3).

## 3. 고정 버전과 설치

### 백엔드

- backend/pyproject.toml: supertonic==1.3.1
- 설치 스크립트 다운로드 클라이언트: lock 기준 huggingface_hub==1.30.0
- 모델 경로: backend/models/tts/supertonic3/
- 필수 ONNX·unicode indexer·10개 voice style 파일의 SHA-256을 backend/tools/install_local_tts.py에 고정
- MODEL_MANIFEST.json에 모델 revision, SDK, voice 목록, 설치 파일별 크기와 SHA-256 기록

새 환경 재현 명령:

```powershell
Set-Location -LiteralPath D:\Projects\InterReview\backend
uv sync
uv run python tools/install_local_tts.py --threads 2
```

스크립트는 기존 destination을 덮어쓰지 않고 임시 staging 폴더에서 다운로드·경로/심볼릭 링크·필수 파일·SHA-256을 검사한 뒤 원자적으로 이동한다. 다운로드 중단, 해시 불일치, 위험한 링크가 발생하면 staging을 지우고 기존 설치를 보존한다. 런타임에는 자동 다운로드하지 않는다.

설치된 현재 로컬 검증 결과:

- 파일 86개, 총 407,733,938 bytes(약 388.9 MiB)
- 10개 화자 × 3개 고정 안내 WAV = 30개
- MODEL_MANIFEST.json 생성, staging 잔여물 0개

### 프론트엔드 VAD

- @ricky0123/vad-web==0.0.30
- onnxruntime-web은 lockfile에 고정된 패키지 의존성으로 사용
- frontend/public/vad/에 worklet, ONNX, WASM 파일을 복사해 브라우저 런타임 네트워크 의존성 제거
- legacy Silero 모델을 실시간·녹음 후 분석에 공통 사용

설치 명령:

```powershell
Set-Location -LiteralPath D:\Projects\InterReview\frontend
npm.cmd install
```

## 4. 구현 계약

### TTS

- POST /tts 요청에 선택적 voice_id를 추가하고 허용 목록 밖은 422로 거부한다.
- 고정 안내는 model version + voice_id + text를 캐시 키로 사용한다. 질문 오디오는 세션 메모리에서 현재·다음 질문만 Promise/Blob으로 공유하고 디스크에는 저장하지 않는다.
- 질문·시작·종료 안내·마지막 인사는 같은 세션 화자를 사용한다.
- 백엔드 진단 코드는 model_missing, model_load, synthesis, guide_missing으로 분리한다.
- 프론트는 요청 timeout, 자동재생 차단, 재생 timeout, 재생 실패, 취소를 구분한다.
- 성공·실패·취소·timeout 모두 Audio, 이벤트, 타이머, Blob URL을 정리한다.
- 질문 안내 실패는 화면 질문과 수동 녹음으로 복구한다. 종료 안내 실패는 답변 처리와 다음 단계 진행을 막지 않으며, 마지막 인사 실패는 결과 화면을 막지 않는다.
- 질문 원문·개인정보·음성·비밀값을 로그에 남기지 않는다.

### 시작

기본 자동 모드는 켜져 있다. 화자 확정 뒤 첫 질문 음성을 준비하고, 흐름은 질문 낭독 → 시작 안내 → 즉시 답변 녹음이다. 답변 녹음 중 다음 질문 음성을 한 건만 선생성하며, 낭독 중 바로 답변 시작을 누르면 진행 중 TTS와 예약 작업을 취소하고 녹음을 한 번만 시작한다. 자동 모드를 끄면 기존 수동 녹음 버튼을 사용한다.

TTS가 끝나기 전 녹음·시선 측정을 시작하지 않으며, 모든 비동기 완료 지점에서 실행 식별자를 확인한다.

답변 녹음과 시선 측정을 먼저 끝내고 답변 Blob을 확보한 뒤, 종료 안내 재생과 답변 WAV 변환·STT·측정값 계산을 병행한다. 두 작업이 모두 정리될 때까지 다음 질문으로 이동하지 않는다.

### Silero VAD와 자동 종료

초기값:

- 양성/음성 종료 threshold: 0.6 / 0.35
- 최소 유효 발화: 250 ms
- 유효 발화 뒤 연속 무음: 4,000 ms
- 첫 유효 발화 전에는 자동 종료를 시작하지 않음

공유 마이크 stream에 echoCancellation·noiseSuppression을 ideal로 요청하고 autoGainControl은 끈다. VAD는 shared track을 종료하지 않는다. 로딩 실패 시 자동 모드를 수동 종료로 전환하고 종료 버튼을 남긴다. 녹음 후 측정도 같은 Silero speech frame 정책을 사용하며 결과의 긴 무음(LONG_PAUSE_SEC) 2초와 자동 종료 4초는 목적이 다른 설정으로 유지한다.

확인 녹음·확인 STT 분기는 두지 않는다. 유효 발화 뒤 4초 무음 또는 사용자의 답변 종료 버튼이 한 번만 답변 처리를 시작하며, 종료 안내 음성은 답변·시선 측정 구간 밖에서 재생한다.

## 5. 검증 기록

### 자동·정적·서비스 검증

- 백엔드 전체: 115 passed, 1 skipped(Windows symlink 권한)
- 프론트 면접/API/TTS/질문 캐시: 18 passed
- 프론트 오디오/VAD 측정: 6 passed
- 프론트 시선: 13 passed
- TypeScript: npx.cmd tsc --noEmit 통과
- ESLint: 통과
- Next production build: 통과
- 실제 Supertonic 서비스: 선택 화자 질문 WAV와 고정 안내 WAV 생성 성공
- 실제 FastAPI /tts: 질문과 안내 모두 200, audio/wav, no-store, RIFF 반환
- 모델 설치: 26개 snapshot 파일 다운로드, voice별 안내 30개 생성, 임시 staging 잔여물 없음
- 현재 호스트 CPU 2 thread 측정: 초기 한국어 1.799초, 반복 한국어 0.708초, 영문 기술명 혼합 F2 1.432초, 20문장 장문 28.526초

위 합성 시간은 개발 호스트 측정이며 노트북 결과가 아니다. 최대 native memory는 이번 실행에서 신뢰 가능한 값으로 수집하지 못했으므로 미측정으로 남긴다.

### 미검증 항목

- 실제 스피커 청취: 한국어 발음, 영문 기술명, 숫자·기호, 장문 누락·음색·음량 일관성
- 승인된 노트북에서 초기 로딩, 반복 합성, 최대 메모리, 설치 용량, 카메라·시선 동시 실행 지연
- 실제 카메라·마이크에서 안내 음성·스피커 잔향·종료 안내 음성이 답변/시선 측정에 섞이지 않는지
- 실제 브라우저 InterviewView의 카메라·마이크 장치 E2E
- 개선 전후 녹음 종료→다음 질문 음성 시작 지연과 TTS 요청 횟수의 실제 브라우저 비교
- Supertonic 2의 자원 비교 및 품질 재평가

모의 장치·순수 상태 전이·API/재생 회귀 통과는 위 실제 장치·노트북·청취 항목의 완료를 의미하지 않는다.

## 6. 완료 후 운영 규칙

모델을 바꿀 때는 SDK, revision, 필수 파일 hash, 설치 용량, CPU 2 thread의 초기/반복 합성 시간, 청취 결과를 이 문서와 manifest에 함께 갱신한다. 발음 정규화가 필요해도 화면 질문·평가 입력은 보존하고 합성 입력에만 적용한다. 커밋·푸시는 별도 요청이 있을 때만 수행한다.

공통 검증 명령:

```powershell
Set-Location -LiteralPath D:\Projects\InterReview\backend
uv run pytest -q -p no:cacheprovider

Set-Location -LiteralPath D:\Projects\InterReview\frontend
npm.cmd run test:audio
npm.cmd run test:interview
npm.cmd run test:gaze
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
```

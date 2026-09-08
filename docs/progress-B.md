# InterReview Track B 진행 현황

## 통합 문서 읽기 및 최신 대조 (2026-09-08)

이 문서는 이전 보고서·계획·참고 코드를 원본별로 보존한 통합 기록이다. 아래 2026-09-01 요약과 각 원본의 기준일·브랜치·미완료 체크박스·커밋 금지 문구는 당시 기록이며 현재 상태 전체를 뜻하지 않는다. 최신 구현 기준은 후반부 `plan-B-feature-improvements-final.md`와 `plan-B-local-tts.md` 원본 절이다. 삭제된 문서 경로가 나오는 경우 이 문서의 같은 이름 원본 절을 참조한다.

`codex/b-feature-improvements`의 `1d0095c` 구현을 대조한 결과, 4+2 질문 구성과 domain별 fallback, 수동/자동 진행, Supertonic 3, 질문 음성 선생성, Silero VAD와 유효 발화 후 4초 자동 종료의 핵심 흐름은 기록과 일치한다. 다음 세부 차이는 구분한다.

- 자소서가 비어 있어도 `technologies` 또는 `projects`에 근거가 있으면 생성 질문을 시도한다. 허용 근거 전체가 비어 있을 때 bank로 fallback한다.
- 종료 안내와 답변 처리를 병행하는 경로는 VAD 자동 종료다. 수동 `답변 종료` 버튼은 안내 없이 답변을 처리한다.
- 설치 시 준비하는 안내는 화자별 시작·확인·마지막 인사 3개다. 실제 자동 종료의 답변 접수 안내는 요청 시 합성하고 프론트 메모리에 캐시한다.
- domain별 fallback은 검증 가능한 응답 항목에 적용한다. structured 응답 자체의 스키마 파싱이 실패하면 전체 bank fallback이 가능하다. 앞선 적대적 분석의 의미적 근거 검증 한계까지 해결되었다는 뜻은 아니다.

이번 재검증: backend 115 passed, 1 skipped; frontend audio 6, interview/API/TTS/cache 18, gaze 13 passed; ESLint, TypeScript, production build 통과. 실제 `.env` 읽기를 비활성화한 백엔드 테스트이며, 과거 서비스 smoke·합성 시간·모델 설치 측정은 재실행하지 않았다. 실제 장치·청취·노트북 E2E는 여전히 미검증이다. 이번 사용자의 요청으로 문서 통합 변경의 커밋·푸시가 승인되었다.

---

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

---

## 원본: `reference/eyetracking.py`

```python
# Legacy reference only: this file is not imported by the Track B runtime.
# Current browser implementation: frontend/lib/gaze.ts.

from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path
import shutil
import tempfile
from threading import Lock
from typing import Any
import time

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


APP_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(
    os.environ.get("FACE_LANDMARKER_MODEL_PATH", APP_ROOT / "face_landmarker.task")
).expanduser()


def _model_path_for_mediapipe(model_path: Path) -> Path:
    """Return a Windows-safe model path for MediaPipe's native file loader.

    Some MediaPipe Windows builds cannot open a task file whose absolute path
    contains non-ASCII characters. This happens when the project lives in a
    Korean-named folder such as ``D:\\졸과``. Copy the immutable model asset to
    the system temporary directory only in that case; Docker/Linux paths are
    used directly.
    """
    if os.name != "nt" or str(model_path).isascii():
        return model_path

    cache_dir = Path(tempfile.gettempdir()) / "interreview-assets"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached_path = cache_dir / model_path.name
    if not cached_path.exists() or cached_path.stat().st_size != model_path.stat().st_size:
        shutil.copy2(model_path, cached_path)
    return cached_path


LEFT_IRIS = [468, 469, 470, 471, 472]
RIGHT_IRIS = [473, 474, 475, 476, 477]

LEFT_EYE_CORNERS = (33, 133)
RIGHT_EYE_CORNERS = (362, 263)

LEFT_EYE_TOP_BOTTOM = (159, 145)
RIGHT_EYE_TOP_BOTTOM = (386, 374)

NOSE_TIP = 1

LEFT_EYE_CONTOUR = [33, 160, 158, 133, 153, 144, 145, 163, 7, 33]
RIGHT_EYE_CONTOUR = [362, 385, 387, 263, 373, 380, 374, 390, 249, 362]


def normalize(v: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    n = np.linalg.norm(v)

    if n < eps:
        return np.zeros_like(v)

    return v / n


def landmark_3d(landmark) -> np.ndarray:
    return np.array(
        [landmark.x, landmark.y, landmark.z],
        dtype=np.float32,
    )


def landmark_to_pixel(landmark, width: int, height: int) -> np.ndarray:
    return np.array(
        [landmark.x * width, landmark.y * height],
        dtype=np.float32,
    )


def average_iris_center_3d(
    landmarks,
    iris_indices: list[int],
) -> tuple[np.ndarray, np.ndarray]:
    pts = np.array(
        [landmark_3d(landmarks[index]) for index in iris_indices],
        dtype=np.float32,
    )

    return pts.mean(axis=0), pts


def average_iris_center_2d(
    landmarks,
    iris_indices: list[int],
    width: int,
    height: int,
) -> tuple[np.ndarray, np.ndarray]:
    pts = np.array(
        [
            landmark_to_pixel(landmarks[index], width, height)
            for index in iris_indices
        ],
        dtype=np.float32,
    )

    return pts.mean(axis=0), pts


def build_face_local_frame(landmarks) -> dict[str, np.ndarray] | None:
    left_eye_center = (
        landmark_3d(landmarks[LEFT_EYE_CORNERS[0]])
        + landmark_3d(landmarks[LEFT_EYE_CORNERS[1]])
    ) / 2.0

    right_eye_center = (
        landmark_3d(landmarks[RIGHT_EYE_CORNERS[0]])
        + landmark_3d(landmarks[RIGHT_EYE_CORNERS[1]])
    ) / 2.0

    nose = landmark_3d(landmarks[NOSE_TIP])
    origin = (left_eye_center + right_eye_center) / 2.0

    x_axis = normalize(right_eye_center - left_eye_center)
    y_hint = nose - origin
    z_axis = normalize(np.cross(x_axis, y_hint))
    y_axis = normalize(np.cross(z_axis, x_axis))

    if np.linalg.norm(x_axis) < 1e-5:
        return None

    if np.linalg.norm(y_axis) < 1e-5:
        return None

    if np.linalg.norm(z_axis) < 1e-5:
        return None

    return {
        "origin": origin,
        "x_axis": x_axis,
        "y_axis": y_axis,
        "z_axis": z_axis,
    }


def get_eye_rotation_feature(
    landmarks,
    iris_indices: list[int],
    corner_indices: tuple[int, int],
    top_bottom_indices: tuple[int, int],
    face_frame: dict[str, np.ndarray],
) -> dict[str, Any]:
    iris_center, _ = average_iris_center_3d(landmarks, iris_indices)

    c0 = landmark_3d(landmarks[corner_indices[0]])
    c1 = landmark_3d(landmarks[corner_indices[1]])
    top = landmark_3d(landmarks[top_bottom_indices[0]])
    bottom = landmark_3d(landmarks[top_bottom_indices[1]])

    eye_center = (c0 + c1 + top + bottom) / 4.0

    eye_width = abs(np.dot(c1 - c0, face_frame["x_axis"]))
    eye_height = abs(np.dot(bottom - top, face_frame["y_axis"]))

    eye_width = max(eye_width, 1e-4)
    eye_height = max(eye_height, 1e-4)

    delta = iris_center - eye_center

    local_x = np.dot(delta, face_frame["x_axis"]) / eye_width
    local_y = np.dot(delta, face_frame["y_axis"]) / eye_height
    local_z = np.dot(delta, face_frame["z_axis"])

    return {
        "local_x": float(local_x),
        "local_y": float(local_y),
        "local_z": float(local_z),
    }


def draw_eye_landmarks(frame: np.ndarray, landmarks) -> np.ndarray:
    height, width = frame.shape[:2]

    for contour in (LEFT_EYE_CONTOUR, RIGHT_EYE_CONTOUR):
        pts = np.array(
            [
                landmark_to_pixel(landmarks[index], width, height)
                for index in contour
            ],
            dtype=np.int32,
        )

        cv2.polylines(
            frame,
            [pts],
            False,
            (0, 255, 255),
            1,
            cv2.LINE_AA,
        )

    for iris_indices, label in (
        (LEFT_IRIS, "L"),
        (RIGHT_IRIS, "R"),
    ):
        center, pts = average_iris_center_2d(
            landmarks,
            iris_indices,
            width,
            height,
        )

        for point in pts.astype(np.int32):
            cv2.circle(
                frame,
                tuple(point),
                2,
                (0, 255, 0),
                -1,
            )

        center_point = tuple(center.astype(int))

        cv2.circle(
            frame,
            center_point,
            5,
            (0, 0, 255),
            -1,
        )

        cv2.circle(
            frame,
            center_point,
            8,
            (255, 255, 255),
            1,
        )

        cv2.putText(
            frame,
            label,
            (center_point[0] + 8, center_point[1] - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 255, 0),
            1,
            cv2.LINE_AA,
        )

    return frame


@dataclass
class EyeTrackingState:
    total_frames: int = 0
    processed_frames: int = 0
    face_detected_frames: int = 0
    started_at: float = field(default_factory=time.perf_counter)
    last_timestamp_ms: int = 0
    samples: list[dict[str, Any]] = field(default_factory=list)
    last_sample: dict[str, Any] | None = None


class EyeTracker:
    def __init__(self) -> None:
        if not MODEL_PATH.exists():
            raise FileNotFoundError(
                "face_landmarker.task 파일이 없습니다. "
                "프로젝트 루트에 face_landmarker.task를 넣어 주세요."
            )

        self.lock = Lock()
        self.state = EyeTrackingState()

        base_options = python.BaseOptions(
            model_asset_path=str(_model_path_for_mediapipe(MODEL_PATH)),
        )

        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=False,
            output_facial_transformation_matrixes=False,
        )

        self.landmarker = vision.FaceLandmarker.create_from_options(options)

    def reset(self) -> None:
        with self.lock:
            self.state = EyeTrackingState()

    def process_bgr_frame(
        self,
        frame_bgr: np.ndarray,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        with self.lock:
            return self._process_bgr_frame_locked(frame_bgr)

    def _process_bgr_frame_locked(
        self,
        frame_bgr: np.ndarray,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        self.state.total_frames += 1
        self.state.processed_frames += 1

        display_frame = frame_bgr.copy()

        rgb = cv2.cvtColor(display_frame, cv2.COLOR_BGR2RGB)

        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=rgb,
        )

        raw_timestamp_ms = int(
            (time.perf_counter() - self.state.started_at) * 1000
        )

        timestamp_ms = max(
            raw_timestamp_ms,
            self.state.last_timestamp_ms + 1,
        )

        self.state.last_timestamp_ms = timestamp_ms

        result = self.landmarker.detect_for_video(
            mp_image,
            timestamp_ms,
        )

        if not result.face_landmarks:
            sample = {
                "timestamp": time.time(),
                "face_detected": False,
                "face_frame_valid": False,
                "left_eye": None,
                "right_eye": None,
                "gaze_x": None,
                "gaze_y": None,
            }

            self.state.samples.append(sample)
            self.state.last_sample = sample

            return display_frame, sample

        self.state.face_detected_frames += 1

        landmarks = result.face_landmarks[0]

        annotated = display_frame.copy()
        draw_eye_landmarks(annotated, landmarks)

        face_frame = build_face_local_frame(landmarks)

        if face_frame is None:
            sample = {
                "timestamp": time.time(),
                "face_detected": True,
                "face_frame_valid": False,
                "left_eye": None,
                "right_eye": None,
                "gaze_x": None,
                "gaze_y": None,
            }

            self.state.samples.append(sample)
            self.state.last_sample = sample

            return annotated, sample

        left_feature = get_eye_rotation_feature(
            landmarks,
            LEFT_IRIS,
            LEFT_EYE_CORNERS,
            LEFT_EYE_TOP_BOTTOM,
            face_frame,
        )

        right_feature = get_eye_rotation_feature(
            landmarks,
            RIGHT_IRIS,
            RIGHT_EYE_CORNERS,
            RIGHT_EYE_TOP_BOTTOM,
            face_frame,
        )

        gaze_x = float(
            np.mean(
                [
                    left_feature["local_x"],
                    right_feature["local_x"],
                ]
            )
        )

        gaze_y = float(
            np.mean(
                [
                    left_feature["local_y"],
                    right_feature["local_y"],
                ]
            )
        )

        sample = {
            "timestamp": time.time(),
            "face_detected": True,
            "face_frame_valid": True,
            "left_eye": {
                "local_x": round(left_feature["local_x"], 4),
                "local_y": round(left_feature["local_y"], 4),
                "local_z": round(left_feature["local_z"], 4),
            },
            "right_eye": {
                "local_x": round(right_feature["local_x"], 4),
                "local_y": round(right_feature["local_y"], 4),
                "local_z": round(right_feature["local_z"], 4),
            },
            "gaze_x": round(gaze_x, 4),
            "gaze_y": round(gaze_y, 4),
        }

        self.state.samples.append(sample)
        self.state.last_sample = sample

        cv2.putText(
            annotated,
            f"gaze_x={gaze_x:+.3f}, gaze_y={gaze_y:+.3f}",
            (20, 32),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        return annotated, sample

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            processed_frames = max(self.state.processed_frames, 1)

            face_detected_ratio = (
                self.state.face_detected_frames / processed_frames
            )

            valid_samples = [
                sample
                for sample in self.state.samples
                if sample.get("face_detected") is True
                and sample.get("face_frame_valid") is True
                and sample.get("gaze_x") is not None
                and sample.get("gaze_y") is not None
            ]

            gaze_x_values = [
                sample["gaze_x"]
                for sample in valid_samples
            ]

            gaze_y_values = [
                sample["gaze_y"]
                for sample in valid_samples
            ]

            if valid_samples:
                avg_gaze_x = float(np.mean(gaze_x_values))
                avg_gaze_y = float(np.mean(gaze_y_values))
                std_gaze_x = float(np.std(gaze_x_values))
                std_gaze_y = float(np.std(gaze_y_values))
            else:
                avg_gaze_x = None
                avg_gaze_y = None
                std_gaze_x = None
                std_gaze_y = None

            center_samples = [
                sample
                for sample in valid_samples
                if abs(sample["gaze_x"]) <= 0.18
                and abs(sample["gaze_y"]) <= 0.20
            ]

            front_gaze_ratio = (
                len(center_samples) / len(valid_samples)
                if valid_samples
                else 0.0
            )

            return {
                "total_frames": self.state.total_frames,
                "processed_frames": self.state.processed_frames,
                "face_detected_frames": self.state.face_detected_frames,
                "face_detected_ratio": round(face_detected_ratio, 3),
                "valid_gaze_samples": len(valid_samples),
                "front_gaze_ratio": round(front_gaze_ratio, 3),
                "avg_gaze_x": (
                    None
                    if avg_gaze_x is None
                    else round(avg_gaze_x, 4)
                ),
                "avg_gaze_y": (
                    None
                    if avg_gaze_y is None
                    else round(avg_gaze_y, 4)
                ),
                "std_gaze_x": (
                    None
                    if std_gaze_x is None
                    else round(std_gaze_x, 4)
                ),
                "std_gaze_y": (
                    None
                    if std_gaze_y is None
                    else round(std_gaze_y, 4)
                ),
                "last_sample": self.state.last_sample,
            }
```

---

## 원본: `add_provider.md`

# Gemini provider 추가 계획

## 1. 목적

현재 Anthropic 전용인 공용 LLM 계층에 Gemini를 추가한다.

기존 서비스의 호출 방식은 유지한다.

```text
essay / personalize / answer_review
→ llm.call_text() 또는 llm.call_structured()
→ LLM_PROVIDER에 맞는 provider 호출
→ 기존과 동일한 str 또는 Pydantic 모델 반환
```

이번 변경은 provider 선택 계층까지만 다룬다. 프롬프트, API endpoint, Pydantic 응답 모델, 프론트엔드 계약은 변경하지 않는다.

## 2. 현재 구조

- `backend/app/services/llm.py`만 외부 LLM API를 호출한다.
- `call_text()`는 Anthropic `client.messages.create()`를 호출하고 `str`을 반환한다.
- `call_structured()`는 Anthropic `client.messages.parse()`를 호출하고 검증된 Pydantic 객체를 반환한다.
- Anthropic client는 `get_client()`에서 프로세스당 한 번 생성된다.
- SDK 전송 오류와 schema 불일치는 `LLMError` 계열로 통일된다.
- 개인화와 답변 분석 서비스가 각각의 fallback을 담당한다.

이 공개 계약은 그대로 유지한다.

## 3. 권장 구조

provider가 두 개뿐이므로 별도 factory, 추상 클래스, plugin registry는 만들지 않는다.

`llm.py`를 공용 facade로 유지하고 내부에 provider별 private 함수를 둔다.

```text
call_text()
├─ anthropic → _call_anthropic_text()
└─ gemini    → _call_gemini_text()

call_structured()
├─ anthropic → _call_anthropic_structured()
└─ gemini    → _call_gemini_structured()
```

공통 책임:

- provider 선택
- client 재사용
- `str` 또는 Pydantic 모델 반환
- provider별 예외를 `LLMNotConfiguredError` / `LLMCallError`로 변환
- structured output schema 불일치 시 현재와 동일하게 한 번만 재시도

provider별 책임:

- client 생성
- system/user prompt를 각 SDK 요청 형식으로 변환
- 응답 text 추출
- Pydantic structured output 추출 및 검증

## 4. 환경변수 계약

권장 기본값:

```env
LLM_PROVIDER=anthropic

ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# 선택 사항: 비워두면 provider별 기본 모델 사용
EVAL_MODEL=
PERSONALIZE_MODEL=
```

provider 전환 예:

```env
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
```

규칙:

- `LLM_PROVIDER`는 `anthropic` 또는 `gemini`만 허용한다.
- 기본 provider는 기존 동작 보존을 위해 `anthropic`으로 둔다.
- 기존 `ANTHROPIC_API_KEY`는 이름과 동작을 유지한다.
- `EVAL_MODEL`, `PERSONALIZE_MODEL`이 있으면 공통 override로 사용한다.
- 모델 override가 없으면 provider별 기본 모델을 사용한다.
- Gemini 기본 모델은 구현 시 사용 가능한 안정 모델을 확인하여 설정하고, 환경변수로 교체 가능하게 둔다.
- 환경변수 변경은 캐시된 settings/client 때문에 backend 재시작 후 반영된다.

## 5. Gemini 호출 방식

공식 `google-genai` Python SDK를 사용한다.

### Text

```text
genai.Client(api_key=...)
→ client.models.generate_content(...)
→ response.text.strip()
→ str 반환
```

### Structured output

```text
Pydantic output_format
→ GenerateContentConfig(
     response_mime_type="application/json",
     response_schema=output_format
   )
→ client.models.generate_content(...)
→ response.parsed 또는 output_format.model_validate_json(response.text)
→ 검증된 Pydantic 객체 반환
```

Gemini도 Pydantic schema 기반 structured output을 지원하므로 기존 서비스의 `output_format` 인자는 유지할 수 있다. Gemini가 지원하는 JSON Schema 범위에 현재 `EssayAnalysis`와 답변 피드백 모델이 포함되는지는 단위 테스트로 확인한다.

## 6. 수정 예상 파일

### 필수

- `backend/app/config.py`
  - `LLM_PROVIDER`, `GEMINI_API_KEY` 추가
  - provider별 기본 모델 선택
  - 기존 Anthropic 설정 호환 유지
- `backend/app/services/llm.py`
  - 기존 공개 함수 유지
  - Anthropic/Gemini client 캐시 분리
  - provider dispatcher와 Gemini private 호출 추가
  - provider별 오류를 기존 `LLMError`로 통일
- `backend/pyproject.toml`
  - `google-genai` 의존성 추가
- `backend/uv.lock`
  - 기존 uv 흐름으로 lock 갱신
- `backend/.env.example`
  - provider 및 Gemini 설정 예시 추가
- `backend/tests/test_config.py`
  - provider validation, 기본값, model override 테스트
- `backend/tests/test_llm.py`
  - 기존 Anthropic 회귀 테스트 유지
  - Gemini text/structured/error/선택 테스트 추가

### 변경하지 않음

- `backend/app/services/essay.py`
- `backend/app/services/personalize.py`
- `backend/app/services/answer_review.py`
- `backend/app/prompts/*`
- router/schema/frontend

공개 `llm.call_text()`와 `llm.call_structured()` 계약을 유지하므로 위 호출자는 수정할 필요가 없다.

## 7. 구현 단계

### P0. 설정 계약 추가

- `LLM_PROVIDER`를 제한된 문자열 타입으로 추가한다.
- Gemini key와 provider별 기본 모델 해석을 추가한다.
- 기존 Anthropic 환경에서 설정 변경 없이 같은 모델과 key가 선택되는지 테스트한다.

완료 조건:

- provider 미지정 시 기존 Anthropic 설정이 그대로 나온다.
- 잘못된 provider는 시작 시 설정 오류가 난다.
- Gemini 선택 시 Anthropic key가 없어도 `is_configured()`가 Gemini key를 확인한다.

### P1. Gemini client와 dispatcher 추가

- 기존 Anthropic 요청 코드를 동작 변경 없이 private 경로로 정리한다.
- Gemini client를 프로세스당 한 번 캐시한다.
- `call_text()`와 `call_structured()`에서 선택된 provider만 호출한다.
- Gemini API/validation 오류를 기존 공통 예외로 변환한다.

완료 조건:

- 기존 서비스 코드를 바꾸지 않고 provider만 전환할 수 있다.
- 두 provider 모두 동일한 반환 타입을 제공한다.
- 한 provider의 key가 없을 때 다른 provider 설정에 영향을 주지 않는다.

### P2. 의존성·예제 환경 정리

- `google-genai`를 backend dependency와 lockfile에 반영한다.
- `.env.example`에 최소 전환 예시를 기록한다.
- 실제 secret은 생성하거나 커밋하지 않는다.

### P3. 검증

기본 테스트에서는 두 SDK client를 모두 mock하며 실제 외부 API를 호출하지 않는다.

필수 테스트:

- 기본 provider가 Anthropic인지
- `LLM_PROVIDER=anthropic`에서 기존 요청 인자가 변하지 않는지
- `LLM_PROVIDER=gemini`에서 Gemini client만 호출되는지
- provider별 key 누락 시 `LLMNotConfiguredError`
- Gemini text 응답 추출과 빈 응답 처리
- Gemini structured 응답의 Pydantic 반환
- Gemini structured schema 불일치 재시도 후 실패
- Gemini SDK 오류가 `LLMCallError`로 변환되는지
- `EVAL_MODEL` / `PERSONALIZE_MODEL` override
- 기존 essay, personalization, answer review 테스트 회귀 없음

실행 예정:

```bash
cd backend
uv run pytest
uv run ruff check .
```

실제 Gemini smoke test는 `GEMINI_API_KEY` 사용 승인이 있을 때만 별도로 수행하고, mock 테스트와 구분해 보고한다.

## 8. 위험과 제한

- Anthropic의 `effort`와 Gemini의 thinking 설정은 계약이 다르다. Gemini에서 동일 의미가 명확하지 않으면 `effort`를 무시하고 provider별 추가 옵션을 만들지 않는다.
- Gemini structured output은 JSON Schema 일부만 지원한다. 현재 Pydantic schema가 거부되면 해당 schema를 단순화하되 API 응답 계약은 바꾸지 않는다.
- SDK별 retry 정책이 다르므로 이중 retry를 피한다. 전송 오류는 SDK 설정으로 처리하고, 공용 반복은 schema 불일치에만 사용한다.
- API key나 모델이 잘못되면 기능별 기존 fallback이 동작해야 하며 전체 면접을 실패시키지 않는다.

## 9. 최종 완료 조건

- 기존 Anthropic 동작과 테스트가 유지된다.
- 환경변수로 Anthropic/Gemini를 선택할 수 있다.
- 서비스와 프론트엔드 코드는 provider를 알 필요가 없다.
- text 호출은 항상 `str`, structured 호출은 항상 지정한 Pydantic 모델을 반환한다.
- 모든 provider 오류는 기존 `LLMError` 계약으로 처리된다.
- 실제 API key와 응답 원문을 저장하거나 로그에 남기지 않는다.

## 10. 이번 계획에서 제외

- 요청별 provider 혼용
- runtime provider 변경 API
- provider 자동 fallback
- 비용 기반 routing
- streaming
- 비동기 LLM client 전환
- 세 번째 provider를 위한 plugin/factory framework

필요가 확인되기 전까지는 환경변수로 하나의 provider를 선택하는 현재 규모만 지원한다.

---

## 원본: `B-feature-adversarial-review-2026-09-05.md`

# InterReview B파트 단기 변경 적대적 분석 보고서

작성일: 2026-09-05 · 기준: `codex/b-feature-improvements` / `cd37949` · 비교 기준: 직전 커밋 `067d47e`

## 1. 종합 판단

**구조적 방향은 타당하지만, 현재 상태를 최종 완료로 승인하기에는 핵심 계약에 빈틈이 있다.** 질문 중복 제거와 수정 답변의 평가 연결에서 재현 가능한 결함이 있으며, 원문 evidence 검증은 질문에 포함된 사실까지 보증하지 않는다. 새 기능 확장보다 아래 P1 항목의 보완이 먼저다. P1은 배포 전 우선 해결, P2는 다음 단기 수정 범위를 뜻한다.

분석은 이전 에이전트의 실행 문맥, 사용자가 최종 승인한 계획, 역할 문서, 실제 커밋과 호출 경로를 대조했다. 과거의 3+3 제안 대신 **질문은행 4개 + 근거 기반 최대 2개**, 수동 진행만을 기준으로 삼았다. TTS·자동 종료·STT 교체·간투사 계수의 미구현은 이번 결함으로 계산하지 않았다.

현재 백엔드는 여섯 도메인의 은행 질문을 먼저 확보하고 `resume`·`job_technology`만 생성 질문으로 교체한 뒤, 은행 개인화와 중복 처리를 수행한다. 프런트는 `InterviewView`가 녹음·WAV/VAD·STT·대기 상태를, 부모 `InterviewApp`이 질문 ID와 revision별 평가 Promise를 관리한다. 기존 순서·SHA-256 ID·공개 질문 응답의 evidence 비노출·실패 답변 LLM 차단은 확인했다.

## 2. 우선 발견 사항

### [P1] 개인화된 앞 문항이 뒤 문항의 원문과 같으면 최종 중복이 남는다 — 합성 실행으로 확인

`resolve_question_duplicates()`는 은행끼리 충돌할 때 **뒤 문항만** 원문으로 돌린다. 앞 문항이 개인화되어 뒤 문항의 원문과 같아진 경우, 뒤 문항은 이미 원문이므로 아무 변경도 하지 않고 종료한다. 서로 다른 원문 6개에서 이 상황을 만들자 최종 고유 문장이 **5개/6개**로 남았다. 반복 횟수를 늘려도 바뀔 대상 선택이 잘못되어 해결되지 않는다.

- 근거: [questions.py:443](D:/Projects/InterReview/backend/app/services/questions.py:443), [종료 조건:468](D:/Projects/InterReview/backend/app/services/questions.py:468).
- 영향: 최종 6문항 전체 중복 금지 계약 위반. 생성이 모두 fallback되어도 발생한다.
- 최소 조치: 충돌한 문항 중 실제로 개인화된 문항을 원문으로 복원하고 다시 검사한다. 앞 개인화/뒤 원문과 그 반대 방향을 모두 회귀 사례로 고정한다.

### [P1] STT 성공 답변을 수정하면 정상 평가가 최종 결과에서 사라진다 — 호출 경로로 확인

STT 완료 시 원래 transcript의 평가가 시작된다. 대기 화면의 textarea에서 수정하면 transcript와 revision은 달라지지만, `waiting_next`의 다음 질문 버튼과 최종 제출은 수정본을 `onAnswerFinalized`에 전달하지 않는다. 부모는 최종 revision에 맞는 기존 Promise만 찾으므로 **이미 평가가 끝났어도 “판단 불가”로 대체**한다. 수정하지 않은 답변에는 발생하지 않는다.

- 근거: [수정 처리:138](D:/Projects/InterReview/frontend/components/InterviewView.tsx:138), [이동·제출:309](D:/Projects/InterReview/frontend/components/InterviewView.tsx:309), [revision 조회:148](D:/Projects/InterReview/frontend/components/InterviewApp.tsx:148).
- 영향: 사용자에게 허용한 정상 편집 동작이 평가 누락을 일으키는 이번 변경의 회귀다. 이전에는 이동/종료 시 최신 답변으로 검토를 시작했다.
- 최소 조치: 다음/결과 버튼에서 최신 snapshot을 다시 확정하고 부모 registry에 전달한다. 동일 revision은 기존 Promise를 재사용하고, 최종 집계는 계속 이미 시작된 Promise만 기다리게 한다. 텍스트 편집 제거로 우회하면 이번 승인 범위를 바꾸게 된다.

### [P1] 실제 evidence를 붙여도 허구의 경험·기술 질문이 통과한다 — 합성 실행으로 확인

현재 검사는 evidence의 포함 여부와 일부 기술 토큰을 확인할 뿐, 질문의 전제가 그 근거에서 나오는지는 확인하지 않는다. 입력 `학교 프로젝트에 참여했습니다.`에 evidence `프로젝트`를 붙인 `대기업에서 10명 팀을 이끌어 매출을 300% 높인 방법은 무엇인가요?`가 `resume` 검증을 통과했다. 또한 입력 `MySQL을 사용했습니다.`에 evidence `MySQL`을 붙인 `MongoDB를 사용한 이유는 무엇인가요?`도 통과했다. 기존 관련성 사전이 MySQL과 MongoDB를 모두 `database`로 묶기 때문이다.

- 근거: [근거·질문 검증:51](D:/Projects/InterReview/backend/app/services/grounded_questions.py:51), [기술 별칭:19](D:/Projects/InterReview/backend/app/services/question_relevance.py:19).
- 영향: “근거 구절이 존재한다”를 “질문이 근거에 충실하다”로 해석할 수 없다. 이 실험은 검증기의 허용 범위를 입증하며, 실제 LLM의 환각 발생률을 측정한 것은 아니다.
- 최소 조치: A와 함께 기술 관련성 분류와 실제 사용 기술의 동일성 검사를 분리한다. 수치·역할·성과를 새 사실로 전제하는 질문에 대한 검증/생성 제약도 합의한다. 단순 토큰 검사만으로 모든 허구를 차단했다고 보고하지 않는다. 임베딩이나 추가 LLM 심사를 즉시 도입할 근거는 없다.

### [P2] 한 도메인의 구조 오류가 정상 도메인까지 버린다 — 합성 실행으로 확인

`GroundedQuestionSet.questions`가 엄격한 `list[GroundedQuestion]`이므로, 정상 resume 항목과 evidence가 빠진 기술 항목을 함께 반환하면 목록 전체 validation이 실패한다. 서비스는 두 슬롯 모두 `None`으로 반환했다. 실제 공용 LLM 계층도 같은 전체 스키마를 검증하므로 재시도까지 실패하면 정상 항목을 보존하지 못한다.

- 근거: [스키마:119](D:/Projects/InterReview/backend/app/schemas.py:119), [전체 응답 검증:110](D:/Projects/InterReview/backend/app/services/grounded_questions.py:110).
- 영향: 면접은 은행 6개로 계속되지만 “구조가 깨진 해당 도메인만 fallback” 계약에는 미달한다. 기존 부분 실패 테스트는 이미 모델로 만들어진 항목의 잘못된 근거만 다룬다.
- 최소 조치: A의 내부 반환 경계에서 envelope 파싱과 항목별 검증을 나눠 유효 항목을 보존한다. 공용 LLM 전체의 validation을 약화시키는 변경은 피한다.

### [P2] STT 실패 화면이 안내하는 재녹음 경로가 없다 — 화면 조건으로 확인

실패 뒤 `waiting_next`로 전이하면 녹음 버튼이 사라지고 이전 버튼도 비활성화된다. 그런데 안내는 “다시 녹음하거나 직접 입력하세요”라고 한다. 마지막 문항에서는 다음 문항에 갔다가 돌아오는 간접 재녹음도 불가능하다. 직접 입력은 남아 있지만 실패 STT 상태이므로 내용 평가 대상이 아니다. **실패 답변의 평가 차단 자체는 승인된 동작**이고, 복구 안내와 실제 가능 동작의 불일치가 문제다.

- 근거: [실패 안내:240](D:/Projects/InterReview/frontend/components/InterviewView.tsx:240), [녹음 버튼 조건:424](D:/Projects/InterReview/frontend/components/InterviewView.tsx:424), [평가 조건](D:/Projects/InterReview/frontend/lib/answerReview.ts:4).
- 최소 조치: 현 계약을 유지하려면 실제 가능한 “계속 진행/평가 불가”로 안내를 맞춘다. 재녹음까지 제공하려면 명시적 재시도 전이와 이전 결과 교체 규칙을 별도 확정한다.

## 3. 기존 위험과 검증의 한계

**기존부터 있던 위험을 이번 회귀와 구분해야 한다.** `/measurements` 실패 시 부모가 면접 화면을 다시 mount하지만 답변·측정값은 자식의 로컬 state에만 있어 초기화될 수 있다. 또한 STT fetch에 앱 차원의 취소·시간 제한이 없고, 최종 화면은 평가 Promise 전체를 기다린다. 응답이 끝나지 않는 상황은 reject를 잡는 것으로 복구되지 않는다. 이는 [InterviewApp:110](D:/Projects/InterReview/frontend/components/InterviewApp.tsx:110), [API 클라이언트:121](D:/Projects/InterReview/frontend/lib/api.ts:121)에 남은 기존 위험이며 이번 실제 장치/네트워크 장애 실험으로 재현한 것은 아니다.

이번 재검증 결과:

| 검사 | 결과와 해석 |
|---|---|
| 질문 테스트 | 20개 통과. 합성 설정과 외부 연결 차단으로 실행 |
| 면접 helper 테스트 | 6개 통과. 실제 React 화면·Promise registry 통합 검사는 아님 |
| TypeScript | `npx.cmd tsc --noEmit` 통과 |
| 적대적 합성 입력 | 중복 잔존, 허구 성과/기술 허용, 정상 도메인 동반 탈락 확인 |
| 장치·실제 STT/LLM E2E | 미실시 |

첫 백엔드 검사에서는 감사용 소켓 차단이 Windows 이벤트 루프의 내부 loopback까지 막아 테스트가 실패했다. loopback만 허용한 재실행에서 20개가 통과했으며, 첫 실패를 제품 결함으로 계산하지 않았다. 이전 에이전트가 기록한 전체 pytest 101개·Ruff·lint·build 통과는 **이전 검증 기록**이다. 이번에는 그 전체 검사를 다시 수행하지 않았다.

현재 신규 테스트에는 생성 두 문항끼리의 직접 충돌, 별도 프로세스에서의 SHA ID 비교, 실제 화면의 수정→이동→최종 평가, 늦은 응답과 중복 이벤트의 부수효과 검증이 없다. 상태 전이 함수가 올바르다는 사실만으로 이 시나리오의 완료를 주장할 수 없다.

## 4. 단기 처리 순서와 인계 조건

1. **B 우선:** 중복 복원 대상과 최신 답변 확정 경계를 수정하고 위 반례를 회귀 테스트로 남긴다.
2. **A/B 공동:** 근거의 보증 범위·기술 동일성·부분 구조 실패 계약을 확정한다. 이번 커밋에 A 소유로 명시된 생성 service/prompt도 포함되어 있으므로 공동 검토 대상으로 인계한다.
3. **B 마감:** 실패 안내를 실제 동작에 맞추고 마지막 질문·STT 실패·LLM 지연 중 이동을 mock 기반으로 연결 검증한다. 새 라이브러리는 필요하지 않다.

Phase 1과 2를 별도 커밋으로 나누라는 승인 계획과 달리 현재 두 기능은 `cd37949` 하나에 묶여 있다. 작동 결함은 아니지만 부분 되돌리기와 담당별 검토가 어려워진다. 또한 상세 실행 계획 파일은 현재 untracked여서 코드 커밋만 전달하면 계약 문서가 함께 전달되지 않는다. 인계 전에 문서 버전과 커밋 구성을 확인하되 이번 감사에서 Git 이력을 재작성하지 않았다.

**권고 판정: 부분 충족.** P1 반례 해소와 A/B 검증 계약 보강 후 재승인하는 것이 적절하다. TTS·자동 종료를 먼저 얹으면 현재의 답변 확정·오류 복구 경계가 더 복잡해진다. 이번 작업은 보고서 작성과 검증만 수행했으며 제품 코드는 수정하지 않았다.

---

## 원본: `handoff-to-B.md`

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

---

## 원본: `ict-question-bank-review-final.md`

# ICT 질문은행 최종 승인 검수 보고서

최종 검수본의 구조적 오류를 교정했고, 그 결과를 실제 런타임 질문은행에 반영했다.

## 1. 최종 판정 집계

| 판정 | 이전 adversarial | 최종 |
| --- | ---: | ---: |
| keep | 835 | 864 |
| comment | 163 | 133 |
| exclude | 29 | 30 |

## 2. 이전 adversarial 대비 변경

| 전환 | 개수 |
| --- | ---: |
| keep -> comment | 0 |
| keep -> exclude | 0 |
| comment -> keep | 26 |
| comment -> exclude | 4 |
| exclude -> comment | 0 |
| exclude -> keep | 3 |

## 3. service_group 수정 결과

Adversarial 대비 13개를 수정했다. HTTP/HTTPS 5개는 job_technology, 교대근무 2개와 #466/#552 조직 문항은 collaboration_organization, #589/#677은 motivation_commitment, #768/#829는 problem_solving으로 확정했다.

| 그룹 | 최종 개수 |
| --- | ---: |
| resume | 112 |
| values_personality | 297 |
| job_technology | 225 |
| problem_solving | 65 |
| collaboration_organization | 219 |
| motivation_commitment | 109 |

## 4. role_scope 수정 결과

57개를 수정했다. HTTP/HTTPS, VPN, 프록시, AWS, Android/iOS, 커널, SSD, C 프로세스 공간을 교정했고, ndc-015/062/064/066과 일반 개발 프로세스 문항의 devops 단독 태그를 frontend/backend/data_ai/devops/mobile로 넓혔다.

## 5. exclude 29개 재검토 결과

기존 29개 전부를 문장 단위로 재검토했다. #412/#457/#563은 국가 선호 질문으로 keep 복원했고, #185/#188/#525/#540은 평가 가치가 낮고 지나치게 자극적이어서 exclude로 확정했다. 최종 exclude는 30개다.

## 6. near-duplicate/decision 검증 결과

70개 cluster, 642개 문항을 검증했다. 교차 service_group 0, 설명되지 않은 decision 충돌 0이다. ndc-059는 자연스러운 13개를 keep, 실제 비문 #838/#842만 comment로 확정했다.

## 7. 알려진 회귀 사례 결과

HTTP/HTTPS cluster는 job_technology와 backend/security/infra_cloud/devops로 통일했다. #32는 mobile만 유지했다. 기존 7개 회귀쌍의 decision/service_group/cluster 일치도 유지했다.

## 8. 최종 자동 검증 결과

- questions_1027: PASS
- review_indices_complete: PASS
- unique_review_indices: PASS
- decision_values_valid: PASS
- decision_flags_consistent: PASS
- comment_payload_valid: PASS
- keep_payload_clean: PASS
- company_context_valid: PASS
- role_scopes_valid: PASS
- service_groups_valid: PASS
- cluster_count_70: PASS
- cross_service_cluster_zero: PASS
- unresolved_decision_conflict_zero: PASS
- human_review_zero: PASS
- http_https_fixed: PASS
- android_ios_mobile_only: PASS
- ndc_059_item_quality: PASS
- travel_preference_restored: PASS
- exclude_all_semantically_reviewed: PASS
- summary_matches_questions: PASS
- semantic_sanity_final: PASS

## 9. 최종 판정

FINAL REVIEW: PASS

---

## 원본: `interview-enhancement-feasibility-report.md`

# InterReview 질문·면접 진행·음성 처리 개선 검토 보고서

> 기준일: 2026-09-03
> 검토 대상: `B/llm_interface` 브랜치의 현재 코드, `docs/RoleDivision.md`, `docs/plan.md`, `docs/plan-A.md`, `docs/plan-B.md`
> 목적: 신규 6개 업무와 5개 계획 쟁점의 적용 가능성, A/B 경계, 구현 순서를 상위 체계에 보고
> 현재 TTS 적용 상태: 아래 브라우저/Cloud TTS 권고는 당시 검토 기록이다. 승인된 현재 구현은 `docs/plan-B-local-tts.md`의 Supertonic 3 로컬 CPU TTS를 따른다.

## 1. 종합 결론

제안된 기능은 현재 구조를 폐기하지 않고 확장할 수 있다. 질문은 기존의 여섯 도메인 계약을 유지하면서 **자소서 근거 질문 최대 3개 + 질문은행 기반 개인화 질문 나머지 3개**로 합치는 것이 가장 안전하다. 면접 진행은 현재 수동 녹음 구조를 상태 머신으로 확장하고, 질문 읽기는 당시 브라우저 TTS를 최소안으로 검토했으나 현재는 `docs/plan-B-local-tts.md`의 Supertonic 3으로 구현했다. 자동 종료는 기존 VAD를 활용한 장시간 무음 감지까지는 비교적 쉽게 적용할 수 있으나, “이상입니다” 같은 종료 키워드 감지는 현재의 녹음 종료 후 CLOVA 업로드 방식으로는 불가능하므로 스트리밍 STT가 필요하다.

STT 결과의 직접 편집을 제거하는 것도 가능하다. 다만 LLM이 교정한 문장을 원본처럼 덮어쓰면 답변 내용과 발화 측정의 근거가 섞인다. 따라서 `raw_transcript`와 `corrected_transcript`, 변경 내역을 함께 보존해야 한다. 특히 VAD는 음성/무음만 구분하므로 STT가 제거한 “어·음”을 VAD와 강제 정렬만으로 정확히 복구할 수 없다. 불필요어를 세려면 원문 보존 전사(verbatim)가 우선이며, 강제 정렬은 그 단어의 시간 위치를 붙이는 보조 수단으로 사용해야 한다.

현재 역할 문서와 이번 분담에는 충돌이 있다. 저장소 문서는 면접 세션 UI를 B, 질문 개인화와 공용 LLM 프롬프트를 A로 정하지만, 신규 분담은 답변 종료/대기 UI를 A, 3:3 질문 조합과 STT 교정을 B로 배정한다. 구현 전에 `RoleDivision.md`와 A/B 계획에서 **“A는 자소서 구조화·입력·대기 화면, B는 질문 조합·진행 모드·음성 파이프라인”**으로 파일별 책임을 다시 확정해야 한다. 단, 기존 개인화 함수 자체는 A 소유로 두고 B가 조합 단계에서 호출하면 현재 계약을 가장 적게 바꿀 수 있다.

## 2. 현재 프로젝트 구조와 차이

현재 `SetupView.tsx`는 이름, 직무, 자소서, 기술, 프로젝트를 자유 텍스트로 받아 `POST /questions`에 전달한다. `questions.py`는 `자기소개·이력 → 지원동기·직무몰입 → 직무·기술 → 문제 해결 → 협업·조직생활 → 가치관·성향`의 고정 순서로 한 문항씩 선택한다. 직무·기술과 문제 해결 문항은 지원 직무 범위로 먼저 필터링되고, 선택된 문항만 `personalize_question()`을 통해 개인화된다. 자소서 분석에서 생성한 예상 질문은 별도 `POST /essay/analyze` 결과에만 존재하며 면접의 여섯 질문에는 아직 합쳐지지 않는다.

면접 화면은 사용자가 `녹음 시작`과 `녹음 중지`를 누른 뒤 STT 완료를 기다리고 `다음 질문`을 누르는 수동 방식이다. 질문 TTS, 자동 종료, 종료 키워드, 별도 대기 화면은 없다. 답변은 브라우저에서 16 kHz mono WAV로 변환되며, 20 ms 프레임의 RMS 기반 VAD로 발화·무음·긴 무음과 최대 120구간의 타임라인을 만든다. 백엔드는 CLOVA 장문 파일 인식 API를 동기 호출하지만 `wordAlignment=False`로 요청하고 전체 텍스트·신뢰도·세그먼트 수만 반환한다. 프런트의 transcript는 현재 `textarea`라 사용자가 직접 수정할 수 있다.

이 구조는 재사용 가치가 높다. 질문은행 로더, 직무 필터, 질문별 개인화 fallback, WAV 변환, VAD, 질문별 측정값, 비동기 답변 검토는 유지하고, 질문 조합 계약·transcript 계약·면접 상태만 추가하는 방향이 적절하다.

## 3. 항목별 반영 계획과 실현 가능성

### 3.1 질문은행 3개와 자소서 기반 3개의 결합

여섯 도메인을 없애거나 두 종류의 질문 목록을 이어 붙이지 않고, **도메인 슬롯은 여섯 개로 고정**한다. A의 자소서 분석 결과에 `domain`, `question`, `evidence`, `risk_level`이 검증된 질문 후보를 추가하고, B의 질문 조합기가 근거가 충분한 서로 다른 도메인 후보 최대 3개를 우선 배치한다. 비어 있는 나머지 도메인에서는 기존 질문은행 문항을 직무 필터 후 선택하고 A의 개인화 함수를 호출한다. 모든 질문에는 `source_type: essay | bank`를 붙이고 기존 `original_text`를 보존한다.

이 방식이면 도메인 중복 없이 총 6개가 유지되고 질문은행 전체도 LLM에 전달하지 않는다. 자소서가 짧아 서로 다른 세 도메인의 근거를 제공하지 못하면 사실을 만들어 3개를 채우지 않고 질문은행 비중을 4개 이상으로 늘려야 한다. 따라서 “3:3”은 정상 목표이고, **근거 부족 시 bank fallback**이 공식 예외여야 한다. 고정적으로 특정 세 도메인을 자소서 전용으로 지정하는 방식은 자소서 내용과 맞지 않는 질문을 만들 위험이 있어 권장하지 않는다. 실현 가능성은 높다.

### 3.2 텍스트 직접 수정 제거와 STT 명시적 교정

현재 editable `textarea`를 읽기 전용 결과 카드로 바꾸고 `재녹음`, `교정 확인`, `건너뛰기`만 제공한다. 백엔드 응답은 기존 `transcript`를 바로 삭제하지 말고 호환성을 위해 유지하면서 다음 필드를 append하는 것이 안전하다.

```text
raw_transcript        STT 원문, 수정 금지
corrected_transcript  교정 후 내용 검토용 문장
corrections[]         원문/교정문/교정 사유/확신 여부
```

교정 프롬프트에는 “오탈자·띄어쓰기·명백한 동음이의 오인식만 수정, 사실·수치·기술·성과 추가 금지, 불확실하면 원문 유지”를 명시하고 구조화 JSON으로 검증한다. 텍스트만 받은 LLM은 실제 음성을 들을 수 없으므로 음향적으로 잘못 전사됐는지 확정할 수 없다. 고유명사나 수치처럼 의미가 바뀌는 수정은 음성 입력을 받는 모델 또는 word confidence와 대조해야 하며, 변경 내역을 사용자에게 보여줘야 한다. 답변 내용 검토에는 교정본을, 발화 속도와 불필요어 계산에는 원문 보존 전사를 사용한다. STT 실패 시 사용자가 답을 만들어 입력하게 하지 않고 빈 transcript와 실패 상태를 보존해 세션을 계속한다. 실현 가능성은 높지만 교정 정확도는 별도 검증이 필요하다.

### 3.3 질문 TTS와 자동/수동 면접 진행

당시 검토에서는 서버 서비스를 추가하기 전 브라우저의 `SpeechSynthesisUtterance`를 최소 구현으로 제안했다. 현재 승인된 구현은 고정 revision의 Supertonic 3을 로컬 CPU에서 사용하고, 화자별 안내와 현재·다음 질문 TTS 선생성을 제공한다.

공통 상태는 `질문 읽는 중 → 답변 중 → 종료 처리/STT → 다음 질문 대기`로 둔다. 수동 모드는 TTS 종료 후 사용자가 답변을 시작·종료하고, 처리 완료 뒤 대기 화면의 `다음 질문`을 누른다. 현재 자동 모드는 TTS `onend` 이후에만 녹음을 시작하여 질문 음성이 답변에 섞이지 않게 하고, 유효 발화 뒤 4초 연속 무음으로 종료한다. 결과 분석의 긴 무음 2초와 자동 종료 4초는 분리한다.

종료 키워드는 현재 방식에서 녹음 종료 전 transcript가 없으므로 바로 적용할 수 없다. 스트리밍 STT의 interim/final 결과에서 문장 끝의 허용 키워드(`이상입니다` 등)를 감지하고, 최소 답변 시간·발화 경계·정확 일치를 함께 확인해야 오종료를 줄일 수 있다. 따라서 수동 모드와 VAD 무음 종료는 단기 적용 가능, 키워드 종료는 스트리밍 도입 이후 적용 가능으로 판단한다.

### 3.4 CLOVA Speech와 Gemini 3.5 Transcribe 비교

질문을 읽어 주는 기능은 TTS이고, 답변을 실시간 글자로 바꾸는 기능은 STT다. 두 공급자 비교는 STT 기준으로 해야 한다.

| 항목 | CLOVA Speech | Gemini 3.5 Transcribe |
|---|---|---|
| 현재 프로젝트 연결 | 장문 파일 동기 업로드가 이미 동작 | 미연결 |
| 한국어 실시간 | gRPC 스트리밍, 16 kHz/16-bit mono 지원 | `gemini-3.5-transcribe-live` WebSocket, 16 kHz PCM과 interim/final 지원 |
| 자동 종료 보조 | `semanticEpd.gapThreshold` 제공 | Live API의 실시간 결과와 VAD 전략 활용 가능 |
| 단어 시간 정보 | 파일 인식 `wordAlignment`와 segment words 지원, 현재 코드는 비활성 | 파일형 `verbatim`은 word timestamp 지원, Live는 미지원 |
| 불필요어 보존 | 현재 응답이 제거할 수 있어 실제 표본 확인 필요 | `verbatim`은 filler·반복·말바꿈 보존, `smart`는 제거 |
| 통합 부담 | 브라우저와 gRPC 사이 백엔드 스트리밍 브리지 필요 | WebSocket/SDK가 편리하지만 브라우저 직접 연결 시 ephemeral token 등 키 보호 필요 |
| 주요 제약 | 현재 endpoint는 녹음 종료 후에만 결과 제공 | Live 세션은 약 10분이며 단어 timestamp가 없음; 2026년 8월 공개된 신규 모델이라 운영 검증 필요 |

CLOVA도 Gemini도 한국어 실시간 STT는 기술적으로 가능하다. 다만 현재 면접은 질문별 녹음 후 전사하므로, 자동 종료가 꼭 필요하지 않다면 기존 CLOVA endpoint를 유지하는 편이 변경이 가장 작다. 종료 키워드와 실시간 자막이 제품 요구사항이면 두 공급자를 동일한 한국어 면접 음원으로 비교한 뒤 선택해야 한다. 비교 지표는 한국어 문자 오류율(CER), 직무 고유명사 정확도, “어·음” 재현율, 중간 결과 지연 p50/p95, 최종 확정 지연, 잘못된 자동 종료율, 분당 비용이다. 운영 전환 전 30~50개 수동 라벨 표본으로 평가하며, 공급자 교체 여부와 관계없이 기존 `/stt` 실패 계약은 유지한다.

### 3.5 “어·음” 등 불필요어 카운트

현재 VAD는 소리가 있는 구간을 찾을 뿐 그 소리가 단어인지 “어·음”인지 분류하지 않는다. 강제 정렬도 이미 transcript에 있는 토큰을 음성 시간축에 맞추는 기술이므로, STT가 토큰을 삭제했다면 삭제된 내용을 복원하지 못한다. 정렬되지 않은 유성 구간을 “불필요어 후보”로 표시할 수는 있으나 이를 정확한 횟수로 보고하면 안 된다.

권장 방식은 파일형 Gemini 3.5 Transcribe의 `verbatim`처럼 filler를 보존하는 전사를 원문 계층으로 확보하고, 제한된 한국어 불필요어 사전과 word timestamp로 횟수와 위치를 계산하는 것이다. CLOVA를 유지한다면 먼저 `wordAlignment=True`로 segment words를 보존한 실험을 하고, 실제로 “어·음”이 얼마나 남는지 측정해야 한다. 불필요어가 계속 삭제되면 VAD+정렬을 덧붙이는 대신 별도 원문 보존 STT를 보조 채널로 사용해야 한다. 결과는 점수가 아니라 질문별 횟수와 타임라인 표시로 제한한다. 실현 가능성은 원문 보존 STT 사용 시 중간~높음, 현재 CLOVA 전체 텍스트+VAD만으로는 낮다.

## 4. 권장 실행 순서와 역할

1. **계약 확정(A/B 공동)**: 역할 문서 갱신, `Question.source_type`, 자소서 질문 후보, raw/corrected transcript의 append-only 스키마 합의.
2. **자소서 구조화(A)**: 자유 텍스트 또는 문항-답변 입력을 하나의 정규화된 자소서 payload로 만들고, 분석 결과에 근거·도메인이 있는 질문 후보를 추가. 모의면접 입력 화면과 답변 종료 후 대기 화면을 구현하되 공유 `InterviewApp.tsx` 변경은 B와 함께 검토.
3. **3:3 질문 조합(B)**: A 후보를 도메인별 최대 3개 배치하고 나머지는 기존 질문은행 선택→기존 개인화 함수 호출. 근거 부족 fallback과 출처 표시 테스트 추가.
4. **전사 계약(B)**: 편집 UI 제거, CLOVA 원문·alignment 보존, 교정본과 변경 내역 분리. 기존 `/stt` 상태와 세션 유지 fallback 보존.
5. **진행 모드(B)**: 먼저 브라우저 TTS+수동 모드+대기 화면, 다음으로 VAD 자동 종료, 마지막으로 스트리밍 PoC와 종료 키워드 적용.
6. **공급자 PoC(B, A의 공용 클라이언트 계약 준수)**: 같은 한국어 음원으로 CLOVA streaming과 Gemini Live/파일형 verbatim을 비교하고 결과에 따라 공급자를 결정.
7. **검증(A/B 공동)**: 질문 6개/도메인 중복 없음, 근거 없는 자소서 질문 없음, 교정 전후 provenance, TTS 중 녹음 방지, 무음·키워드 오종료, STT 실패 후 세션 지속, 기존 시선·음성 측정 회귀를 확인. 실제 마이크·외부 API E2E는 승인된 환경에서 별도로 수행.

## 5. 상위 의사결정 요청

- 3:3을 절대 비율로 강제할지, 자소서 근거 부족 시 질문은행으로 채우는 것을 허용할지 결정이 필요하다. 본 보고서는 허용을 권고한다.
- “실시간”의 목적이 자막 표시인지, 종료 키워드 감지인지, 단순 자동 종료인지 확정해야 한다. 자동 종료만 필요하면 기존 VAD로 충분하여 STT 교체가 필요 없다.
- transcript 교정본만 표시할지, 원문과 변경 내역도 사용자에게 표시할지 확정해야 한다. 측정 근거와 신뢰성을 위해 원문 및 변경 내역 표시를 권고한다.
- 신규 분담이 기존 역할 문서보다 우선하므로, 공유·B 소유 파일을 A가 수정할 수 있는 범위를 착수 전에 문서화해야 한다.

## 참고 자료

- [NAVER Cloud CLOVA Speech 지원 범위](https://guide.ncloud-docs.com/docs/clovaspeech-spec)
- [CLOVA 로컬 파일 인식과 word alignment](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-longsentence-local)
- [CLOVA 실시간 스트리밍과 silence EPD](https://api.ncloud-docs.com/en/ai-application-service-clovaspeech-grpc)
- [Gemini 3.5 Transcribe 모델과 Live/파일형 제약](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe)
- [Gemini 3.5 Transcribe verbatim/smart 모드](https://ai.google.dev/gemini-api/docs/transcribe)
- [Gemini Live transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
- [Web Speech API SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)

---

## 원본: `plan-B-dynamic-interview-feasibility.md`

# B파트 동적 면접·추임새 분석 계획

작성일: 2026-09-05 · 상태: 구현 전 검토 · A4 2쪽 이내를 목표로 한 요약본

> 현재 TTS 적용 상태: 이 문서의 CLOVA Voice 후보는 구현 전 검토 기록이다. 현재 구현·설치·검증 기준은 `docs/plan-B-local-tts.md`의 로컬 CPU TTS 계획이다.

## 1. 현재 구현과 변경 목표

| 항목 | 현재 코드 | 이번 계획 |
|---|---|---|
| 질문 | 질문은행 4개 + 자소서 기반 최대 2개, 실패 시 은행 대체 | 유지 |
| 진행 | 수동 녹음 시작·종료 → 처리 → 다음 질문 대기 | 수동 유지 + 자동 모드 추가 |
| 전사문 | 면접 중 편집 가능, 결과 화면에도 표시 | 두 화면 모두 표시·편집 제거, 내부 평가용으로만 사용 |
| STT·평가 | 종료 후 CLOVA 업로드, 성공한 답변만 비동기 평가 | 유지. 실패는 판단 불가, 텍스트 직접 입력으로 복구하지 않음 |
| VAD | 브라우저에서 녹음 종료 후 RMS 기준 발화·무음 분석 | 기존 측정 유지 + 진행 중 무음 감지 추가 |
| TTS·추임새 | 미구현 | TTS 안내 추가, 추임새 검출·정렬은 검증 후 도입 |

확인 위치: `InterviewView.tsx`의 textarea, `AnalysisView.tsx`의 transcript 표시, `recorder.ts`의 사후 VAD. 이번 작업은 계획 작성이며 제품 코드는 변경하지 않는다.

## 2. 자동 면접 진행

**질문 TTS → 준비 3초 → “시작하세요” 재생 완료 → 녹음 → 발화 후 무음 5초 → “답변을 마치셨나요?” → 확인 응답 → 종료 또는 재개**

| 단계 | 구현 방침·안전장치 |
|---|---|
| 시작 | 사용자 최초 시작 클릭·마이크 권한 확인 후 진행. TTS 재생이 끝난 뒤 답변 수집 시작 |
| 무음 감지 | Web Audio 입력 감시 추가. 3초·5초는 조정 가능한 시험값이며 기존 측정용 긴 무음 2초와 분리 |
| 종료 확인 | 답변 수집을 일시정지하고 안내 재생 후 짧은 확인 음성을 별도로 CLOVA에 업로드 |
| 응답 판단 | 확인 상태의 명확한 “네/종료할게요”만 종료. “아니요”는 재개. 복합·불명확 응답, 무응답, API 실패는 자동 종료하지 않고 버튼 제공 |
| 답변 보존 | 재개 시 이전 답변 구간 보존. TTS·확인 음성·확인 대기시간은 답변 및 시선 측정에서 제외하고 구간 시간 대응 유지 |
| 다음 문항 | 답변 STT 결과 확정 후 자동 모드는 짧은 취소 가능 대기를 거쳐 다음 질문 재생. 마지막은 결과 화면. LLM 평가는 진행을 막지 않음 |
| 공통 보호 | 첫 발화 전에는 종료 확인 금지. 반복 확인은 새 발화 이후 재허용. 수동 종료·계속 답변 버튼, 이전 질문의 늦은 응답 차단 |

TTS는 **CLOVA Voice를 1차 후보**로 한다. 서버에서 합성하고 키는 환경변수로 관리한다. 고정 안내는 재사용하고 질문 음성은 세션 동안만 보관한다. TTS 실패 시 화면 안내·수동 진행으로 전환한다. 별도 서비스 이용 설정이 필요하다. [CLOVA Voice 공식 문서](https://api.ncloud-docs.com/docs/en/ai-naver-clovavoice)

**판정: 구현 가능.** 스트리밍 STT 교체 없이 시작할 수 있으나, 확인 음성 업로드의 지연과 짧은 “네” 인식률은 실측이 필요하다. 즉각적인 대화 응답을 보장하지 않는다.

## 3. “어·음” 검출과 강제 정렬

**VAD는 발화 유무를, 강제 정렬은 주어진 단어의 위치를 찾는다. 누락된 단어 자체를 복원하는 기능은 아니다.** 따라서 CLOVA 전사문을 정렬한 뒤 남은 구간을 모두 추임새로 취급할 수 없다. 이는 강제 정렬의 입력·출력 정의에 따른 제한이다. [MFA 공식 설명](https://montreal-forced-aligner.readthedocs.io/en/v3.4.1/user_guide/index.html)

| 단계 | 구체적 계획 |
|---|---|
| ① 기준 음성 | 동의받은 짧은 한국어 시험 음성에 사람이 추임새·일반 단어·실제 무음의 시각을 표시. 소규모 개발 검증이며 런타임 데이터셋 기능은 만들지 않음 |
| ② 원문 확보 | CLOVA는 내용 평가용으로 유지. 별도 실험에서 추임새 보존 전사를 비교해 누락 단어를 확보할 수 있는지 먼저 확인 |
| ③ 위치 정렬 | 추임새가 포함된 전사문 + 원본 음성을 한국어 지원 강제 정렬기에 입력. 설치·모델·라이선스·실행 자원 확인 후 후보 하나만 검증 |
| ④ 구간 구분 | `일반 발화 / 추임새 / 실제 무음 / 미확인`으로 분리. 각 구간에 시작·끝·근거를 내부 저장. VAD 발화인데 정렬되지 않은 곳은 미확인으로 남김 |
| ⑤ 무음 처리 | 여기서 무음 처리는 **별도 음성 사본의 추임새 구간 음소거**로 정의. 시간 길이는 유지하고 원본은 덮어쓰지 않음. 경계가 불확실한 구간은 처리하지 않음 |
| ⑥ 측정 | 원본의 실제 무음·발화 지표는 그대로 유지. 추임새 횟수·길이는 별도 집계하며 음소거 사본으로 원본 무음 비율을 재계산하지 않음 |

실험 후보인 Gemini Transcribe의 verbatim 모드는 추임새 보존과 타임스탬프를 제공하지만, 한국어 “어·음”의 완전 검출은 보장된 것으로 간주하지 않는다. 기본 타임스탬프와 강제 정렬을 비교해 추가 정렬의 실익도 확인한다. **운영 CLOVA 교체·추가 공급자 연결은 이 검증만으로 시행하지 않는다.** [Gemini 전사 공식 문서](https://ai.google.dev/gemini-api/docs/transcribe)

추임새도 소리가 있는 발화이므로 자동 종료 타이머를 초기화한다. 추임새 음소거는 답변 종료 후에만 수행한다. “어”가 포함된 정상 단어를 부분 문자열로 삭제하지 않으며, 전체 추임새 100% 검출을 완료 조건으로 잡지 않는다.

## 4. 구현 순서·통과 기준

| 순서 | 작업 | 완료·진입 조건 |
|---|---|---|
| 1 | 전사 비공개·수정 제거 | 면접·결과에 전사문 없음. 내부 STT·평가 연결 유지. 실패 안내의 직접 수정 문구도 제거 |
| 2 | TTS + 무음 감지 + 버튼 확인 | 안내 재유입·첫 발화 전 오종료 없음. 기존 수동 진행 회귀 테스트 통과 |
| 3 | 음성 확인 + 자동 다음 질문 | 긍정·부정·무응답·실패·늦은 응답 테스트, 답변 재개 시 데이터 보존. 승인된 장치에서 인식률·지연 확인 |
| 4 | 추임새 전사·정렬 검증 | 검출 누락·오검출, 구간 경계 오차, 처리시간을 사람 표기와 비교. 정상 발화 손상 위험이 있으면 음소거 도입 보류 |
| 5 | 검증된 구간만 음소거 | 시험 음성의 정상 단어를 훼손하지 않고 원본 지표 보존. 불확실 구간은 미처리 |

정적·mock 검증과 실제 마이크·외부 API 검증은 구분한다. 실제 장치·외부 호출은 승인 후 수행하고 음성은 필요한 처리 동안만 보관한다. B가 UI·음성 흐름을 담당하며 A의 평가 프롬프트는 변경하지 않는다. 공유 측정 타입 추가는 계약 확인 후 진행한다.

**최종 판단: 전사 비공개와 확인형 자동 진행은 구현 대상으로 확정할 수 있다. 추임새 전체 무음 처리는 조건부이며, 누락 없는 전사와 정확한 구간 검증이 먼저다.**

---

## 원본: `plan-B-feature-improvements-final.md`

# InterReview B 파트 기능개선 최종 실행 계획

> 기준일: 2026-09-03
>
> 상태: 계획 기준 문서. 질문 구성·상태 머신과 로컬 TTS/Silero VAD 구현이 반영되었고, 실제 장치 검증은 별도 승인 대기다.
>
> 입력 자료: `InterReview_B파트_기능개선_검토서_재정의_2026-09-03.md`, 현재 `B/llm_interface` 코드와 A/B 계획

## 1. 최종 결정

이번 B 추가 작업은 아래 두 항목으로 한정한다.

1. 기존 질문 6개를 **질문은행 4개 + 자소서 기반 생성 2개**로 재구성한다.
2. 현재 여러 boolean으로 관리되는 면접 진행을 명시적인 상태 머신으로 바꾼다.

이 계획은 이전 검토의 `질문은행 3 + 자소서 3`보다 첨부 재정의안의 `4 + 2`를 우선한다. 자소서 기반 생성 도메인은 `resume`, `job_technology`로 고정한다.

질문 순서는 첨부 문서의 나열이 아니라 현재 코드와 테스트의 확정 순서를 유지한다.

```text
1. resume                       자소서 기반 생성
2. motivation_commitment        질문은행
3. job_technology               자소서 기반 생성
4. problem_solving              질문은행 + 기존 role scope
5. collaboration_organization   질문은행
6. values_personality           질문은행
```

다음은 이번 구현에서 제외한다.

- STT 공급자 교체, 스트리밍 STT, 종료 키워드 감지
- transcript 편집·교정 계약 변경
- 질문은행 데이터 수정·재정제
- Track A 자소서 분석 화면 재구현
- 답변 평가 프롬프트·결과 화면·Vision 변경
- 상태 머신 라이브러리나 신규 프런트 테스트 프레임워크 도입

## 2. 변경 전 기준선

현재 `generate_questions()`는 여섯 도메인에서 질문은행 문항을 하나씩 선택한다. `job_technology`와 `problem_solving`은 직무 scope를 먼저 적용하고, `POST /questions`는 선택된 각 문항을 기존 `personalize_question()`으로 개인화한다. 자소서 분석의 예상 질문은 이 면접 질문 흐름과 연결되지 않는다.

현재 `InterviewView.tsx`는 `isRecording`, `isTranscribing` 등의 boolean과 질문 index를 조합한다. 흐름은 `질문 표시 → 녹음 시작 → 녹음 중지 → WAV/VAD/STT → 다음 질문`이며, 답변 검토는 질문 확정 후 부모의 promise registry에서 비동기로 실행된다. 이 병렬화 계약은 유지한다.

## 3. A/B 선행 계약

자소서 질문을 만드는 LLM 프롬프트와 공용 LLM 호출은 기존 규칙대로 A 소유다. B는 전체 자소서 분석을 호출하거나 재구현하지 않고 다음 함수만 소비한다.

```python
def generate_grounded_questions(
    profile: dict[str, object],
    essay: str,
    excluded_questions: list[str],
) -> dict[str, GroundedQuestion]:
    """유효한 resume/job_technology 질문만 domain key로 반환한다."""

class GroundedQuestion(BaseModel):
    domain: Literal["resume", "job_technology"]
    question: str
    evidence: str
```

계약 규칙:

- 두 질문은 한 번의 structured LLM 호출로 생성한다.
- `evidence`는 `resume_text`, `technologies`, `projects` 중 실제 입력에 존재해야 한다.
- `resume`은 경험·주장 확인, `job_technology`는 실제 기술 선택·사용·판단을 묻는다.
- 질문은 한 문장·물음표 하나·200자 이하로 제한한다.
- 지원자가 적지 않은 기술·역할·성과를 추가하지 않는다.
- `excluded_questions`에는 이미 선택한 질문은행 4개만 전달하며 질문은행 전체는 전달하지 않는다.
- 두 도메인 중 하나만 유효해도 그 하나는 사용하고, 나머지만 fallback한다.
- 미설정 LLM, 호출 오류, 빈 결과, 잘못된 domain/evidence/question은 예외를 밖으로 전파하지 않고 해당 domain을 누락한다.

B는 이 계약을 mock하여 먼저 조합 로직을 완성할 수 있지만, 실제 연동 완료 판정은 A 함수가 제공된 뒤에만 한다.

## 4. B-1 질문 구성 개편

### 4.1 최소 구현 방식

기존 `generate_questions()`로 여섯 질문은행 문항을 먼저 선택한다. 이 결과는 `resume`·`job_technology` 생성 실패 시 즉시 사용할 fallback이 된다. 별도의 질문은행 로더나 두 번째 선택 체계는 만들지 않는다.

```text
기존 generate_questions()로 6개 선택
→ 유지할 bank 4개의 원문을 excluded_questions로 전달
→ A 함수로 resume/job_technology를 한 번에 생성
→ 유효한 domain만 같은 위치의 bank 질문과 교체
→ bank로 남은 질문만 기존 personalize_question() 호출
→ 현재 GROUPS 순서로 6개 반환
```

생성 질문은 이미 지원자 입력에 근거하므로 다시 `personalize_question()`에 보내지 않는다. 생성에 실패해 질문은행 문항이 남은 domain은 기존과 동일하게 개인화한다.

### 4.2 기존 `Question` 계약 유지

프런트에서 질문 출처를 표시하라는 요구가 없으므로 `source_type` 같은 공유 필드는 추가하지 않는다. 생성 질문도 기존 `Question`으로 변환한다.

```text
id               현재 순서에 따른 q1~q6
question_id      "GENERATED + domain + question"의 안정 해시
category         기존 도메인 한글명
rule_group       resume 또는 job_technology
subcategory      generated::resume 또는 generated::job_technology
text             생성 질문
original_text    생성 질문과 동일
source_file      null
occurrence_count 1
```

LLM의 `evidence`는 서버 검증에만 사용하고 API에 노출하지 않는다. 향후 사용자에게 질문 근거를 표시하기로 결정할 때만 공유 스키마에 append한다.

### 4.3 코드 검증

LLM 출력 뒤 다음을 코드에서 다시 확인한다.

- domain이 `resume` 또는 `job_technology`인지
- evidence를 공백 정규화한 문자열이 사용자 입력에 실제 포함되는지
- 질문 형식과 길이가 유효한지
- `job_technology` 질문의 등록 기술 토큰이 사용자 입력 또는 근거에 존재하는지
- 선택된 질문은행 4개 및 다른 생성 질문과 정규화 exact duplicate가 아닌지

의미 중복을 판정하는 별도 LLM 호출이나 embedding은 추가하지 않는다. 한 번의 생성 프롬프트에 선택된 4개 질문을 제공하고, 코드에서는 명확한 중복만 차단한다. 실제 중복 사례가 확인될 때만 규칙을 확장한다.

### 4.4 fallback

| 상황 | 결과 |
|---|---|
| 자소서가 비어 있음 | 두 domain 모두 기존 bank 질문 사용 |
| A 함수 전체 실패 | 두 domain 모두 bank fallback |
| 한 domain만 실패 | 실패한 domain만 bank fallback |
| evidence 불일치·새 기술 생성 | 해당 domain만 bank fallback |
| 생성 질문이 bank 질문과 중복 | 해당 domain만 bank fallback |
| bank 질문 개인화 실패 | 기존 원문 질문 사용 |

fallback 때문에 실제 구성은 4+2, 5+1, 6+0이 될 수 있다. 근거 없는 질문으로 4+2를 강제하지 않는다.

### 4.5 변경 파일

B 변경:

- `backend/app/services/questions.py`: 기존 선택 결과와 생성 결과를 합치는 최소 helper, 생성 질문 ID/`Question` 변환
- `backend/app/routers/questions.py`: A 함수 호출, domain별 교체, bank 질문만 개인화
- `backend/tests/test_questions.py`: 조합·순서·fallback·개인화 회귀

A 선행 제공:

- A 소유 service/prompt와 focused test: `generate_grounded_questions()` 계약

변경하지 않음:

- 질문은행 JSON과 role metadata
- `backend/app/schemas.py`, `frontend/lib/types.ts`, `frontend/lib/api.ts`
- 프런트 질문 렌더링

## 5. B-2 면접 상태 머신

### 5.1 1차 상태

부모 `InterviewApp`의 화면 단위 `Phase`는 그대로 두고, `InterviewView` 내부에 질문 진행용 상태를 하나 둔다.

```ts
type InterviewStep =
  | "question_ready"
  | "recording"
  | "processing"
  | "waiting_next"
  | "complete";
```

외부 상태 머신 패키지는 사용하지 않는다. `isRecording`과 `isTranscribing`은 별도 진실값으로 유지하지 않고 `InterviewStep`에서 파생한다.

### 5.2 전이 계약

| 현재 상태 | 이벤트 | 다음 상태 | 핵심 동작 |
|---|---|---|---|
| `question_ready` | 녹음 시작 | `recording` | recorder·gaze 시작, 현재 question ID 고정 |
| `recording` | 답변 종료 | `processing` | 중복 클릭 차단, gaze 종료, recorder stop |
| `processing` | WAV/VAD/STT 완료 또는 실패 | `waiting_next` | 답변 snapshot 저장, `onAnswerFinalized` 1회 호출 |
| `waiting_next` | 다음 질문 | `question_ready` | index 1 증가 |
| `waiting_next` | 마지막 질문 완료 | `complete` | `onFinish` 1회 호출 |

필수 규칙:

- 녹음·처리 중에는 이전/다음 이동을 막는다.
- `processing` 실패도 `waiting_next`로 이동하여 세션을 유지한다.
- 녹음 시작 시 고정한 question ID로만 결과를 기록한다.
- `onAnswerFinalized`는 처리 완료 직후 시작해 대기·다음 질문과 LLM 검토를 겹친다.
- 마지막 `onFinish`는 중복 호출되지 않도록 기존 ref 패턴으로 보호한다.
- 이전 질문 이동은 `question_ready`에서만 기존 동작을 유지한다. 재녹음으로 transcript가 바뀌면 부모 registry의 revision 비교가 새 검토를 시작한다.

### 5.3 화면 동작

- `question_ready`: 질문, 이전 버튼, 녹음 시작 버튼 표시
- `recording`: 명시적인 `답변 종료` 버튼과 녹음 상태 표시
- `processing`: WAV/STT 처리 중 표시, 모든 진행 버튼 잠금
- `waiting_next`: 답변 수집 완료 안내와 `다음 질문`; 마지막은 `결과 보기`
- `complete`: 부모 결과 처리로 넘어가는 짧은 전이 상태

현재 transcript 입력·STT 실패 안내·오디오 타임라인은 이번 단계에서 변경하지 않는다.

### 5.4 상태 로직 검증

React 테스트 라이브러리는 추가하지 않는다. 전이 규칙만 작은 순수 함수로 분리하고 Node 내장 `node:test`/`assert`로 검사한다.

변경 파일:

- `frontend/components/InterviewView.tsx`: 상태 기반 렌더링과 side effect 연결
- `frontend/lib/interviewFlow.ts`: 허용 전이와 마지막 질문 분기
- `frontend/lib/interviewFlow.test.mts`: 정상 전이, 잘못된 중복 이벤트, 마지막 완료
- `frontend/package.json`: `test:interview` 한 줄 추가

## 6. 단계적 확장

### Phase 1 — 질문 4+2 조합

- A 함수 계약 확정 및 mock 제공
- 여섯 bank 질문 선선택
- `resume`, `job_technology`만 생성 결과로 교체
- domain별 fallback과 현재 순서 보존

완료 기준: 정상 입력은 4+2, 실패 입력은 안전한 5+1/6+0이며 항상 6문항·6 domain·중복 없는 ID/text를 반환한다.

### Phase 2 — 수동 상태 머신

- 다섯 상태와 전이 적용
- `답변 종료`와 `다음 질문 대기` 화면 분리
- STT/LLM 실패 시 세션 지속

완료 기준: Q1~Q6의 녹음·처리·대기·완료가 중복 호출 없이 진행되고 기존 질문별 결과가 보존된다.

### Phase 3 — Supertonic 3 로컬 CPU TTS

질문과 고정 안내를 동일한 로컬 한국어 TTS 경로로 재생한다.

```text
question_ready → reading_question → playing_start → recording
```

- POST /tts는 고정 revision의 Supertonic 3을 CPU로 합성한다.
- 고정 안내는 voice별 WAV로 설치 시 준비하고, 질문 오디오는 요청 중 메모리에서만 생성한다.
- voice_id는 M1~M5/F1~F5 허용 목록으로 검증하며 이미지에서 성별·연령을 추정하지 않는다.
- 브라우저 SpeechSynthesisUtterance나 클라우드 TTS fallback은 사용하지 않는다.
- 화자 확정 뒤 첫 질문을 준비하고, 답변 녹음 중 다음 질문을 한 건만 선생성한다. 진행 중 Promise도 공유해 질문 진입 시 중복 합성을 막는다.
- HTTP 요청과 오디오 재생 모두 유한한 시간 제한을 두며, 취소·늦은 응답·Blob URL을 정리한다.
- 질문/시작 안내 실패는 화면 질문과 수동 녹음으로 복구한다.
- 마지막 인사 실패는 결과 화면 진입을 막지 않는다.

### Phase 4 — 자동 모드·Silero VAD·4초 자동 종료

자동 모드를 기본값으로 켜되 사용자가 끌 수 있는 제어를 유지한다.

```text
질문 TTS 종료 → 시작 안내 종료 → 답변 녹음
→ 유효 발화
→ 연속 무음 4초 또는 수동 답변 종료
→ 종료 안내 재생 + 답변 STT/측정 병행
```

브라우저의 고정 RMS 감시 대신 로컬 @ricky0123/vad-web legacy Silero 모델을 실시간·녹음 후 분석에 사용한다. 초기 threshold는 0.6/0.35, 최소 발화는 250ms, 자동 종료 무음은 4초다. 첫 유효 발화 전에는 자동 종료하지 않으며 수동 종료 버튼을 유지한다. 결과 분석의 긴 무음 2초는 별도로 유지한다.

확인 녹음·확인 STT 분기는 추가하지 않는다. 답변 Blob 확보 뒤 종료 안내와 답변 변환·STT·측정을 병행하고, 둘이 끝나기 전에는 다음 질문을 시작하지 않는다. 종료 안내 음성은 답변·시선 측정에 포함하지 않는다.

실제 카메라·마이크·노트북·청취 검증은 승인된 환경에서 별도로 수행한다.

### 후속 PoC — 종료 키워드

`이상입니다` 같은 종료 키워드는 스트리밍 STT 없이는 구현하지 않는다. 제품 필수 요건으로 다시 승인될 때만 별도 PoC를 수립한다.

## 7. 테스트 및 검증

### Backend

- 정상 4+2 구성과 현재 `GROUPS` 순서
- 자소서 없음·전체 실패·domain별 부분 실패 fallback
- 근거 불일치·새 기술·중복 질문 차단
- bank 네 domain만 기존 개인화 호출
- fallback domain은 bank 개인화 후 원문 fallback 유지
- `problem_solving`의 기존 role scope/priority 회귀
- 질문 수 6, domain/ID/text 중복 없음
- 질문은행 validator 통과

### Frontend

- 상태별 허용 이벤트와 마지막 질문 완료
- 녹음/처리 중 이동·중복 종료 차단
- STT 성공·실패 모두 `waiting_next` 도달
- 질문별 answer/gaze/speech 결과 보존
- 기존 비동기 answer review promise 재사용
- 기존 audio/gaze tests 회귀
- TypeScript, ESLint, production build

### 실제 환경

카메라·마이크·TTS·실시간 무음 종료는 localhost/HTTPS의 승인된 장치 환경에서 별도 확인한다. 정적·단위 테스트 결과를 실제 장치 E2E로 보고하지 않는다.

## 8. Definition of Done

### B-1 질문 구성

- [ ] 현재 순서의 여섯 domain과 여섯 질문을 유지한다.
- [ ] `resume`, `job_technology`만 근거 기반 생성으로 교체한다.
- [ ] 나머지 네 domain은 기존 bank 선택·필터·개인화를 유지한다.
- [ ] 생성 실패는 domain별 bank fallback으로 처리한다.
- [ ] 질문은행 전체를 LLM에 전달하지 않는다.
- [ ] 생성 질문에 입력에 없는 사실·기술이 없다.
- [ ] 질문은행 파일과 공유 API 스키마를 변경하지 않는다.

### B-2 상태 머신

- [ ] 수동 진행이 다섯 상태로 동작한다.
- [ ] 녹음 중에는 명시적 `답변 종료` 버튼을 제공한다.
- [ ] 처리 후 `다음 질문 대기` 화면을 표시한다.
- [ ] 중복 종료·이동·최종 제출이 발생하지 않는다.
- [ ] STT/LLM 실패가 세션을 중단하지 않는다.
- [ ] 기존 answer review 병렬화와 질문별 측정값을 보존한다.

### Track B 추가 구현 상태

- [x] 수동/자동 상태 머신과 질문별 결과 보존
- [x] Supertonic 3 로컬 TTS와 voice별 안내 캐시
- [x] 현재·다음 질문 TTS 선생성과 Promise 공유
- [x] Silero VAD 기반 유효 발화 후 4초 자동 종료
- [x] 종료 안내·답변 STT/측정 병행 및 중복 종료 방지
- [ ] 승인된 실제 장치·노트북·청취 품질 검증
- [ ] 종료 키워드 감지. 이번 DoD에는 포함하지 않는다.

## 9. 착수 조건 및 현재 상태

초기 구현 착수 조건은 다음과 같았고 현재 구현에 적용했다.

1. A가 `generate_grounded_questions()` 입력·출력·fallback 계약에 동의한다.
2. 질문의 실제 순서를 현재 코드 순서로 유지한다는 합의가 있다.
3. Phase 1~2를 필수 범위, Phase 3~4를 후속 범위로 분리한다는 합의가 있다.

Phase 1과 Phase 2의 기존 A/B 계약과 질문 순서는 유지한다. 로컬 TTS/VAD는 이 문서의 추가 계약으로 연결했으며 커밋·푸시는 수행하지 않는다.

---

## 원본: `plan-B-local-tts.md`

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

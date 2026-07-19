from __future__ import annotations

from dataclasses import dataclass, field
import math
import os
from pathlib import Path
import shutil
import tempfile
from threading import Lock
import time
from typing import Any

import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


APP_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = Path(
    os.environ.get("FACE_LANDMARKER_MODEL_PATH", APP_ROOT / "face_landmarker.task")
).expanduser()

# Preserve the previous JSON meaning: left/right are screen-side labels.
EYES = {
    "left": {
        "iris": (468, 469, 470, 471, 472),
        "corners": (33, 133),
        "vertical": ((160, 144), (158, 153)),
        "lid": (159, 145),
        "brow_lid": (105, 159),
    },
    "right": {
        "iris": (473, 474, 475, 476, 477),
        "corners": (362, 263),
        "vertical": ((385, 380), (387, 373)),
        "lid": (386, 374),
        "brow_lid": (334, 386),
    },
}

BLENDSHAPES = (
    "eyeSquintLeft",
    "eyeSquintRight",
    "eyeWideLeft",
    "eyeWideRight",
    "browDownLeft",
    "browDownRight",
    "browOuterUpLeft",
    "browOuterUpRight",
)

MIN_BLINK_SECONDS = 0.05
MAX_BLINK_SECONDS = 0.8


def _model_path_for_mediapipe(path: Path) -> Path:
    """Copy the model only when MediaPipe cannot open a non-ASCII Windows path."""
    if os.name != "nt" or str(path).isascii():
        return path

    target = Path(tempfile.gettempdir()) / "interreview-assets" / path.name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_size != path.stat().st_size:
        shutil.copy2(path, target)
    return target


def _xy(landmarks, index: int) -> np.ndarray:
    point = landmarks[index]
    return np.array((point.x, point.y), dtype=np.float32)


def _distance(landmarks, pair: tuple[int, int]) -> float:
    return float(np.linalg.norm(_xy(landmarks, pair[0]) - _xy(landmarks, pair[1])))


def _eye_features(landmarks, eye: dict[str, Any]) -> dict[str, float] | None:
    """Return scale- and roll-normalized gaze, EAR, lid and brow distances."""
    corner0, corner1 = (_xy(landmarks, index) for index in eye["corners"])
    width = float(np.linalg.norm(corner1 - corner0))
    if width < 1e-6:
        return None

    top, bottom = (_xy(landmarks, index) for index in eye["lid"])
    x_axis = (corner1 - corner0) / width
    y_axis = np.array((-x_axis[1], x_axis[0]), dtype=np.float32)
    if np.dot(bottom - top, y_axis) < 0:
        y_axis = -y_axis

    center = (corner0 + corner1 + top + bottom) / 4
    iris = np.mean([_xy(landmarks, index) for index in eye["iris"]], axis=0)
    height = max(abs(float(np.dot(bottom - top, y_axis))), width * 0.05)
    delta = iris - center

    vertical = eye["vertical"]
    ear = (_distance(landmarks, vertical[0]) + _distance(landmarks, vertical[1])) / (2 * width)
    iris_z = float(np.mean([landmarks[index].z for index in eye["iris"]]))
    eye_z = float(np.mean([landmarks[index].z for index in (*eye["corners"], *eye["lid"])]))

    return {
        "local_x": float(np.dot(delta, x_axis) / width),
        "local_y": float(np.dot(delta, y_axis) / height),
        "local_z": iris_z - eye_z,
        "ear": ear,
        "lid_opening": _distance(landmarks, eye["lid"]) / width,
        "brow_eye_distance": _distance(landmarks, eye["brow_lid"]) / width,
    }


def _blendshape_scores(result) -> dict[str, float]:
    if not result.face_blendshapes:
        return {}
    scores = {item.category_name: float(item.score) for item in result.face_blendshapes[0]}
    return {name: round(scores.get(name, 0.0), 4) for name in BLENDSHAPES}


def _empty_sample(
    face_detected: bool,
    blendshapes: dict[str, float] | None = None,
    timestamp: float = 0.0,
) -> dict[str, Any]:
    return {
        "timestamp": timestamp,
        "face_detected": face_detected,
        "face_frame_valid": False,
        "left_eye": None,
        "right_eye": None,
        "gaze_x": None,
        "gaze_y": None,
        "gaze_speed": None,
        "gaze_direction": None,
        "eyes_closed": None,
        "blendshapes": blendshapes or {},
    }


def _direction(
    x: float,
    y: float,
    center: tuple[float, float],
    threshold: tuple[float, float],
) -> str:
    dx, dy = x - center[0], y - center[1]
    tx, ty = threshold
    if abs(dx) <= tx and abs(dy) <= ty:
        return "center"
    if abs(dx / tx) >= abs(dy / ty):
        return "right" if dx > 0 else "left"
    return "down" if dy > 0 else "up"


@dataclass
class EyeTrackingState:
    gaze_center: tuple[float, float]
    gaze_threshold: tuple[float, float]
    ear_threshold: float
    started_at: float = field(default_factory=time.perf_counter)
    processed_frames: int = 0
    face_detected_frames: int = 0
    valid_gaze_samples: int = 0
    front_gaze_samples: int = 0
    gaze_mean: list[float] = field(default_factory=lambda: [0.0, 0.0])
    gaze_m2: list[float] = field(default_factory=lambda: [0.0, 0.0])
    gaze_min: list[float] = field(default_factory=lambda: [math.inf, math.inf])
    gaze_max: list[float] = field(default_factory=lambda: [-math.inf, -math.inf])
    last_gaze: tuple[float, float, float] | None = None
    speed_total: float = 0.0
    speed_count: int = 0
    max_speed: float = 0.0
    last_direction: str | None = None
    direction_changes: int = 0
    closed_since: float | None = None
    blink_count: int = 0
    blink_duration_total: float = 0.0
    eye_feature_samples: int = 0
    eye_totals: dict[str, float] = field(default_factory=dict)
    blendshape_samples: int = 0
    blendshape_totals: dict[str, float] = field(default_factory=dict)
    last_sample: dict[str, Any] | None = None

    def add(self, sample: dict[str, Any], now: float) -> None:
        self.processed_frames += 1
        if sample["face_detected"]:
            self.face_detected_frames += 1

        if sample["blendshapes"]:
            self.blendshape_samples += 1
            for name, value in sample["blendshapes"].items():
                self.blendshape_totals[name] = self.blendshape_totals.get(name, 0.0) + value

        if not sample["face_frame_valid"]:
            self.last_gaze = None
            self.last_direction = None
            self.last_sample = sample
            return

        left, right = sample["left_eye"], sample["right_eye"]
        self.eye_feature_samples += 1
        for name, value in {
            "ear_asymmetry": abs(left["ear"] - right["ear"]),
            "lid_left": left["lid_opening"],
            "lid_right": right["lid_opening"],
            "brow_left": left["brow_eye_distance"],
            "brow_right": right["brow_eye_distance"],
        }.items():
            self.eye_totals[name] = self.eye_totals.get(name, 0.0) + value

        mean_ear = (left["ear"] + right["ear"]) / 2
        closed = mean_ear < self.ear_threshold
        sample["ear"] = round(mean_ear, 4)
        sample["eyes_closed"] = closed

        if closed and self.closed_since is None:
            self.closed_since = now
        elif not closed and self.closed_since is not None:
            duration = now - self.closed_since
            if MIN_BLINK_SECONDS <= duration <= MAX_BLINK_SECONDS:
                self.blink_count += 1
                self.blink_duration_total += duration
            self.closed_since = None

        if closed:
            self.last_gaze = None
            self.last_direction = None
            self.last_sample = sample
            return

        x, y = sample["gaze_x"], sample["gaze_y"]
        direction = _direction(x, y, self.gaze_center, self.gaze_threshold)
        sample["gaze_direction"] = direction
        sample["gaze_speed"] = None

        if self.last_gaze is not None:
            previous_x, previous_y, previous_at = self.last_gaze
            speed = math.hypot(x - previous_x, y - previous_y) / max(now - previous_at, 1e-3)
            sample["gaze_speed"] = round(speed, 4)
            self.speed_total += speed
            self.speed_count += 1
            self.max_speed = max(self.max_speed, speed)
        self.last_gaze = (x, y, now)

        self.valid_gaze_samples += 1
        count = self.valid_gaze_samples
        for axis, value in enumerate((x, y)):
            delta = value - self.gaze_mean[axis]
            self.gaze_mean[axis] += delta / count
            self.gaze_m2[axis] += delta * (value - self.gaze_mean[axis])
            self.gaze_min[axis] = min(self.gaze_min[axis], value)
            self.gaze_max[axis] = max(self.gaze_max[axis], value)

        if direction == "center":
            self.front_gaze_samples += 1
        elif self.last_direction is not None and direction != self.last_direction:
            self.direction_changes += 1
        if direction != "center":
            self.last_direction = direction

        self.last_sample = sample

    def snapshot(self) -> dict[str, Any]:
        frames, valid = self.processed_frames, self.valid_gaze_samples
        eye_count, blend_count = self.eye_feature_samples, self.blendshape_samples
        elapsed = max(time.perf_counter() - self.started_at, 1e-6)

        def eye_mean(name: str) -> float | None:
            return round(self.eye_totals.get(name, 0.0) / eye_count, 4) if eye_count else None

        return {
            "total_frames": frames,
            "processed_frames": frames,
            "face_detected_frames": self.face_detected_frames,
            "face_detected_ratio": round(self.face_detected_frames / frames, 3) if frames else 0.0,
            "valid_gaze_samples": valid,
            "front_gaze_ratio": round(self.front_gaze_samples / valid, 3) if valid else 0.0,
            "avg_gaze_x": round(self.gaze_mean[0], 4) if valid else None,
            "avg_gaze_y": round(self.gaze_mean[1], 4) if valid else None,
            "std_gaze_x": round(math.sqrt(self.gaze_m2[0] / valid), 4) if valid else None,
            "std_gaze_y": round(math.sqrt(self.gaze_m2[1] / valid), 4) if valid else None,
            "gaze_movement": {
                "mean_speed": round(self.speed_total / self.speed_count, 4) if self.speed_count else None,
                "max_speed": round(self.max_speed, 4) if self.speed_count else None,
                "range_x": round(self.gaze_max[0] - self.gaze_min[0], 4) if valid else None,
                "range_y": round(self.gaze_max[1] - self.gaze_min[1], 4) if valid else None,
                "direction_changes": self.direction_changes,
                "last_direction": self.last_sample.get("gaze_direction") if self.last_sample else None,
            },
            "blink": {
                "count": self.blink_count,
                "per_minute": round(self.blink_count * 60 / elapsed, 2),
                "mean_duration_ms": (
                    round(self.blink_duration_total * 1000 / self.blink_count, 1)
                    if self.blink_count else None
                ),
                "mean_ear_asymmetry": eye_mean("ear_asymmetry"),
            },
            "eye_openness": {
                "mean_lid_opening": {"left": eye_mean("lid_left"), "right": eye_mean("lid_right")},
                "mean_brow_eye_distance": {"left": eye_mean("brow_left"), "right": eye_mean("brow_right")},
            },
            "blendshapes": {
                name: round(self.blendshape_totals.get(name, 0.0) / blend_count, 4)
                for name in BLENDSHAPES
            } if blend_count else {},
            "last_sample": self.last_sample,
        }


class EyeTracker:
    def __init__(
        self,
        *,
        gaze_center: tuple[float, float] = (0.0, 0.0),
        gaze_threshold: tuple[float, float] = (0.18, 0.20),
        ear_threshold: float = 0.20,
    ) -> None:
        if any(value <= 0 for value in (*gaze_threshold, ear_threshold)):
            raise ValueError("시선·EAR 임계값은 0보다 커야 합니다.")
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Face Landmarker 모델이 없습니다: {MODEL_PATH}")

        self.lock = Lock()
        self.gaze_center = gaze_center
        self.gaze_threshold = gaze_threshold
        self.ear_threshold = ear_threshold
        self.state = EyeTrackingState(gaze_center, gaze_threshold, ear_threshold)
        self._clock_started_at = time.perf_counter()
        self._interview_started_at = self._clock_started_at
        self._last_timestamp_ms = 0

        options = vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(
                model_asset_path=str(_model_path_for_mediapipe(MODEL_PATH))
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=False,
        )
        self.landmarker = vision.FaceLandmarker.create_from_options(options)

    def reset(self, *, restart_timeline: bool = False) -> None:
        with self.lock:
            if restart_timeline:
                self._interview_started_at = time.perf_counter()
            self.state = EyeTrackingState(
                self.gaze_center,
                self.gaze_threshold,
                self.ear_threshold,
            )

    def process_bgr_frame(self, frame_bgr: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
        with self.lock:
            if self.landmarker is None:
                raise RuntimeError("EyeTracker가 이미 종료되었습니다.")
            image = mp.Image(
                image_format=mp.ImageFormat.SRGB,
                data=np.ascontiguousarray(frame_bgr[..., ::-1]),
            )
            now = time.perf_counter()
            timestamp_ms = max(
                int((now - self._clock_started_at) * 1000),
                self._last_timestamp_ms + 1,
            )
            self._last_timestamp_ms = timestamp_ms
            result = self.landmarker.detect_for_video(image, timestamp_ms)
            elapsed = round(now - self._interview_started_at, 3)

            if not result.face_landmarks:
                sample = _empty_sample(False, timestamp=elapsed)
                self.state.add(sample, now)
                return frame_bgr, sample

            landmarks = result.face_landmarks[0]
            blendshapes = _blendshape_scores(result)
            eyes = {name: _eye_features(landmarks, eye) for name, eye in EYES.items()}
            if any(feature is None for feature in eyes.values()):
                sample = _empty_sample(True, blendshapes, elapsed)
                self.state.add(sample, now)
                return frame_bgr, sample

            left, right = eyes["left"], eyes["right"]
            gaze_x = (left["local_x"] + right["local_x"]) / 2
            gaze_y = (left["local_y"] + right["local_y"]) / 2
            sample = {
                "timestamp": elapsed,
                "face_detected": True,
                "face_frame_valid": True,
                "left_eye": {key: round(value, 4) for key, value in left.items()},
                "right_eye": {key: round(value, 4) for key, value in right.items()},
                "gaze_x": round(gaze_x, 4),
                "gaze_y": round(gaze_y, 4),
                "gaze_speed": None,
                "gaze_direction": None,
                "eyes_closed": None,
                "blendshapes": blendshapes,
            }
            self.state.add(sample, now)
            return frame_bgr, sample

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return self.state.snapshot()

    def close(self) -> None:
        with self.lock:
            if self.landmarker is not None:
                self.landmarker.close()
                self.landmarker = None


def _self_check() -> None:
    state = EyeTrackingState((0.0, 0.0), (0.18, 0.20), 0.20)
    now = time.perf_counter()

    def sample(ear: float, gaze_x: float) -> dict[str, Any]:
        eye = {"ear": ear, "lid_opening": ear, "brow_eye_distance": 0.4}
        return {
            **_empty_sample(True),
            "face_frame_valid": True,
            "left_eye": eye.copy(),
            "right_eye": eye.copy(),
            "gaze_x": gaze_x,
            "gaze_y": 0.0,
        }

    state.add(sample(0.3, 0.0), now)
    state.add(sample(0.1, 0.0), now + 0.1)
    state.add(sample(0.3, 0.3), now + 0.2)
    result = state.snapshot()
    assert result["processed_frames"] == 3
    assert result["valid_gaze_samples"] == 2
    assert result["blink"]["count"] == 1
    assert result["gaze_movement"]["range_x"] == 0.3


if __name__ == "__main__":
    _self_check()
    print("eyetracking self-check: OK")

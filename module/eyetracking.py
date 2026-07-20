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
MIN_EYE_WIDTH_PX = 8.0
# ponytail: heuristic validity gates, tune against recorded sessions if needed.
MAX_EYE_DISAGREEMENT = 0.4
MAX_HEAD_YAW_DEG = 25.0
MAX_HEAD_PITCH_DEG = 20.0
# Cap the per-frame dt so stream stalls do not pollute time-based ratios.
MAX_FRAME_GAP_SECONDS = 0.5
# A center dwell longer than this breaks direction-change continuity.
MAX_CENTER_LINK_SECONDS = 1.0


def _model_path_for_mediapipe(path: Path) -> Path:
    """Copy the model only when MediaPipe cannot open a non-ASCII Windows path."""
    if os.name != "nt" or str(path).isascii():
        return path

    target = Path(tempfile.gettempdir()) / "interreview-assets" / path.name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.stat().st_size != path.stat().st_size:
        shutil.copy2(path, target)
    return target


def _xy(landmarks, index: int, scale: np.ndarray) -> np.ndarray:
    """Landmark in pixel coordinates so distances are isotropic."""
    point = landmarks[index]
    return np.array((point.x, point.y), dtype=np.float32) * scale


def _distance(landmarks, pair: tuple[int, int], scale: np.ndarray) -> float:
    return float(np.linalg.norm(_xy(landmarks, pair[0], scale) - _xy(landmarks, pair[1], scale)))


def _eye_features(landmarks, eye: dict[str, Any], scale: np.ndarray) -> dict[str, float] | None:
    """Return scale- and roll-normalized gaze, EAR, lid and brow distances."""
    corner0, corner1 = (_xy(landmarks, index, scale) for index in eye["corners"])
    width = float(np.linalg.norm(corner1 - corner0))
    if width < MIN_EYE_WIDTH_PX:
        return None

    top, bottom = (_xy(landmarks, index, scale) for index in eye["lid"])
    x_axis = (corner1 - corner0) / width
    y_axis = np.array((-x_axis[1], x_axis[0]), dtype=np.float32)
    if np.dot(bottom - top, y_axis) < 0:
        y_axis = -y_axis

    center = (corner0 + corner1 + top + bottom) / 4
    iris = np.mean([_xy(landmarks, index, scale) for index in eye["iris"]], axis=0)
    delta = iris - center

    vertical = eye["vertical"]
    ear = (
        _distance(landmarks, vertical[0], scale) + _distance(landmarks, vertical[1], scale)
    ) / (2 * width)

    features = {
        # Both axes are normalized by eye width so vertical gaze does not get
        # amplified when the lids narrow (squint / half-closed eyes).
        "local_x": float(np.dot(delta, x_axis) / width),
        "local_y": float(np.dot(delta, y_axis) / width),
        "ear": ear,
        "lid_opening": _distance(landmarks, eye["lid"], scale) / width,
        "brow_eye_distance": _distance(landmarks, eye["brow_lid"], scale) / width,
    }
    if not all(math.isfinite(value) for value in features.values()):
        return None
    return features


def _blendshape_scores(result) -> dict[str, float]:
    if not result.face_blendshapes:
        return {}
    scores = {item.category_name: float(item.score) for item in result.face_blendshapes[0]}
    return {name: round(scores.get(name, 0.0), 4) for name in BLENDSHAPES}


def _head_pose_degrees(result) -> dict[str, float] | None:
    """Euler angles from the facial transformation matrix (R = Rz·Ry·Rx)."""
    matrixes = getattr(result, "facial_transformation_matrixes", None)
    if matrixes is None or len(matrixes) == 0:
        return None
    r = np.asarray(matrixes[0], dtype=np.float64)[:3, :3]
    sy = math.hypot(r[0, 0], r[1, 0])
    return {
        "yaw": round(math.degrees(math.atan2(-r[2, 0], sy)), 1),
        "pitch": round(math.degrees(math.atan2(r[2, 1], r[2, 2])), 1),
        "roll": round(math.degrees(math.atan2(r[1, 0], r[0, 0])), 1),
    }


def _empty_sample(
    face_detected: bool,
    blendshapes: dict[str, float] | None = None,
    timestamp: float = 0.0,
    head_pose: dict[str, float] | None = None,
) -> dict[str, Any]:
    return {
        "timestamp": timestamp,
        "face_detected": face_detected,
        "face_frame_valid": False,
        "head_pose": head_pose,
        "left_eye": None,
        "right_eye": None,
        "gaze_x": None,
        "gaze_y": None,
        "gaze_speed": None,
        "gaze_direction": None,
        "ear": None,
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
    processed_frames: int = 0
    face_detected_frames: int = 0
    valid_gaze_samples: int = 0
    last_add_at: float | None = None
    observed_seconds: float = 0.0
    face_seconds: float = 0.0
    valid_seconds: float = 0.0
    gaze_seconds: float = 0.0
    front_seconds: float = 0.0
    gaze_mean: list[float] = field(default_factory=lambda: [0.0, 0.0])
    gaze_m2: list[float] = field(default_factory=lambda: [0.0, 0.0])
    gaze_min: list[float] = field(default_factory=lambda: [math.inf, math.inf])
    gaze_max: list[float] = field(default_factory=lambda: [-math.inf, -math.inf])
    last_gaze: tuple[float, float, float] | None = None
    speed_total: float = 0.0
    speed_count: int = 0
    max_speed: float = 0.0
    last_direction: str | None = None
    center_since: float | None = None
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
        dt = 0.0
        if self.last_add_at is not None:
            dt = min(max(now - self.last_add_at, 0.0), MAX_FRAME_GAP_SECONDS)
        self.last_add_at = now
        self.observed_seconds += dt

        self.processed_frames += 1
        if sample["face_detected"]:
            self.face_detected_frames += 1
            self.face_seconds += dt

        if sample["blendshapes"]:
            self.blendshape_samples += 1
            for name, value in sample["blendshapes"].items():
                self.blendshape_totals[name] = self.blendshape_totals.get(name, 0.0) + value

        if not sample["face_frame_valid"]:
            # Losing the eyes breaks blink continuity too: a closure observed
            # before the gap must not pair with an opening observed after it.
            self.closed_since = None
            self.last_gaze = None
            self.last_direction = None
            self.center_since = None
            self.last_sample = sample
            return

        self.valid_seconds += dt

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
            self.center_since = None
            self.last_sample = sample
            return

        self.gaze_seconds += dt

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
            self.front_seconds += dt
            if self.center_since is None:
                self.center_since = now
            elif now - self.center_since > MAX_CENTER_LINK_SECONDS:
                # A long front-gaze dwell ends the previous look-away episode;
                # the next deviation is a new event, not a "direction change".
                self.last_direction = None
        else:
            self.center_since = None
            if self.last_direction is not None and direction != self.last_direction:
                self.direction_changes += 1
            self.last_direction = direction

        self.last_sample = sample

    def snapshot(self) -> dict[str, Any]:
        frames, valid = self.processed_frames, self.valid_gaze_samples
        eye_count, blend_count = self.eye_feature_samples, self.blendshape_samples

        def eye_mean(name: str) -> float | None:
            return round(self.eye_totals.get(name, 0.0) / eye_count, 4) if eye_count else None

        return {
            "processed_frames": frames,
            "face_detected_frames": self.face_detected_frames,
            "observed_seconds": round(self.observed_seconds, 2),
            "valid_observation_seconds": round(self.valid_seconds, 2),
            "face_detected_ratio": (
                round(self.face_seconds / self.observed_seconds, 3)
                if self.observed_seconds else 0.0
            ),
            "valid_gaze_samples": valid,
            "front_gaze_ratio": (
                round(self.front_seconds / self.gaze_seconds, 3)
                if self.gaze_seconds else 0.0
            ),
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
                "per_minute": (
                    round(self.blink_count * 60 / self.valid_seconds, 2)
                    if self.valid_seconds else 0.0
                ),
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
        gaze_threshold: tuple[float, float] = (0.18, 0.10),
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
            output_facial_transformation_matrixes=True,
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

    def calibrate_center(self, minimum_samples: int = 10) -> bool:
        """현재까지 누적된 평균 시선을 정면 기준점으로 설정한다.

        설정 페이지에서 "화면 중앙을 응시해 주세요" 안내 후 호출하는 용도.
        유효 샘플이 부족하면 False를 반환하고 아무것도 바꾸지 않는다.
        """
        with self.lock:
            if self.state.valid_gaze_samples < minimum_samples:
                return False
            self.gaze_center = (self.state.gaze_mean[0], self.state.gaze_mean[1])
            self.state.gaze_center = self.gaze_center
            return True

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
            head_pose = _head_pose_degrees(result)

            # Gaze is measured relative to the head; with the head turned away
            # the iris offset no longer maps to screen gaze, so drop the frame.
            head_turned = head_pose is not None and (
                abs(head_pose["yaw"]) > MAX_HEAD_YAW_DEG
                or abs(head_pose["pitch"]) > MAX_HEAD_PITCH_DEG
            )

            height, width = frame_bgr.shape[:2]
            scale = np.array((width, height), dtype=np.float32)
            eyes = {name: _eye_features(landmarks, eye, scale) for name, eye in EYES.items()}
            left, right = eyes["left"], eyes["right"]

            eyes_disagree = (
                left is not None
                and right is not None
                and (
                    abs(left["local_x"] - right["local_x"]) > MAX_EYE_DISAGREEMENT
                    or abs(left["local_y"] - right["local_y"]) > MAX_EYE_DISAGREEMENT
                )
            )

            if head_turned or left is None or right is None or eyes_disagree:
                sample = _empty_sample(True, blendshapes, elapsed, head_pose)
                self.state.add(sample, now)
                return frame_bgr, sample

            gaze_x = (left["local_x"] + right["local_x"]) / 2
            gaze_y = (left["local_y"] + right["local_y"]) / 2
            sample = {
                "timestamp": elapsed,
                "face_detected": True,
                "face_frame_valid": True,
                "head_pose": head_pose,
                "left_eye": {key: round(value, 4) for key, value in left.items()},
                "right_eye": {key: round(value, 4) for key, value in right.items()},
                "gaze_x": round(gaze_x, 4),
                "gaze_y": round(gaze_y, 4),
                "gaze_speed": None,
                "gaze_direction": None,
                "ear": None,
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
    from types import SimpleNamespace

    # 1. pixel-space features: EAR must not depend on the image aspect ratio.
    def pt(x: float, y: float) -> SimpleNamespace:
        return SimpleNamespace(x=x, y=y)

    landmarks = [pt(0.0, 0.0)] * 478
    scale = np.array((1000.0, 500.0), dtype=np.float32)  # 2:1 frame
    placements = {  # eye 100px wide, lids 30px apart, iris dead center
        33: (100, 100), 133: (200, 100),
        159: (150, 85), 145: (150, 115),
        160: (130, 85), 144: (130, 115),
        158: (170, 85), 153: (170, 115),
        105: (150, 60),
    }
    for index in EYES["left"]["iris"]:
        placements[index] = (150, 100)
    for index, (px, py) in placements.items():
        landmarks[index] = pt(px / scale[0], py / scale[1])
    features = _eye_features(landmarks, EYES["left"], scale)
    assert features is not None
    assert abs(features["ear"] - 0.3) < 1e-3, features["ear"]
    assert abs(features["local_x"]) < 1e-3 and abs(features["local_y"]) < 1e-3

    # 2. blink counting and time-based accumulation
    state = EyeTrackingState((0.0, 0.0), (0.18, 0.10), 0.20)
    t0 = 100.0

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

    state.add(sample(0.3, 0.0), t0)
    state.add(sample(0.1, 0.0), t0 + 0.1)
    state.add(sample(0.3, 0.3), t0 + 0.2)
    result = state.snapshot()
    assert result["processed_frames"] == 3
    assert result["valid_gaze_samples"] == 2
    assert result["blink"]["count"] == 1
    assert result["gaze_movement"]["range_x"] == 0.3
    assert abs(result["valid_observation_seconds"] - 0.2) < 1e-6

    # 3. losing the face mid-closure must not produce a blink
    state.add(sample(0.1, 0.0), t0 + 0.3)          # eyes close
    state.add(_empty_sample(False), t0 + 0.4)       # face lost
    state.add(sample(0.3, 0.0), t0 + 0.5)           # eyes open again
    assert state.blink_count == 1

    # 4. a long center dwell breaks direction-change continuity
    state2 = EyeTrackingState((0.0, 0.0), (0.18, 0.10), 0.20)
    state2.add(sample(0.3, 0.3), t0)                # right
    state2.add(sample(0.3, -0.3), t0 + 0.1)         # left -> 1 change
    state2.add(sample(0.3, 0.0), t0 + 0.2)          # center
    state2.add(sample(0.3, 0.0), t0 + 1.5)          # center dwell > 1s
    state2.add(sample(0.3, 0.3), t0 + 1.6)          # right, new episode
    assert state2.direction_changes == 1, state2.direction_changes


if __name__ == "__main__":
    _self_check()
    print("eyetracking self-check: OK")

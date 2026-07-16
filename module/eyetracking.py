# module/eyetracking.py

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

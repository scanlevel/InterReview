import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { EyeTrackingSummary } from "./types";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH = "/face_landmarker.task";
const MIN_EYE_WIDTH_PX = 8;
const MAX_EYE_DISAGREEMENT = 0.4;
const FRONT_THRESHOLD = { x: 0.18, y: 0.1 };
const CALIBRATED_FRONT_THRESHOLD = { x: 0.2, y: 0.15 };
const SAMPLE_INTERVAL_MS = 100;

type Point = { x: number; y: number };
export type GazePoint = { x: number; y: number };

export interface FivePointGazeSamples {
  center: GazePoint;
  topLeft: GazePoint;
  topRight: GazePoint;
  bottomRight: GazePoint;
  bottomLeft: GazePoint;
}

export interface GazeCalibration {
  x: { low: number; center: number; high: number };
  y: { low: number; center: number; high: number };
}

export interface GazeDebugFrame {
  faceDetected: boolean;
  gaze: GazePoint | null;
  screenPoint: GazePoint | null;
  isFront: boolean | null;
  summary: EyeTrackingSummary | null;
}

const EYES = [
  { iris: [468, 469, 470, 471, 472], corners: [33, 133], lids: [159, 145] },
  { iris: [473, 474, 475, 476, 477], corners: [362, 263], lids: [386, 374] },
] as const;

function point(
  landmarks: NormalizedLandmark[],
  index: number,
  width: number,
  height: number,
): Point {
  return { x: landmarks[index].x * width, y: landmarks[index].y * height };
}

function eyeGaze(
  landmarks: NormalizedLandmark[],
  eye: (typeof EYES)[number],
  width: number,
  height: number,
): GazePoint | null {
  const corner0 = point(landmarks, eye.corners[0], width, height);
  const corner1 = point(landmarks, eye.corners[1], width, height);
  const dx = corner1.x - corner0.x;
  const dy = corner1.y - corner0.y;
  const eyeWidth = Math.hypot(dx, dy);
  if (eyeWidth < MIN_EYE_WIDTH_PX) return null;

  const top = point(landmarks, eye.lids[0], width, height);
  const bottom = point(landmarks, eye.lids[1], width, height);
  const xAxis = { x: dx / eyeWidth, y: dy / eyeWidth };
  let yAxis = { x: -xAxis.y, y: xAxis.x };
  if ((bottom.x - top.x) * yAxis.x + (bottom.y - top.y) * yAxis.y < 0) {
    yAxis = { x: -yAxis.x, y: -yAxis.y };
  }

  const iris = eye.iris.reduce(
    (sum, index) => {
      const value = point(landmarks, index, width, height);
      return { x: sum.x + value.x, y: sum.y + value.y };
    },
    { x: 0, y: 0 },
  );
  iris.x /= eye.iris.length;
  iris.y /= eye.iris.length;

  const center = {
    x: (corner0.x + corner1.x + top.x + bottom.x) / 4,
    y: (corner0.y + corner1.y + top.y + bottom.y) / 4,
  };
  const offset = { x: iris.x - center.x, y: iris.y - center.y };
  return {
    x: (offset.x * xAxis.x + offset.y * xAxis.y) / eyeWidth,
    y: (offset.x * yAxis.x + offset.y * yAxis.y) / eyeWidth,
  };
}

function gazeFromLandmarks(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): GazePoint | null {
  const left = eyeGaze(landmarks, EYES[0], width, height);
  const right = eyeGaze(landmarks, EYES[1], width, height);
  if (
    !left ||
    !right ||
    Math.abs(left.x - right.x) > MAX_EYE_DISAGREEMENT ||
    Math.abs(left.y - right.y) > MAX_EYE_DISAGREEMENT
  ) {
    return null;
  }
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ordered(low: number, center: number, high: number): boolean {
  return (low < center && center < high) || (low > center && center > high);
}

export function createGazeCalibration(
  samples: FivePointGazeSamples,
): GazeCalibration | null {
  const x = {
    low: (samples.topLeft.x + samples.bottomLeft.x) / 2,
    center: samples.center.x,
    high: (samples.topRight.x + samples.bottomRight.x) / 2,
  };
  const y = {
    low: (samples.topLeft.y + samples.topRight.y) / 2,
    center: samples.center.y,
    high: (samples.bottomLeft.y + samples.bottomRight.y) / 2,
  };
  if (!ordered(x.low, x.center, x.high) || !ordered(y.low, y.center, y.high)) {
    return null;
  }
  return { x, y };
}

function mapAxis(value: number, axis: GazeCalibration["x"]): number {
  const onLowSide = (value - axis.center) * (axis.low - axis.center) >= 0;
  const mapped = onLowSide
    ? (0.5 * (value - axis.low)) / (axis.center - axis.low)
    : 0.5 + (0.5 * (value - axis.center)) / (axis.high - axis.center);
  return Math.max(0, Math.min(1, mapped));
}

export function applyGazeCalibration(
  gaze: GazePoint,
  calibration: GazeCalibration,
): GazePoint {
  return {
    x: mapAxis(gaze.x, calibration.x),
    y: mapAxis(gaze.y, calibration.y),
  };
}

export class GazeAccumulator {
  private processed = 0;
  private faceDetected = 0;
  private valid = 0;
  private front = 0;
  private meanX = 0;
  private meanY = 0;
  private m2X = 0;
  private m2Y = 0;
  private rawMeanX = 0;
  private rawMeanY = 0;
  private calibration?: GazeCalibration;

  constructor(calibration?: GazeCalibration) {
    this.calibration = calibration;
  }

  add(faceDetected: boolean, gaze: GazePoint | null): void {
    this.processed += 1;
    if (faceDetected) this.faceDetected += 1;
    if (!gaze) return;

    this.valid += 1;
    this.rawMeanX += (gaze.x - this.rawMeanX) / this.valid;
    this.rawMeanY += (gaze.y - this.rawMeanY) / this.valid;
    if (this.isFront(gaze)) {
      this.front += 1;
    }

    const measured = this.screenPoint(gaze);
    const dx = measured.x - this.meanX;
    const dy = measured.y - this.meanY;
    this.meanX += dx / this.valid;
    this.meanY += dy / this.valid;
    this.m2X += dx * (measured.x - this.meanX);
    this.m2Y += dy * (measured.y - this.meanY);
  }

  isFront(gaze: GazePoint): boolean {
    if (this.calibration) {
      const screen = applyGazeCalibration(gaze, this.calibration);
      return (
        Math.abs(screen.x - 0.5) <= CALIBRATED_FRONT_THRESHOLD.x &&
        Math.abs(screen.y - 0.5) <= CALIBRATED_FRONT_THRESHOLD.y
      );
    }
    return (
      Math.abs(gaze.x) <= FRONT_THRESHOLD.x &&
      Math.abs(gaze.y) <= FRONT_THRESHOLD.y
    );
  }

  meanGaze(minimumSamples = 10): GazePoint | null {
    if (this.valid < minimumSamples) return null;
    return { x: this.rawMeanX, y: this.rawMeanY };
  }

  screenPoint(gaze: GazePoint): GazePoint {
    return this.calibration ? applyGazeCalibration(gaze, this.calibration) : gaze;
  }

  snapshot(): EyeTrackingSummary | null {
    if (!this.processed) return null;
    const stdGaze = this.valid
      ? Math.hypot(
          Math.sqrt(this.m2X / this.valid),
          Math.sqrt(this.m2Y / this.valid),
        )
      : null;
    return {
      face_detected_ratio: round(this.faceDetected / this.processed),
      front_gaze_ratio: this.valid ? round(this.front / this.valid) : null,
      std_gaze: stdGaze === null ? null : round(stdGaze),
    };
  }
}

export class BrowserGazeTracker {
  private accumulator: GazeAccumulator;
  private animationFrame: number | null = null;
  private active = false;
  private lastTimestamp = 0;
  private nextSampleAt = 0;
  private readonly video: HTMLVideoElement;
  private readonly landmarker: FaceLandmarker;
  private readonly onDebugFrame?: (frame: GazeDebugFrame) => void;
  private calibration?: GazeCalibration;

  constructor(
    video: HTMLVideoElement,
    landmarker: FaceLandmarker,
    onDebugFrame?: (frame: GazeDebugFrame) => void,
    calibration?: GazeCalibration,
  ) {
    this.video = video;
    this.landmarker = landmarker;
    this.onDebugFrame = onDebugFrame;
    this.calibration = calibration;
    this.accumulator = new GazeAccumulator(calibration);
  }

  start(): void {
    this.stop();
    this.accumulator = new GazeAccumulator(this.calibration);
    this.nextSampleAt = 0;
    this.active = true;
    this.processFrame();
  }

  stop(): EyeTrackingSummary | null {
    this.active = false;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    return this.accumulator.snapshot();
  }

  close(): void {
    this.stop();
    this.landmarker.close();
  }

  meanGaze(minimumSamples = 10): GazePoint | null {
    return this.accumulator.meanGaze(minimumSamples);
  }

  setCalibration(calibration: GazeCalibration): void {
    this.calibration = calibration;
  }

  private processFrame = (): void => {
    if (!this.active) return;
    const now = performance.now();
    if (
      now >= this.nextSampleAt &&
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0
    ) {
      this.nextSampleAt = now + SAMPLE_INTERVAL_MS;
      const timestamp = Math.max(now, this.lastTimestamp + 1);
      this.lastTimestamp = timestamp;
      const result = this.landmarker.detectForVideo(this.video, timestamp);
      const landmarks = result.faceLandmarks[0];
      const gaze = landmarks
        ? gazeFromLandmarks(
            landmarks,
            this.video.videoWidth,
            this.video.videoHeight,
          )
        : null;
      this.accumulator.add(Boolean(landmarks), gaze);
      this.onDebugFrame?.({
        faceDetected: Boolean(landmarks),
        gaze,
        screenPoint:
          gaze && this.calibration ? this.accumulator.screenPoint(gaze) : null,
        isFront: gaze ? this.accumulator.isFront(gaze) : null,
        summary: this.accumulator.snapshot(),
      });
    }
    this.animationFrame = requestAnimationFrame(this.processFrame);
  };
}

export async function createBrowserGazeTracker(
  video: HTMLVideoElement,
  onDebugFrame?: (frame: GazeDebugFrame) => void,
  calibration?: GazeCalibration,
): Promise<BrowserGazeTracker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return new BrowserGazeTracker(video, landmarker, onDebugFrame, calibration);
}

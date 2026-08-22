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
const GAZE_SMOOTHING_ALPHA = 0.15;
export const HEATMAP_COLUMNS = 12;
export const HEATMAP_ROWS = 8;

type Point = { x: number; y: number };
export type GazePoint = { x: number; y: number };

const MAX_ABS_GAZE = 1;

export function isValidGazePoint(
  gaze: GazePoint | null | undefined,
): gaze is GazePoint {
  return Boolean(
    gaze &&
      Number.isFinite(gaze.x) &&
      Number.isFinite(gaze.y) &&
      Math.abs(gaze.x) <= MAX_ABS_GAZE &&
      Math.abs(gaze.y) <= MAX_ABS_GAZE,
  );
}

export function smoothGazePoint(
  previous: GazePoint | null,
  gaze: GazePoint | null,
  alpha = GAZE_SMOOTHING_ALPHA,
): GazePoint | null {
  if (!isValidGazePoint(gaze)) return null;
  if (!isValidGazePoint(previous)) return gaze;
  const safeAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : GAZE_SMOOTHING_ALPHA;
  return {
    x: previous.x + safeAlpha * (gaze.x - previous.x),
    y: previous.y + safeAlpha * (gaze.y - previous.y),
  };
}

export interface GazeCalibrationSample {
  gaze: GazePoint;
  target: GazePoint;
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
  const averaged = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
  return isValidGazePoint(averaged) ? averaged : null;
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.max(low, Math.min(high, value));
}

function ordered(low: number, center: number, high: number): boolean {
  return (low < center && center < high) || (low > center && center > high);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const orderedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(orderedValues.length / 2);
  return orderedValues.length % 2
    ? orderedValues[middle]
    : (orderedValues[middle - 1] + orderedValues[middle]) / 2;
}

function calibrationAxis(
  samples: GazeCalibrationSample[],
  axis: "x" | "y",
): GazeCalibration["x"] | null {
  const levels = [0.1, 0.5, 0.9];
  const values = levels.map((level) =>
    median(
      samples
        .filter((sample) => Math.abs(sample.target[axis] - level) <= 0.02)
        .map((sample) => sample.gaze[axis])
        .filter(Number.isFinite),
    ),
  );
  if (values.some((value) => value === null)) return null;
  const [low, center, high] = values as [number, number, number];
  return ordered(low, center, high) ? { low, center, high } : null;
}

export function createGazeCalibration(
  samples: GazeCalibrationSample[],
): GazeCalibration | null {
  if (samples.length < 24) return null;
  const x = calibrationAxis(samples, "x");
  const y = calibrationAxis(samples, "y");
  return x && y ? { x, y } : null;
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
  private valid = 0;
  private calibration?: GazeCalibration;
  private readonly heatmap = new Array<number>(
    HEATMAP_COLUMNS * HEATMAP_ROWS,
  ).fill(0);

  constructor(calibration?: GazeCalibration) {
    this.calibration = calibration;
  }

  add(gaze: GazePoint | null): void {
    if (!isValidGazePoint(gaze)) return;

    this.valid += 1;

    const measured = this.screenPoint(gaze);

    const column = Math.min(
      HEATMAP_COLUMNS - 1,
      Math.max(0, Math.floor(measured.x * HEATMAP_COLUMNS)),
    );
    const row = Math.min(
      HEATMAP_ROWS - 1,
      Math.max(0, Math.floor(measured.y * HEATMAP_ROWS)),
    );
    this.heatmap[row * HEATMAP_COLUMNS + column] += 1;
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

  screenPoint(gaze: GazePoint): GazePoint {
    if (this.calibration) return applyGazeCalibration(gaze, this.calibration);
    // Keep the uncalibrated view broad and normalized for the heatmap.
    return {
      x: clamp(0.5 - gaze.x * 1.5),
      y: clamp(0.5 + gaze.y * 1.5),
    };
  }

  snapshot(): EyeTrackingSummary | null {
    return this.valid
      ? {
          gaze_heatmap: {
            columns: HEATMAP_COLUMNS,
            rows: HEATMAP_ROWS,
            counts: [...this.heatmap],
            total: this.valid,
          },
        }
      : null;
  }
}

const XNNPACK_INFO = "Created TensorFlow Lite XNNPACK delegate for CPU.";
let infoFilterUsers = 0;
let previousConsoleError: typeof console.error | null = null;
let filteredConsoleError: typeof console.error | null = null;

/** MediaPipe sends this informational WASM line through console.error. */
function acquireMediapipeInfoFilter(): () => void {
  if (typeof console === "undefined") return () => undefined;
  if (infoFilterUsers === 0) {
    previousConsoleError = console.error;
    filteredConsoleError = (...args: Parameters<typeof console.error>) => {
      if (
        args.some(
          (arg) => typeof arg === "string" && arg.includes(XNNPACK_INFO),
        )
      ) {
        return;
      }
      previousConsoleError?.(...args);
    };
    console.error = filteredConsoleError;
  }
  infoFilterUsers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    infoFilterUsers -= 1;
    if (
      infoFilterUsers === 0 &&
      filteredConsoleError &&
      console.error === filteredConsoleError
    ) {
      console.error = previousConsoleError ?? console.error;
      previousConsoleError = null;
      filteredConsoleError = null;
    }
  };
}

export class BrowserGazeTracker {
  private accumulator: GazeAccumulator;
  private animationFrame: number | null = null;
  private active = false;
  private lastTimestamp = 0;
  private nextSampleAt = 0;
  private smoothedGaze: GazePoint | null = null;
  private readonly video: HTMLVideoElement;
  private readonly landmarker: FaceLandmarker;
  private readonly onDebugFrame?: (frame: GazeDebugFrame) => void;
  private calibration?: GazeCalibration;
  private readonly releaseInfoFilter: () => void;
  private closed = false;

  constructor(
    video: HTMLVideoElement,
    landmarker: FaceLandmarker,
    onDebugFrame?: (frame: GazeDebugFrame) => void,
    calibration?: GazeCalibration,
    releaseInfoFilter: () => void = () => undefined,
  ) {
    this.video = video;
    this.landmarker = landmarker;
    this.onDebugFrame = onDebugFrame;
    this.calibration = calibration;
    this.releaseInfoFilter = releaseInfoFilter;
    this.accumulator = new GazeAccumulator(calibration);
  }

  start(): void {
    if (this.closed) return;
    this.stop();
    this.accumulator = new GazeAccumulator(this.calibration);
    this.lastTimestamp = 0;
    this.nextSampleAt = 0;
    this.smoothedGaze = null;
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
    if (this.closed) return;
    this.stop();
    try {
      this.landmarker.close();
    } finally {
      this.releaseInfoFilter();
      this.closed = true;
    }
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
      try {
        const result = this.landmarker.detectForVideo(this.video, timestamp);
        const landmarks = result.faceLandmarks[0];
        const rawGaze = landmarks
          ? gazeFromLandmarks(
              landmarks,
              this.video.videoWidth,
              this.video.videoHeight,
            )
          : null;
        const gaze = this.smoothGaze(rawGaze);
        this.accumulator.add(gaze);
        this.onDebugFrame?.({
          faceDetected: Boolean(landmarks),
          gaze,
          screenPoint: gaze ? this.accumulator.screenPoint(gaze) : null,
          isFront: gaze ? this.accumulator.isFront(gaze) : null,
        });
      } catch {
        // A dropped/invalid video frame should not stop the interview loop.
        this.smoothedGaze = null;
        this.accumulator.add(null);
      }
    }
    this.animationFrame = requestAnimationFrame(this.processFrame);
  };

  private smoothGaze(gaze: GazePoint | null): GazePoint | null {
    this.smoothedGaze = smoothGazePoint(this.smoothedGaze, gaze);
    return this.smoothedGaze;
  }
}

export async function createBrowserGazeTracker(
  video: HTMLVideoElement,
  onDebugFrame?: (frame: GazeDebugFrame) => void,
  calibration?: GazeCalibration,
): Promise<BrowserGazeTracker> {
  const releaseInfoFilter = acquireMediapipeInfoFilter();
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
    const landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return new BrowserGazeTracker(
      video,
      landmarker,
      onDebugFrame,
      calibration,
      releaseInfoFilter,
    );
  } catch (error) {
    releaseInfoFilter();
    throw error;
  }
}

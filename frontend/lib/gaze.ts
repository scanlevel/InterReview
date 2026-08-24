import {
  FaceLandmarker,
  FilesetResolver,
  type Matrix,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { EyeTrackingSummary } from "./types";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH = "/face_landmarker.task";
const MIN_EYE_WIDTH_PX = 8;
const MIN_EYE_OPENNESS = 0.06;
const MAX_EYE_DISAGREEMENT = 0.3;
const FRONT_THRESHOLD = { x: 0.18, y: 0.1 };
const CALIBRATED_FRONT_THRESHOLD = { x: 0.2, y: 0.15 };
const SAMPLE_INTERVAL_MS = 50;
export const HEATMAP_COLUMNS = 12;
const SMOOTHING_RESET_AFTER_MS = 500;
const CALIBRATION_LEVELS = [0.1, 0.5, 0.9] as const;
const CALIBRATION_TARGET_TOLERANCE = 0.02;
const MIN_CALIBRATION_SAMPLES_PER_TARGET = 8;
const MAX_CALIBRATION_MAD = 0.12;
const MIN_CALIBRATION_GAZE_SPAN = 0.04;
const CALIBRATION_RIDGE_LAMBDA = 0.0001;
const CALIBRATION_FEATURE_COUNT = 6;
const MAX_HEAD_POSE_DELTA = 0.28;
const VIDEO_TIME_EPSILON = 0.0001;
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

export function isNewVideoFrame(
  currentTime: number,
  previousTime: number | null,
): boolean {
  if (!Number.isFinite(currentTime) || currentTime <= 0) return true;
  return previousTime === null || currentTime > previousTime + VIDEO_TIME_EPSILON;
}


export interface GazeCalibrationSample {
  gaze: GazePoint;
  target: GazePoint;
}

export interface GazeCalibration {
  mean: GazePoint;
  scale: GazePoint;
  xCoefficients: number[];
  yCoefficients: number[];
}

export interface GazeDebugFrame {
  faceDetected: boolean;
  rawGaze: GazePoint | null;
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
  const eyeHeight = Math.abs(
    (bottom.x - top.x) * yAxis.x + (bottom.y - top.y) * yAxis.y,
  );
  if (eyeHeight / eyeWidth < MIN_EYE_OPENNESS) return null;

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

function median(values: number[]): number | null {
  if (!values.length) return null;
  const orderedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(orderedValues.length / 2);
  return orderedValues.length % 2
    ? orderedValues[middle]
    : (orderedValues[middle - 1] + orderedValues[middle]) / 2;
}

function calibrationTargetMedians(
  samples: GazeCalibrationSample[],
): GazeCalibrationSample[] | null {
  const medians: GazeCalibrationSample[] = [];
  for (const y of CALIBRATION_LEVELS) {
    for (const x of CALIBRATION_LEVELS) {
      const targetSamples = samples.filter(
        (sample) =>
          Math.abs(sample.target.x - x) <= CALIBRATION_TARGET_TOLERANCE &&
          Math.abs(sample.target.y - y) <= CALIBRATION_TARGET_TOLERANCE,
      );
      const validSamples = targetSamples.filter((sample) =>
        isValidGazePoint(sample.gaze),
      );
      if (validSamples.length < MIN_CALIBRATION_SAMPLES_PER_TARGET) {
        return null;
      }
      const gazeXValues = validSamples.map((sample) => sample.gaze.x);
      const gazeYValues = validSamples.map((sample) => sample.gaze.y);
      const gazeX = median(gazeXValues);
      const gazeY = median(gazeYValues);
      if (gazeX === null || gazeY === null) return null;
      const madX = median(
        gazeXValues.map((value) => Math.abs(value - gazeX)),
      );
      const madY = median(
        gazeYValues.map((value) => Math.abs(value - gazeY)),
      );
      if (
        madX === null ||
        madY === null ||
        Math.max(madX, madY) > MAX_CALIBRATION_MAD
      ) {
        return null;
      }
      medians.push({ gaze: { x: gazeX, y: gazeY }, target: { x, y } });
    }
  }
  return medians;
}

function calibrationFeatures(
  gaze: GazePoint,
  mean: GazePoint,
  scale: GazePoint,
): number[] {
  const x = (gaze.x - mean.x) / scale.x;
  const y = (gaze.y - mean.y) / scale.y;
  return [1, x, y, x * x, x * y, y * y];
}

function solveLinearSystem(
  matrix: number[][],
  vector: number[],
): number[] | null {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(augmented[row][column]) >
        Math.abs(augmented[pivotRow][column])
      ) {
        pivotRow = row;
      }
    }
    const pivot = augmented[pivotRow][column];
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-9) return null;
    [augmented[column], augmented[pivotRow]] = [
      augmented[pivotRow],
      augmented[column],
    ];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  const result = augmented.map((row) => row[size]);
  return result.every(Number.isFinite) ? result : null;
}

function fitCalibrationModel(
  targetMedians: GazeCalibrationSample[],
): GazeCalibration | null {
  const gazeXValues = targetMedians.map((sample) => sample.gaze.x);
  const gazeYValues = targetMedians.map((sample) => sample.gaze.y);
  const xSpan = Math.max(...gazeXValues) - Math.min(...gazeXValues);
  const ySpan = Math.max(...gazeYValues) - Math.min(...gazeYValues);
  if (xSpan < MIN_CALIBRATION_GAZE_SPAN || ySpan < MIN_CALIBRATION_GAZE_SPAN) {
    return null;
  }

  const mean = {
    x: gazeXValues.reduce((sum, value) => sum + value, 0) / gazeXValues.length,
    y: gazeYValues.reduce((sum, value) => sum + value, 0) / gazeYValues.length,
  };
  const scale = {
    x: Math.max(
      0.05,
      Math.sqrt(
        gazeXValues.reduce((sum, value) => sum + (value - mean.x) ** 2, 0) /
          gazeXValues.length,
      ),
    ),
    y: Math.max(
      0.05,
      Math.sqrt(
        gazeYValues.reduce((sum, value) => sum + (value - mean.y) ** 2, 0) /
          gazeYValues.length,
      ),
    ),
  };

  const normal = Array.from(
    { length: CALIBRATION_FEATURE_COUNT },
    () => new Array<number>(CALIBRATION_FEATURE_COUNT).fill(0),
  );
  const targetX = new Array<number>(CALIBRATION_FEATURE_COUNT).fill(0);
  const targetY = new Array<number>(CALIBRATION_FEATURE_COUNT).fill(0);
  for (const sample of targetMedians) {
    const features = calibrationFeatures(sample.gaze, mean, scale);
    for (let row = 0; row < CALIBRATION_FEATURE_COUNT; row += 1) {
      targetX[row] += features[row] * sample.target.x;
      targetY[row] += features[row] * sample.target.y;
      for (let column = 0; column < CALIBRATION_FEATURE_COUNT; column += 1) {
        normal[row][column] += features[row] * features[column];
      }
    }
  }
  for (let index = 1; index < CALIBRATION_FEATURE_COUNT; index += 1) {
    normal[index][index] += CALIBRATION_RIDGE_LAMBDA;
  }

  const xCoefficients = solveLinearSystem(normal, targetX);
  const yCoefficients = solveLinearSystem(normal, targetY);
  if (!xCoefficients || !yCoefficients) return null;
  return { mean, scale, xCoefficients, yCoefficients };
}

export function createGazeCalibration(
  samples: GazeCalibrationSample[],
): GazeCalibration | null {
  const targetMedians = calibrationTargetMedians(samples);
  if (!targetMedians) return null;
  return fitCalibrationModel(targetMedians);
}

function predictCalibration(
  gaze: GazePoint,
  calibration: GazeCalibration,
  coefficients: number[],
): number {
  const features = calibrationFeatures(gaze, calibration.mean, calibration.scale);
  return features.reduce(
    (sum, feature, index) => sum + feature * coefficients[index],
    0,
  );
}

export function applyGazeCalibration(
  gaze: GazePoint,
  calibration: GazeCalibration,
): GazePoint {
  return {
    x: clamp(predictCalibration(gaze, calibration, calibration.xCoefficients)),
    y: clamp(predictCalibration(gaze, calibration, calibration.yCoefficients)),
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

function oneEuroAlpha(cutoff: number, deltaSeconds: number): number {
  const safeCutoff = Math.max(0.001, cutoff);
  const tau = 1 / (2 * Math.PI * safeCutoff);
  return 1 / (1 + tau / Math.max(0.001, deltaSeconds));
}

class OneEuroAxisFilter {
  private lastTimestamp: number | null = null;
  private previousRaw: number | null = null;
  private filtered: number | null = null;
  private filteredDerivative = 0;

  reset(): void {
    this.lastTimestamp = null;
    this.previousRaw = null;
    this.filtered = null;
    this.filteredDerivative = 0;
  }

  filter(value: number, timestamp: number): number {
    if (
      this.lastTimestamp === null ||
      this.previousRaw === null ||
      this.filtered === null
    ) {
      this.lastTimestamp = timestamp;
      this.previousRaw = value;
      this.filtered = value;
      return value;
    }

    const deltaSeconds = Math.max(
      0.001,
      (timestamp - this.lastTimestamp) / 1000,
    );
    const derivative = (value - this.previousRaw) / deltaSeconds;
    const derivativeAlpha = oneEuroAlpha(1, deltaSeconds);
    this.filteredDerivative +=
      derivativeAlpha * (derivative - this.filteredDerivative);
    const cutoff = 1.1 + 0.08 * Math.abs(this.filteredDerivative);
    const alpha = oneEuroAlpha(cutoff, deltaSeconds);
    this.filtered += alpha * (value - this.filtered);
    this.lastTimestamp = timestamp;
    this.previousRaw = value;
    return this.filtered;
  }
}

export class OneEuroGazeFilter {
  private readonly x = new OneEuroAxisFilter();
  private readonly y = new OneEuroAxisFilter();

  reset(): void {
    this.x.reset();
    this.y.reset();
  }

  filter(gaze: GazePoint, timestamp: number): GazePoint {
    return {
      x: this.x.filter(gaze.x, timestamp),
      y: this.y.filter(gaze.y, timestamp),
    };
  }
}

function normalizedRotation(matrix: Matrix | undefined): number[] | null {
  if (!matrix || matrix.data.length < 16) return null;
  const rotation = matrix.data.slice(0, 3).concat(
    matrix.data.slice(4, 7),
    matrix.data.slice(8, 11),
  );
  for (let row = 0; row < 3; row += 1) {
    const offset = row * 3;
    const length = Math.hypot(
      rotation[offset],
      rotation[offset + 1],
      rotation[offset + 2],
    );
    if (!Number.isFinite(length) || length < 1e-6) return null;
    for (let column = 0; column < 3; column += 1) {
      rotation[offset + column] /= length;
    }
  }
  return rotation.every(Number.isFinite) ? rotation : null;
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
  private lastVideoTime: number | null = null;
  private nextSampleAt = 0;
  private readonly gazeFilter = new OneEuroGazeFilter();
  private lastValidGazeAt = 0;
  private poseReference: number[] | null = null;
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
    this.lastVideoTime = null;
    this.nextSampleAt = 0;
    this.gazeFilter.reset();
    this.lastValidGazeAt = 0;
    this.poseReference = null;
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
    const videoTime = this.video.currentTime;
    if (
      now >= this.nextSampleAt &&
      this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0 &&
      isNewVideoFrame(videoTime, this.lastVideoTime)
    ) {
      this.nextSampleAt = now + SAMPLE_INTERVAL_MS;
      if (Number.isFinite(videoTime) && videoTime > 0) {
        this.lastVideoTime = videoTime;
      }
      const frameTimestamp =
        Number.isFinite(videoTime) && videoTime > 0 ? videoTime * 1000 : now;
      const timestamp = Math.max(frameTimestamp, this.lastTimestamp + 1);
      this.lastTimestamp = timestamp;
      try {
        const result = this.landmarker.detectForVideo(this.video, timestamp);
        const landmarks = result.faceLandmarks[0];
        const pose = result.facialTransformationMatrixes?.[0];
        const rawGaze =
          landmarks && this.isPoseStable(pose)
            ? gazeFromLandmarks(
                landmarks,
                this.video.videoWidth,
                this.video.videoHeight,
              )
            : null;
        const gaze = this.filterGaze(rawGaze, now);
        this.accumulator.add(gaze);
        this.onDebugFrame?.({
          faceDetected: Boolean(landmarks),
          rawGaze,
          gaze,
          screenPoint: gaze ? this.accumulator.screenPoint(gaze) : null,
          isFront: gaze ? this.accumulator.isFront(gaze) : null,
        });
      } catch {
        // A dropped/invalid video frame should not stop the interview loop.
        this.filterGaze(null, now);
        this.accumulator.add(null);
      }
    }
    this.animationFrame = requestAnimationFrame(this.processFrame);
  };

  private isPoseStable(matrix: Matrix | undefined): boolean {
    const rotation = normalizedRotation(matrix);
    if (!rotation) return true;
    if (!this.poseReference) {
      this.poseReference = rotation;
      return true;
    }
    const delta = Math.sqrt(
      rotation.reduce(
        (sum, value, index) =>
          sum + (value - (this.poseReference as number[])[index]) ** 2,
        0,
      ) / rotation.length,
    );
    return delta <= MAX_HEAD_POSE_DELTA;
  }

  private filterGaze(gaze: GazePoint | null, now: number): GazePoint | null {
    if (!isValidGazePoint(gaze)) {
      if (now - this.lastValidGazeAt > SMOOTHING_RESET_AFTER_MS) {
        this.gazeFilter.reset();
      }
      return null;
    }
    if (now - this.lastValidGazeAt > SMOOTHING_RESET_AFTER_MS) {
      this.gazeFilter.reset();
    }
    this.lastValidGazeAt = now;
    return this.gazeFilter.filter(gaze, now);
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
      outputFacialTransformationMatrixes: true,
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

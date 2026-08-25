import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { EyeTrackingSummary } from "./types";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_PATH = "/face_landmarker.task";
const DEFAULT_MIN_EYE_WIDTH_PX = 4;
const MIN_EYE_WIDTH_RELEASE_RATIO = 0.75;
const ABSOLUTE_MIN_EYE_WIDTH_PX = 2;
const MIN_EYE_OPENNESS_FLOOR = 0.025;
const BLINK_RATIO = 0.6;
const BLINK_MIN_DROP = 0.018;
const ANCHOR_EMA_ALPHA = 0.05;
const OPENNESS_EMA_ALPHA = 0.05;
const MAX_EYE_DISAGREEMENT = 0.3;
const MAX_MONOCULAR_JUMP = 0.25;
const MONOCULAR_CONTINUITY_MS = 500;
const FRONT_THRESHOLD = { x: 0.18, y: 0.1 };
const CALIBRATED_FRONT_THRESHOLD = { x: 0.2, y: 0.15 };
const SAMPLE_INTERVAL_MS = 50;
const GAZE_EMA_ALPHA = 0.15;
export const HEATMAP_COLUMNS = 12;
const SMOOTHING_RESET_AFTER_MS = 500;
export const CALIBRATION_PATH_DURATION_MS = 7000;
export const CALIBRATION_TARGET_DELAY_MS = 200;
const CALIBRATION_MIN_SAMPLES = 120;
const MIN_CALIBRATION_GAZE_SPAN = 0.01;
const CALIBRATION_HIDDEN_UNITS = 8;
const CALIBRATION_EPOCHS = 200;
const CALIBRATION_YIELD_EVERY = 5;
const CALIBRATION_LEARNING_RATE = 0.03;
const VIDEO_TIME_EPSILON = 0.0001;
const FACE_CROP_SIZE = 512;
export const HEATMAP_ROWS = 8;

type Point = { x: number; y: number };
export type GazePoint = { x: number; y: number };

export type CalibrationPath = "plus" | "x";

const CALIBRATION_PATHS: Record<CalibrationPath, readonly GazePoint[]> = {
  plus: [
    { x: 0.5, y: 0.5 },
    { x: 0.1, y: 0.5 },
    { x: 0.9, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.1 },
    { x: 0.5, y: 0.9 },
    { x: 0.5, y: 0.5 },
  ],
  x: [
    { x: 0.5, y: 0.5 },
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.9 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.1 },
    { x: 0.1, y: 0.9 },
    { x: 0.5, y: 0.5 },
  ],
};

export function calibrationPathPoints(
  path: CalibrationPath,
): readonly GazePoint[] {
  return CALIBRATION_PATHS[path];
}

export interface CalibrationTargetHistoryEntry {
  at: number;
  target: GazePoint;
}

export function calibrationTargetAt(
  history: readonly CalibrationTargetHistoryEntry[],
  timestamp: number,
): GazePoint | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].at <= timestamp) return history[index].target;
  }
  return null;
}

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
  eyeWidthPx?: number;
}

export interface GazeCalibration {
  kind: "mlp";
  mean: GazePoint;
  scale: GazePoint;
  hiddenWeights: number[][];
  hiddenBias: number[];
  outputWeights: number[][];
  outputBias: GazePoint;
  minimumEyeWidthPx: number;
}

export type GazeQuality =
  | "ok"
  | "face_missing"
  | "eye_too_small"
  | "blink"
  | "eyes_disagree"
  | "invalid"
  | "frame_error"
  | "processing_error";

export interface GazeDebugFrame {
  faceDetected: boolean;
  quality: GazeQuality;
  eyeWidthPx: number | null;
  rawGaze: GazePoint | null;
  gaze: GazePoint | null;
  stagePoint: GazePoint | null;
  isFront: boolean | null;
}

const EYES = [
  { iris: [468, 469, 470, 471, 472], corners: [33, 133], lids: [159, 145] },
  { iris: [473, 474, 475, 476, 477], corners: [362, 263], lids: [386, 374] },
] as const;

type EyeSampleStatus = "ok" | "eye_too_small" | "blink";

type EyeEstimate = {
  gaze: GazePoint | null;
  status: EyeSampleStatus;
  width: number;
};

type EyeState = {
  anchoredCorners: [Point, Point] | null;
  tracking: boolean;
  opennessBaseline: number | null;
};

function createEyeState(): EyeState {
  return { anchoredCorners: null, tracking: false, opennessBaseline: null };
}

function resetEyeState(state: EyeState): void {
  state.anchoredCorners = null;
  state.tracking = false;
  state.opennessBaseline = null;
}

function smoothPoint(previous: Point, next: Point, alpha: number): Point {
  return {
    x: previous.x + alpha * (next.x - previous.x),
    y: previous.y + alpha * (next.y - previous.y),
  };
}

export function isEyeWidthUsable(
  width: number,
  tracking: boolean,
  minimumWidth = DEFAULT_MIN_EYE_WIDTH_PX,
): boolean {
  return (
    Number.isFinite(width) &&
    width >= (tracking ? minimumWidth * MIN_EYE_WIDTH_RELEASE_RATIO : minimumWidth)
  );
}

type FaceRegion = { left: number; top: number; right: number; bottom: number };

export function faceRegionFromLandmarks(
  landmarks: NormalizedLandmark[],
): FaceRegion | null {
  if (!landmarks.length) return null;
  const xs = landmarks.map((landmark) => landmark.x).filter(Number.isFinite);
  const ys = landmarks.map((landmark) => landmark.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const paddingX = (right - left) * 0.25;
  const paddingY = (bottom - top) * 0.25;
  const region = {
    left: clamp(left - paddingX),
    top: clamp(top - paddingY),
    right: clamp(right + paddingX),
    bottom: clamp(bottom + paddingY),
  };
  return region.right - region.left >= 0.05 && region.bottom - region.top >= 0.05
    ? region
    : null;
}

export function landmarksFromFaceCrop(
  landmarks: NormalizedLandmark[],
  region: FaceRegion,
): NormalizedLandmark[] {
  const width = region.right - region.left;
  const height = region.bottom - region.top;
  return landmarks.map((landmark) => ({
    ...landmark,
    x: region.left + landmark.x * width,
    y: region.top + landmark.y * height,
  }));
}

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
  state: EyeState,
  minimumWidth: number,
): EyeEstimate {
  const rawCorner0 = point(landmarks, eye.corners[0], width, height);
  const rawCorner1 = point(landmarks, eye.corners[1], width, height);
  const rawWidth = Math.hypot(
    rawCorner1.x - rawCorner0.x,
    rawCorner1.y - rawCorner0.y,
  );
  if (!isEyeWidthUsable(rawWidth, state.tracking, minimumWidth)) {
    resetEyeState(state);
    return { gaze: null, status: "eye_too_small", width: rawWidth };
  }

  state.tracking = true;
  if (!state.anchoredCorners) {
    state.anchoredCorners = [rawCorner0, rawCorner1];
  } else {
    state.anchoredCorners = [
      smoothPoint(state.anchoredCorners[0], rawCorner0, ANCHOR_EMA_ALPHA),
      smoothPoint(state.anchoredCorners[1], rawCorner1, ANCHOR_EMA_ALPHA),
    ];
  }

  const [corner0, corner1] = state.anchoredCorners;
  const dx = corner1.x - corner0.x;
  const dy = corner1.y - corner0.y;
  const eyeWidth = Math.hypot(dx, dy);
  if (!Number.isFinite(eyeWidth) || eyeWidth <= 0) {
    return { gaze: null, status: "eye_too_small", width: rawWidth };
  }

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
  const openness = eyeHeight / rawWidth;
  const baseline = state.opennessBaseline;
  if (
    !Number.isFinite(openness) ||
    openness < MIN_EYE_OPENNESS_FLOOR ||
    (baseline !== null &&
      baseline - openness >= BLINK_MIN_DROP &&
      openness <= baseline * BLINK_RATIO)
  ) {
    return { gaze: null, status: "blink", width: rawWidth };
  }
  state.opennessBaseline =
    baseline === null
      ? openness
      : baseline + OPENNESS_EMA_ALPHA * (openness - baseline);

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
    x: (corner0.x + corner1.x) / 2,
    y: (corner0.y + corner1.y) / 2,
  };
  const offset = { x: iris.x - center.x, y: iris.y - center.y };
  return {
    gaze: {
      x: (offset.x * xAxis.x + offset.y * xAxis.y) / eyeWidth,
      y: (offset.x * yAxis.x + offset.y * yAxis.y) / eyeWidth,
    },
    status: "ok",
    width: rawWidth,
  };
}

function distance(left: GazePoint, right: GazePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function invalidEyeQuality(left: EyeEstimate, right: EyeEstimate): GazeQuality {
  if (left.status === "blink" || right.status === "blink") return "blink";
  return "eye_too_small";
}

function gazeFromLandmarks(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
  states: [EyeState, EyeState],
  previous: GazePoint | null,
  minimumEyeWidth: number,
): { gaze: GazePoint | null; quality: GazeQuality; eyeWidthPx: number | null } {
  const left = eyeGaze(
    landmarks,
    EYES[0],
    width,
    height,
    states[0],
    minimumEyeWidth,
  );
  const right = eyeGaze(
    landmarks,
    EYES[1],
    width,
    height,
    states[1],
    minimumEyeWidth,
  );
  const eyeWidthPx = median([left.width, right.width].filter(Number.isFinite));
  if (left.gaze && right.gaze) {
    const averaged = {
      x: (left.gaze.x + right.gaze.x) / 2,
      y: (left.gaze.y + right.gaze.y) / 2,
    };
    const disagreement = Math.max(
      Math.abs(left.gaze.x - right.gaze.x),
      Math.abs(left.gaze.y - right.gaze.y),
    );
    if (disagreement <= MAX_EYE_DISAGREEMENT) {
      return isValidGazePoint(averaged)
        ? { gaze: averaged, quality: "ok", eyeWidthPx }
        : { gaze: null, quality: "invalid", eyeWidthPx };
    }

    if (previous) {
      const candidate =
        distance(left.gaze, previous) <= distance(right.gaze, previous)
          ? left.gaze
          : right.gaze;
      if (isValidGazePoint(candidate) && distance(candidate, previous) <= MAX_MONOCULAR_JUMP) {
        return { gaze: candidate, quality: "ok", eyeWidthPx };
      }
    }
    return { gaze: null, quality: "eyes_disagree", eyeWidthPx };
  }

  const candidate = left.gaze ?? right.gaze;
  if (
    candidate &&
    isValidGazePoint(candidate) &&
    (!previous || distance(candidate, previous) <= MAX_MONOCULAR_JUMP)
  ) {
    return { gaze: candidate, quality: "ok", eyeWidthPx };
  }
  return { gaze: null, quality: invalidEyeQuality(left, right), eyeWidthPx };
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

export function calibrationPathPoint(
  path: CalibrationPath,
  progress: number,
): GazePoint {
  const points = calibrationPathPoints(path);
  const position = clamp(progress);
  if (points.length < 2) return { ...points[0] };

  const lengths = points.slice(1).map((point, index) =>
    Math.hypot(point.x - points[index].x, point.y - points[index].y),
  );
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = position * totalLength;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining <= length || index === lengths.length - 1) {
      const ratio = length === 0 ? 0 : clamp(remaining / length);
      const eased = ratio * ratio * (3 - 2 * ratio);
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * eased,
        y: points[index].y + (points[index + 1].y - points[index].y) * eased,
      };
    }
    remaining -= length;
  }
  return { ...points[points.length - 1] };
}

export interface GazeCalibrationTrainingOptions {
  onProgress?: (progress: number) => void;
  shouldCancel?: () => boolean;
}

type MlpSample = { input: [number, number]; target: [number, number] };

type MlpWeights = Pick<
  GazeCalibration,
  "hiddenWeights" | "hiddenBias" | "outputWeights" | "outputBias"
>;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createInitialMlp(): MlpWeights {
  const random = createSeededRandom(0x51a7e);
  return {
    hiddenWeights: Array.from({ length: CALIBRATION_HIDDEN_UNITS }, () => [
      (random() - 0.5) * 0.6,
      (random() - 0.5) * 0.6,
    ]),
    hiddenBias: new Array<number>(CALIBRATION_HIDDEN_UNITS).fill(0),
    outputWeights: Array.from({ length: 2 }, () =>
      Array.from({ length: CALIBRATION_HIDDEN_UNITS }, () =>
        (random() - 0.5) * 0.6,
      ),
    ),
    outputBias: { x: 0.5, y: 0.5 },
  };
}

function cloneMlp(weights: MlpWeights): MlpWeights {
  return {
    hiddenWeights: weights.hiddenWeights.map((row) => [...row]),
    hiddenBias: [...weights.hiddenBias],
    outputWeights: weights.outputWeights.map((row) => [...row]),
    outputBias: { ...weights.outputBias },
  };
}

function mlpPredict(input: [number, number], weights: MlpWeights): [number, number] {
  const hidden = weights.hiddenWeights.map((row, index) =>
    Math.tanh(
      weights.hiddenBias[index] + row[0] * input[0] + row[1] * input[1],
    ),
  );
  return [
    weights.outputBias.x +
      weights.outputWeights[0].reduce((sum, value, index) => sum + value * hidden[index], 0),
    weights.outputBias.y +
      weights.outputWeights[1].reduce((sum, value, index) => sum + value * hidden[index], 0),
  ];
}

function clippedGradient(value: number): number {
  return Math.max(-3, Math.min(3, value));
}

function trainMlpEpoch(weights: MlpWeights, samples: MlpSample[]): void {
  const hiddenWeights = weights.hiddenWeights.map((row) => row.map(() => 0));
  const hiddenBias = weights.hiddenBias.map(() => 0);
  const outputWeights = weights.outputWeights.map((row) => row.map(() => 0));
  const outputBias = { x: 0, y: 0 };

  for (const sample of samples) {
    const hidden = weights.hiddenWeights.map((row, index) =>
      Math.tanh(
        weights.hiddenBias[index] + row[0] * sample.input[0] + row[1] * sample.input[1],
      ),
    );
    const output = mlpPredict(sample.input, weights);
    const outputGradient = [output[0] - sample.target[0], output[1] - sample.target[1]];

    outputBias.x += outputGradient[0];
    outputBias.y += outputGradient[1];
    for (let outputIndex = 0; outputIndex < 2; outputIndex += 1) {
      for (let hiddenIndex = 0; hiddenIndex < CALIBRATION_HIDDEN_UNITS; hiddenIndex += 1) {
        outputWeights[outputIndex][hiddenIndex] +=
          outputGradient[outputIndex] * hidden[hiddenIndex];
      }
    }

    for (let hiddenIndex = 0; hiddenIndex < CALIBRATION_HIDDEN_UNITS; hiddenIndex += 1) {
      const hiddenGradient =
        (outputGradient[0] * weights.outputWeights[0][hiddenIndex] +
          outputGradient[1] * weights.outputWeights[1][hiddenIndex]) *
        (1 - hidden[hiddenIndex] ** 2);
      hiddenBias[hiddenIndex] += hiddenGradient;
      hiddenWeights[hiddenIndex][0] += hiddenGradient * sample.input[0];
      hiddenWeights[hiddenIndex][1] += hiddenGradient * sample.input[1];
    }
  }

  const scale = CALIBRATION_LEARNING_RATE / samples.length;
  for (let hiddenIndex = 0; hiddenIndex < CALIBRATION_HIDDEN_UNITS; hiddenIndex += 1) {
    for (let inputIndex = 0; inputIndex < 2; inputIndex += 1) {
      weights.hiddenWeights[hiddenIndex][inputIndex] -=
        scale * clippedGradient(hiddenWeights[hiddenIndex][inputIndex]);
    }
    weights.hiddenBias[hiddenIndex] -= scale * clippedGradient(hiddenBias[hiddenIndex]);
  }
  for (let outputIndex = 0; outputIndex < 2; outputIndex += 1) {
    for (let hiddenIndex = 0; hiddenIndex < CALIBRATION_HIDDEN_UNITS; hiddenIndex += 1) {
      weights.outputWeights[outputIndex][hiddenIndex] -=
        scale * clippedGradient(outputWeights[outputIndex][hiddenIndex]);
    }
  }
  weights.outputBias.x -= scale * clippedGradient(outputBias.x);
  weights.outputBias.y -= scale * clippedGradient(outputBias.y);
}

function mlpError(weights: MlpWeights, samples: MlpSample[]): number {
  if (!samples.length) return Number.POSITIVE_INFINITY;
  const total = samples.reduce((sum, sample) => {
    const output = mlpPredict(sample.input, weights);
    return sum + (output[0] - sample.target[0]) ** 2 + (output[1] - sample.target[1]) ** 2;
  }, 0);
  return total / samples.length;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function isCalibrationTarget(target: GazePoint): boolean {
  return (
    Number.isFinite(target.x) &&
    Number.isFinite(target.y) &&
    target.x >= 0 &&
    target.x <= 1 &&
    target.y >= 0 &&
    target.y <= 1
  );
}

export async function createGazeCalibration(
  samples: GazeCalibrationSample[],
  options: GazeCalibrationTrainingOptions = {},
): Promise<GazeCalibration | null> {
  const validSamples = samples.filter(
    (sample) => isValidGazePoint(sample.gaze) && isCalibrationTarget(sample.target),
  );
  if (validSamples.length < CALIBRATION_MIN_SAMPLES) return null;

  const gazeXValues = validSamples.map((sample) => sample.gaze.x);
  const gazeYValues = validSamples.map((sample) => sample.gaze.y);
  const xSpan = Math.max(...gazeXValues) - Math.min(...gazeXValues);
  const ySpan = Math.max(...gazeYValues) - Math.min(...gazeYValues);
  if (xSpan < MIN_CALIBRATION_GAZE_SPAN || ySpan < MIN_CALIBRATION_GAZE_SPAN) return null;

  const mean = {
    x: gazeXValues.reduce((sum, value) => sum + value, 0) / gazeXValues.length,
    y: gazeYValues.reduce((sum, value) => sum + value, 0) / gazeYValues.length,
  };
  const scale = {
    x: Math.max(0.05, Math.sqrt(gazeXValues.reduce((sum, value) => sum + (value - mean.x) ** 2, 0) / gazeXValues.length)),
    y: Math.max(0.05, Math.sqrt(gazeYValues.reduce((sum, value) => sum + (value - mean.y) ** 2, 0) / gazeYValues.length)),
  };
  const dataset = validSamples.map<MlpSample>((sample) => ({
    input: [(sample.gaze.x - mean.x) / scale.x, (sample.gaze.y - mean.y) / scale.y],
    target: [sample.target.x, sample.target.y],
  }));
  const training = dataset.filter((_, index) => index % 5 !== 0);
  const validation = dataset.filter((_, index) => index % 5 === 0);
  const weights = createInitialMlp();
  let best = cloneMlp(weights);
  let bestError = Number.POSITIVE_INFINITY;
  options.onProgress?.(0);

  for (let epoch = 0; epoch < CALIBRATION_EPOCHS; epoch += 1) {
    if (options.shouldCancel?.()) return null;
    trainMlpEpoch(weights, training);
    const error = mlpError(weights, validation);
    if (Number.isFinite(error) && error < bestError) {
      bestError = error;
      best = cloneMlp(weights);
    }
    if ((epoch + 1) % CALIBRATION_YIELD_EVERY === 0 || epoch === CALIBRATION_EPOCHS - 1) {
      options.onProgress?.(((epoch + 1) / CALIBRATION_EPOCHS) * 100);
      await yieldToBrowser();
    }
  }

  const observedEyeWidth = median(
    validSamples
      .map((sample) => sample.eyeWidthPx)
      .filter((width): width is number => typeof width === "number" && Number.isFinite(width) && width > 0),
  );
  const minimumEyeWidthPx =
    observedEyeWidth === null
      ? DEFAULT_MIN_EYE_WIDTH_PX
      : clamp(
          observedEyeWidth * 0.5,
          ABSOLUTE_MIN_EYE_WIDTH_PX,
          DEFAULT_MIN_EYE_WIDTH_PX,
        );
  return { kind: "mlp", mean, scale, ...best, minimumEyeWidthPx };
}

export function applyGazeCalibration(
  gaze: GazePoint,
  calibration: GazeCalibration,
): GazePoint {
  const input: [number, number] = [
    (gaze.x - calibration.mean.x) / calibration.scale.x,
    (gaze.y - calibration.mean.y) / calibration.scale.y,
  ];
  const [x, y] = mlpPredict(input, calibration);
  return { x: clamp(x), y: clamp(y) };
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

    const measured = this.stagePoint(gaze);

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

  stagePoint(gaze: GazePoint): GazePoint {
    if (this.calibration) return applyGazeCalibration(gaze, this.calibration);
    // Keep the uncalibrated view broad and normalized for the heatmap.
    return {
      x: clamp(0.5 - gaze.x * 1.5),
      y: clamp(0.5 + gaze.y * 1.5),
    };
  }

  setCalibration(calibration?: GazeCalibration): void {
    this.calibration = calibration;
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

export class EmaGazeFilter {
  private filtered: GazePoint | null = null;

  reset(): void {
    this.filtered = null;
  }

  filter(gaze: GazePoint): GazePoint {
    this.filtered = this.filtered
      ? {
          x: this.filtered.x + GAZE_EMA_ALPHA * (gaze.x - this.filtered.x),
          y: this.filtered.y + GAZE_EMA_ALPHA * (gaze.y - this.filtered.y),
        }
      : { ...gaze };
    return this.filtered;
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
  private lastVideoTime: number | null = null;
  private nextSampleAt = 0;
  private readonly gazeFilter = new EmaGazeFilter();
  private lastValidGazeAt = 0;
  private readonly eyeStates: [EyeState, EyeState] = [
    createEyeState(),
    createEyeState(),
  ];
  private lastRawGaze: GazePoint | null = null;
  private lastRawGazeAt = 0;
  private readonly video: HTMLVideoElement;
  private readonly landmarker: FaceLandmarker;
  private readonly onDebugFrame?: (frame: GazeDebugFrame) => void;
  private calibration?: GazeCalibration;
  private minimumEyeWidthPx: number;
  private faceRegion: FaceRegion | null = null;
  private readonly faceCanvas: HTMLCanvasElement | null;
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
    this.minimumEyeWidthPx =
      calibration?.minimumEyeWidthPx ?? DEFAULT_MIN_EYE_WIDTH_PX;
    this.faceCanvas =
      typeof document === "undefined" ? null : document.createElement("canvas");
    if (this.faceCanvas) {
      this.faceCanvas.width = FACE_CROP_SIZE;
      this.faceCanvas.height = FACE_CROP_SIZE;
    }
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
    this.eyeStates.forEach(resetEyeState);
    this.lastRawGaze = null;
    this.lastRawGazeAt = 0;
    this.faceRegion = null;
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

  setCalibration(calibration?: GazeCalibration): void {
    this.calibration = calibration;
    this.minimumEyeWidthPx =
      calibration?.minimumEyeWidthPx ?? DEFAULT_MIN_EYE_WIDTH_PX;
    this.accumulator.setCalibration(calibration);
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
        const landmarks = this.detectLandmarks(timestamp);
        if (!landmarks) {
          this.eyeStates.forEach(resetEyeState);
          this.lastRawGaze = null;
          this.faceRegion = null;
        } else {
          this.faceRegion = faceRegionFromLandmarks(landmarks);
        }
        const previousRawGaze =
          this.lastRawGaze && now - this.lastRawGazeAt <= MONOCULAR_CONTINUITY_MS
            ? this.lastRawGaze
            : null;
        const estimate = landmarks
          ? gazeFromLandmarks(
              landmarks,
              this.video.videoWidth,
              this.video.videoHeight,
              this.eyeStates,
              previousRawGaze,
              this.minimumEyeWidthPx,
            )
          : { gaze: null, quality: "face_missing" as const, eyeWidthPx: null };
        const rawGaze = estimate.gaze;
        if (rawGaze) {
          this.lastRawGaze = rawGaze;
          this.lastRawGazeAt = now;
        }
        const gaze = this.filterGaze(rawGaze, now);
        this.accumulator.add(gaze);
        this.onDebugFrame?.({
          faceDetected: Boolean(landmarks),
          quality: estimate.quality,
          eyeWidthPx: estimate.eyeWidthPx,
          rawGaze,
          gaze,
          stagePoint: gaze ? this.accumulator.stagePoint(gaze) : null,
          isFront: gaze ? this.accumulator.isFront(gaze) : null,
        });
      } catch {
        // A dropped/invalid video frame should not stop the interview loop.
        const videoTrack = (
          this.video.srcObject as MediaStream | null
        )?.getVideoTracks?.()[0];
        const quality: GazeQuality =
          this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
          videoTrack?.readyState === "ended"
            ? "frame_error"
            : "processing_error";
        this.eyeStates.forEach(resetEyeState);
        this.lastRawGaze = null;
        this.faceRegion = null;
        this.filterGaze(null, now);
        this.accumulator.add(null);
        this.onDebugFrame?.({
          faceDetected: false,
          quality,
          eyeWidthPx: null,
          rawGaze: null,
          gaze: null,
          stagePoint: null,
          isFront: null,
        });
      }
    }
    this.animationFrame = requestAnimationFrame(this.processFrame);
  };

  private detectLandmarks(timestamp: number): NormalizedLandmark[] | undefined {
    const region = this.faceRegion;
    const context = this.faceCanvas?.getContext("2d");
    if (!region || !this.faceCanvas || !context) {
      return this.landmarker.detectForVideo(this.video, timestamp).faceLandmarks[0];
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      this.video,
      region.left * this.video.videoWidth,
      region.top * this.video.videoHeight,
      (region.right - region.left) * this.video.videoWidth,
      (region.bottom - region.top) * this.video.videoHeight,
      0,
      0,
      FACE_CROP_SIZE,
      FACE_CROP_SIZE,
    );
    const landmarks = this.landmarker.detectForVideo(
      this.faceCanvas,
      timestamp,
    ).faceLandmarks[0];
    return landmarks ? landmarksFromFaceCrop(landmarks, region) : undefined;
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
    return this.gazeFilter.filter(gaze);
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

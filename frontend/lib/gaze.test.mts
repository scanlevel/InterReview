import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGazeCalibration,
  CALIBRATION_CONTINUOUS_TARGET_DELAY_MS,
  CALIBRATION_TARGET_DELAY_MS,
  CALIBRATION_GRID_POINTS,
  CALIBRATION_GRID_ORDER,
  CALIBRATION_POINT_SETTLE_MS,
  CALIBRATION_POINT_COLLECT_MS,
  filterCalibrationSamples,
  medianGaze,
  splitCalibrationSamples,
  calibrationPathPoint,
  calibrationPathPoints,
  calibrationTargetAt,
  createGazeCalibration,
  faceRegionFromLandmarks,
  GazeAccumulator,
  isEyeWidthUsable,
  isNewVideoFrame,
  isValidGazePoint,
  landmarksFromFaceCrop,
  EmaGazeFilter,
} from "./gaze.ts";

function syntheticGaze(targetX: number, targetY: number) {
  const deltaX = targetX - 0.5;
  const deltaY = targetY - 0.5;
  return {
    x: 0.1 - 0.7 * deltaX + 0.15 * deltaY + 0.08 * deltaX * deltaY,
    y: -0.35 + 0.85 * deltaY - 0.12 * deltaX + 0.05 * deltaY * deltaY,
  };
}

test("keeps the gaze result as a heatmap", () => {
  const accumulator = new GazeAccumulator();
  accumulator.add(null);
  accumulator.add({ x: 0, y: 0 });
  accumulator.add({ x: 0.3, y: 0 });

  const summary = accumulator.snapshot();
  assert.ok(summary);
  assert.equal("face_detected_ratio" in summary, false);
  assert.equal(summary?.gaze_heatmap?.total, 2);
  assert.equal(summary?.gaze_heatmap?.counts.reduce((sum, count) => sum + count, 0), 2);
});

test("rejects invalid gaze points", () => {
  const accumulator = new GazeAccumulator();
  accumulator.add({ x: Number.NaN, y: 0 });
  accumulator.add({ x: 2, y: 0 });
  assert.equal(accumulator.snapshot(), null);
  assert.equal(isValidGazePoint({ x: 0, y: 0 }), true);
  assert.equal(isValidGazePoint({ x: Number.POSITIVE_INFINITY, y: 0 }), false);
});

test("defines smooth plus and X calibration paths across the full interviewer stage", () => {
  for (const path of ["plus", "x"] as const) {
    const points = calibrationPathPoints(path);
    assert.deepEqual(points[0], { x: 0.5, y: 0.5 });
    assert.deepEqual(points.at(-1), { x: 0.5, y: 0.5 });
    assert.ok(points.some((point) => point.x === 0));
    assert.ok(points.some((point) => point.x === 1));
    assert.ok(points.some((point) => point.y === 0));
    assert.ok(points.some((point) => point.y === 1));
    for (const progress of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
      const point = calibrationPathPoint(path, progress);
      assert.ok(point.x >= 0 && point.x <= 1);
      assert.ok(point.y >= 0 && point.y <= 1);
    }
  }
});

test("uses the 150ms delayed continuous calibration target", () => {
  assert.equal(CALIBRATION_CONTINUOUS_TARGET_DELAY_MS, 150);
  assert.equal(CALIBRATION_TARGET_DELAY_MS, 150);
  const history = [
    { at: 100, target: { x: 0.1, y: 0.1 } },
    { at: 200, target: { x: 0.9, y: 0.9 } },
  ];
  assert.equal(calibrationTargetAt(history, 99), null);
  assert.deepEqual(calibrationTargetAt(history, 199), { x: 0.1, y: 0.1 });
  assert.deepEqual(calibrationTargetAt(history, 200), { x: 0.9, y: 0.9 });
});

test("defines the deterministic 9-point dwell order and timing", () => {
  assert.deepEqual(CALIBRATION_GRID_ORDER, [4, 0, 8, 2, 6, 3, 5, 1, 7]);
  assert.equal(CALIBRATION_GRID_POINTS.length, 9);
  assert.equal(CALIBRATION_POINT_SETTLE_MS, 300);
  assert.equal(CALIBRATION_POINT_COLLECT_MS, 500);
});

test("uses grid medians and rejects grid outliers", () => {
  const samples = [
    { source: "grid" as const, pointId: 0, target: { x: 0.1, y: 0.1 }, gaze: { x: 0.20, y: 0.30 } },
    { source: "grid" as const, pointId: 0, target: { x: 0.1, y: 0.1 }, gaze: { x: 0.201, y: 0.299 } },
    { source: "grid" as const, pointId: 0, target: { x: 0.1, y: 0.1 }, gaze: { x: 0.199, y: 0.301 } },
    { source: "grid" as const, pointId: 0, target: { x: 0.1, y: 0.1 }, gaze: { x: 0.200, y: 0.302 } },
    { source: "grid" as const, pointId: 0, target: { x: 0.1, y: 0.1 }, gaze: { x: 0.202, y: 0.298 } },
    { source: "grid" as const, pointId: 0, target: { x: 0.1, y: 0.1 }, gaze: { x: 0.8, y: 0.8 } },
  ];
  assert.deepEqual(medianGaze(samples.slice(0, 5).map((sample) => sample.gaze)), { x: 0.2, y: 0.3 });
  const clean = filterCalibrationSamples(samples);
  assert.equal(clean.length, 5);
  assert.equal(clean.some((sample) => sample.gaze.x === 0.8), false);
});

test("splits calibration samples by source blocks", () => {
  const plus = Array.from({ length: 5 }, (_, index) => ({
    source: "plus" as const, gaze: { x: index / 10, y: index / 10 }, target: { x: 0.5, y: 0.5 },
  }));
  const grid = Array.from({ length: 5 }, (_, index) => ({
    source: "grid" as const, pointId: 0, gaze: { x: 0.2 + index / 100, y: 0.3 }, target: { x: 0.1, y: 0.1 },
  }));
  const split = splitCalibrationSamples([...plus, ...grid]);
  assert.equal(split.training.length, 8);
  assert.equal(split.validation.length, 2);
  assert.deepEqual(split.validation.map((sample) => sample.source), ["plus", "grid"]);
  assert.equal(split.training.some((sample) => split.validation.includes(sample)), false);
});
test("trains a small MLP on nonlinear MediaPipe gaze samples", async () => {
  const samples = Array.from({ length: 200 }, (_, index) => {
    const targetX = 0.1 + 0.8 * ((index % 20) / 19);
    const targetY = 0.1 + 0.8 * (Math.floor(index / 20) / 9);
    return {
      target: { x: targetX, y: targetY },
      gaze: syntheticGaze(targetX, targetY),
      eyeWidthPx: 6,
    };
  });
  const progress: number[] = [];
  const calibration = await createGazeCalibration(samples, {
    onProgress: (value) => progress.push(value),
    stageSize: { width: 1000, height: 600 },
  });

  assert.ok(calibration);
  assert.equal(calibration.kind, "mlp");
  assert.equal(calibration.hiddenWeights.length, 32);
  assert.equal(calibration.hiddenWeights[0]?.length, 2);
  assert.equal(calibration.outputWeights.length, 2);
  assert.equal(calibration.outputWeights[0]?.length, 32);
  assert.equal(calibration.minimumEyeWidthPx, 3);
  assert.ok(calibration.meanErrorPx !== null && Number.isFinite(calibration.meanErrorPx));
  assert.equal(calibration.meanErrorPx, calibration.validationErrorPx);
  assert.ok(calibration.trainingErrorPx !== null && Number.isFinite(calibration.trainingErrorPx));
  assert.ok(calibration.validationMedianErrorPx !== null && Number.isFinite(calibration.validationMedianErrorPx));
  assert.equal(calibration.totalSamples, 200);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));

  for (const target of [
    { x: 0.15, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.85, y: 0.75 },
  ]) {
    const gaze = syntheticGaze(target.x, target.y);
    const mapped = applyGazeCalibration(gaze, calibration);
    assert.ok(Math.abs(mapped.x - target.x) < 0.12);
    assert.ok(Math.abs(mapped.y - target.y) < 0.12);
  }
});

test("rejects a calibration with too few valid samples", async () => {
  const samples = Array.from({ length: 119 }, (_, index) => ({
    target: { x: index / 118, y: index / 118 },
    gaze: { x: index / 118, y: index / 118 },
  }));
  assert.equal(await createGazeCalibration(samples), null);
});

test("keeps eye tracking active through the hysteresis release width", () => {
  assert.equal(isEyeWidthUsable(3.9, false), false);
  assert.equal(isEyeWidthUsable(4, false), true);
  assert.equal(isEyeWidthUsable(3, true), true);
  assert.equal(isEyeWidthUsable(2.99, true), false);
  assert.equal(isEyeWidthUsable(3, false, 3), true);
});

test("expands a detected face region for the next interpolated frame", () => {
  const region = faceRegionFromLandmarks([
    { x: 0.2, y: 0.3, z: 0, visibility: 1 },
    { x: 0.6, y: 0.7, z: 0, visibility: 1 },
  ]);
  assert.ok(region);
  assert.ok(Math.abs(region.left - 0.1) < 1e-9);
  assert.ok(Math.abs(region.top - 0.2) < 1e-9);
  assert.ok(Math.abs(region.right - 0.7) < 1e-9);
  assert.ok(Math.abs(region.bottom - 0.8) < 1e-9);

  const restored = landmarksFromFaceCrop(
    [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }],
    region,
  );
  assert.ok(Math.abs(restored[0].x - 0.4) < 1e-9);
  assert.ok(Math.abs(restored[0].y - 0.5) < 1e-9);
});

test("EMA filter smooths jumps and resets cleanly", () => {
  const filter = new EmaGazeFilter();
  assert.deepEqual(filter.filter({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(filter.filter({ x: 1, y: 1 }), { x: 0.15, y: 0.15 });
  filter.reset();
  assert.deepEqual(filter.filter({ x: 1, y: 1 }), { x: 1, y: 1 });
});

test("does not count the same positive video timestamp twice", () => {
  assert.equal(isNewVideoFrame(0.1, null), true);
  assert.equal(isNewVideoFrame(0.1, 0.1), false);
  assert.equal(isNewVideoFrame(0.1002, 0.1), true);
  assert.equal(isNewVideoFrame(0, 0), true);
});

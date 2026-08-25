import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGazeCalibration,
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

test("defines smooth plus and X calibration paths inside the screen margin", () => {
  for (const path of ["plus", "x"] as const) {
    const points = calibrationPathPoints(path);
    assert.deepEqual(points[0], { x: 0.5, y: 0.5 });
    assert.deepEqual(points.at(-1), { x: 0.5, y: 0.5 });
    for (const progress of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
      const point = calibrationPathPoint(path, progress);
      assert.ok(point.x >= 0.1 && point.x <= 0.9);
      assert.ok(point.y >= 0.1 && point.y <= 0.9);
    }
  }
});

test("matches gaze frames to a delayed calibration target", () => {
  const history = [
    { at: 100, target: { x: 0.1, y: 0.1 } },
    { at: 200, target: { x: 0.9, y: 0.9 } },
  ];
  assert.equal(calibrationTargetAt(history, 99), null);
  assert.deepEqual(calibrationTargetAt(history, 199), { x: 0.1, y: 0.1 });
  assert.deepEqual(calibrationTargetAt(history, 200), { x: 0.9, y: 0.9 });
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
  });

  assert.ok(calibration);
  assert.equal(calibration.kind, "mlp");
  assert.equal(calibration.minimumEyeWidthPx, 3);
  assert.equal(progress[0], 0);
  assert.equal(progress.at(-1), 100);
  assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));

  for (const target of [
    { x: 0.15, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.85, y: 0.75 },
  ]) {
    const mapped = applyGazeCalibration(syntheticGaze(target.x, target.y), calibration);
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

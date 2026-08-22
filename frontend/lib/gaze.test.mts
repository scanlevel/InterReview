import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGazeCalibration,
  createGazeCalibration,
  GazeAccumulator,
  isValidGazePoint,
  smoothGazePoint,
} from "./gaze.ts";

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

test("rejects invalid gaze points and smooths valid samples", () => {
  const accumulator = new GazeAccumulator();
  accumulator.add({ x: Number.NaN, y: 0 });
  accumulator.add({ x: 2, y: 0 });
  assert.equal(accumulator.snapshot(), null);
  assert.equal(isValidGazePoint({ x: 0, y: 0 }), true);
  assert.equal(isValidGazePoint({ x: Number.POSITIVE_INFINITY, y: 0 }), false);
  assert.deepEqual(smoothGazePoint(null, { x: 1, y: 1 }), { x: 1, y: 1 });
  assert.deepEqual(smoothGazePoint({ x: 0, y: 0 }, { x: 1, y: 1 }, 0.5), { x: 0.5, y: 0.5 });
  assert.equal(smoothGazePoint({ x: 0, y: 0 }, { x: Number.NaN, y: 1 }), null);
});

test("builds calibration from repeated, noisy target samples", () => {
  const targetSamples = [
    { target: { x: 0.1, y: 0.1 }, gaze: { x: 0.4, y: -0.3 } },
    { target: { x: 0.5, y: 0.1 }, gaze: { x: 0.1, y: -0.3 } },
    { target: { x: 0.9, y: 0.1 }, gaze: { x: -0.2, y: -0.3 } },
    { target: { x: 0.1, y: 0.5 }, gaze: { x: 0.4, y: 0 } },
    { target: { x: 0.5, y: 0.5 }, gaze: { x: 0.1, y: 0 } },
    { target: { x: 0.9, y: 0.5 }, gaze: { x: -0.2, y: 0 } },
    { target: { x: 0.1, y: 0.9 }, gaze: { x: 0.4, y: 0.3 } },
    { target: { x: 0.5, y: 0.9 }, gaze: { x: 0.1, y: 0.3 } },
    { target: { x: 0.9, y: 0.9 }, gaze: { x: -0.2, y: 0.3 } },
  ];
  const samples = Array.from({ length: 4 }, (_, repeat) =>
    targetSamples.map((sample, index) => ({
      target: sample.target,
      gaze: {
        x: sample.gaze.x + ((repeat + index) % 3 - 1) * 0.005,
        y: sample.gaze.y + ((repeat + index + 1) % 3 - 1) * 0.005,
      },
    })),
  ).flat();

  const calibration = createGazeCalibration(samples);
  assert.ok(calibration);
  assert.deepEqual(applyGazeCalibration({ x: 0.1, y: 0 }, calibration), {
    x: 0.5,
    y: 0.5,
  });
  assert.deepEqual(applyGazeCalibration({ x: 0.4, y: -0.3 }, calibration), {
    x: 0,
    y: 0,
  });

  const accumulator = new GazeAccumulator(calibration);
  assert.equal(accumulator.isFront({ x: 0.1, y: 0 }), true);
  assert.equal(accumulator.isFront({ x: 0.4, y: -0.3 }), false);
});

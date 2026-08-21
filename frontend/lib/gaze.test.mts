import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGazeCalibration,
  createGazeCalibration,
  GazeAccumulator,
} from "./gaze.ts";

test("summarizes face detection and front gaze per answer", () => {
  const accumulator = new GazeAccumulator();
  accumulator.add(false, null);
  accumulator.add(true, { x: 0, y: 0 });
  accumulator.add(true, { x: 0.3, y: 0 });

  const summary = accumulator.snapshot();
  assert.equal(summary?.face_detected_ratio, 0.667);
  assert.equal(summary?.front_gaze_ratio, 0.5);
  assert.equal(summary?.valid_gaze_ratio, 0.667);
  assert.equal(summary?.std_gaze, 0.225);
  assert.equal(summary?.mean_gaze_x, -0.225);
  assert.equal(summary?.gaze_std_x, 0.225);
  assert.equal(summary?.gaze_heatmap?.total, 2);
  assert.equal(summary?.gaze_heatmap?.counts.reduce((sum, count) => sum + count, 0), 2);
});

test("maps five measured gaze points to screen coordinates", () => {
  const calibration = createGazeCalibration({
    center: { x: 0.1, y: -0.05 },
    topLeft: { x: -0.2, y: -0.25 },
    topRight: { x: 0.4, y: -0.25 },
    bottomRight: { x: 0.4, y: 0.15 },
    bottomLeft: { x: -0.2, y: 0.15 },
  });
  assert.ok(calibration);
  assert.deepEqual(applyGazeCalibration({ x: 0.1, y: -0.05 }, calibration), {
    x: 0.5,
    y: 0.5,
  });
  assert.deepEqual(applyGazeCalibration({ x: -0.2, y: -0.25 }, calibration), {
    x: 0,
    y: 0,
  });

  const accumulator = new GazeAccumulator(calibration);
  assert.equal(accumulator.isFront({ x: 0.1, y: -0.05 }), true);
  assert.equal(accumulator.isFront({ x: -0.2, y: -0.25 }), false);
});

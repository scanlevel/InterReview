import assert from "node:assert/strict";
import test from "node:test";
import {
  applyGazeCalibration,
  createGazeCalibration,
  GazeAccumulator,
  isNewVideoFrame,
  isValidGazePoint,
  OneEuroGazeFilter,
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

test("rejects invalid gaze points", () => {
  const accumulator = new GazeAccumulator();
  accumulator.add({ x: Number.NaN, y: 0 });
  accumulator.add({ x: 2, y: 0 });
  assert.equal(accumulator.snapshot(), null);
  assert.equal(isValidGazePoint({ x: 0, y: 0 }), true);
  assert.equal(isValidGazePoint({ x: Number.POSITIVE_INFINITY, y: 0 }), false);
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
  const samples = Array.from({ length: 8 }, (_, repeat) =>
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
  const center = applyGazeCalibration({ x: 0.1, y: 0 }, calibration);
  assert.ok(Math.abs(center.x - 0.5) < 0.03);
  assert.ok(Math.abs(center.y - 0.5) < 0.03);
  const topLeft = applyGazeCalibration({ x: 0.4, y: -0.3 }, calibration);
  assert.ok(Math.abs(topLeft.x - 0.1) < 0.03);
  assert.ok(Math.abs(topLeft.y - 0.1) < 0.03);

  const accumulator = new GazeAccumulator(calibration);
  assert.equal(accumulator.isFront({ x: 0.1, y: 0 }), true);
  assert.equal(accumulator.isFront({ x: 0.4, y: -0.3 }), false);
});

test("fits cross-axis gaze distortion with a 2D calibration", () => {
  const levels = [0.1, 0.5, 0.9];
  const samples = levels.flatMap((y) =>
    levels.flatMap((x) =>
      Array.from({ length: 8 }, () => {
        const deltaX = x - 0.5;
        const deltaY = y - 0.5;
        return {
          target: { x, y },
          gaze: {
            x: 0.1 - 0.75 * deltaX + 0.18 * deltaY,
            y: -0.4 + deltaY - 0.15 * deltaX,
          },
        };
      }),
    ),
  );
  const calibration = createGazeCalibration(samples);
  assert.ok(calibration);

  const deltaX = 0.7 - 0.5;
  const deltaY = 0.2 - 0.5;
  const mapped = applyGazeCalibration(
    {
      x: 0.1 - 0.75 * deltaX + 0.18 * deltaY,
      y: -0.4 + deltaY - 0.15 * deltaX,
    },
    calibration,
  );
  assert.ok(Math.abs(mapped.x - 0.7) < 0.03);
  assert.ok(Math.abs(mapped.y - 0.2) < 0.03);
});

test("requires every calibration target and a measurable axis span", () => {
  const levels = [0.1, 0.5, 0.9];
  const complete = levels.flatMap((y) =>
    levels.flatMap((x) =>
      Array.from({ length: 8 }, () => ({
        target: { x, y },
        gaze: { x: 0.475 - x * 0.75, y: y - 0.4 },
      })),
    ),
  );
  assert.ok(createGazeCalibration(complete));
  assert.equal(
    createGazeCalibration(
      complete.filter((sample) => sample.target.x !== 0.9 || sample.target.y !== 0.9),
    ),
    null,
  );
  assert.equal(
    createGazeCalibration(
      complete.map((sample) => ({
        ...sample,
        gaze: { x: sample.target.x * 0.01, y: sample.target.y * 0.01 },
      })),
    ),
    null,
  );
});

test("One Euro filter reduces jumps and resets cleanly", () => {
  const filter = new OneEuroGazeFilter();
  assert.deepEqual(filter.filter({ x: 0, y: 0 }, 0), { x: 0, y: 0 });
  const filtered = filter.filter({ x: 1, y: 1 }, 50);
  assert.ok(filtered.x > 0 && filtered.x < 1);
  assert.ok(filtered.y > 0 && filtered.y < 1);
  filter.reset();
  assert.deepEqual(filter.filter({ x: 1, y: 1 }, 100), { x: 1, y: 1 });
});

test("does not count the same positive video timestamp twice", () => {
  assert.equal(isNewVideoFrame(0.1, null), true);
  assert.equal(isNewVideoFrame(0.1, 0.1), false);
  assert.equal(isNewVideoFrame(0.1002, 0.1), true);
  assert.equal(isNewVideoFrame(0, 0), true);
});

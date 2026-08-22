import assert from "node:assert/strict";
import test from "node:test";
import { calculateSpeechMetrics } from "./recorder.ts";

test("calculates speech time, pauses, and transcript rate", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(sampleRate * 6);
  const mark = (start: number, end: number) => {
    for (let index = start * sampleRate; index < end * sampleRate; index += 1) {
      samples[index] = 0.1;
    }
  };
  mark(1, 2.2);
  mark(4.4, 5.2);

  const metrics = calculateSpeechMetrics(samples, sampleRate, "하나 둘 셋 넷");
  assert.equal(metrics.total_duration_sec, 6);
  assert.equal(metrics.speech_duration_sec, 2);
  assert.equal(metrics.silence_duration_sec, 4);
  assert.equal(metrics.long_pause_count, 1);
  assert.equal(metrics.max_pause_sec, 2.2);
  assert.equal(metrics.speech_rate_eojeol_per_min, 120);
  assert.ok(metrics.audio_timeline);
  assert.equal(metrics.audio_timeline.energy.length, 120);
  assert.equal(metrics.audio_timeline.speech.length, 120);
  assert.equal(metrics.audio_timeline.long_pause.length, 120);
  assert.ok(metrics.audio_timeline.speech.some(Boolean));
  assert.ok(metrics.audio_timeline.long_pause.some(Boolean));
  assert.ok(metrics.audio_timeline.energy.every((value) => value >= 0 && value <= 1));
});

test("returns empty measurements for empty audio", () => {
  const metrics = calculateSpeechMetrics(new Float32Array(), 16000);
  assert.equal(metrics.total_duration_sec, 0);
  assert.equal(metrics.speech_rate_eojeol_per_min, null);
  assert.equal(metrics.audio_timeline, null);
});

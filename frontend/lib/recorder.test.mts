import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSpeechMetrics,
  canTranscribeRecording,
  classifySpeechFrames,
  createSpeechEndGate,
  SILERO_MIN_SPEECH_MS,
  SILERO_NEGATIVE_SPEECH_THRESHOLD,
  SILERO_POSITIVE_SPEECH_THRESHOLD,
  SILERO_SILENCE_REDEMPTION_MS,
} from "./recorder.ts";

test("uses the approved initial Silero VAD policy", () => {
  assert.equal(SILERO_POSITIVE_SPEECH_THRESHOLD, 0.6);
  assert.equal(SILERO_NEGATIVE_SPEECH_THRESHOLD, 0.35);
  assert.equal(SILERO_MIN_SPEECH_MS, 250);
  assert.equal(SILERO_SILENCE_REDEMPTION_MS, 4000);
});

test("auto-end waits for valid speech and notifies only once", () => {
  let notifications = 0;
  const gate = createSpeechEndGate(() => {
    notifications += 1;
  });
  gate.markSilence();
  assert.equal(notifications, 0);
  gate.markValidSpeech();
  gate.markSilence();
  gate.markSilence();
  assert.equal(notifications, 1);
});

test("transcribes only a recording that was explicitly started", () => {
  assert.equal(canTranscribeRecording(null, false, false), false);
  assert.equal(canTranscribeRecording(null, true, false), false);
  assert.equal(canTranscribeRecording("q1", false, false), false);
  assert.equal(canTranscribeRecording("q1", true, true), false);
  assert.equal(canTranscribeRecording("q1", true, false), true);
});

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

test("partitions VAD frames by aligned words without treating unmatched speech as filler", () => {
  const result = classifySpeechFrames(
    {
      frameRms: [0.1, 0, 0, 0.1],
      speechFrames: [true, false, false, true],
      longPauseFrames: [false, false, false, false],
      frameDurations: [0.25, 0.25, 0.25, 0.25],
      totalDurationSec: 1,
    },
    [
      { start_ms: 0, end_ms: 150, text: "하나" },
      { start_ms: 600, end_ms: 650, text: "둘" },
    ],
  );

  assert.ok(result);
  assert.deepEqual(result.frameKinds, [
    "transcribed_speech",
    "vad_silence",
    "pending",
    "untranscribed_speech",
  ]);
  assert.equal(result.summary.total_analysis_duration_sec, 1);
  assert.equal(
    result.summary.transcribed_speech_duration_sec +
      result.summary.untranscribed_speech_duration_sec +
      result.summary.vad_silence_duration_sec +
      result.summary.pending_duration_sec,
    result.summary.total_analysis_duration_sec,
  );
  assert.equal(result.summary.untranscribed_speech_segment_count, 1);
  assert.equal(result.summary.pending_segment_count, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  transitionInterviewStep,
  waitForAnswerAndGuide,
} from "./interviewFlow.ts";

test("follows the manual interview state machine", () => {
  let step = transitionInterviewStep("question_ready", "start_recording", false);
  assert.equal(step, "recording");
  step = transitionInterviewStep(step, "stop_recording", false);
  assert.equal(step, "processing");
  step = transitionInterviewStep(step, "processing_succeeded", false);
  assert.equal(step, "waiting_next");
  step = transitionInterviewStep(step, "next_question", false);
  assert.equal(step, "question_ready");
});

test("STT failure still reaches the next-question wait state", () => {
  assert.equal(
    transitionInterviewStep("processing", "processing_failed", false),
    "waiting_next",
  );
});

test("manual retry records the same question again from the ready state", () => {
  assert.equal(
    transitionInterviewStep("waiting_next", "retry_answer", false),
    "question_ready",
  );
});

test("invalid duplicate events do not move the state", () => {
  assert.equal(
    transitionInterviewStep("recording", "next_question", false),
    "recording",
  );
  assert.equal(
    transitionInterviewStep("processing", "stop_recording", false),
    "processing",
  );
});

test("the last question completes instead of opening another question", () => {
  assert.equal(
    transitionInterviewStep("waiting_next", "next_question", true),
    "complete",
  );
});

test("automatic flow reaches processing after a valid long silence", () => {
  let step = transitionInterviewStep("question_ready", "start_automatic", false);
  assert.equal(step, "reading_question");
  step = transitionInterviewStep(step, "question_audio_ready", false);
  step = transitionInterviewStep(step, "start_recording", false);
  assert.equal(step, "recording");
  step = transitionInterviewStep(step, "long_silence", false);
  assert.equal(step, "processing");
});

test("automatic flow cannot start recording before the start guide finishes", () => {
  assert.equal(
    transitionInterviewStep("reading_question", "start_recording", false),
    "reading_question",
  );
  assert.equal(
    transitionInterviewStep("playing_start", "start_recording", false),
    "recording",
  );
});

test("answer processing waits for the guide in either completion order", async () => {
  let answerResolve: (value: string) => void = () => undefined;
  let guideResolve: () => void = () => undefined;
  const answer = new Promise<string>((resolve) => {
    answerResolve = resolve;
  });
  const guide = new Promise<void>((resolve) => {
    guideResolve = resolve;
  });
  let completed = false;
  const pending = waitForAnswerAndGuide(answer, guide).then((value) => {
    completed = true;
    return value;
  });
  answerResolve("processed");
  await Promise.resolve();
  assert.equal(completed, false);
  guideResolve();
  assert.equal(await pending, "processed");

  let answerAgain: (value: string) => void = () => undefined;
  const guideFirst = waitForAnswerAndGuide(
    new Promise<string>((resolve) => {
      answerAgain = resolve;
    }),
    Promise.resolve(),
  );
  answerAgain("processed after guide");
  assert.equal(await guideFirst, "processed after guide");

  assert.equal(
    await waitForAnswerAndGuide(
      Promise.resolve("processed again"),
      Promise.reject(new Error("guide failed")),
    ),
    "processed again",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { transitionInterviewStep } from "./interviewFlow.ts";

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

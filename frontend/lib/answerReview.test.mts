import assert from "node:assert/strict";
import test from "node:test";
import { getAnswerRevision, isAnswerReviewable } from "./answerReview.ts";
import type { AnswerItem } from "./types";

const answer: AnswerItem = {
  question_id: "q1",
  question: "질문?",
  transcript: "답변",
  stt_status: "ok",
};

test("only successful non-empty STT answers are reviewable", () => {
  assert.equal(isAnswerReviewable(answer), true);
  assert.equal(
    isAnswerReviewable({ ...answer, transcript: "", stt_status: "ok" }),
    false,
  );
  assert.equal(
    isAnswerReviewable({ ...answer, stt_status: "error" }),
    false,
  );
});

test("the review revision distinguishes STT status", () => {
  assert.notEqual(
    getAnswerRevision(answer),
    getAnswerRevision({ ...answer, stt_status: "error" }),
  );
});

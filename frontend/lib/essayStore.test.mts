import assert from "node:assert/strict";
import test from "node:test";

import { answerText, currentItems } from "./essayStore.ts";

test("answerText excludes company questions from interview evidence", () => {
  assert.equal(
    answerText([
      { question: "지원 동기는 무엇인가요?", answer: "API 서버를 개선했습니다." },
      { question: "협업 경험은?", answer: "리뷰 규칙을 합의했습니다." },
    ]),
    "API 서버를 개선했습니다.\n\n리뷰 규칙을 합의했습니다.",
  );
});

test("currentItems keeps free-form essays in the same structured contract", () => {
  assert.deepEqual(
    currentItems({ mode: "free", free: " 지원자 답변 ", items: [] }),
    [{ question: "", answer: "지원자 답변" }],
  );
});

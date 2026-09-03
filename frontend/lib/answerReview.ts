import type { AnswerItem } from "./types";

/** Only a successful, non-empty STT result is eligible for content review. */
export function isAnswerReviewable(answer: AnswerItem): boolean {
  return answer.stt_status === "ok" && Boolean(answer.transcript.trim());
}

/** Revision key for the existing per-question review promise registry. */
export function getAnswerRevision(answer: AnswerItem): string {
  return JSON.stringify([
    answer.question,
    answer.original_question,
    answer.transcript,
    answer.stt_status,
    answer.stt_error,
  ]);
}

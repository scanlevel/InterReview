export type InterviewStep =
  | "question_ready"
  | "reading_question"
  | "playing_start"
  | "recording"
  | "processing"
  | "waiting_next"
  | "complete";

export type InterviewEvent =
  | "start_automatic"
  | "question_audio_ready"
  | "start_recording"
  | "stop_recording"
  | "long_silence"
  | "processing_succeeded"
  | "processing_failed"
  | "skip_answer"
  | "retry_answer"
  | "next_question"
  | "finish"
  | "automatic_cancel";

/** Wait for answer processing and its end guide; guide failure never loses the answer. */
export async function waitForAnswerAndGuide<T>(
  answer: Promise<T>,
  guide: Promise<void>,
): Promise<T> {
  const [answerResult] = await Promise.allSettled([answer, guide]);
  if (answerResult.status === "rejected") throw answerResult.reason;
  return answerResult.value;
}

/** Return the next legal interview step; invalid events are no-ops. */
export function transitionInterviewStep(
  step: InterviewStep,
  event: InterviewEvent,
  isLastQuestion: boolean,
): InterviewStep {
  if (step === "question_ready") {
    if (event === "start_automatic") return "reading_question";
    if (event === "start_recording") return "recording";
    if (event === "skip_answer") return "waiting_next";
    return step;
  }
  if (step === "reading_question") {
    if (event === "question_audio_ready") return "playing_start";
    if (event === "automatic_cancel") return "question_ready";
    return step;
  }
  if (step === "playing_start") {
    if (event === "start_recording") return "recording";
    if (event === "automatic_cancel") return "question_ready";
    return step;
  }
  if (step === "recording") {
    if (event === "stop_recording" || event === "long_silence") return "processing";
    return step;
  }
  if (step === "processing") {
    return event === "processing_succeeded" || event === "processing_failed"
      ? "waiting_next"
      : step;
  }
  if (step === "waiting_next") {
    if (event === "retry_answer") return "question_ready";
    if (event === "next_question") {
      return isLastQuestion ? "complete" : "question_ready";
    }
    if (event === "finish") return "complete";
  }
  return step;
}

export type InterviewStep =
  | "question_ready"
  | "recording"
  | "processing"
  | "waiting_next"
  | "complete";

export type InterviewEvent =
  | "start_recording"
  | "stop_recording"
  | "processing_succeeded"
  | "processing_failed"
  | "skip_answer"
  | "next_question"
  | "finish";

/** Return the next legal interview step; invalid events are no-ops. */
export function transitionInterviewStep(
  step: InterviewStep,
  event: InterviewEvent,
  isLastQuestion: boolean,
): InterviewStep {
  if (step === "question_ready") {
    if (event === "start_recording") return "recording";
    if (event === "skip_answer") return "waiting_next";
    return step;
  }
  if (step === "recording") {
    return event === "stop_recording" ? "processing" : step;
  }
  if (step === "processing") {
    return event === "processing_succeeded" || event === "processing_failed"
      ? "waiting_next"
      : step;
  }
  if (step === "waiting_next") {
    if (event === "next_question") {
      return isLastQuestion ? "complete" : "question_ready";
    }
    if (event === "finish") return "complete";
  }
  return step;
}

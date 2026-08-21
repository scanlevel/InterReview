// Thin client for the InterReview FastAPI backend.
// The base URL is injected at build time via NEXT_PUBLIC_API_BASE.

import type {
  AnswerItem,
  ContentFeedback,
  GenerateQuestionsResponse,
  MeasurementReport,
  Profile,
  TranscriptResponse,
} from "@/lib/types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export interface HealthResponse {
  status: string;
  service: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} 실패: HTTP ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export function generateQuestions(
  profile: Profile,
  seed?: number,
): Promise<GenerateQuestionsResponse> {
  return postJson<GenerateQuestionsResponse>("/questions", { profile, seed });
}

export function getMeasurementReport(
  answers: AnswerItem[],
): Promise<MeasurementReport> {
  return postJson<MeasurementReport>("/measurements", { answers });
}

/** Call the Track A per-question review contract; A owns the implementation. */
export function reviewAnswer(
  answer: AnswerItem,
  profile: Profile,
): Promise<ContentFeedback> {
  return postJson<ContentFeedback>("/answers/review", {
    question: answer.question,
    transcript: answer.transcript,
    essay: profile.resume_text ?? null,
    profile,
  });
}

/** Upload one recorded answer blob and get its transcript (used from Milestone B). */
export async function transcribe(
  blob: Blob,
  filename = "answer.webm",
): Promise<TranscriptResponse> {
  const form = new FormData();
  form.append("file", blob, filename);
  const res = await fetch(`${API_BASE}/stt`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`/stt 실패: HTTP ${res.status}`);
  return (await res.json()) as TranscriptResponse;
}

// Thin client for the InterReview FastAPI backend.
// The base URL is injected at build time via NEXT_PUBLIC_API_BASE.

import type {
  AnswerItem,
  EssayAnalysis,
  EvaluationReport,
  GenerateQuestionsResponse,
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

export function evaluateInterview(
  profile: Profile,
  answers: AnswerItem[],
): Promise<EvaluationReport> {
  return postJson<EvaluationReport>("/evaluate", { profile, answers });
}

/** Pull FastAPI's `detail` out of an error response, falling back to `fallback`.
 *
 * The 422 body carries an array of field errors rather than a string, so only a
 * string `detail` is surfaced; anything else uses the caller's message. */
async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Non-JSON body (proxy error page, empty response) — use the fallback.
  }
  return fallback;
}

/** Track A: analyze one 자기소개서 for its interview weak points.
 *
 * There is no degraded result to fall back to, so a failure surfaces as a
 * thrown Error carrying a message meant for the user. */
export async function analyzeEssay(
  essay: string,
  profile: Profile = {},
): Promise<EssayAnalysis> {
  const res = await fetch(`${API_BASE}/essay/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ essay, profile }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      await errorDetail(
        res,
        res.status === 422
          ? "자기소개서를 확인해 주세요."
          : "자소서 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      ),
    );
  }
  return (await res.json()) as EssayAnalysis;
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

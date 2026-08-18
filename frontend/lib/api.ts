// Thin client for the InterReview FastAPI backend.
// The base URL is injected at build time via NEXT_PUBLIC_API_BASE.

import type {
  AnswerItem,
  AnnotationProgress,
  AnnotatorSummary,
  BenchmarkAssignment,
  BenchmarkMode,
  BenchmarkRubric,
  BenchmarkScore,
  BenchmarkSamplePage,
  EvaluationReport,
  GenerateQuestionsResponse,
  Profile,
  TranscriptResponse,
  UnresolvedBenchmarkItem,
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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} 실패: HTTP ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

export async function getBenchmarkSamples(params: {
  offset: number;
  limit?: number;
  group?: string;
  source_split?: string;
  experience?: string;
}): Promise<BenchmarkSamplePage> {
  const query = new URLSearchParams({
    offset: String(params.offset),
    limit: String(params.limit ?? 1),
  });
  for (const key of ["group", "source_split", "experience"] as const) {
    if (params[key]) query.set(key, params[key] as string);
  }
  const res = await fetch(`${API_BASE}/benchmark/samples?${query}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`/benchmark/samples 실패: HTTP ${res.status}`);
  return (await res.json()) as BenchmarkSamplePage;
}

export function benchmarkAudioUrl(sampleId: string, side: "question" | "answer") {
  return `${API_BASE}/benchmark/samples/${encodeURIComponent(sampleId)}/audio/${side}`;
}

export const getBenchmarkRubric = () => getJson<BenchmarkRubric>("/benchmark/rubric");
export const getAnnotators = () => getJson<AnnotatorSummary[]>("/benchmark/annotators");

export function registerAnnotator(body: {
  name: string;
  affiliation_or_major?: string;
  interview_experience?: string;
  evaluation_experience?: string;
  note?: string;
}): Promise<AnnotatorSummary> {
  return postJson<AnnotatorSummary>("/benchmark/annotators", body);
}

function annotationQuery(annotatorId: string, mode: BenchmarkMode) {
  return `annotator_id=${encodeURIComponent(annotatorId)}&mode=${mode}`;
}

export function getAnnotationProgress(annotatorId: string, mode: BenchmarkMode) {
  return getJson<AnnotationProgress>(`/benchmark/annotation/progress?${annotationQuery(annotatorId, mode)}`);
}

export function getNextAssignment(annotatorId: string, mode: BenchmarkMode) {
  return getJson<BenchmarkAssignment>(`/benchmark/assignments/next?${annotationQuery(annotatorId, mode)}`);
}

export function saveBenchmarkAnnotation(sampleId: string, body: {
  annotator_id: string;
  rubric_version: string;
  target_mode: BenchmarkMode;
  scores: Record<"relevance" | "specificity" | "coherence" | "specialized", BenchmarkScore>;
  confidence: BenchmarkScore;
  note: string;
}) {
  return postJson(`/benchmark/samples/${encodeURIComponent(sampleId)}/annotations`, body);
}

export function getUnresolved(mode: BenchmarkMode) {
  return getJson<UnresolvedBenchmarkItem[]>(`/benchmark/adjudication/unresolved?mode=${mode}`);
}

export function saveAdjudication(sampleId: string, body: {
  adjudicator_id: string;
  rubric_version: string;
  target_mode: BenchmarkMode;
  scores: Record<"relevance" | "specificity" | "coherence" | "specialized", BenchmarkScore>;
  note: string;
}) {
  return postJson(`/benchmark/samples/${encodeURIComponent(sampleId)}/adjudication`, body);
}

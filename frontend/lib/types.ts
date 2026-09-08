// TypeScript mirrors of the backend pydantic schemas (app/schemas.py).

export interface Profile {
  name?: string;
  job?: string;
}

export interface Question {
  id: string;
  question_id: string;
  category: string;
  rule_group: string;
  subcategory: string;
  text: string;
  original_text?: string | null;
  source_file?: string | null;
  occurrence_count?: number;
}

export interface GenerateQuestionsResponse {
  questions: Question[];
}

export interface EyeTrackingSummary {
  gaze_heatmap?: GazeHeatmap | null;
}

export interface GazeHeatmap {
  columns: number;
  rows: number;
  counts: number[];
  total: number;
}

export interface AudioTimeline {
  /** Normalized energy for each display bin (0..1). */
  energy: number[];
  /** Whether each display bin is predominantly speech. */
  speech: boolean[];
  /** Whether each display bin overlaps a long-pause run. */
  long_pause: boolean[];
  /** Optional VAD/alignment classification for the same display bins. */
  classification: SpeechClassificationKind[] | null;
}

export type SpeechClassificationKind =
  | "transcribed_speech"
  | "untranscribed_speech"
  | "vad_silence"
  | "pending";

export interface SpeechClassification {
  total_analysis_duration_sec: number;
  transcribed_speech_duration_sec: number;
  transcribed_speech_segment_count: number;
  untranscribed_speech_duration_sec: number;
  untranscribed_speech_segment_count: number;
  vad_silence_duration_sec: number;
  vad_silence_segment_count: number;
  pending_duration_sec: number;
  pending_segment_count: number;
}

export interface SpeechMetrics {
  total_duration_sec: number;
  speech_duration_sec: number;
  speech_rate_eojeol_per_min: number | null;
  silence_duration_sec: number;
  silence_ratio: number;
  long_pause_count: number;
  max_pause_sec: number;
  long_pause_threshold_sec: number;
  audio_timeline?: AudioTimeline | null;
  speech_classification?: SpeechClassification | null;
}
export type SttStatus =
  | "not_attempted"
  | "ok"
  | "no_speech"
  | "empty"
  | "not_configured"
  | "error";


export interface AnswerItem {
  question_id: string;
  question: string;
  original_question?: string | null;
  category?: string | null;
  transcript: string;
  stt_status: SttStatus;
  stt_error?: string | null;
  eye_tracking?: EyeTrackingSummary | null;
  speech_metrics?: SpeechMetrics | null;
}

export interface AnswerReview {
  summary: string;
  strengths: string[];
  improvements: string[];
}

export interface MeasurementSummary {
  reference_source: string;
  reference_average_total_duration_sec: number;
  reference_average_answer_length_eojeol: number;
  average_answer_length_eojeol: number | null;
  average_total_duration_sec: number | null;
  average_speech_duration_sec: number | null;
  average_silence_duration_sec: number | null;
  average_silence_ratio: number | null;
  average_long_pause_count: number | null;
}

export interface QuestionResult {
  question_id: string | null;
  question: string | null;
  category: string | null;
  stt_status: SttStatus;
  stt_error?: string | null;
  original_question?: string | null;
  speech_metrics?: SpeechMetrics | null;
  eye_tracking?: EyeTrackingSummary | null;
  content?: AnswerReview | null;
}

export interface MeasurementReport {
  summary_feedback: string;
  measurement_summary: MeasurementSummary;
  results: QuestionResult[];
}

export interface TranscriptResponse {
  transcript: string;
  status: SttStatus;
  error?: string | null;
  confidence?: number | null;
  segment_count?: number | null;
  words?: WordTimestamp[] | null;
}

export interface WordTimestamp {
  start_ms: number;
  end_ms: number;
  text: string;
}

// --- 자소서 분석 -------------------------------------------------------------

export interface EssayWeakness {
  description: string;
  expected_questions: string[];
  /** 이 약점이 드러나는 원문 문장 — 하이라이트 매칭용. */
  source_quotes: string[];
}

/** risk_level ranks how exposed the experience is in an interview, 5 = most. */
export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export interface EssayExperience {
  experience: string;
  claims: string[];
  /** 원문에서 그대로 복사된 근거 문장 — 하이라이트 매칭용. 검증은 프론트에서. */
  source_quotes: string[];
  risk_level: RiskLevel;
  risk_reason: string;
  weaknesses: EssayWeakness[];
}

export interface EssayAnalysis {
  /** Already sorted most-risky-first by the backend. */
  experiences: EssayExperience[];
  unsupported_claims: string[];
}

/** Mirrors the backend's max_length on EssayAnalyzeRequest.essay. */
export const ESSAY_MAX_LENGTH = 10_000;

/** 문항형 자소서의 한 문항 — 기업 질문(비울 수 있음) + 지원자 답변. */
export interface EssayQAItem {
  question: string;
  answer: string;
}

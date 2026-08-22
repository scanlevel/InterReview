// TypeScript mirrors of the backend pydantic schemas (app/schemas.py).

export interface Profile {
  name?: string;
  job?: string;
  experience?: "NEW" | "EXPERIENCED" | string;
  resume_text?: string;
  technologies?: string;
  projects?: string;
}

export interface Question {
  id: string;
  question_id: string;
  category: string;
  rule_group: string;
  subcategory: string;
  experience: string;
  text: string;
  original_text?: string | null;
  source_file?: string | null;
  occurrence_count?: number;
}

export interface GenerateQuestionsResponse {
  experience: string;
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

export type AnswerStatus =
  | "good"
  | "partial"
  | "off_topic"
  | "insufficient"
  | "unavailable";

export interface ContentFeedback {
  answer_status: AnswerStatus;
  reason: string;
  missing_points: string[];
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
  transcript: string;
  speech_metrics?: SpeechMetrics | null;
  eye_tracking?: EyeTrackingSummary | null;
  content?: ContentFeedback | null;
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
}

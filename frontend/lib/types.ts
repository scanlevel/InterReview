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
  front_gaze_ratio?: number | null;
  face_detected_ratio?: number | null;
  std_gaze?: number | null;
  mean_gaze_x?: number | null;
  mean_gaze_y?: number | null;
  gaze_std_x?: number | null;
  gaze_std_y?: number | null;
  valid_gaze_ratio?: number | null;
  gaze_heatmap?: GazeHeatmap | null;
}

export interface GazeHeatmap {
  columns: number;
  rows: number;
  counts: number[];
  total: number;
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
}

export interface AnswerItem {
  question_id: string;
  question: string;
  original_question?: string | null;
  category?: string | null;
  transcript: string;
  eye_tracking?: EyeTrackingSummary | null;
  speech_metrics?: SpeechMetrics | null;
}

export type AnswerStatus = "good" | "partial" | "off_topic" | "insufficient";

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
  average_face_detected_ratio: number | null;
  average_valid_gaze_ratio: number | null;
  average_front_gaze_ratio: number | null;
  average_mean_gaze_x: number | null;
  average_mean_gaze_y: number | null;
  average_gaze_std_x: number | null;
  average_gaze_std_y: number | null;
}

export interface QuestionResult {
  question_id: string | null;
  question: string | null;
  category: string | null;
  original_question?: string | null;
  transcript: string;
  speech_metrics?: SpeechMetrics | null;
  eye_tracking?: EyeTrackingSummary | null;
  content: ContentFeedback;
}

export interface EvaluationReport {
  status: string;
  engine: string;
  summary_feedback: string;
  measurement_summary: MeasurementSummary;
  results: QuestionResult[];
}

export interface TranscriptResponse {
  transcript: string;
  status: string;
  error?: string | null;
  confidence?: number | null;
  segment_count?: number | null;
}

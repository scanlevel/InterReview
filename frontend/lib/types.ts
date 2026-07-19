// TypeScript mirrors of the backend pydantic schemas (app/schemas.py).

export interface Profile {
  name?: string;
  job?: string;
  experience?: "NEW" | "EXPERIENCED" | string;
}

export interface Question {
  id: string;
  category: string;
  rule_group: string;
  subcategory: string;
  experience: string;
  text: string;
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
}

export interface AnswerItem {
  question_id: string;
  question: string;
  category?: string | null;
  transcript: string;
  eye_tracking?: EyeTrackingSummary | null;
}

export interface EvaluationItem {
  name: string;
  score: number | null;
  status: string;
  comment: string;
}

export interface QuestionResult {
  question_id: string | null;
  question: string | null;
  category: string | null;
  evaluation_items: EvaluationItem[];
  feedback: string;
}

export interface EvaluationReport {
  total_score: number | null;
  status: string;
  engine: string;
  summary_feedback: string;
  results: QuestionResult[];
}

export interface TranscriptResponse {
  transcript: string;
  status: string;
  error?: string | null;
  confidence?: number | null;
  segment_count?: number | null;
}

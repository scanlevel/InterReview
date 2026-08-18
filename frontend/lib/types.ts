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

export interface BenchmarkCandidate {
  sample_id: string;
  source: {
    dataset: string;
    source_sample_id?: string | null;
    source_split?: string | null;
    experience?: string | null;
  };
  question: {
    text: string;
    group?: string | null;
    group_name?: string | null;
  };
  answer: {
    text: string;
    word_count: number;
  };
  audio: {
    question_wav: string;
    answer_wav: string;
  };
  metadata: Record<string, unknown>;
}

export interface BenchmarkSamplePage {
  items: BenchmarkCandidate[];
  total: number;
  offset: number;
  limit: number;
}

export type BenchmarkScore = 0 | 1 | 2;
export type BenchmarkMode = "pilot" | "full";

export interface AnnotatorSummary {
  annotator_id: string;
  name: string;
  created_at: string;
}

export interface RubricMetric {
  code: string;
  name: string;
  levels: Record<"0" | "1" | "2", string>;
  note?: string;
}

export interface BenchmarkRubric {
  version: string;
  confidence_scale: Record<"0" | "1" | "2", string>;
  common: Record<"relevance" | "specificity" | "coherence", RubricMetric>;
  specialized: Record<string, RubricMetric & { group_name: string; metric: string }>;
}

export interface BenchmarkAssignment {
  sample: BenchmarkCandidate & { benchmark?: Record<string, unknown> };
  annotation_count: number;
  needs_reevaluation: boolean;
  rubric_version: string;
}

export interface AnnotationProgress {
  annotator_completed: number;
  needs_reevaluation: number;
  target_samples: number;
  global_completed_annotations: number;
  global_required_annotations: number;
  global_progress: number;
}

export interface UnresolvedBenchmarkItem {
  sample: BenchmarkCandidate;
  annotations: Array<{
    annotator_id: string;
    scores: Record<"relevance" | "specificity" | "coherence" | "specialized", BenchmarkScore>;
    confidence: BenchmarkScore;
    note: string;
  }>;
  unresolved_fields: string[];
}

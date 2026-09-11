"use client";

import type {
  EyeTrackingSummary,
  GazeHeatmap,
  MeasurementReport,
  MeasurementSummary,
  QuestionResult,
  SpeechClassification,
  SpeechMetrics,
  SttStatus,
} from "@/lib/types";
import AudioActivityTimeline from "@/components/AudioActivityTimeline";
import InterviewerStage from "@/components/InterviewerStage";

const STT_STATUS_LABELS: Record<SttStatus, string> = {
  not_attempted: "미시도",
  ok: "인식 완료",
  no_speech: "음성 없음",
  empty: "빈 오디오",
  not_configured: "STT 미설정",
  error: "인식 오류",
};

function fixed(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${fixed(value * 100, 1)}%`;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-line-soft py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}

function ClassificationPanel({
  classification,
}: {
  classification: SpeechClassification | null | undefined;
}) {
  if (!classification) {
    return (
      <p className="mt-3 text-sm text-muted">
        전사·정렬 기반 발화 분류를 제공할 수 없습니다.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs text-muted">
        발화 구간 분류 · 총 {fixed(classification.total_analysis_duration_sec)}초
      </p>
      <MetricRow
        label="전사 기반 발화"
        value={`${fixed(classification.transcribed_speech_duration_sec)}초 · ${classification.transcribed_speech_segment_count}구간`}
      />
      <MetricRow
        label="미전사 발화"
        value={`${fixed(classification.untranscribed_speech_duration_sec)}초 · ${classification.untranscribed_speech_segment_count}구간`}
      />
      <MetricRow
        label="VAD 기준 무음"
        value={`${fixed(classification.vad_silence_duration_sec)}초 · ${classification.vad_silence_segment_count}구간`}
      />
      <MetricRow
        label="판정 보류"
        value={`${fixed(classification.pending_duration_sec)}초 · ${classification.pending_segment_count}구간`}
      />
    </div>
  );
}

function SpeechPanel({
  metrics,
  sttStatus,
  sttError,
}: {
  metrics: SpeechMetrics | null | undefined;
  sttStatus: SttStatus;
  sttError?: string | null;
}) {
  if (!metrics) {
    return (
      <div>
        <MetricRow label="STT 상태" value={STT_STATUS_LABELS[sttStatus]} />
        {sttError && <p className="mt-2 text-xs text-risk-mid-text">{sttError}</p>}
        <p className="text-sm text-muted">녹음 측정값이 없습니다.</p>
      </div>
    );
  }
  return (
    <div>
      <MetricRow label="STT 상태" value={STT_STATUS_LABELS[sttStatus]} />
      {sttError && <p className="mb-2 text-xs text-risk-mid-text">{sttError}</p>}
      <div className="mt-3">
        <p className="mb-2 text-xs text-muted">오디오 활동</p>
        <AudioActivityTimeline timeline={metrics.audio_timeline} />
      </div>
      <ClassificationPanel classification={metrics.speech_classification} />
      <div className="mt-3">
        <MetricRow
          label="발화 속도"
          value={`${fixed(metrics.speech_rate_eojeol_per_min, 1)}어절/분`}
        />
        <MetricRow label="무음 비율" value={percent(metrics.silence_ratio)} />
        <MetricRow label="긴 무음 횟수" value={`${metrics.long_pause_count}회`} />
      </div>
    </div>
  );
}

function Heatmap({
  heatmap,
  imageSrc,
}: {
  heatmap: GazeHeatmap | null | undefined;
  imageSrc?: string | null;
}) {
  if (!heatmap || !heatmap.counts.length) {
    return <p className="text-sm text-muted">유효한 시선 프레임이 없습니다.</p>;
  }
  const peak = Math.max(...heatmap.counts, 1);
  return (
    <InterviewerStage
      showLabel={false}
      className="w-full max-w-xl"
      imageSrc={imageSrc}
    >
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={{ gridTemplateColumns: "repeat(" + heatmap.columns + ", minmax(0, 1fr))" }}
        aria-label="질문별 시선 Heatmap"
      >
        {heatmap.counts.map((count, index) => (
          <span
            key={String(index) + "-" + String(count)}
            title={String(count) + " 프레임"}
            className="border-[0.5px] border-white/30 dark:border-black/20"
            style={{
              backgroundColor: "rgba(239, 68, 68, " + (count ? 0.12 + (count / peak) * 0.88 : 0) + ")",
            }}
          />
        ))}
      </div>
    </InterviewerStage>
  );
}

function GazePanel({
  summary,
  imageSrc,
}: {
  summary: EyeTrackingSummary | null | undefined;
  imageSrc?: string | null;
}) {
  if (!summary) {
    return <p className="text-sm text-muted">시선 측정값이 없습니다.</p>;
  }
  return (
    <Heatmap heatmap={summary.gaze_heatmap} imageSrc={imageSrc} />
  );
}

function SessionMeasurementPanel({ summary }: { summary: MeasurementSummary }) {
  return (
    <div className="mt-4 rounded-md border border-line-soft bg-surface-soft p-3">
      <h3 className="font-semibold text-ink">최종 측정 요약</h3>
      <p className="mt-1 text-xs text-muted">
        음성은 질문별 활동 타임라인과 중립적인 측정값으로, 시선은 질문별 Heatmap으로 표시합니다.
      </p>
      <div className="mt-2 grid gap-x-6 md:grid-cols-2">
        <MetricRow
          label="참고 평균 답변 어절"
          value={`${summary.reference_average_answer_length_eojeol}어절`}
        />
        <MetricRow
          label="내 평균 답변 어절"
          value={`${fixed(summary.average_answer_length_eojeol, 1)}어절`}
        />
        <MetricRow label="내 평균 무음 비율" value={percent(summary.average_silence_ratio)} />
        <MetricRow
          label="내 평균 긴 무음 횟수"
          value={`${fixed(summary.average_long_pause_count, 1)}회`}
        />
      </div>
    </div>
  );
}

function ContentPanel({ result }: { result: QuestionResult }) {
  if (!result.content) {
    return (
      <div className="rounded-md border border-line-soft bg-surface-soft p-3">
        <h3 className="font-semibold text-ink">답변 피드백</h3>
        <p className="mt-2 text-sm text-muted">
          답변 피드백을 사용할 수 없습니다. 세션은 유지됩니다.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-line-soft bg-surface-soft p-3">
      <h3 className="font-semibold text-ink">답변 피드백</h3>
      <p className="mt-2 text-sm text-ink-2">
        {result.content.summary}
      </p>
      {result.content.strengths.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-muted">답변에서 확인된 강점</p>
          <ul className="mt-1 list-disc pl-5">
            {result.content.strengths.map((strength) => (
              <li key={strength}>{strength}</li>
            ))}
          </ul>
        </div>
      )}
      {result.content.improvements.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-muted">다음 답변에서 시도할 보완</p>
          <ul className="mt-1 list-disc pl-5">
            {result.content.improvements.map((improvement) => (
              <li key={improvement}>{improvement}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AnalysisView({
  report,
  interviewerImageSrc,
  onReset,
}: {
  report: MeasurementReport;
  interviewerImageSrc?: string | null;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-brand">면접 결과</h2>
            <p className="mt-1 text-sm text-muted">
              시선과 음성은 측정값으로 표시합니다.
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2">
          {report.summary_feedback}
        </p>
        <SessionMeasurementPanel summary={report.measurement_summary} />
      </section>

      {report.results.map((result, index) => (
        <section
          key={result.question_id ?? `${result.question}-${index}`}
          className="rounded-lg border border-line bg-surface p-5 shadow-card"
        >
          <div className="mb-1 flex items-center gap-2 text-xs">
            <span className="font-semibold text-faint">질문 {index + 1}</span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">{result.category}</span>
          </div>
          <p className="text-sm font-semibold leading-relaxed text-ink">{result.question}</p>
          {result.original_question && result.original_question !== result.question && (
            <p className="mt-1 text-xs text-muted">질문은행 원문: {result.original_question}</p>
          )}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ContentPanel result={result} />
            <div className="rounded-md border border-line-soft bg-surface-soft p-3">
              <h3 className="font-semibold text-ink">음성</h3>
              <SpeechPanel
                metrics={result.speech_metrics}
                sttStatus={result.stt_status}
                sttError={result.stt_error}
              />
            </div>
          </div>

          <div className="mt-4 rounded-md border border-line-soft bg-surface-soft p-3">
            <h3 className="mb-3 font-semibold text-ink">시선</h3>
            <GazePanel
              summary={result.eye_tracking}
              imageSrc={interviewerImageSrc}
            />
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={onReset}
        className="self-start rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink-2 hover:border-accent"
      >
        새 면접 시작
      </button>
    </div>
  );
}

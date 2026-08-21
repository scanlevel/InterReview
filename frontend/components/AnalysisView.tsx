"use client";

import type {
  AnswerStatus,
  EyeTrackingSummary,
  GazeHeatmap,
  MeasurementReport,
  MeasurementSummary,
  QuestionResult,
  SpeechMetrics,
} from "@/lib/types";

const STATUS_LABELS: Record<AnswerStatus, string> = {
  good: "답변함",
  partial: "부분 답변",
  off_topic: "질문과 다른 방향",
  insufficient: "답변 부족",
  unavailable: "내용 판단 불가",
};

function fixed(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${fixed(value * 100, 1)}%`;
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-gray-100 py-2 text-sm dark:border-gray-800">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SpeechPanel({ metrics }: { metrics: SpeechMetrics | null | undefined }) {
  if (!metrics) {
    return <p className="text-sm text-gray-500">녹음 측정값이 없습니다.</p>;
  }
  return (
    <div>
      <MetricRow label="총 답변 시간" value={`${fixed(metrics.total_duration_sec, 1)}초`} />
      <MetricRow label="실제 발화 시간" value={`${fixed(metrics.speech_duration_sec, 1)}초`} />
      <MetricRow
        label="발화 속도"
        value={`${fixed(metrics.speech_rate_eojeol_per_min, 1)}어절/분`}
      />
      <MetricRow label="무음 시간" value={`${fixed(metrics.silence_duration_sec, 1)}초`} />
      <MetricRow label="무음 비율" value={percent(metrics.silence_ratio)} />
      <MetricRow label={`${metrics.long_pause_threshold_sec.toFixed(1)}초 이상 긴 무음`} value={`${metrics.long_pause_count}회`} />
      <MetricRow label="최대 무음" value={`${fixed(metrics.max_pause_sec, 1)}초`} />
    </div>
  );
}

function Heatmap({ heatmap }: { heatmap: GazeHeatmap | null | undefined }) {
  if (!heatmap || !heatmap.counts.length) {
    return <p className="text-sm text-gray-500">유효한 시선 프레임이 없습니다.</p>;
  }
  const peak = Math.max(...heatmap.counts, 1);
  return (
    <div
      className="grid aspect-[3/2] w-full max-w-sm overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900"
      style={{ gridTemplateColumns: `repeat(${heatmap.columns}, minmax(0, 1fr))` }}
      aria-label="질문별 시선 Heatmap"
    >
      {heatmap.counts.map((count, index) => (
        <span
          key={`${index}-${count}`}
          title={`${count} 프레임`}
          className="border-[0.5px] border-white/30 dark:border-black/20"
          style={{
            backgroundColor: `rgba(239, 68, 68, ${count ? 0.12 + (count / peak) * 0.88 : 0})`,
          }}
        />
      ))}
    </div>
  );
}

function GazePanel({ summary }: { summary: EyeTrackingSummary | null | undefined }) {
  if (!summary) {
    return <p className="text-sm text-gray-500">시선 측정값이 없습니다.</p>;
  }
  return (
    <Heatmap heatmap={summary.gaze_heatmap} />
  );
}

function SessionMeasurementPanel({ summary }: { summary: MeasurementSummary }) {
  return (
    <div className="mt-4 rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <h3 className="font-medium">최종 측정 요약</h3>
      <p className="mt-1 text-xs text-gray-500">
        {summary.reference_source}와 이번 세션의 측정값을 그대로 표시합니다. 우열 판단 없이 측정값만 제공합니다.
      </p>
      <div className="mt-2 grid gap-x-6 md:grid-cols-2">
        <MetricRow
          label="참고 평균 답변시간"
          value={`${fixed(summary.reference_average_total_duration_sec, 1)}초`}
        />
        <MetricRow
          label="참고 평균 답변 어절"
          value={`${summary.reference_average_answer_length_eojeol}어절`}
        />
        <MetricRow
          label="내 평균 총 답변시간"
          value={`${fixed(summary.average_total_duration_sec, 1)}초`}
        />
        <MetricRow
          label="내 평균 실제 발화시간"
          value={`${fixed(summary.average_speech_duration_sec, 1)}초`}
        />
        <MetricRow
          label="내 평균 답변 어절"
          value={`${fixed(summary.average_answer_length_eojeol, 1)}어절`}
        />
        <MetricRow
          label="내 평균 무음시간"
          value={`${fixed(summary.average_silence_duration_sec, 1)}초`}
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
      <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
        <h3 className="font-medium">내용</h3>
        <p className="mt-2 text-sm text-gray-500">
          A 담당 내용 판별 결과가 아직 연결되지 않았습니다.
        </p>
      </div>
    );
  }
  const status = result.content.answer_status;
  return (
    <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">내용</h3>
        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">
          {STATUS_LABELS[status]}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
        {result.content.reason}
      </p>
      {result.content.missing_points.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="text-gray-500">빠진 내용</p>
          <ul className="mt-1 list-disc pl-5">
            {result.content.missing_points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function AnalysisView({
  report,
  onReset,
}: {
  report: MeasurementReport;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">면접 결과</h2>
            <p className="mt-1 text-sm text-gray-500">
              시선과 음성은 측정값으로 표시합니다.
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {report.summary_feedback}
        </p>
        <SessionMeasurementPanel summary={report.measurement_summary} />
      </section>

      {report.results.map((result, index) => (
        <section
          key={result.question_id ?? `${result.question}-${index}`}
          className="rounded-lg border border-gray-200 p-5 dark:border-gray-800"
        >
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>질문 {index + 1} · {result.category}</span>
          </div>
          <p className="text-sm font-medium leading-relaxed">{result.question}</p>
          {result.original_question && result.original_question !== result.question && (
            <p className="mt-1 text-xs text-gray-500">질문은행 원문: {result.original_question}</p>
          )}

          <div className="mt-4 rounded-md bg-gray-50 p-3 dark:bg-gray-900">
            <p className="text-xs text-gray-500">답변 transcript</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {result.transcript || "(인식된 답변 없음)"}
            </p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ContentPanel result={result} />
            <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
              <h3 className="font-medium">음성</h3>
              <SpeechPanel metrics={result.speech_metrics} />
            </div>
          </div>

          <div className="mt-4 rounded-md border border-gray-200 p-3 dark:border-gray-800">
            <h3 className="mb-3 font-medium">시선</h3>
            <GazePanel summary={result.eye_tracking} />
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={onReset}
        className="self-start rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
      >
        새 면접 시작
      </button>
    </div>
  );
}

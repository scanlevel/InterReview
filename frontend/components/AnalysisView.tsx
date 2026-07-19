"use client";

import type { EvaluationItem, EvaluationReport } from "@/lib/types";

function scoreColor(score: number | null): string {
  if (score === null) return "text-gray-400";
  if (score >= 70) return "text-green-600";
  if (score >= 45) return "text-amber-600";
  return "text-red-600";
}

function ItemRow({ item }: { item: EvaluationItem }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-gray-100 py-2 dark:border-gray-800">
      <div>
        <p className="text-sm font-medium">{item.name}</p>
        <p className="text-xs text-gray-500">{item.comment}</p>
      </div>
      <span className={`shrink-0 text-sm font-semibold ${scoreColor(item.score)}`}>
        {item.score === null ? "—" : item.score}
      </span>
    </div>
  );
}

export default function AnalysisView({
  report,
  onReset,
}: {
  report: EvaluationReport;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-gray-500">총점</p>
            <p className={`text-4xl font-bold ${scoreColor(report.total_score)}`}>
              {report.total_score === null ? "—" : report.total_score}
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {report.engine === "rule_based" ? "규칙 기반 예비평가" : report.engine}
          </span>
        </div>
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {report.summary_feedback}
        </p>
      </section>

      {report.results.map((result) => (
        <section
          key={result.question_id ?? result.question}
          className="rounded-lg border border-gray-200 p-5 dark:border-gray-800"
        >
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span>{result.category}</span>
          </div>
          <p className="mb-3 text-sm font-medium leading-relaxed">
            {result.question}
          </p>

          <div>
            {result.evaluation_items.map((item) => (
              <ItemRow key={item.name} item={item} />
            ))}
          </div>

          <p className="mt-3 rounded-md bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-300">
            {result.feedback}
          </p>
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

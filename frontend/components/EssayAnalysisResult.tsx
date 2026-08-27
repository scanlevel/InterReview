import type {
  EssayAnalysis,
  EssayExperience,
  RiskLevel,
} from "@/lib/types";

/** Track A — 자소서 분석 결과 표시 (presentation only).
 *
 * The risk badge describes how exposed an experience is in an interview, not
 * how good the applicant is — plan.md §12 rules out scoring the person. */

const RISK_STYLES: Record<RiskLevel, string> = {
  5: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  4: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  3: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  2: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  1: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function ExperienceCard({ item }: { item: EssayExperience }) {
  return (
    <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
      <div className="mb-2 flex items-start justify-between gap-4">
        <p className="text-sm font-medium leading-relaxed">{item.experience}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${RISK_STYLES[item.risk_level]}`}
        >
          위험도 {item.risk_level}
        </span>
      </div>
      <p className="text-xs text-gray-500">{item.risk_reason}</p>

      {item.claims.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          <span className="font-medium">뒷받침하는 주장</span>{" "}
          {item.claims.join(" · ")}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {item.weaknesses.map((weakness, index) => (
          <div
            key={index}
            className="rounded-md bg-gray-50 p-3 dark:bg-gray-900"
          >
            <p className="text-sm font-medium">{weakness.description}</p>
            {weakness.expected_questions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {weakness.expected_questions.map((question, qIndex) => (
                  <li
                    key={qIndex}
                    className="text-xs leading-relaxed text-gray-600 dark:text-gray-300"
                  >
                    Q. {question}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EssayAnalysisResult({
  analysis,
}: {
  analysis: EssayAnalysis;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold">
        경험 {analysis.experiences.length}건 · 위험도가 높은 순
      </h2>

      {analysis.experiences.length === 0 && (
        <p className="text-sm text-gray-500">
          분석할 경험을 찾지 못했습니다. 구체적인 경험을 담아 다시 작성해
          보세요.
        </p>
      )}

      {analysis.experiences.map((item, index) => (
        <ExperienceCard key={index} item={item} />
      ))}

      {analysis.unsupported_claims.length > 0 && (
        <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
          <h3 className="mb-1 text-sm font-medium">
            근거가 되는 경험이 없는 주장
          </h3>
          <p className="mb-3 text-xs text-gray-500">
            면접에서 &ldquo;그렇게 생각하는 근거가 무엇인가요?&rdquo;라는
            질문을 받기 쉬운 문장입니다.
          </p>
          <ul className="flex flex-col gap-1">
            {analysis.unsupported_claims.map((claim, index) => (
              <li
                key={index}
                className="text-sm text-gray-600 dark:text-gray-300"
              >
                · {claim}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

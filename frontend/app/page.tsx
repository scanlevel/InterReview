import Link from "next/link";
import PageShell from "@/components/PageShell";

/** 홈 — 두 트랙은 병렬적인 독립 탭이다 (plan.md §1). */
export default function Home() {
  return (
    <PageShell>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/essay"
          className="flex flex-col gap-2 rounded-lg border border-gray-200 p-6 transition-colors hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-600"
        >
          <h2 className="text-lg font-semibold">자소서 첨삭</h2>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            자기소개서에서 면접관이 파고들 약점과 예상 질문을 찾아 드립니다.
            분석 결과를 보며 자소서를 고치고, 모의 인터뷰로 이어갈 수 있습니다.
          </p>
        </Link>
        <Link
          href="/interview"
          className="flex flex-col gap-2 rounded-lg border border-gray-200 p-6 transition-colors hover:border-gray-400 dark:border-gray-800 dark:hover:border-gray-600"
        >
          <h2 className="text-lg font-semibold">모의 인터뷰</h2>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            개인화된 질문으로 면접을 연습하고, 시선·음성 측정값과 답변 내용
            확인 결과를 받아 봅니다.
          </p>
        </Link>
      </div>
    </PageShell>
  );
}

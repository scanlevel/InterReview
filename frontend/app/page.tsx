import Link from "next/link";
import PageShell from "@/components/PageShell";

/** 홈 — 두 트랙은 병렬적인 독립 탭이다 (plan.md §1). */
export default function Home() {
  return (
    <PageShell wide>
      <section className="pt-6 text-center sm:pt-12">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3.5 py-1.5 text-[12.5px] font-semibold text-accent">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M6 1l1.4 3 3.1.3-2.3 2.1.7 3.1L6 7.9 3.1 9.5l.7-3.1L1.5 4.3l3.1-.3L6 1z"
              fill="currentColor"
            />
          </svg>
          취업 준비생을 위한 AI 면접 트레이닝
        </span>
        <h1 className="mt-4 text-[28px] font-extrabold leading-snug tracking-[-0.03em] text-brand sm:text-[34px]">
          자소서의 약점을 찾고,
          <br />
          실전처럼 면접을 연습하세요
        </h1>
        <p className="mt-3 text-[15.5px] text-muted">
          면접관이 파고들 문장을 미리 찾아내고, 카메라 앞에서 답변까지 연습하는 두
          단계 트레이닝.
        </p>
        <p className="mx-auto mt-5 inline-block max-w-xl rounded-md border border-line bg-surface px-4 py-2 text-[13px] leading-relaxed text-ink-2">
          <svg
            className="mr-1.5 inline-block align-[-2px] text-accent"
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M6.5 4v3M6.5 9h.01"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          InterReview는 사람에게 점수를 매기지 않습니다 — 숫자 점수 대신{" "}
          <b className="font-semibold text-brand-2">위험도와 측정값</b>만
          보여드립니다.
        </p>
      </section>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Link
          href="/essay"
          className="group flex flex-col rounded-lg border border-line bg-surface p-6 text-left shadow-card transition-colors hover:border-accent"
        >
          <span
            aria-hidden="true"
            className="flex h-[42px] w-[42px] items-center justify-center rounded-lg bg-accent-soft text-accent"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M4 2.5h9L17 6.5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path d="M13 2.5V6.5H17" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M6 10h8M6 13h5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path d="M12.2 15.8l4-4 1.4 1.4-4 4-1.8.4.4-1.8Z" fill="currentColor" />
            </svg>
          </span>
          <h2 className="mt-4 text-lg font-bold text-brand">자소서 첨삭</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            자기소개서에서 면접관이 파고들 약점과 예상 질문을 찾아 드립니다.
            분석 결과를 보며 자소서를 고치고, 모의 인터뷰로 이어갈 수 있습니다.
          </p>
          <ul className="mt-3.5 flex flex-col gap-1.5">
            {[
              "문장별 위험도 하이라이트 (1~5단계)",
              "경험 단위 약점 분석과 예상 꼬리질문",
              "근거 없는 주장 문장 자동 감지",
            ].map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2"
              >
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-accent"
                />
                {feature}
              </li>
            ))}
          </ul>
          <span
            aria-hidden="true"
            className="mt-auto inline-flex items-center pt-5 text-brand-2 transition-transform group-hover:translate-x-1"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path
                d="M4 2.5L8 6l-4 3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Link>
        <Link
          href="/interview"
          className="group flex flex-col rounded-lg border border-line bg-surface p-6 text-left shadow-card transition-colors hover:border-accent"
        >
          <span
            aria-hidden="true"
            className="flex h-[42px] w-[42px] items-center justify-center rounded-lg bg-accent-soft text-accent"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect
                x="7"
                y="2"
                width="6"
                height="10"
                rx="3"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M4.5 9.5a5.5 5.5 0 0 0 11 0"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <path
                d="M10 15v3M7.5 18h5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <h2 className="mt-4 text-lg font-bold text-brand">모의 인터뷰</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            개인화된 질문으로 면접을 연습하고, 시선·음성 측정값과 답변 내용
            확인 결과를 받아 봅니다.
          </p>
          <ul className="mt-3.5 flex flex-col gap-1.5">
            {[
              "자소서 기반 맞춤 질문 생성",
              "음성 인식 답변 확인과 면접관의 음성 질문",
              "점수 없는 측정 리포트 — 발화·침묵·시선 수치",
            ].map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2"
              >
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-accent"
                />
                {feature}
              </li>
            ))}
          </ul>
          <span
            aria-hidden="true"
            className="mt-auto inline-flex items-center pt-5 text-brand-2 transition-transform group-hover:translate-x-1"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path
                d="M4 2.5L8 6l-4 3.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </Link>
      </div>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-t border-line-soft pt-5 text-xs text-faint">
        {[
          ["1단계", "자소서 입력"],
          ["2단계", "위험도 분석 확인"],
          ["3단계", "모의 인터뷰 진행"],
          ["4단계", "측정 리포트 확인"],
        ].map(([step, label]) => (
          <span key={step}>
            <b className="mr-1.5 font-semibold text-muted">{step}</b>
            {label}
          </span>
        ))}
      </div>
    </PageShell>
  );
}

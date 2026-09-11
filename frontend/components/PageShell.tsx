import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

/** Common page frame for routes outside the interview app itself. */
export default function PageShell({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="border-b border-line-soft bg-surface">
        <div className="mx-auto flex h-[58px] w-full max-w-5xl items-center px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[17px] font-extrabold tracking-[-0.02em] text-brand"
          >
            <span
              aria-hidden="true"
              className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md bg-brand-2 text-white"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 2.8A1.8 1.8 0 0 1 3.8 1h6.4A1.8 1.8 0 0 1 12 2.8v5.4A1.8 1.8 0 0 1 10.2 10H6l-2.6 2.4V10h-.2A1.8 1.8 0 0 1 2 8.2V2.8Z"
                  fill="currentColor"
                  opacity=".92"
                />
                <path
                  d="M4.6 4.4h4.8M4.6 6.6h3.2"
                  stroke="var(--brand-2)"
                  strokeWidth="1.1"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            InterReview
          </Link>
        </div>
      </header>
      <main
        className={`mx-auto w-full flex-1 px-6 py-10 ${wide ? "max-w-5xl" : "max-w-2xl"}`}
      >
        {children}
      </main>
      <ThemeToggle />
    </div>
  );
}

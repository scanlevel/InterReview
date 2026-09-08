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
    <main
      className={`mx-auto w-full px-6 py-10 ${wide ? "max-w-5xl" : "max-w-2xl"}`}
    >
      <header className="mb-8">
        <Link href="/" className="inline-block">
          <h1 className="text-2xl font-semibold">InterReview</h1>
        </Link>
        <p className="text-sm text-gray-500">AI 모의면접 · Next.js + FastAPI</p>
      </header>
      {children}
      <ThemeToggle />
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import { API_BASE, getHealth } from "@/lib/api";

type ConnectionState =
  | { kind: "loading" }
  | { kind: "ok"; service: string }
  | { kind: "error"; message: string };

export default function Home() {
  const [state, setState] = useState<ConnectionState>({ kind: "loading" });

  useEffect(() => {
    getHealth()
      .then((r) => setState({ kind: "ok", service: r.service }))
      .catch((e: unknown) =>
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">InterReview</h1>
        <p className="text-sm text-gray-500">
          AI 모의면접 · Next.js + FastAPI
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="mb-2 text-sm font-medium text-gray-500">백엔드 연결</h2>
        {state.kind === "loading" && (
          <p className="text-sm">확인 중… ({API_BASE})</p>
        )}
        {state.kind === "ok" && (
          <p className="text-sm text-green-600">
            ● 연결됨 — <span className="font-mono">{state.service}</span>
          </p>
        )}
        {state.kind === "error" && (
          <p className="text-sm text-red-600">
            ● 연결 실패 — {state.message}
            <br />
            <span className="text-gray-500">
              백엔드가 {API_BASE} 에서 실행 중인지 확인하세요.
            </span>
          </p>
        )}
      </section>
    </main>
  );
}

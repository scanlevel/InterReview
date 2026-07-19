"use client";

import { useState } from "react";
import { evaluateInterview, generateQuestions } from "@/lib/api";
import type {
  AnswerItem,
  EvaluationReport,
  Profile,
  Question,
} from "@/lib/types";
import SetupView from "@/components/SetupView";
import InterviewView from "@/components/InterviewView";
import AnalysisView from "@/components/AnalysisView";

type Phase = "setup" | "generating" | "interview" | "evaluating" | "analysis";

export default function InterviewApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [profile, setProfile] = useState<Profile>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleStart(nextProfile: Profile) {
    setError(null);
    setProfile(nextProfile);
    setPhase("generating");
    try {
      const res = await generateQuestions(nextProfile);
      setQuestions(res.questions);
      setPhase("interview");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("setup");
    }
  }

  async function handleFinish(answers: AnswerItem[]) {
    setError(null);
    setPhase("evaluating");
    try {
      const result = await evaluateInterview(profile, answers);
      setReport(result);
      setPhase("analysis");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("interview");
    }
  }

  function handleReset() {
    setReport(null);
    setQuestions([]);
    setError(null);
    setPhase("setup");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">InterReview</h1>
        <p className="text-sm text-gray-500">AI 모의면접 · Next.js + FastAPI</p>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
          {error}
        </div>
      )}

      {phase === "setup" && <SetupView onStart={handleStart} />}

      {phase === "generating" && <Busy label="질문을 생성하는 중입니다…" />}

      {phase === "interview" && (
        <InterviewView questions={questions} onFinish={handleFinish} />
      )}

      {phase === "evaluating" && <Busy label="답변을 평가하는 중입니다…" />}

      {phase === "analysis" && report && (
        <AnalysisView report={report} onReset={handleReset} />
      )}
    </main>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-6 dark:border-gray-800">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  );
}

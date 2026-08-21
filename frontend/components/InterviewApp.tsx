"use client";

import { useEffect, useRef, useState } from "react";
import {
  generateQuestions,
  getMeasurementReport,
  reviewAnswer,
} from "@/lib/api";
import type {
  AnswerItem,
  ContentFeedback,
  MeasurementReport,
  Profile,
  Question,
} from "@/lib/types";
import SetupView from "@/components/SetupView";
import InterviewView from "@/components/InterviewView";
import AnalysisView from "@/components/AnalysisView";
import DeviceSetupView, {
  type DeviceSetupResult,
} from "@/components/DeviceSetupView";

type Phase =
  | "setup"
  | "generating"
  | "device-setup"
  | "interview"
  | "measuring"
  | "analysis";

export default function InterviewApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [profile, setProfile] = useState<Profile>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [report, setReport] = useState<MeasurementReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceSetup, setDeviceSetup] = useState<DeviceSetupResult | null>(null);
  const deviceStreamRef = useRef<MediaStream | null>(null);

  useEffect(
    () => () => deviceStreamRef.current?.getTracks().forEach((track) => track.stop()),
    [],
  );

  function stopDevices() {
    deviceStreamRef.current?.getTracks().forEach((track) => track.stop());
    deviceStreamRef.current = null;
    setDeviceSetup(null);
  }

  async function handleStart(nextProfile: Profile) {
    setError(null);
    setProfile(nextProfile);
    setPhase("generating");
    try {
      const res = await generateQuestions(nextProfile);
      setQuestions(res.questions);
      setPhase("device-setup");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("setup");
    }
  }

  function handleDevicesReady(result: DeviceSetupResult) {
    deviceStreamRef.current = result.stream;
    setDeviceSetup(result);
    setPhase("interview");
  }

  async function handleFinish(answers: AnswerItem[]) {
    setError(null);
    setPhase("measuring");
    try {
      const measurementReport = await getMeasurementReport(answers);
      const reviewResults = await Promise.allSettled(
        answers.map((answer) => reviewAnswer(answer, profile)),
      );
      const contentByQuestion = new Map<string, ContentFeedback>();
      reviewResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          contentByQuestion.set(answers[index].question_id, result.value);
        }
      });
      const result: MeasurementReport = {
        ...measurementReport,
        results: measurementReport.results.map((item) => ({
          ...item,
          content: item.question_id
            ? contentByQuestion.get(item.question_id) ?? null
            : null,
        })),
      };
      stopDevices();
      setReport(result);
      setPhase("analysis");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("interview");
    }
  }

  function handleReset() {
    stopDevices();
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

      {phase === "device-setup" && (
        <DeviceSetupView
          onReady={handleDevicesReady}
          onCancel={() => {
            setQuestions([]);
            setPhase("setup");
          }}
        />
      )}

      {phase === "interview" && deviceSetup && (
        <InterviewView
          questions={questions}
          stream={deviceSetup.stream}
          calibration={deviceSetup.calibration}
          onFinish={handleFinish}
        />
      )}

      {phase === "measuring" && <Busy label="측정값을 정리하는 중입니다…" />}

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

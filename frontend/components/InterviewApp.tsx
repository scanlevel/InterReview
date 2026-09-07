"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  generateQuestions,
  getMeasurementReport,
  reviewAnswer,
} from "@/lib/api";
import type {
  AnswerItem,
  AnswerReview,
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
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";
import {
  DEFAULT_APPLICANT,
  DEFAULT_DRAFT,
  loadApplicant,
  loadDraft,
  saveApplicant,
  saveDraft,
  subscribeToStore,
  type ApplicantInfo,
  type EssayDraft,
} from "@/lib/essayStore";

type Phase =
  | "setup"
  | "generating"
  | "device-setup"
  | "interview"
  | "measuring"
  | "analysis";

const UNAVAILABLE_CONTENT: AnswerReview = {
  answer_status: "unavailable",
  reason: "답변 내용 판별을 사용할 수 없습니다.",
  missing_points: [],
  follow_up_question: null,
};

export default function InterviewApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [profile, setProfile] = useState<Profile>({});
  const [questions, setQuestions] = useState<Question[]>([]);
  const [report, setReport] = useState<MeasurementReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceSetup, setDeviceSetup] = useState<DeviceSetupResult | null>(null);
  // 자소서 첨삭 탭과 같은 draft를 공유한다 (Track A 연동, A 담당) — 설정
  // 화면의 자소서 입력이 곧 첨삭 탭의 자소서이고, 어느 쪽에서 고쳐도 같다.
  const storedDraft = useSyncExternalStore(
    subscribeToStore,
    loadDraft,
    () => DEFAULT_DRAFT,
  );
  const [editedDraft, setEditedDraft] = useState<EssayDraft | null>(null);
  const draft = editedDraft ?? storedDraft;
  // 이름·지원 직무도 첨삭 탭과 공유한다.
  const storedApplicant = useSyncExternalStore(
    subscribeToStore,
    loadApplicant,
    () => DEFAULT_APPLICANT,
  );
  const [editedApplicant, setEditedApplicant] = useState<ApplicantInfo | null>(
    null,
  );
  const applicant = editedApplicant ?? storedApplicant;
  const deviceStreamRef = useRef<MediaStream | null>(null);

  function handleDraftChange(next: EssayDraft) {
    setEditedDraft(next);
    saveDraft(next);
  }

  function handleApplicantChange(next: ApplicantInfo) {
    setEditedApplicant(next);
    saveApplicant(next);
  }

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
      const contentByQuestion = new Map<string, AnswerReview>();
      reviewResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          contentByQuestion.set(answers[index].question_id, result.value);
        } else {
          contentByQuestion.set(answers[index].question_id, UNAVAILABLE_CONTENT);
        }
      });
      const result: MeasurementReport = {
        ...measurementReport,
        results: measurementReport.results.map((item) => ({
          ...item,
          content: item.question_id
            ? contentByQuestion.get(item.question_id) ?? UNAVAILABLE_CONTENT
            : UNAVAILABLE_CONTENT,
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
    <main className={`mx-auto px-6 py-10 ${phase === "device-setup" || phase === "interview" ? "max-w-5xl" : "max-w-2xl"}`}>
      <header className="mb-8">
        <Link href="/" className="inline-block">
          <h1 className="text-2xl font-semibold">InterReview</h1>
        </Link>
        <p className="text-sm text-gray-500">AI 모의면접 · Next.js + FastAPI</p>
      </header>

      {error && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
          {error}
        </div>
      )}

      {phase === "setup" && (
        <SetupView
          draft={draft}
          onDraftChange={handleDraftChange}
          applicant={applicant}
          onApplicantChange={handleApplicantChange}
          onStart={handleStart}
        />
      )}

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
      <ThemeToggle />
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

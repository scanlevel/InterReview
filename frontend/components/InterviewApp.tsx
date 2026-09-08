"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_TTS_VOICE_ID,
  generateQuestions,
  getInterviewerImages,
  getMeasurementReport,
  reviewAnswer,
} from "@/lib/api";
import type {
  AnswerItem,
  AnswerReview,
  EssayQAItem,
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
  pickInterviewerImage,
  type InterviewerGender,
} from "@/lib/interviewerImages";
import { getAnswerRevision, isAnswerReviewable } from "@/lib/answerReview";
import {
  createQuestionSpeechCache,
  type QuestionSpeechCache,
} from "@/lib/questionSpeechCache";
import {
  DEFAULT_APPLICANT,
  DEFAULT_DRAFT,
  currentItems,
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
  summary: "답변을 판단할 수 없습니다.",
  strengths: [],
  improvements: [],
};
function voiceGender(voiceId: DeviceSetupResult["voiceId"]): InterviewerGender {
  return voiceId.startsWith("F") ? "female" : "male";
}

export default function InterviewApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [profile, setProfile] = useState<Profile>({});
  const [essayItems, setEssayItems] = useState<EssayQAItem[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [report, setReport] = useState<MeasurementReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceSetup, setDeviceSetup] = useState<DeviceSetupResult | null>(null);
  const [interviewerImages, setInterviewerImages] = useState<string[]>([]);
  const [interviewerImageSrc, setInterviewerImageSrc] = useState<string | null>(null);
  const [questionSpeechCache] = useState<QuestionSpeechCache>(
    createQuestionSpeechCache,
  );
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
  const reviewRequestsRef = useRef<Map<string, ReviewRequest>>(new Map());
  const ttsPrewarmRunRef = useRef(0);

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
    ttsPrewarmRunRef.current += 1;
    questionSpeechCache.clear();
    deviceStreamRef.current?.getTracks().forEach((track) => track.stop());
    deviceStreamRef.current = null;
    setDeviceSetup(null);
  }

  async function handleStart(nextProfile: Profile) {
    const items = currentItems(draft);
    setError(null);
    ttsPrewarmRunRef.current += 1;
    questionSpeechCache.clear();
    reviewRequestsRef.current.clear();
    setInterviewerImages([]);
    setInterviewerImageSrc(null);
    setProfile(nextProfile);
    setEssayItems(items);
    setPhase("generating");
    try {
      const res = await generateQuestions(nextProfile, items);
      setQuestions(res.questions);
      const availableInterviewerImages = await getInterviewerImages().catch(() => []);
      setInterviewerImages(availableInterviewerImages);
      setInterviewerImageSrc(
        pickInterviewerImage(
          availableInterviewerImages,
          Math.random,
          voiceGender(DEFAULT_TTS_VOICE_ID),
        ),
      );
      setPhase("device-setup");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("setup");
    }
  }

  function prewarmQuestionSpeech(voiceId: DeviceSetupResult["voiceId"]) {
    const run = ++ttsPrewarmRunRef.current;
    void (async () => {
      for (const question of questions) {
        if (ttsPrewarmRunRef.current !== run) return;
        await questionSpeechCache
          .prepare(question.question_id, question.text, voiceId)
          .promise.catch(() => undefined);
      }
    })();
  }

  function handleDevicesReady(result: DeviceSetupResult) {
    questionSpeechCache.clear();
    prewarmQuestionSpeech(result.voiceId);
    deviceStreamRef.current = result.stream;
    setDeviceSetup(result);
    setPhase("interview");
  }

  function startAnswerReview(answer: AnswerItem) {
    const revision = getAnswerRevision(answer);
    const existing = reviewRequestsRef.current.get(answer.question_id);
    if (existing?.revision === revision) return existing.promise;

    const promise = isAnswerReviewable(answer)
      ? reviewAnswer(answer, profile, essayItems).catch((reviewError) => {
          console.warn("Answer review failed for " + answer.question_id, reviewError);
          return UNAVAILABLE_CONTENT;
        })
      : Promise.resolve(UNAVAILABLE_CONTENT);
    reviewRequestsRef.current.set(answer.question_id, { revision, promise });
    return promise;
  }

  function handleAnswerFinalized(answer: AnswerItem) {
    void startAnswerReview(answer);
  }

  async function handleFinish(answers: AnswerItem[]) {
    setError(null);
    setPhase("measuring");
    try {
      const reviewPromises = answers.map((answer) => getExistingAnswerReview(answer));
      const [measurementReport, reviewResults] = await Promise.all([
        getMeasurementReport(answers),
        Promise.all(reviewPromises),
      ]);
      const contentByQuestion = new Map<string, AnswerReview>();
      reviewResults.forEach((result, index) => {
        contentByQuestion.set(answers[index].question_id, result);
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
    setEssayItems([]);
    setInterviewerImages([]);
    setInterviewerImageSrc(null);
    setError(null);
    setPhase("setup");
  }

  function getExistingAnswerReview(answer: AnswerItem): Promise<AnswerReview> {
    const revision = getAnswerRevision(answer);
    const existing = reviewRequestsRef.current.get(answer.question_id);
    return existing?.revision === revision
      ? existing.promise
      : Promise.resolve(UNAVAILABLE_CONTENT);
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
          interviewerImageSrc={interviewerImageSrc}
          onReady={handleDevicesReady}
          onVoiceChange={(voiceId) =>
            setInterviewerImageSrc(
              pickInterviewerImage(interviewerImages, Math.random, voiceGender(voiceId)),
            )
          }
          onCancel={() => {
            questionSpeechCache.clear();
            setQuestions([]);
            setInterviewerImages([]);
            setInterviewerImageSrc(null);
            setPhase("setup");
          }}
        />
      )}

      {phase === "interview" && deviceSetup && (
        <InterviewView
          questions={questions}
          stream={deviceSetup.stream}
          calibration={deviceSetup.calibration}
          voiceId={deviceSetup.voiceId}
          questionSpeechCache={questionSpeechCache}
          interviewerImageSrc={interviewerImageSrc}
          onAnswerFinalized={handleAnswerFinalized}
          onFinish={handleFinish}
        />
      )}

      {phase === "measuring" && <Busy label="측정값을 정리하는 중입니다…" />}

      {phase === "analysis" && report && (
        <AnalysisView
          report={report}
          interviewerImageSrc={interviewerImageSrc}
          onReset={handleReset}
        />
      )}
      <ThemeToggle />
    </main>
  );
}

type ReviewRequest = {
  revision: string;
  promise: Promise<AnswerReview>;
};

function Busy({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-6 dark:border-gray-800">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
      <span className="text-sm text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  );
}

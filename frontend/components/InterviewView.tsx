"use client";

import { useState } from "react";
import type { AnswerItem, Question } from "@/lib/types";

export default function InterviewView({
  questions,
  onFinish,
}: {
  questions: Question[];
  onFinish: (answers: AnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const current = answers[question.id] ?? "";

  function setAnswer(value: string) {
    setAnswers((prev) => ({ ...prev, [question.id]: value }));
  }

  function submit() {
    const items: AnswerItem[] = questions.map((q) => ({
      question_id: q.id,
      question: q.text,
      category: q.category,
      transcript: (answers[q.id] ?? "").trim(),
      eye_tracking: null, // Milestone C fills this from the browser gaze tracker
    }));
    onFinish(items);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          질문 {index + 1} / {questions.length}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
          {question.category}
        </span>
      </div>

      <p className="text-lg leading-relaxed">{question.text}</p>

      <textarea
        value={current}
        onChange={(e) => setAnswer(e.target.value)}
        rows={6}
        placeholder="답변을 입력하세요. (Milestone B에서 음성 녹음으로 대체됩니다)"
        className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
      />

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
        >
          이전
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            제출하고 평가받기
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            다음
          </button>
        )}
      </div>
    </div>
  );
}

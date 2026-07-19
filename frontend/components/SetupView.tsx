"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";

export default function SetupView({
  onStart,
}: {
  onStart: (profile: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [experience, setExperience] = useState<"NEW" | "EXPERIENCED">("NEW");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onStart({
      name: name.trim() || undefined,
      job: job.trim() || undefined,
      experience,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        프로필을 입력하면 직무·경력에 맞는 6개의 면접 질문이 생성됩니다.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">이름 (선택)</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="홍길동"
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">지원 직무 (선택)</span>
        <input
          value={job}
          onChange={(e) => setJob(e.target.value)}
          placeholder="백엔드 개발자"
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">경력 구분</legend>
        <div className="flex gap-4">
          {(["NEW", "EXPERIENCED"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="experience"
                checked={experience === value}
                onChange={() => setExperience(value)}
              />
              {value === "NEW" ? "신입" : "경력"}
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
      >
        면접 시작
      </button>
    </form>
  );
}

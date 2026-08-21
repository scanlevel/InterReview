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
  const [resumeText, setResumeText] = useState("");
  const [technologies, setTechnologies] = useState("");
  const [projects, setProjects] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onStart({
      name: name.trim() || undefined,
      job: job.trim() || undefined,
      experience,
      resume_text: resumeText.trim() || undefined,
      technologies: technologies.trim() || undefined,
      projects: projects.trim() || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        질문은행에서 항목별로 한 문항씩 무작위 선택합니다. 아래 정보를 넣으면 선택된 질문만 개인화됩니다.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">이름 (선택)</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="홍길동"
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">지원 직무 (선택)</span>
        <input
          value={job}
          onChange={(event) => setJob(event.target.value)}
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

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">자기소개·이력 (선택)</span>
        <textarea
          value={resumeText}
          onChange={(event) => setResumeText(event.target.value)}
          rows={3}
          placeholder="개인화에 사용할 자기소개서나 이력 내용을 입력하세요."
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">기술 스택 (선택)</span>
        <textarea
          value={technologies}
          onChange={(event) => setTechnologies(event.target.value)}
          rows={2}
          placeholder="Python, FastAPI, PostgreSQL"
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">프로젝트 경험 (선택)</span>
        <textarea
          value={projects}
          onChange={(event) => setProjects(event.target.value)}
          rows={3}
          placeholder="프로젝트에서 맡은 역할과 결과를 간단히 입력하세요."
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <button
        type="submit"
        className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
      >
        다음: 카메라·마이크 설정
      </button>
    </form>
  );
}

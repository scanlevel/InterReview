"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import {
  benchmarkAudioUrl,
  getAnnotationProgress,
  getAnnotators,
  getBenchmarkRubric,
  getNextAssignment,
  registerAnnotator,
  saveBenchmarkAnnotation,
} from "@/lib/api";
import type {
  AnnotationProgress,
  AnnotatorSummary,
  BenchmarkAssignment,
  BenchmarkMode,
  BenchmarkRubric,
  BenchmarkScore,
  RubricMetric,
} from "@/lib/types";

type MetricKey = "relevance" | "specificity" | "coherence" | "specialized";
const emptyScores: Partial<Record<MetricKey, BenchmarkScore>> = {};

export default function AnnotatePage() {
  const [rubric, setRubric] = useState<BenchmarkRubric | null>(null);
  const [annotators, setAnnotators] = useState<AnnotatorSummary[]>([]);
  const [annotatorId, setAnnotatorId] = useState("");
  const [mode, setMode] = useState<BenchmarkMode>("pilot");
  const [assignment, setAssignment] = useState<BenchmarkAssignment | null>(null);
  const [progress, setProgress] = useState<AnnotationProgress | null>(null);
  const [scores, setScores] = useState(emptyScores);
  const [confidence, setConfidence] = useState<BenchmarkScore | undefined>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([getBenchmarkRubric(), getAnnotators()])
      .then(([nextRubric, nextAnnotators]) => {
        setRubric(nextRubric);
        setAnnotators(nextAnnotators);
      })
      .catch((error) => setMessage(String(error)));
  }, []);

  async function next() {
    if (!annotatorId) return;
    setBusy(true);
    setMessage("");
    try {
      const [nextAssignment, nextProgress] = await Promise.all([
        getNextAssignment(annotatorId, mode),
        getAnnotationProgress(annotatorId, mode),
      ]);
      setAssignment(nextAssignment);
      setProgress(nextProgress);
      setScores({});
      setConfidence(undefined);
      setNote("");
    } catch (error) {
      setAssignment(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!assignment || !annotatorId || confidence === undefined) return;
    const fields: MetricKey[] = ["relevance", "specificity", "coherence", "specialized"];
    if (fields.some((field) => scores[field] === undefined)) {
      setMessage("네 평가 항목을 모두 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await saveBenchmarkAnnotation(assignment.sample.sample_id, {
        annotator_id: annotatorId,
        rubric_version: assignment.rubric_version,
        target_mode: mode,
        scores: scores as Record<MetricKey, BenchmarkScore>,
        confidence,
        note,
      });
      await next();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  if (!annotatorId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Header />
        <section className="rounded-xl border p-6 dark:border-gray-800">
          <h2 className="mb-4 text-lg font-semibold">평가자 등록 또는 선택</h2>
          {annotators.length > 0 && (
            <label className="mb-6 block text-sm">
              기존 평가자
              <select className="mt-2 w-full rounded-md border bg-transparent p-2" defaultValue="" onChange={(event) => setAnnotatorId(event.target.value)}>
                <option value="" disabled>이름을 선택하세요</option>
                {annotators.map((item) => <option key={item.annotator_id} value={item.annotator_id}>{item.name}</option>)}
              </select>
            </label>
          )}
          <Registration onRegistered={(profile) => { setAnnotators((items) => [...items, profile]); setAnnotatorId(profile.annotator_id); }} />
          {message && <p className="mt-4 text-sm text-red-600">{message}</p>}
        </section>
      </main>
    );
  }

  const sample = assignment?.sample;
  const specialized = sample && rubric ? rubric.specialized[sample.question.group ?? ""] : undefined;
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Header />
      <section className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm dark:border-gray-800">
        <select value={annotatorId} onChange={(event) => { setAnnotatorId(event.target.value); setAssignment(null); setProgress(null); }} className="rounded-md border bg-transparent p-2">
          {annotators.map((item) => <option key={item.annotator_id} value={item.annotator_id}>{item.name}</option>)}
        </select>
        <select value={mode} onChange={(event) => { setMode(event.target.value as BenchmarkMode); setAssignment(null); setProgress(null); }} className="rounded-md border bg-transparent p-2">
          <option value="pilot">Pilot (그룹당 10)</option><option value="full">Full (1,000)</option>
        </select>
        <button onClick={() => void next()} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">다음 평가</button>
        {progress && <span className="ml-auto text-gray-500">내 완료 {progress.annotator_completed}/{progress.target_samples} · 전체 {(progress.global_progress * 100).toFixed(1)}%</span>}
      </section>
      {message && <p className="mb-5 rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</p>}
      {!sample && <p className="rounded-xl border p-8 text-center text-gray-500 dark:border-gray-800">“다음 평가”를 눌러 자동 배정받으세요.</p>}
      {sample && rubric && specialized && (
        <div className="space-y-5">
          <section className="rounded-xl border p-5 dark:border-gray-800">
            <div className="mb-4 flex flex-wrap gap-2 text-xs text-gray-500"><span>{sample.question.group_name}</span><span>{sample.question.group}</span><span>Sample {sample.sample_id}</span>{assignment.needs_reevaluation && <span className="text-amber-600">rubric 변경으로 재평가 필요</span>}</div>
            <h2 className="mb-2 text-sm font-semibold text-gray-500">질문</h2><p className="mb-5 leading-relaxed">{sample.question.text}</p>
            <h2 className="mb-2 text-sm font-semibold text-gray-500">답변 reference transcript</h2><p className="whitespace-pre-wrap leading-relaxed">{sample.answer.text}</p>
            <audio className="mt-5 w-full" controls preload="metadata" src={benchmarkAudioUrl(sample.sample_id, "answer")} />
          </section>
          {([ ["relevance", rubric.common.relevance], ["specificity", rubric.common.specificity], ["coherence", rubric.common.coherence], ["specialized", specialized] ] as [MetricKey, RubricMetric][]).map(([field, metric]) => (
            <Metric key={field} metric={metric} value={scores[field]} onChange={(value) => setScores((current) => ({ ...current, [field]: value }))} />
          ))}
          <Metric metric={{ code: "CONF", name: "평가 확신도", levels: rubric.confidence_scale }} value={confidence} onChange={setConfidence} />
          <label className="block rounded-xl border p-5 text-sm dark:border-gray-800">Note (선택)<textarea value={note} onChange={(event) => setNote(event.target.value)} className="mt-2 min-h-24 w-full rounded-md border bg-transparent p-3" /></label>
          <button onClick={() => void save()} disabled={busy} className="w-full rounded-md bg-indigo-600 px-5 py-3 font-medium text-white disabled:opacity-50">저장 후 다음</button>
        </div>
      )}
    </main>
  );
}

function Header() {
  return <header className="mb-8 flex items-start justify-between"><div><p className="text-sm text-gray-500">Gold Benchmark</p><h1 className="text-2xl font-semibold">독립 평가</h1></div><Link href="/benchmark" className="text-sm underline">Q-A-WAV 확인</Link></header>;
}

function Registration({ onRegistered }: { onRegistered: (profile: AnnotatorSummary) => void }) {
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim() || undefined;
    try { onRegistered(await registerAnnotator({ name: value("name") ?? "", affiliation_or_major: value("affiliation_or_major"), interview_experience: value("interview_experience"), evaluation_experience: value("evaluation_experience"), note: value("note") })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <form onSubmit={submit} className="grid gap-3"><p className="text-sm font-medium">새 평가자 등록</p>{[ ["name", "이름 *"], ["affiliation_or_major", "소속 또는 전공"], ["interview_experience", "면접 경험"], ["evaluation_experience", "평가 경험"], ["note", "메모"] ].map(([name, label]) => <input key={name} name={name} required={name === "name"} placeholder={label} className="rounded-md border bg-transparent p-2" />)}<button className="rounded-md border px-4 py-2">등록</button>{error && <p className="text-sm text-red-600">{error}</p>}</form>;
}

function Metric({ metric, value, onChange }: { metric: RubricMetric; value?: BenchmarkScore; onChange: (value: BenchmarkScore) => void }) {
  return <fieldset className="rounded-xl border p-5 dark:border-gray-800"><legend className="px-1 font-semibold">{metric.code} {metric.name}</legend><div className="mt-2 grid gap-3 md:grid-cols-3">{([0, 1, 2] as BenchmarkScore[]).map((score) => <label key={score} className={`cursor-pointer rounded-lg border p-3 text-sm ${value === score ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950" : ""}`}><input className="mr-2" type="radio" checked={value === score} onChange={() => onChange(score)} /><strong>{score}</strong><span className="mt-2 block text-gray-600 dark:text-gray-300">{metric.levels[String(score) as "0" | "1" | "2"]}</span></label>)}</div>{metric.note && <p className="mt-3 text-xs text-gray-500">{metric.note}</p>}</fieldset>;
}

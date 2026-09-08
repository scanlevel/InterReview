export type InterviewerGender = "female" | "male";

const FEMALE_INTERVIEWER_NUMBERS = new Set([1, 3, 5, 8, 10, 11, 13, 15, 17, 19]);

function interviewerNumber(path: string): number | null {
  const match = decodeURIComponent(path).match(/korean_interviewer_(\d+)\./u);
  return match ? Number(match[1]) : null;
}

function matchesGender(path: string, gender: InterviewerGender): boolean {
  const number = interviewerNumber(path);
  if (number === null) return false;
  const isFemale = FEMALE_INTERVIEWER_NUMBERS.has(number);
  return gender === "female" ? isFemale : !isFemale;
}

export function pickInterviewerImage(
  paths: readonly string[] = [],
  random: () => number = Math.random,
  gender?: InterviewerGender,
): string | null {
  const candidates = gender ? paths.filter((path) => matchesGender(path, gender)) : paths;
  if (candidates.length === 0) return null;

  const index = Math.max(
    0,
    Math.min(candidates.length - 1, Math.floor(random() * candidates.length)),
  );
  return candidates[index] ?? null;
}

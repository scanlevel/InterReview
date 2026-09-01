export function pickInterviewerImage(
  paths: readonly string[] = [],
  random: () => number = Math.random,
): string | null {
  if (paths.length === 0) return null;

  const index = Math.max(
    0,
    Math.min(paths.length - 1, Math.floor(random() * paths.length)),
  );
  return paths[index] ?? null;
}

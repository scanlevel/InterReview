import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_DIRECTORY = join(process.cwd(), "public", "interviewers");
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

async function listInterviewerImages(): Promise<string[]> {
  try {
    const entries = await readdir(IMAGE_DIRECTORY, { withFileTypes: true });

    return entries
      .filter(
        (entry) =>
          entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()),
      )
      .map((entry) => "/interviewers/" + encodeURIComponent(entry.name))
      .sort();
  } catch (error) {
    console.warn("면접관 이미지 폴더를 읽을 수 없습니다.", error);
    return [];
  }
}

export async function GET() {
  return Response.json(
    { images: await listInterviewerImages() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

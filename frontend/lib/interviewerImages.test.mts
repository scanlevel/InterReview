import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { GET as listInterviewerImages } from "../app/interviewer-images/route.ts";
import { pickInterviewerImage } from "./interviewerImages.ts";

test("returns null for an empty image list", () => {
  assert.equal(pickInterviewerImage([]), null);
});

test("supports deterministic first and last picks", () => {
  const paths = ["/interviewers/one.png", "/interviewers/two.jpg"];

  assert.equal(pickInterviewerImage(paths, () => 0), paths[0]);
  assert.equal(pickInterviewerImage(paths, () => 0.999999), paths[1]);
});

test("returns the only image regardless of the random value", () => {
  const paths = ["/interviewers/only.jpeg"];

  assert.equal(pickInterviewerImage(paths, () => 0), paths[0]);
  assert.equal(pickInterviewerImage(paths, () => 1), paths[0]);
});

test("lists every PNG/JPG/JPEG file in the interviewer directory", async () => {
  const response = await listInterviewerImages();
  assert.equal(response.status, 200);
  const body = (await response.json()) as { images?: unknown };
  assert.ok(Array.isArray(body.images));

  const publicRoot = fileURLToPath(new URL("../public/interviewers/", import.meta.url));
  const expected = (await readdir(publicRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
    .map((entry) => "/interviewers/" + encodeURIComponent(entry.name))
    .sort();

  assert.deepEqual(body.images, expected);
});

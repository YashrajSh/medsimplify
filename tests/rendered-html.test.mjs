import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the MedSimplify upload experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /MedSimplify/);
  assert.match(html, /Medical reports, made understandable/);
  assert.match(html, /Choose your report/);
  assert.match(html, /synthetic or fully anonymized/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps the Gemini key server-side and publishes social metadata", async () => {
  const [page, worker, layout, gitignore] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("worker/index.ts", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL(".gitignore", root), "utf8"),
  ]);
  assert.doesNotMatch(page, /GEMINI_API_KEY|generativelanguage\.googleapis\.com/);
  assert.match(worker, /env\.GEMINI_API_KEY/);
  assert.match(worker, /responseJsonSchema/);
  assert.match(worker, /Cache-Control/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /x-forwarded-host/);
  assert.match(gitignore, /\.env\*/);
});

test("health endpoint reports configuration without exposing secrets", async () => {
  const response = await render("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", analysisConfigured: false });
});

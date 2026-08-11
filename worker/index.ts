/** Cloudflare Worker entry point for MedSimplify. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  HOSTED_MODEL_NAME?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "document_type", "report_date", "plain_language_summary", "clinical_story",
    "key_findings", "timeline", "tests_and_treatments", "concerns_to_discuss",
    "questions_for_clinician", "limitations", "confidence",
  ],
  properties: {
    document_type: { type: "string" },
    report_date: { type: "string" },
    plain_language_summary: { type: "string" },
    clinical_story: { type: "string" },
    key_findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "explanation", "status", "evidence"],
        properties: {
          title: { type: "string" }, explanation: { type: "string" },
          status: { type: "string", enum: ["normal", "abnormal", "uncertain", "historical", "not_applicable"] },
          evidence: { $ref: "#/$defs/evidence" },
        },
      },
    },
    timeline: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["date_or_period", "event", "why_it_matters", "evidence"],
        properties: {
          date_or_period: { type: "string" }, event: { type: "string" },
          why_it_matters: { type: "string" }, evidence: { $ref: "#/$defs/evidence" },
        },
      },
    },
    tests_and_treatments: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "purpose", "documented_result", "evidence"],
        properties: {
          name: { type: "string" }, purpose: { type: "string" },
          documented_result: { type: "string" }, evidence: { $ref: "#/$defs/evidence" },
        },
      },
    },
    concerns_to_discuss: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["concern", "why_it_matters", "next_step", "urgency", "evidence"],
        properties: {
          concern: { type: "string" }, why_it_matters: { type: "string" },
          next_step: { type: "string" }, urgency: { type: "string" },
          evidence: { $ref: "#/$defs/evidence" },
        },
      },
    },
    questions_for_clinician: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  $defs: {
    evidence: {
      type: "object", additionalProperties: false, required: ["page", "quote"],
      properties: { page: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }, quote: { type: "string" } },
    },
  },
};

const INSTRUCTIONS = `You are a senior clinical documentation specialist creating a patient-facing explanation.
Use only facts visible in the uploaded report. Read PDF page images as well as extracted text so damaged OCR does not alter meaning.
Preserve chronology, negation, uncertainty, and the difference between suspected, tested, confirmed, and ruled-out conditions.
Do not invent diagnoses, values, treatments, outcomes, recommendations, names, or dates. Do not infer the patient's current condition from an old report.
For every finding, timeline event, treatment, and concern, include a short verbatim source quote and its PDF page when visible.
Explain medical terms in everyday language. Clearly distinguish the report author's opinion from established fact.
Frame concerns and next steps as questions or discussion points for a qualified clinician, never as a new diagnosis or treatment order.
If text is unreadable, conflicting, incomplete, or redacted, state that in limitations and lower confidence. Never reconstruct redacted identities.
Prioritize material facts; omit boilerplate and repetition.

Create a complete plain-language explanation with the report type/date, concise summary, clinical story, major findings, chronology, tests/treatments and documented results, concerns to discuss, practical clinician questions, and limitations. This is an explanation of a historical source document, not a fresh medical assessment.`;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isAllowedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return file.type === "application/pdf" || file.type.startsWith("text/") || name.endsWith(".pdf") || name.endsWith(".txt");
}

async function explainReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.GEMINI_API_KEY) return json({ error: "The analysis service is not configured." }, 503);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "The upload could not be read." }, 400);
  }
  const value = form.get("report");
  if (!(value instanceof File) || value.size === 0) return json({ error: "Choose a non-empty PDF or TXT report." }, 400);
  if (value.size > MAX_UPLOAD_BYTES) return json({ error: "Reports must be 20 MB or smaller." }, 413);
  if (!isAllowedFile(value)) return json({ error: "Only PDF and UTF-8 TXT reports are supported." }, 415);

  const isPdf = value.type === "application/pdf" || value.name.toLowerCase().endsWith(".pdf");
  const reportPart = isPdf
    ? { inline_data: { mime_type: "application/pdf", data: bytesToBase64(await value.arrayBuffer()) } }
    : { text: `REPORT CONTENT:\n${await value.text()}` };

  const model = env.HOSTED_MODEL_NAME || "gemini-3.6-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [reportPart, { text: INSTRUCTIONS }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA, temperature: 0.1 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error("Gemini request failed", response.status, await response.text());
      return json({ error: response.status === 429 ? "The free analysis quota is busy. Please retry shortly." : "The report could not be analyzed safely. Please retry." }, response.status === 429 ? 429 : 502);
    }
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!output) return json({ error: "The model returned no usable explanation." }, 502);
    try {
      return json(JSON.parse(output));
    } catch {
      console.error("Gemini returned invalid structured JSON");
      return json({ error: "The explanation did not pass structural validation." }, 502);
    }
  } catch (error) {
    console.error("Report analysis failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: error instanceof DOMException && error.name === "AbortError" ? "Analysis took too long. Please retry." : "The analysis service is temporarily unavailable." }, 504);
  } finally {
    clearTimeout(timeout);
  }
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return btoa(binary);
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/explain") return explainReport(request, env);
    if (url.pathname === "/api/health") return json({ status: "ok", analysisConfigured: Boolean(env.GEMINI_API_KEY) });
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }
    return handler.fetch(request, env, ctx);
  },
};

export default worker;

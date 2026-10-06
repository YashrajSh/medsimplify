export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const evidence = { type: "object", required: ["page", "quote"], properties: { page: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] }, quote: { type: "string" } } };
const schema = {
  type: "object",
  required: ["document_type", "report_date", "plain_language_summary", "clinical_story", "key_findings", "timeline", "tests_and_treatments", "concerns_to_discuss", "questions_for_clinician", "limitations", "confidence"],
  properties: {
    document_type: { type: "string" }, report_date: { type: "string" }, plain_language_summary: { type: "string" }, clinical_story: { type: "string" },
    key_findings: { type: "array", items: { type: "object", required: ["title", "explanation", "status", "evidence"], properties: { title: { type: "string" }, explanation: { type: "string" }, status: { type: "string", enum: ["normal", "abnormal", "uncertain", "historical", "not_applicable"] }, evidence } } },
    timeline: { type: "array", items: { type: "object", required: ["date_or_period", "event", "why_it_matters", "evidence"], properties: { date_or_period: { type: "string" }, event: { type: "string" }, why_it_matters: { type: "string" }, evidence } } },
    tests_and_treatments: { type: "array", items: { type: "object", required: ["name", "purpose", "documented_result", "evidence"], properties: { name: { type: "string" }, purpose: { type: "string" }, documented_result: { type: "string" }, evidence } } },
    concerns_to_discuss: { type: "array", items: { type: "object", required: ["concern", "why_it_matters", "next_step", "urgency", "evidence"], properties: { concern: { type: "string" }, why_it_matters: { type: "string" }, next_step: { type: "string" }, urgency: { type: "string" }, evidence } } },
    questions_for_clinician: { type: "array", items: { type: "string" } }, limitations: { type: "array", items: { type: "string" } }, confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const instructions = `You are a senior clinical documentation specialist creating a patient-facing explanation. Use only facts visible in the uploaded report. Read PDF page images as well as extracted text. Preserve chronology, negation, uncertainty, and the difference between suspected, tested, confirmed, and ruled-out conditions. Never invent diagnoses, values, treatments, outcomes, recommendations, names, or dates. Never infer the patient's current condition from an old report. For every finding, timeline event, treatment, and concern, include a short verbatim source quote and its PDF page when visible. Explain medical terms in everyday language. Frame concerns and next steps only as clinician discussion points. If text is unreadable, conflicting, incomplete, or redacted, state that in limitations and lower confidence. Never reconstruct identities. Create a concise but complete explanation with report type/date, summary, clinical story, findings, chronology, tests/treatments and documented results, concerns, clinician questions, and limitations. This is educational, not a fresh medical assessment.`;

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

const RETRYABLE_GEMINI_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_ATTEMPT_TIMEOUT_MS = 12_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  if (!process.env.GEMINI_API_KEY) return json({ error: "The analysis service is not configured." }, 503);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "The upload could not be read." }, 400); }
  const file = form.get("report");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Choose a non-empty PDF or TXT report." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Reports must be 4 MB or smaller." }, 413);
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isText = file.type.startsWith("text/") || name.endsWith(".txt");
  if (!isPdf && !isText) return json({ error: "Only PDF and UTF-8 TXT reports are supported." }, 415);
  const reportPart = isPdf ? { inline_data: { mime_type: "application/pdf", data: Buffer.from(await file.arrayBuffer()).toString("base64") } } : { text: `REPORT CONTENT:\n${await file.text()}` };
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const primaryModel = process.env.HOSTED_MODEL_NAME || "gemini-3.6-flash";
    const fallbackModel = process.env.HOSTED_FALLBACK_MODEL_NAME || "gemini-3.8-flash";
    const models = [...new Set([primaryModel, fallbackModel])];
    let lastStatus = 503;

    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const attemptController = new AbortController();
        const attemptTimeout = setTimeout(() => attemptController.abort(), GEMINI_ATTEMPT_TIMEOUT_MS);
        const signal = AbortSignal.any([controller.signal, attemptController.signal]);
        let response: Response;
        try {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY }, signal,
            body: JSON.stringify({ contents: [{ role: "user", parts: [reportPart, { text: instructions }] }], generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema, temperature: 0.1 } }),
          });
        } catch (error) {
          clearTimeout(attemptTimeout);
          if (controller.signal.aborted) throw error;
          console.error("Gemini attempt timed out", { model, attempt: attempt + 1 });
          lastStatus = 503;
          if (attempt === 1) break;
          await wait(700 * (attempt + 1));
          continue;
        }
        clearTimeout(attemptTimeout);
        if (response.ok) {
          const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
          if (!output) return json({ error: "The model returned no usable explanation." }, 502);
          try { return json(JSON.parse(output)); } catch { return json({ error: "The explanation did not pass structural validation." }, 502); }
        }

        lastStatus = response.status;
        console.error("Gemini request failed", { model, status: response.status, attempt: attempt + 1 });
        if (!RETRYABLE_GEMINI_STATUSES.has(response.status) || attempt === 1) break;
        await wait(700 * (attempt + 1));
      }
    }

    if (lastStatus === 429) return json({ error: "The Gemini free-tier quota is busy. Please retry shortly." }, 429);
    if (RETRYABLE_GEMINI_STATUSES.has(lastStatus)) return json({ error: "Gemini is temporarily busy. We tried a backup model; please retry in a minute." }, 503);
    return json({ error: "The configured Gemini model is unavailable. Please contact the project owner." }, 502);
  } catch (error) {
    console.error("Report analysis failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: error instanceof DOMException && error.name === "AbortError" ? "Analysis took too long. Please retry." : "The analysis service is temporarily unavailable." }, 504);
  } finally { clearTimeout(timeout); }
}

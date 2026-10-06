import { extractText, getDocumentProxy } from "unpdf";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const instructions = `You are a senior clinical documentation specialist creating a patient-facing explanation. Use only facts visible in the uploaded report. Read PDF page images as well as extracted text. Preserve chronology, negation, uncertainty, and the difference between suspected, tested, confirmed, and ruled-out conditions. Never invent diagnoses, values, treatments, outcomes, recommendations, names, or dates. Never infer the patient's current condition from an old report. For every finding, timeline event, treatment, and concern, include a short verbatim source quote and its PDF page when visible. Explain medical terms in everyday language. Frame concerns and next steps only as clinician discussion points. If text is unreadable, conflicting, incomplete, or redacted, state that in limitations and lower confidence. Never reconstruct identities. Create a concise but complete explanation with report type/date, summary, clinical story, findings, chronology, tests/treatments and documented results, concerns, clinician questions, and limitations. This is educational, not a fresh medical assessment.`;

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

const RETRYABLE_OPENROUTER_STATUSES = new Set([429, 500, 502, 503, 504]);
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 25_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Evidence = { page: number | null; quote: string };
const emptyEvidence = (): Evidence => ({ page: null, quote: "" });
const asText = (value: unknown) => typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
function normalizeEvidence(value: unknown): Evidence {
  if (!value || typeof value !== "object") return emptyEvidence();
  const item = value as Record<string, unknown>;
  const page = Number.isInteger(item.page) && Number(item.page) > 0 ? Number(item.page) : null;
  return { page, quote: asText(item.quote) };
}

// Small free models sometimes return the right facts in a slightly different
// JSON shape. Normalize only the shape (never the medical content) before the
// UI consumes it, so one malformed field cannot blank the whole report.
function normalizeReport(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const findings = asList(source.key_findings).map((item) => {
    if (typeof item === "string") return { title: item, explanation: item, status: "uncertain", evidence: emptyEvidence() };
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const status = ["normal", "abnormal", "uncertain", "historical", "not_applicable"].includes(asText(row.status)) ? asText(row.status) : "uncertain";
    return { title: asText(row.title) || "Finding", explanation: asText(row.explanation) || asText(row.title), status, evidence: normalizeEvidence(row.evidence) };
  });
  const timeline = asList(source.timeline).map((item) => {
    if (typeof item === "string") { const [date, ...rest] = item.split(":"); return { date_or_period: date.trim(), event: rest.join(":").trim() || item, why_it_matters: "Documented in the report.", evidence: emptyEvidence() }; }
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return { date_or_period: asText(row.date_or_period), event: asText(row.event), why_it_matters: asText(row.why_it_matters), evidence: normalizeEvidence(row.evidence) };
  });
  const treatmentsSource = source.tests_and_treatments && typeof source.tests_and_treatments === "object" && !Array.isArray(source.tests_and_treatments)
    ? Object.values(source.tests_and_treatments as Record<string, unknown>).flatMap(asList) : asList(source.tests_and_treatments);
  const treatments = treatmentsSource.map((item) => {
    if (typeof item === "string") return { name: item, purpose: "Documented in the report.", documented_result: "Not separately stated.", evidence: emptyEvidence() };
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return { name: asText(row.name) || "Test or treatment", purpose: asText(row.purpose), documented_result: asText(row.documented_result), evidence: normalizeEvidence(row.evidence) };
  });
  const concerns = asList(source.concerns_to_discuss).map((item) => {
    if (typeof item === "string") return { concern: item, why_it_matters: "Discuss this documented point with a clinician.", next_step: "Ask the treating clinician for context.", urgency: "Not determined from this report.", evidence: emptyEvidence() };
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return { concern: asText(row.concern), why_it_matters: asText(row.why_it_matters), next_step: asText(row.next_step), urgency: asText(row.urgency), evidence: normalizeEvidence(row.evidence) };
  });
  const limitations = asList(source.limitations).map(asText).filter(Boolean);
  const confidence = ["high", "medium", "low"].includes(asText(source.confidence)) ? asText(source.confidence) : "low";
  return { document_type: asText(source.document_type), report_date: asText(source.report_date), plain_language_summary: asText(source.plain_language_summary), clinical_story: asText(source.clinical_story), key_findings: findings, timeline, tests_and_treatments: treatments, concerns_to_discuss: concerns, questions_for_clinician: asList(source.questions_for_clinician).map(asText).filter(Boolean), limitations, confidence };
}

async function extractPdfText(buffer: Buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) return json({ error: "The analysis service is not configured." }, 503);
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "The upload could not be read." }, 400); }
  const file = form.get("report");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Choose a non-empty PDF or TXT report." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Reports must be 4 MB or smaller." }, 413);
  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isText = file.type.startsWith("text/") || name.endsWith(".txt");
  if (!isPdf && !isText) return json({ error: "Only PDF and UTF-8 TXT reports are supported." }, 415);
  let reportText: string;
  try {
    reportText = isPdf
      ? await extractPdfText(Buffer.from(await file.arrayBuffer()))
      : await file.text();
  } catch (error) {
    console.error("Report text extraction failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The report text could not be extracted. Please try another PDF or TXT file." }, 422);
  }
  if (!reportText.trim()) return json({ error: "The report contains no readable text." }, 422);
  reportText = reportText.slice(0, 180_000);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 55_000);
  try {
    const model = process.env.OPENROUTER_MODEL || "liquid/lfm-2.5-2.6b:free";
    let lastStatus = 503;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const attemptController = new AbortController();
        const attemptTimeout = setTimeout(() => attemptController.abort(), OPENROUTER_ATTEMPT_TIMEOUT_MS);
        const signal = AbortSignal.any([controller.signal, attemptController.signal]);
        let response: Response;
        try {
          response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST", headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "https://medsimplify-college-yashrajshs-projects.vercel.app",
              "X-Title": "MedSimplify",
            }, signal,
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: `${instructions}\nReturn only valid JSON using exactly these top-level keys: document_type, report_date, plain_language_summary, clinical_story, key_findings, timeline, tests_and_treatments, concerns_to_discuss, questions_for_clinician, limitations, confidence.` },
                { role: "user", content: `REPORT CONTENT:\n${reportText}` },
              ],
              response_format: { type: "json_object" },
              // OpenRouter's free models may spend the entire completion budget on
              // hidden reasoning unless an explicit low reasoning effort is set.
              reasoning: { effort: "minimal" },
              max_completion_tokens: 4_000,
              temperature: 0.1,
            }),
          });
        } catch (error) {
          clearTimeout(attemptTimeout);
          if (controller.signal.aborted) throw error;
          console.error("OpenRouter attempt timed out", { model, attempt: attempt + 1 });
          lastStatus = 503;
          if (attempt === 1) break;
          await wait(700 * (attempt + 1));
          continue;
        }
        clearTimeout(attemptTimeout);
        if (response.ok) {
          const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const output = data.choices?.[0]?.message?.content?.trim();
          if (!output) return json({ error: "The model returned no usable explanation." }, 502);
          try { return json(normalizeReport(JSON.parse(output))); } catch { return json({ error: "The explanation did not pass structural validation." }, 502); }
        }

        lastStatus = response.status;
        console.error("OpenRouter request failed", { model, status: response.status, attempt: attempt + 1 });
        if (!RETRYABLE_OPENROUTER_STATUSES.has(response.status) || attempt === 1) break;
        await wait(700 * (attempt + 1));
    }

    if (lastStatus === 429) return json({ error: "The OpenRouter free-tier quota is busy. Please retry shortly." }, 429);
    if (RETRYABLE_OPENROUTER_STATUSES.has(lastStatus)) return json({ error: "The free AI service is temporarily busy. Please retry in a minute." }, 503);
    return json({ error: "The configured OpenRouter model is unavailable. Please contact the project owner." }, 502);
  } catch (error) {
    console.error("Report analysis failed", error instanceof Error ? error.message : "unknown error");
    return json({ error: error instanceof DOMException && error.name === "AbortError" ? "Analysis took too long. Please retry." : "The analysis service is temporarily unavailable." }, 504);
  } finally { clearTimeout(timeout); }
}

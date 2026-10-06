"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

type Status = "normal" | "abnormal" | "uncertain" | "historical" | "not_applicable";
type Evidence = { page: number | null; quote: string };
type Finding = { title: string; explanation: string; status: Status; evidence: Evidence };
type TimelineEvent = { date_or_period: string; event: string; why_it_matters: string; evidence: Evidence };
type Treatment = { name: string; purpose: string; documented_result: string; evidence: Evidence };
type Concern = { concern: string; why_it_matters: string; next_step: string; urgency: string; evidence: Evidence };
type Explanation = {
  document_type: string;
  report_date: string;
  plain_language_summary: string;
  clinical_story: string;
  key_findings: Finding[];
  timeline: TimelineEvent[];
  tests_and_treatments: Treatment[];
  concerns_to_discuss: Concern[];
  questions_for_clinician: string[];
  limitations: string[];
  confidence: "high" | "medium" | "low";
};

const stages = ["Checking document", "Reading every page", "Writing explanation", "Verifying evidence"];

function Source({ evidence }: { evidence: Evidence }) {
  return (
    <details className="source">
      <summary>{evidence.page ? `View source · page ${evidence.page}` : "View source excerpt"}</summary>
      <blockquote>“{evidence.quote}”</blockquote>
    </details>
  );
}

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function reportAsText(report: Explanation) {
  const findings = report.key_findings.map((item) => `• ${item.title}: ${item.explanation}`).join("\n");
  const questions = report.questions_for_clinician.map((item) => `• ${item}`).join("\n");
  return `MEDSIMPLIFY EXPLANATION\n\n${report.document_type} · ${report.report_date}\n\nIN BRIEF\n${report.plain_language_summary}\n\nWHAT HAPPENED\n${report.clinical_story}\n\nKEY FINDINGS\n${findings}\n\nQUESTIONS FOR YOUR CLINICIAN\n${questions}\n\nEducational explanation only. Always refer to the original report and a qualified clinician.`;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [stage, setStage] = useState(0);
  const [report, setReport] = useState<Explanation | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (phase !== "processing") return;
    const timer = window.setInterval(() => setStage((current) => Math.min(current + 1, stages.length - 1)), 6500);
    return () => window.clearInterval(timer);
  }, [phase]);

  const acceptFile = (candidate?: File) => {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".pdf") && candidate.type !== "text/plain") {
      setError("Please choose a PDF or TXT report.");
      setPhase("error");
      return;
    }
    if (candidate.size > 4 * 1024 * 1024) {
      setError("This file is larger than the 4 MB Vercel demo limit.");
      setPhase("error");
      return;
    }
    setFile(candidate);
    setReport(null);
    setError("");
    setPhase("idle");
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files[0]);
  };

  const explain = async () => {
    if (!file || !confirmed) return;
    setPhase("processing");
    setStage(0);
    setError("");
    const data = new FormData();
    data.append("report", file);
    try {
      const response = await fetch("/api/explain", { method: "POST", body: data });
      const payload = await response.json() as Explanation & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The report could not be explained.");
      setReport(payload);
      setStage(stages.length - 1);
      setPhase("done");
      window.setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report could not be explained.");
      setPhase("error");
    }
  };

  const reset = () => {
    setFile(null);
    setReport(null);
    setConfirmed(false);
    setPhase("idle");
    if (inputRef.current) inputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main>
      <header className="nav shell">
        <a className="brand" href="#top" aria-label="MedSimplify home">
          <span className="brand-mark">M</span>
          <span>MedSimplify</span>
        </a>
        <span className="demo-pill"><i /> College project · anonymized files only</span>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Medical reports, made understandable</p>
          <h1>Clarity for the words<br />that matter most.</h1>
          <p className="lede">Upload an anonymized medical report. Get a calm, plain-language explanation with every important claim linked back to its source.</p>
          <div className="trust-row">
            <span>✓ Page-level evidence</span>
            <span>✓ No model downloads</span>
            <span>✓ Usually under a minute</span>
          </div>
        </div>

        <div className="upload-card">
          <div className="card-heading">
            <div>
              <span className="step-label">STEP 1 OF 1</span>
              <h2>Choose your report</h2>
            </div>
            <span className="file-type">PDF · TXT</span>
          </div>
          <div
            className={`drop-zone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
            aria-label="Choose a PDF or text medical report"
          >
            <input ref={inputRef} hidden type="file" accept=".pdf,.txt,application/pdf,text/plain" onChange={(event: ChangeEvent<HTMLInputElement>) => acceptFile(event.target.files?.[0])} />
            {file ? (
              <>
                <span className="document-icon">▤</span>
                <div className="file-details"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB · Ready to explain</span></div>
                <button className="remove-file" onClick={(event) => { event.stopPropagation(); reset(); }} aria-label="Remove file">×</button>
              </>
            ) : (
              <>
                <span className="upload-icon">↑</span>
                <strong>Drop your report here</strong>
                <span>or click to browse · up to 4 MB</span>
              </>
            )}
          </div>
          <label className="consent">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I confirm this report is synthetic or fully anonymized and contains no identifying patient information.</span>
          </label>
          <button className="primary" disabled={!file || !confirmed || phase === "processing"} onClick={explain}>
            {phase === "processing" ? "Reading your report…" : "Explain this report"}<span>→</span>
          </button>
          <p className="privacy-note">OpenRouter free-tier processing is used for this educational demo. Your report is sent to the configured model provider for analysis; upload only synthetic or fully anonymized reports.</p>
        </div>
      </section>

      {phase === "processing" && (
        <section className="processing shell" aria-live="polite">
          <div className="pulse" />
          <div className="processing-copy">
            <span>ANALYZING DOCUMENT</span>
            <h2>{stages[stage]}</h2>
            <p>We’re preserving dates, uncertainty, negative findings, and the difference between suspected and confirmed conditions.</p>
          </div>
          <ol className="stage-list">
            {stages.map((item, index) => <li key={item} className={index < stage ? "complete" : index === stage ? "active" : ""}><i>{index < stage ? "✓" : index + 1}</i><span>{item}</span></li>)}
          </ol>
        </section>
      )}

      {phase === "error" && (
        <section className="error-card shell" role="alert"><span>!</span><div><strong>We couldn’t finish this report</strong><p>{error}</p></div><button onClick={() => setPhase("idle")}>Try again</button></section>
      )}

      {phase === "done" && report && (
        <section className="results shell" id="results">
          <div className="result-header">
            <div><p className="eyebrow">Your explanation</p><h2>{report.document_type}</h2><p>{report.report_date} · Source clarity: <strong>{report.confidence}</strong></p></div>
            <div className="actions"><button onClick={() => download("medsimplify-explanation.txt", reportAsText(report), "text/plain")}>↓ Download</button><button onClick={reset}>Explain another</button></div>
          </div>

          <article className="summary-card">
            <span className="section-number">01</span>
            <div><p className="section-kicker">In brief</p><h3>{report.plain_language_summary}</h3></div>
          </article>

          <div className="result-grid">
            <article className="story panel"><span className="section-number">02</span><p className="section-kicker">What happened</p><p>{report.clinical_story}</p></article>
            <article className="questions panel"><span className="section-number">03</span><p className="section-kicker">Questions for your clinician</p><ul>{report.questions_for_clinician.map((question) => <li key={question}>{question}</li>)}</ul></article>
          </div>

          <section className="findings-section">
            <div className="section-heading"><div><span className="section-number">04</span><p className="section-kicker">Key findings</p></div><span>{report.key_findings.length} evidenced items</span></div>
            <div className="finding-list">
              {report.key_findings.map((finding) => (
                <article className="finding" key={`${finding.title}-${finding.evidence.quote}`}>
                  <span className={`status-dot ${finding.status}`} />
                  <div><div className="finding-title"><h3>{finding.title}</h3><span>{finding.status.replace("_", " ")}</span></div><p>{finding.explanation}</p><Source evidence={finding.evidence} /></div>
                </article>
              ))}
            </div>
          </section>

          {report.timeline.length > 0 && (
            <section className="timeline-section">
              <div className="section-heading"><div><span className="section-number">05</span><p className="section-kicker">Timeline</p></div></div>
              <div className="timeline">
                {report.timeline.map((item) => <article key={`${item.date_or_period}-${item.event}`}><time>{item.date_or_period}</time><div><h3>{item.event}</h3><p>{item.why_it_matters}</p><Source evidence={item.evidence} /></div></article>)}
              </div>
            </section>
          )}

          <div className="result-grid lower-grid">
            <section className="panel"><p className="section-kicker">Tests & treatments</p>{report.tests_and_treatments.map((item) => <article className="compact-item" key={item.name}><h3>{item.name}</h3><p><strong>Why:</strong> {item.purpose}</p><p><strong>Result:</strong> {item.documented_result}</p><Source evidence={item.evidence} /></article>)}</section>
            <section className="panel concern-panel"><p className="section-kicker">Points to discuss</p>{report.concerns_to_discuss.length ? report.concerns_to_discuss.map((item) => <article className="compact-item" key={item.concern}><h3>{item.concern}<span>{item.urgency}</span></h3><p>{item.why_it_matters}</p><p><strong>Ask:</strong> {item.next_step}</p><Source evidence={item.evidence} /></article>) : <p>No specific concerns were clearly documented.</p>}</section>
          </div>

          {report.limitations.length > 0 && <details className="limitations"><summary>Source limitations and uncertainty</summary><ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
          <div className="safety-footer"><strong>Keep the original report.</strong><span>This explanation is educational and does not diagnose, prescribe, or replace a qualified clinician.</span></div>
        </section>
      )}

      <footer className="footer shell"><span>MedSimplify · College project</span><span>Built for clarity, not clinical decisions.</span></footer>
    </main>
  );
}

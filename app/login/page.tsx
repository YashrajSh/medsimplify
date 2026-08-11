"use client";

import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), password: data.get("password") }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setError(result.error || "Access denied."); setLoading(false); return; }
    window.location.assign("/");
  }
  return <main className="login-page">
    <section className="login-card">
      <a className="brand login-brand" href="/login"><span className="brand-mark">M</span><span>MedSimplify</span></a>
      <div className="login-copy"><p className="eyebrow">Private college project</p><h1>Welcome back.</h1><p>Enter the approved account details to access the medical-report explainer.</p></div>
      <form onSubmit={submit} className="login-form">
        <label>Email address<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={loading}>{loading ? "Checking access…" : "Continue"}<span>→</span></button>
      </form>
      <p className="login-note">Authorized use only · Sessions expire after 8 hours</p>
    </section>
    <aside className="login-aside"><div><span>01</span><p>Private access</p></div><div><span>02</span><p>Evidence-linked explanations</p></div><div><span>03</span><p>Anonymized reports only</p></div></aside>
  </main>;
}

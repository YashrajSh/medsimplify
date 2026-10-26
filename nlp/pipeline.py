"""Rule-based NLP pipeline that mirrors what app/api/explain/route.ts asks the LLM to do.

It returns the same JSON shape as normalizeReport() in route.ts, so the frontend can
consume it unchanged if the LLM call is ever replaced. Standard library only.

Usage: python3 nlp/pipeline.py report.txt
"""
import json
import re
import sys

# Stage 1: page segmentation. route.ts marks PDF pages as "--- PDF PAGE n ---".
PAGE_MARK = re.compile(r"^--- PDF PAGE (\d+) ---$", re.M)


def split_pages(text):
    parts = PAGE_MARK.split(text)
    if len(parts) == 1:
        return [(None, text)]
    return [(int(parts[i]), parts[i + 1]) for i in range(1, len(parts), 2)]


# Stage 2: sentence segmentation (lines first, since reports are often tabular).
def sentences(pages):
    for page, body in pages:
        for line in body.splitlines():
            for sent in re.split(r"(?<=[.!?])\s+(?=[A-Z])", line.strip()):
                if len(sent) > 2:
                    yield page, sent.strip()


# Stage 3: document classification by keyword voting.
DOC_TYPES = {
    "Blood test report": ["hemoglobin", "wbc", "platelet", "cbc", "rbc", "glucose", "cholesterol"],
    "Imaging report": ["x-ray", "ct scan", "mri", "ultrasound", "impression", "radiograph"],
    "Discharge summary": ["discharge", "admitted", "admission", "hospital course"],
    "Prescription": ["rx", "tablet", "capsule", "once daily", "twice daily"],
}


def classify(text):
    low = text.lower()
    scores = {name: sum(low.count(k) for k in keys) for name, keys in DOC_TYPES.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else "Medical report"


DATE = re.compile(r"\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4})\b")

# Stage 4: negation detection (a tiny NegEx). The LLM is told to preserve negation.
NEGATION = re.compile(r"\b(no|not|denies|negative for|ruled out|without|absence of)\b", re.I)

# Stage 5: lab value extraction: "Hemoglobin 10.2 g/dL (13.0 - 17.0)".
LAB = re.compile(
    r"^(?P<name>[A-Za-z][A-Za-z .()/%-]{1,40}?)\s*[:\-]?\s+(?P<value>\d+(?:\.\d+)?)\s*"
    r"(?P<unit>[a-zA-Z/%µ^0-9.]*)\s*[\[(]?\s*(?P<low>\d+(?:\.\d+)?)\s*[-–]\s*(?P<high>\d+(?:\.\d+)?)"
)

# Stage 6: lexical simplification. shortcut: tiny glossary, swap for a UMLS/scispaCy lookup to cover real reports.
GLOSSARY = {
    "hemoglobin": "the protein in red blood cells that carries oxygen",
    "wbc": "white blood cells, which fight infection",
    "platelet": "cells that help blood clot",
    "glucose": "blood sugar",
    "creatinine": "a waste product that shows how well the kidneys filter",
    "cholesterol": "a fat in the blood linked to heart health",
    "hypertension": "high blood pressure",
    "anemia": "fewer healthy red blood cells than normal",
    "tachycardia": "a faster than normal heartbeat",
    "edema": "swelling caused by fluid",
    "benign": "not cancer",
    "malignant": "cancerous",
    "fracture": "a broken bone",
    "lesion": "an area of abnormal tissue",
}
TREATMENT = re.compile(r"\b(tablet|capsule|injection|mg\b|prescribed|started on|surgery|therapy|biopsy|scan|x-ray|mri|ct)\b", re.I)


def explain_terms(sentence):
    low = sentence.lower()
    notes = [f"{term} means {meaning}" for term, meaning in GLOSSARY.items() if term in low]
    return "; ".join(notes)


def evidence(page, quote):
    return {"page": page, "quote": quote[:200]}


def analyze(text):
    pages = split_pages(text)
    sents = list(sentences(pages))
    findings, timeline, treatments, concerns = [], [], [], []

    for page, sent in sents:
        lab = LAB.match(sent)
        if lab:
            value, low, high = float(lab["value"]), float(lab["low"]), float(lab["high"])
            name = lab["name"].strip()
            status = "normal" if low <= value <= high else "abnormal"
            direction = "" if status == "normal" else (" (lower than normal)" if value < low else " (higher than normal)")
            meaning = explain_terms(name)
            findings.append({
                "title": f"{name}: {lab['value']} {lab['unit']}".strip(),
                "explanation": f"Normal range is {lab['low']} to {lab['high']}{direction}." + (f" {meaning[0].upper()}{meaning[1:]}." if meaning else ""),
                "status": status,
                "evidence": evidence(page, sent),
            })
            if status == "abnormal":
                concerns.append({
                    "concern": f"{name} is outside the reference range{direction}",
                    "why_it_matters": "The report lists this value outside its stated normal range.",
                    "next_step": "Ask the treating clinician what this value means for you.",
                    "urgency": "Not determined from this report.",
                    "evidence": evidence(page, sent),
                })
            continue
        meaning = explain_terms(sent)
        if meaning:
            negated = bool(NEGATION.search(sent))
            findings.append({
                "title": sent[:80],
                "explanation": ("The report says this was not found. " if negated else "") + f"{meaning[0].upper()}{meaning[1:]}.",
                "status": "normal" if negated else "uncertain",
                "evidence": evidence(page, sent),
            })
        date = DATE.search(sent)
        if date:
            timeline.append({"date_or_period": date[0], "event": sent, "why_it_matters": "Documented in the report.", "evidence": evidence(page, sent)})
        if TREATMENT.search(sent):
            treatments.append({"name": sent[:80], "purpose": "Documented in the report.", "documented_result": "Not separately stated.", "evidence": evidence(page, sent)})

    # Stage 7: extractive summary, picking the sentences that carry findings.
    abnormal = [f["title"] for f in findings if f["status"] == "abnormal"]
    doc_type = classify(text)
    summary = f"This looks like a {doc_type.lower()} with {len(findings)} notable item(s)."
    summary += f" Values outside the normal range: {', '.join(abnormal)}." if abnormal else " No values were found outside their stated ranges."

    dates = DATE.findall(text)
    return {
        "document_type": doc_type,
        "report_date": dates[0] if dates else "",
        "plain_language_summary": summary,
        "clinical_story": " ".join(s for _, s in sents[:3]),
        "key_findings": findings,
        "timeline": timeline,
        "tests_and_treatments": treatments,
        "concerns_to_discuss": concerns,
        "questions_for_clinician": [f"What does my {c['concern'].split(' is ')[0]} result mean?" for c in concerns],
        "limitations": ["Generated by a rule-based NLP pipeline, not a language model. It only recognises terms in its glossary and lab lines with a printed reference range."],
        "confidence": "medium" if findings else "low",
    }


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        print(json.dumps(analyze(f.read()), indent=2))

# NLP pipeline (LLM fallback)

A rule-based Python version of what `app/api/explain/route.ts` asks the LLM to do. It returns the same JSON keys as `normalizeReport()`, so the frontend can render its output unchanged. The app does not call it yet.

```bash
python3 nlp/pipeline.py nlp/sample_report.txt
python3 nlp/pipeline.py nlp/sample_plastic_surgery.txt
cd nlp && python3 -m unittest test_pipeline
```

Standard library only, no install needed.

## What each stage replaces

| LLM instruction in route.ts | Pipeline stage |
|---|---|
| Read PDF pages, cite the page | Page segmentation on `--- PDF PAGE n ---` markers |
| Work sentence by sentence, quote the source | Sentence segmentation, verbatim `evidence.quote` |
| Report type and date | Keyword-voting classifier, date regex |
| Preserve negation ("no", "ruled out") | NegEx-style negation cues |
| Findings with values | Lab line extraction (name, value, unit, reference range), normal/abnormal |
| Explain medical terms in everyday language | Glossary-based lexical simplification |
| Chronology | Sentences with dates become timeline events |
| Tests and treatments | Treatment keyword matching |
| Concerns and clinician questions | Generated from out-of-range values |
| Summary | Extractive summary from findings |

## Limits compared to the LLM

- Only knows the terms in `GLOSSARY` and lab lines that print a reference range.
- No reasoning across sentences (for example "suspected" vs "confirmed").
- Upgrade path: spaCy or scispaCy for entity recognition, a UMLS lookup for term definitions, and a summarisation model for `plain_language_summary`.

## Switching the app over

The frontend posts the report to `/api/explain` and expects this JSON. To replace the LLM, serve `analyze(text)` from a Python endpoint (for example a Vercel Python function at `api/explain.py`) and point the frontend there, or call it from `route.ts` in place of the OpenRouter request.

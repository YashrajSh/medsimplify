# MedSimplify

MedSimplify turns anonymized medical reports into calm, plain-language explanations. It is a college-project demo focused on making clinical documents easier to understand without downloading large AI models to the user’s device.

## What it provides

- Upload of PDF or UTF-8 TXT reports up to 4 MB
- Plain-language summary and clinical story
- Key findings, chronology, tests, treatments, and discussion points
- Qualitative confidence and source limitations
- A clear safety boundary: it explains the uploaded document; it does not diagnose or prescribe

## Architecture

```text
Browser (Next.js UI)
        |
        v
Next.js serverless route: /api/explain
        |
        +-- extracts PDF text and preserves page markers
        +-- sends the report to OpenRouter server-side
        +-- normalizes the model response for the UI
        |
        v
OpenRouter free-tier model
```

The API key never reaches the browser. No BioBERT, BART, PyTorch, or multi-gigabyte model download is required for the hosted app.

## Run locally

Prerequisites: Node.js `>=22.13.0`.

```bash
npm install
cp ../.env.example .env.local
# Set OPENROUTER_API_KEY and OPENROUTER_MODEL in .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Required environment variables:

```text
OPENROUTER_API_KEY=your_server_side_key
OPENROUTER_MODEL=liquid/lfm-2.5-2.6b:free
```

For Vercel, add those variables to the Production environment. Never commit `.env`, `.env.local`, or API keys.

## Quality and privacy boundary

This is an educational demonstration. Upload only synthetic or fully anonymized reports. The free model may be rate-limited or slow, and important details should always be checked against the original report and discussed with a qualified clinician.

## Verification

```bash
npm run lint
npm run build
```

## Deployment

The production app is deployed at [medsimplify-college.vercel.app](https://medsimplify-college.vercel.app/). The Next.js page is the frontend; `/api/explain` is the serverless backend.

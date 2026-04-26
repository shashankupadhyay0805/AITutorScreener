# AI Tutor Screener

**AI Tutor Screener** is a full-stack web application for screening tutor candidates through a **voice-first interview**. The AI asks structured, **math-teaching** questions (with one follow-up per question focused on *how* the candidate teaches), records candidate answers, and produces a **structured evaluation** for recruiters. A **password-protected recruiter dashboard** lists sessions, shows transcripts, and surfaces pass/fail outcomes.

---

## What we built and which problem we picked

This repository implements **Problem 3: The AI Tutor Screener** from the project brief (the scenario where a tutoring company hires at volume and today relies on short human phone screens to judge communication, patience, warmth, ability to simplify, and general suitability for working with children).

**Why this problem:** Human-led 10-minute screens do not scale; they are expensive, inconsistent, and hard to schedule. An automated **voice conversation** with **adaptive follow-ups** and a **transparent rubric** addresses the same decision surface—who deserves a human follow-up—without pretending to replace every nuance of a seasoned interviewer. The brief also stresses **candidate experience** (fair, welcoming, professional), which maps directly to product choices in this app: clear entry, visible timer, readable UI with light/dark themes, and a text fallback only when the microphone path genuinely fails.

**What we built in response:**

| Brief expectation | What ships here |
|-------------------|-----------------|
| Short voice interview with the AI asking and listening | React client drives **TTS** for questions and **STT** for answers via the **browser Web Speech API** (no separate Whisper service in this repo; transcripts are sent to the API as text). Optional audio can still be attached for audit/debug paths on the backend. |
| Natural, adaptive flow—not a rigid script | **Interview engine** plus optional **Groq** calls choose the next step: seed scenarios (math explanation / classroom situations), **one follow-up per main question**, and clarifying probes when answers are vague or non-substantive. |
| Assessment beyond pass/fail | Final evaluation returns **dimension scores** (clarity, warmth, simplicity, patience, fluency, professionalism), narrative summary, strengths, improvements, and **evidence quotes** from the transcript where available. |
| Operational view for hiring | **Recruiter dashboard** (password-protected) lists sessions and shows detail with transcript and **PASS/FAIL** derived from explicit rules (including hard fail on inappropriate language). |

The original prompt is explicit that the screen is **not** a deep math olympiad; it uses **teaching vignettes** (for example explaining ideas to a child, or responding when a student is stuck) to surface *how* someone teaches. This implementation leans into that: questions are framed around explanation and pedagogy, with scoring and policies tuned so toxic or evasive sessions cannot “game” high marks.

---

## Project summary

### What problem it solves

Hiring teams need a consistent first-pass signal on tutor quality: clarity, patience, simplicity, warmth, fluency, and professionalism. This app automates a short, timed interview so recruiters can review many candidates without running identical manual screens.

### How it works (candidate flow)

1. **Candidate entry** — Name and email are collected before the interview starts.
2. **Interview session** — Backend creates a MongoDB session and returns the first question (math-first ordering from seed scenarios).
3. **Voice answer** — The browser captures speech (Web Speech API) and sends transcript + optional audio to the backend.
4. **Microphone fallback** — If speech capture fails, a **text answer** path appears (only after failure), so the candidate can still complete the flow.
5. **Adaptive follow-ups** — For each main question, the system asks **one** follow-up (clarifying if the answer is weak; otherwise approach-focused via LLM when configured).
6. **Completion** — After **6 main questions** (with follow-ups between them) or on policy/timeout, the backend finalizes evaluation and marks the session complete.

### How it works (recruiter flow)

1. Recruiter opens the dashboard in the UI and enters the **recruiter password** (sent as `x-recruiter-password` on protected API routes).
2. The dashboard lists recent sessions with status, question counts, toxicity/irrelevance counters, and a **PASS/FAIL remark** derived from evaluation rules.
3. Session detail view shows transcript, violations, and final scores.

### Interview rules (high level)

- **Question count:** **6** main questions (configured in backend `config`).
- **Time limit:** **6 minutes** total interview window (backend enforces timeout; frontend sends `remainingMs` so the timer can pause while the AI is speaking without desyncing completion logic).
- **Pass / fail:** **PASS** only if **every score metric is strictly greater than 5** *and* the candidate completed the required question attendance; otherwise **FAIL**. Inappropriate language forces **FAIL** regardless of other scores.
- **Scoring behavior:** Non-toxic sessions are shaped into realistic bands; toxic sessions are **hard-capped low** so inappropriate interviews cannot receive neutral/high scores.

### Tech stack

| Layer | Technology |
|--------|------------|
| Frontend | React 18, Vite 5, Web Speech API (STT + TTS), CSS theming |
| Backend | Node.js (ESM), Express 4 |
| Database | MongoDB via Mongoose 8 |
| LLM | Groq Chat Completions API (optional; safe degradation if key missing) |

### Repository layout

- **`backend/`** — REST API, session model, interview engine (question progression, policies, live hints, final evaluation), audio upload storage under `uploads/`.
- **`frontend/`** — Candidate interview UI, theme toggle, timer, recruiter dashboard views.

---

## Architecture (conceptual)

```
Browser (Vite/React)
  ├─ Speech capture + optional audio (base64)
  └─ HTTP JSON → Express /api/*

Express
  ├─ Session CRUD (MongoDB)
  ├─ classifyResponse (Groq JSON rubric + rule-based guards)
  ├─ chooseNextStep (seed questions + follow-up policy)
  └─ finalizeSessionEvaluation (Groq JSON evaluation + post-processing)

MongoDB
  └─ Session documents (transcript, violations, evaluation, flags)
```

---

## Local development

### Prerequisites

- Node.js 18+ recommended  
- MongoDB instance (local or Atlas)

### Backend

```bash
cd backend
npm install
```

Create **`backend/.env`** (file is gitignored) with at least:

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | Mongo connection string |
| `GROQ_API_KEY` | No | Enables LLM classification / questions / final eval |
| `GROQ_MODEL` | No | Defaults to `llama-3.1-8b-instant` |
| `RECRUITER_PASSWORD` | No | Protects recruiter routes (default exists in code for dev only) |
| `PORT` | No | Defaults to `5000` locally; Render injects `PORT` |

Start:

```bash
npm run dev
```

API base: `http://localhost:5000` — routes are mounted under **`/api`**.

### Frontend

```bash
cd frontend
npm install
```

Create **`frontend/.env`** (or Vercel env) with:

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE_URL` | Must include `/api`, e.g. `http://localhost:5000/api` |

Start:

```bash
npm run dev
```

### Optional: background image

The UI references **`/bg-image.png`**. Place your asset at:

- `frontend/public/bg-image.png`

Then rebuild / redeploy the frontend.

---

## API reference

All JSON routes below are prefixed with **`/api`** (e.g. `POST /api/start-session`).

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/start-session` | Public | Create session; returns `sessionId`, first question |
| `POST` | `/process-response` | Public | Submit answer; returns next question, follow-up, or completion + evaluation |
| `GET` | `/evaluation/:sessionId` | Public | Fetch evaluation for a **completed** session |
| `GET` | `/sessions` | Recruiter header | List sessions for dashboard |
| `GET` | `/sessions/:sessionId` | Recruiter header | Session detail (transcript, evaluation, etc.) |

**Recruiter authentication:** send header:

```http
x-recruiter-password: <your RECRUITER_PASSWORD>
```

`process-response` accepts optional **`remainingMs`** (milliseconds left on client timer) so server timeout aligns with paused UI timers.

---

## Interview engine (behavioral overview)

1. **Start session** — Persists candidate, initializes scores, stores transcript with first assistant question.
2. **Classify response** — Rule-based guards (silence, toxicity, very short answers) plus optional Groq JSON classification.
3. **Policy layer** — Handles re-asks, toxicity escalation, early termination on repeated abuse.
4. **Next step** — Chooses follow-up vs next seed question; avoids repeating prior assistant prompts where possible.
5. **Live hints** — Returns rolling `evaluation.scores` + risk counters for UI display.
6. **Finalize** — Groq produces structured JSON evaluation; server applies business rules (pass/fail, toxic caps, attendance note).

---

## Deployment (Render + Vercel)

### Backend (Render)

- **Root directory:** `backend`
- **Build:** `npm install`
- **Start:** `npm start`
- Set the same env vars as local (`MONGODB_URI`, `GROQ_API_KEY`, `RECRUITER_PASSWORD`, etc.)

Health check URL pattern:

- `https://<your-service>.onrender.com/health`

### Frontend (Vercel)

- **Root directory:** `frontend`
- **Framework:** Vite  
- **Build:** `npm run build`  
- **Output:** `dist`

Critical env var:

- `VITE_API_BASE_URL=https://<your-render-service>.onrender.com/api`

**Common mistake:** pointing `VITE_API_BASE_URL` at the domain **without** `/api` causes HTML 404 responses and JSON parse errors in the browser.

---

## Security & production notes

- **Rotate** `RECRUITER_PASSWORD` for production; never ship default passwords publicly.
- **CORS** is currently permissive (`cors()` default). For production hardening, restrict origins to your Vercel domain.
- **Rate limiting** and **audit logs** are not included yet; add before high-traffic use.
- **Audio uploads** are stored on the Render filesystem by default — ephemeral on free tiers. For durable storage, integrate S3-compatible object storage.

---

## Strict evaluation output shape

Final evaluation JSON (conceptually) includes scores, narrative summary, strengths, improvements, evidence quotes, `flagged`, and `result` (`pass` | `fail` | `pending`) as produced by the backend pipeline.

---

## Roadmap ideas

- JWT or session-based recruiter auth instead of shared password header  
- Object storage for audio artifacts  
- Automated tests (API integration + Playwright E2E)  
- Per-tenant branding and configurable rubric weights  

---

## License

Add your preferred license here if you open-source the repo.

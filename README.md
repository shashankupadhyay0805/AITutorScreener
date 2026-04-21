# AI Tutor Screener

Production-oriented full-stack application for running voice-based tutor interviews and generating structured soft-skill assessments.

## Stack

- Frontend: React + Vite + Web Speech API (STT + TTS)
- Backend: Node.js + Express
- Database: MongoDB (Mongoose)
- LLM: Groq API (with safe fallback when API key is missing)

## Folder Structure

- `backend/`: API, interview state machine, session persistence, evaluation
- `frontend/`: voice interview UI, live transcript, speaking indicator, evaluation dashboard

## Backend Setup

1. Install dependencies:
   - `cd backend`
   - `npm install`
2. Configure env:
   - copy `.env.example` to `.env`
   - set `MONGODB_URI`, `GROQ_API_KEY`, and optional `GROQ_MODEL`
3. Start server:
   - `npm run dev`

Backend runs on `http://localhost:5000`.

## Frontend Setup

1. Install dependencies:
   - `cd frontend`
   - `npm install`
2. Configure env:
   - copy `.env.example` to `.env`
3. Start app:
   - `npm run dev`

Frontend runs on Vite default port and calls backend at `VITE_API_BASE_URL`.

## API Endpoints

- `POST /api/start-session`
  - starts interview session and returns first AI question
- `POST /api/process-response`
  - processes transcript, handles edge cases, returns follow-up/next question, or completion
- `GET /api/evaluation/:sessionId`
  - returns final structured assessment after session completion
- `GET /api/sessions`
  - recruiter dashboard feed with latest sessions and risk flags

## State Machine

1. Start session
2. AI asks question
3. Candidate answers via mic
4. Speech-to-text transcript sent to backend
5. Response classified (quality, irrelevance, toxicity, confidence)
6. Adaptive follow-up or next question generated
7. Repeat for 3-5 questions
8. End session
9. Generate final evaluation JSON

## Mandatory Edge Cases Implemented

- One-word / short answers -> asks for elaboration
- Off-topic / nonsense answers -> warning, redirect, penalty tracking
- Silence/no response -> timeout handling with retries
- Low transcription confidence -> asks candidate to repeat
- Fast/unclear speech proxy -> clarity/simplicity penalties from coherence classification
- Nervous candidate protection -> gentle early behavior and moderated scoring prompt
- Toxic language -> low/medium/high severity with escalating policy
- Repeated irrelevance -> tracked via `irrelevantCount`, penalized

## Example LLM Prompt Themes

- \"Explain fractions to a 9-year-old.\"
- \"A student is stuck for 5 minutes; what do you do?\"
- \"How do you adapt when a learner is losing confidence?\"

## Strict Evaluation Output Format

```json
{
  "scores": {
    "clarity": 8,
    "patience": 9,
    "simplicity": 8,
    "warmth": 8,
    "fluency": 7,
    "professionalism": 9
  },
  "summary": "The candidate shows strong empathy and structured explanations with mostly clear communication.",
  "strengths": [
    "Explains concepts in child-friendly language",
    "Uses calm and supportive reinforcement"
  ],
  "improvements": [
    "Could tighten answer structure under pressure",
    "Provide more concrete progress-check techniques"
  ],
  "evidence": [
    {
      "quote": "I would break fractions into pizza slices first.",
      "reason": "Demonstrates simplicity and age-appropriate teaching."
    }
  ],
  "flagged": false
}
```

## Notes for Production

- Add auth for recruiter-only access
- Add background job queue for analytics
- Add rate limits and audit logs
- Add automated tests (unit + integration + E2E)

## Included Bonus Features

- Real-time scoring hints (live score/risk signals returned by backend)
- Recruiter dashboard (session overview table in frontend + API feed)
- Candidate response audio playback in interview UI

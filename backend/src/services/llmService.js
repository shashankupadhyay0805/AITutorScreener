import { config } from "../config.js";
import { interviewerSystemPrompt, seedQuestions } from "../prompts/interviewerPrompts.js";

const emptyEvaluation = {
  scores: {
    clarity: 5,
    patience: 5,
    simplicity: 5,
    warmth: 5,
    fluency: 5,
    professionalism: 5
  },
  summary: "Evaluation unavailable.",
  strengths: [],
  improvements: [],
  evidence: [],
  flagged: false
};

const hasGroqConfig = Boolean(config.groqApiKey && config.groqModel);

const generateText = async (prompt) => {
  if (!hasGroqConfig) {
    return "";
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groqApiKey}`
      },
      body: JSON.stringify({
        model: config.groqModel,
        temperature: 0.3,
        messages: [
          { role: "system", content: interviewerSystemPrompt },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`${response.status} ${response.statusText} ${details}`.trim());
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "";
  } catch (error) {
    // Keep interview flow alive when model/key is invalid or API is unavailable.
    console.warn("Groq request failed, using fallback behavior:", error?.message || error);
    return "";
  }
};

const toJson = (text, fallback) => {
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    return fallback;
  }
};

const clampScore = (value) => Math.max(0, Math.min(10, Number(value) || 5));

export const classifyResponse = async ({ session, responseText, confidence }) => {
  const normalizedText = (responseText || "").trim().toLowerCase();

  if (!responseText || responseText.trim().length === 0) {
    return {
      quality: "silence",
      irrelevant: false,
      toxicity: "none",
      guidance: "I couldn't hear that. Please try again with a short clear answer."
    };
  }

  // Rule-based toxicity catches short abusive replies like "idiot" before length checks.
  const toxicPattern =
    /\b(idiot|stupid|dumb|moron|shut up|hate you|kill you|punish you|abuse|bastard|fool)\b/i;
  if (toxicPattern.test(normalizedText)) {
    return {
      quality: "good",
      irrelevant: false,
      toxicity: "medium",
      guidance: "Please keep your language respectful and professional."
    };
  }

  if (responseText.trim().split(/\s+/).length <= 2) {
    return {
      quality: "too_short",
      irrelevant: false,
      toxicity: "none",
      guidance: "Thanks. Could you expand a bit with a concrete example?"
    };
  }

  // Some browsers report 0 confidence even for clear speech; treat non-positive values as unknown.
  const normalizedConfidence = typeof confidence === "number" && confidence > 0 ? confidence : 1;

  if (normalizedConfidence < 0.45) {
    return {
      quality: "low_confidence_transcript",
      irrelevant: false,
      toxicity: "none",
      guidance: "I may have misheard that. Could you repeat clearly in one or two sentences?"
    };
  }

  if (!hasGroqConfig) {
    return {
      quality: "good",
      irrelevant: false,
      toxicity: "none",
      guidance: ""
    };
  }

  const rubricPrompt = `
Classify this candidate response in context.
Return strict JSON:
{
  "quality": "good|too_short|off_topic|unclear|nonsense",
  "irrelevant": boolean,
  "toxicity": "none|low|medium|high",
  "guidance": "one short interviewer sentence"
}

Current question: ${session.currentQuestion}
Response: ${responseText}
`;

  const text = await generateText(rubricPrompt);
  const parsed = toJson(text, {
    quality: "good",
    irrelevant: false,
    toxicity: "none",
    guidance: ""
  });

  return {
    quality: parsed.quality || "good",
    irrelevant: Boolean(parsed.irrelevant),
    toxicity: parsed.toxicity || "none",
    guidance: parsed.guidance || ""
  };
};

export const generateNextQuestion = async ({ session, latestResponse }) => {
  if (!hasGroqConfig) {
    const idx = Math.min(session.questionCount, seedQuestions.length - 1);
    return seedQuestions[idx];
  }

  const prompt = `
You are interviewing a tutor candidate.
Session so far:\n${session.transcript.map((t) => `${t.role}: ${t.text}`).join("\n")}

Latest candidate response: ${latestResponse}

Generate ONE next interviewer question.
It should be adaptive, concise, warm, and math-tutoring focused.
Prefer a targeted follow-up on the same topic before switching topics.
Your follow-up should probe one or more of:
- clarity (can the candidate explain simply and correctly),
- patience (how they respond to confusion),
- simplicity (age-appropriate language),
- warmth (encouraging tone),
- fluency (structured, coherent explanation),
- professionalism (respectful and appropriate communication).
If the previous answer was weak, ask a clarifying follow-up question that helps the candidate improve.
Avoid repeating prior wording.
`;

  const text = await generateText(prompt);
  return (text || "Could you walk me through your teaching approach in a tough moment?").trim();
};

export const generateFinalEvaluation = async ({ session }) => {
  if (!hasGroqConfig) {
    const fallback = { ...emptyEvaluation };
    fallback.summary = "Candidate showed baseline communication, but full AI scoring requires API configuration.";
    fallback.flagged = session.toxicCount > 0;
    return fallback;
  }

  const evalPrompt = `
Evaluate this tutor interview transcript.
Use scores 1-10 for clarity, patience, simplicity, warmth, fluency, professionalism.
Professionalism penalties:
- low toxicity: -1
- medium toxicity: -2
- high toxicity: -4
- additional penalty for repeated violations

Consider candidate nervousness early in interview and avoid harsh early penalties.
Reward clear improvement and consistently good answers with higher scores.
Do not over-penalize a single short or slightly unclear response.

Return STRICT JSON in this exact format:
{
  "scores": {
    "clarity": number,
    "patience": number,
    "simplicity": number,
    "warmth": number,
    "fluency": number,
    "professionalism": number
  },
  "summary": "overall evaluation",
  "strengths": ["..."],
  "improvements": ["..."],
  "evidence": [
    {
      "quote": "...",
      "reason": "..."
    }
  ],
  "flagged": boolean
}

Interview transcript:
${session.transcript.map((entry) => `${entry.role}: ${entry.text}`).join("\n")}

Violation counts:
- toxicCount: ${session.toxicCount}
- irrelevantCount: ${session.irrelevantCount}
`;

  const text = await generateText(evalPrompt);
  const parsed = toJson(text || "", emptyEvaluation);
  const scores = parsed.scores || emptyEvaluation.scores;

  return {
    scores: {
      clarity: clampScore(scores.clarity),
      patience: clampScore(scores.patience),
      simplicity: clampScore(scores.simplicity),
      warmth: clampScore(scores.warmth),
      fluency: clampScore(scores.fluency),
      professionalism: clampScore(scores.professionalism)
    },
    summary: parsed.summary || emptyEvaluation.summary,
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6) : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 6) : [],
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence.slice(0, 8) : [],
    flagged: Boolean(parsed.flagged)
  };
};

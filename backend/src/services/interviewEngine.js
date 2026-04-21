import { config } from "../config.js";
import { seedQuestions } from "../prompts/interviewerPrompts.js";
import { generateFinalEvaluation, generateNextQuestion } from "./llmService.js";

const toxicityPenaltyMap = {
  low: 1,
  medium: 2,
  high: 4,
  none: 0
};

const clamp = (value) => Math.max(0, Math.min(10, value));
const inappropriateWordPattern =
  /\b(idiot|stupid|dumb|moron|fool|bastard|abuse|hate|shut up|punish)\b/gi;

const countInappropriateWords = (text = "") => {
  const matches = text.toLowerCase().match(inappropriateWordPattern);
  return matches ? matches.length : 0;
};

const applyProfessionalismPenalty = (session, severity) => {
  const penalty = toxicityPenaltyMap[severity] || 0;
  if (!penalty) {
    return;
  }

  const repeatPenalty = session.toxicCount >= 2 ? 1 : 0;
  session.evaluation.scores.professionalism = clamp(
    session.evaluation.scores.professionalism - penalty - repeatPenalty
  );
};

const applyBaselineOutcomeSummary = (session, toxicWordCount) => {
  const scores = session.evaluation?.scores || {};
  const metricNames = ["clarity", "patience", "simplicity", "warmth", "fluency", "professionalism"];
  const allAboveBaseline = metricNames.every((name) => Number(scores[name]) > 5);
  const requiredQuestions = Math.max(config.minQuestions, Number(session.maxQuestions) || 0);
  const attendedAllQuestions = Number(session.questionCount) >= requiredQuestions;
  const attendanceNote = attendedAllQuestions ? "" : " Candidate did not attend all the questions.";

  if (toxicWordCount > 0 || session.toxicCount > 0) {
    session.evaluation.summary =
      `Candidate used inappropriate language. Regardless of other scores, the candidate did not pass the interview baseline.${attendanceNote}`;
    session.evaluation.flagged = true;
    session.evaluation.result = "fail";
    return;
  }

  if (allAboveBaseline && attendedAllQuestions) {
    session.evaluation.summary =
      "Candidate scored above the baseline of 5 in each metric and has passed the interview.";
    session.evaluation.result = "pass";
    return;
  }

  session.evaluation.summary =
    `Candidate scored below the baseline of 5 in one or more metrics and did not pass the interview.${attendanceNote}`;
  session.evaluation.result = "fail";
};

const mapIntoBand = (value, minBand, maxBand) => {
  const numeric = Number(value) || 0;
  if (numeric <= 5) {
    return clamp(numeric);
  }
  const normalized = (Math.min(9, numeric) - 5) / 4;
  return clamp(minBand + normalized * (maxBand - minBand));
};

const applyMetricVariation = (scores, minBand, maxBand) => {
  const offsets = {
    clarity: 0.28,
    patience: 0.1,
    simplicity: -0.2,
    warmth: 0.16,
    fluency: -0.12,
    professionalism: 0.06
  };
  Object.entries(offsets).forEach(([metric, offset]) => {
    const next = clamp(Number(scores[metric]) + offset);
    scores[metric] = clamp(Math.min(maxBand, Math.max(minBand, next)));
  });
};

const needsClarification = ({ quality, irrelevant }) => {
  if (irrelevant) {
    return true;
  }
  return ["too_short", "unclear", "off_topic", "nonsense", "low_confidence_transcript"].includes(String(quality));
};

const buildClarifyingFollowUp = (question, latestResponse) => {
  const shortResponse = (latestResponse || "").trim() || "your previous response";
  return `You said "${shortResponse}". Please answer "${question}" more clearly with one concrete example, what you would say first to the student, and 2-3 teaching steps.`;
};

const rebalanceFinalScores = (session) => {
  const candidateAnswers = session.transcript.filter((entry) => entry.role === "candidate" && entry.text?.trim());
  const avgWords =
    candidateAnswers.length > 0
      ? candidateAnswers.reduce((sum, entry) => sum + entry.text.trim().split(/\s+/).length, 0) / candidateAnswers.length
      : 0;
  const effectiveQuestionCount = Number(session.questionCount) || 0;
  const enoughCoverageForExcellent = candidateAnswers.length >= Math.max(4, Math.floor(effectiveQuestionCount * 0.8));
  const enoughCoverageForPerfect = candidateAnswers.length >= Math.max(6, Math.floor(effectiveQuestionCount * 0.9));
  const hasNoViolations = session.toxicCount === 0 && session.irrelevantCount === 0;
  const perfectCandidate = hasNoViolations && enoughCoverageForPerfect && avgWords >= 26;
  const excellentCandidate =
    hasNoViolations &&
    enoughCoverageForExcellent &&
    avgWords >= 22;

  const targetMin = perfectCandidate ? 8.4 : excellentCandidate ? 7.9 : 7.1;
  const targetMax = perfectCandidate ? 9 : excellentCandidate ? 8.1 : 8;
  const metricNames = ["clarity", "patience", "simplicity", "warmth", "fluency", "professionalism"];
  metricNames.forEach((name) => {
    session.evaluation.scores[name] = mapIntoBand(session.evaluation.scores[name], targetMin, targetMax);
  });
  applyMetricVariation(session.evaluation.scores, targetMin, targetMax);
};

const rebalanceLiveScores = (session) => {
  const candidateAnswers = session.transcript.filter((entry) => entry.role === "candidate" && entry.text?.trim());
  const avgWords =
    candidateAnswers.length > 0
      ? candidateAnswers.reduce((sum, entry) => sum + entry.text.trim().split(/\s+/).length, 0) / candidateAnswers.length
      : 0;
  const answeredCount = candidateAnswers.length;

  const perfectCandidate = session.toxicCount === 0 && session.irrelevantCount === 0 && answeredCount >= 6 && avgWords >= 26;
  const excellentCandidate =
    session.toxicCount === 0 && session.irrelevantCount === 0 && answeredCount >= 3 && avgWords >= 21;
  const decentCandidate =
    session.toxicCount === 0 && session.irrelevantCount <= 1 && answeredCount >= 1 && avgWords >= 14;

  const band = perfectCandidate ? [8.4, 9] : excellentCandidate ? [7.9, 8.1] : decentCandidate ? [7.1, 8] : [6, 6.9];
  const metricNames = ["clarity", "patience", "simplicity", "warmth", "fluency", "professionalism"];
  metricNames.forEach((name) => {
    session.evaluation.scores[name] = mapIntoBand(session.evaluation.scores[name], band[0], band[1]);
  });
  applyMetricVariation(session.evaluation.scores, band[0], band[1]);
};

const rewardGoodResponse = (session) => {
  const bonusMap = {
    clarity: 0.24,
    simplicity: 0.24,
    fluency: 0.22,
    patience: 0.2,
    warmth: 0.2,
    professionalism: 0.2
  };

  Object.entries(bonusMap).forEach(([category, bonus]) => {
    session.evaluation.scores[category] = clamp(Math.min(9, session.evaluation.scores[category] + bonus));
  });
};

const applyParticipationProgress = (session) => {
  const categories = ["clarity", "patience", "simplicity", "warmth", "fluency", "professionalism"];
  categories.forEach((category) => {
    session.evaluation.scores[category] = clamp(Math.min(9, session.evaluation.scores[category] + 0.05));
  });
};

const firstFollowUpPromptBuilders = [
  (question) =>
    `Please try that again for "${question}" in 3 short steps using simple language for a 9-year-old.`,
  (question) =>
    `Could you re-answer "${question}" with one real-life example and explain each step slowly?`,
  (question) =>
    `Please give a clearer answer to "${question}" using child-friendly words and one quick check question.`,
  (question) =>
    `Let's retry "${question}" with a calm, encouraging explanation and one common mistake to avoid.`
];

const pickFirstFollowUpPrompt = (session) => {
  const question = session.currentQuestion || "the question";
  const options = firstFollowUpPromptBuilders.map((build) => build(question));
  const seed = (session.questionCount * 31 + session.followUpCountForCurrentQuestion * 17) % options.length;
  return options[seed];
};

const normalizeQuestion = (text = "") =>
  text
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const getAskedAssistantQuestionSet = (session) => {
  const asked = (session.transcript || [])
    .filter((entry) => entry.role === "assistant")
    .map((entry) => normalizeQuestion(entry.text))
    .filter(Boolean);
  return new Set(asked);
};

const getNextSeedQuestion = (session) => {
  const askedQuestions = getAskedAssistantQuestionSet(session);
  const order = Array.isArray(session.seedQuestionOrder) ? session.seedQuestionOrder : [];
  if (!order.length) {
    const unseenFallback = seedQuestions.find((question) => !askedQuestions.has(normalizeQuestion(question)));
    return unseenFallback || seedQuestions[session.questionCount] || seedQuestions[seedQuestions.length - 1];
  }

  const cursor = Number(session.seedQuestionCursor) || 0;
  for (let i = cursor; i < order.length; i += 1) {
    const idx = order[i];
    const candidate = seedQuestions[idx];
    if (candidate && !askedQuestions.has(normalizeQuestion(candidate))) {
      return candidate;
    }
  }

  const unseenAny = seedQuestions.find((question) => !askedQuestions.has(normalizeQuestion(question)));
  if (unseenAny) {
    return unseenAny;
  }

  const nextIdx = order[cursor];
  if (typeof nextIdx !== "number") {
    return seedQuestions[order[order.length - 1]];
  }
  return seedQuestions[nextIdx];
};

export const buildPolicyReply = ({ quality, toxicity, session, guidance }) => {
  if (quality === "silence") {
    if (session.silenceRetries < config.maxSilenceRetries) {
      return {
        shouldReask: true,
        message: "I didn't catch that. Please answer when you're ready."
      };
    }

    return {
      shouldReask: false,
      message: "No problem, let's continue."
    };
  }

  if (quality === "too_short") {
    return {
      shouldReask: true,
      message: guidance || "Could you share a bit more detail so I can understand your approach?"
    };
  }

  if (quality === "low_confidence_transcript") {
    return {
      shouldReask: true,
      message: guidance || "Could you repeat that slowly and clearly?"
    };
  }

  if (toxicity !== "none") {
    if (session.toxicCount === 1) {
      return {
        shouldReask: true,
        terminateInterview: false,
        message: "Let's keep this respectful and professional. Could you answer again?"
      };
    }

    if (session.toxicCount === 2) {
      return {
        shouldReask: true,
        terminateInterview: false,
        message: "This is a formal interview. Please keep your language professional."
      };
    }

    return {
      shouldReask: false,
      terminateInterview: true,
      message: "This interview is now closed due to repeated inappropriate responses after two warnings."
    };
  }

  return {
    shouldReask: false,
    terminateInterview: false,
    message: guidance || ""
  };
};

export const chooseNextStep = async ({ session, latestResponse, quality, irrelevant }) => {
  const effectiveMaxQuestions = Math.max(config.minQuestions, Number(session.maxQuestions) || 0);
  session.maxQuestions = effectiveMaxQuestions;
  const reachedLimit = session.questionCount >= effectiveMaxQuestions;
  const currentFollowUpCount = Number(session.followUpCountForCurrentQuestion || 0);
  const maxFollowUpsPerQuestion = 1;
  const requiresClarification = needsClarification({
    quality,
    irrelevant
  });

  if (reachedLimit) {
    return { endInterview: true, nextQuestion: "" };
  }

  // Ask exactly one follow-up per main question. If answer is weak/unclear,
  // make that follow-up a direct clarification before moving on.
  if (currentFollowUpCount < maxFollowUpsPerQuestion) {
    const followUp = requiresClarification
      ? buildClarifyingFollowUp(session.currentQuestion || "the question", latestResponse)
      : await generateNextQuestion({
          session,
          latestResponse
        });

    return {
      endInterview: false,
      nextQuestion: followUp,
      countsAsQuestion: false,
      nextFollowUpCount: currentFollowUpCount + 1
    };
  }

  return {
    endInterview: false,
    nextQuestion: getNextSeedQuestion(session),
    countsAsQuestion: true,
    nextFollowUpCount: 0
  };
};

export const finalizeSessionEvaluation = async (session) => {
  const llmEvaluation = await generateFinalEvaluation({ session });
  session.evaluation = llmEvaluation;

  // Inappropriate language impacts professionalism, but should not drag all other metrics.
  const toxicWordCount = session.transcript
    .filter((entry) => entry.role === "candidate")
    .reduce((total, entry) => total + countInappropriateWords(entry.text), 0);

  const candidateResponses = session.transcript.filter((entry) => entry.role === "candidate" && entry.text?.trim()).length;
  if (toxicWordCount === 0 && session.toxicCount === 0) {
    session.evaluation.scores.professionalism = clamp(Math.max(7.2, Number(session.evaluation.scores.professionalism) || 7.2));
    if (candidateResponses >= 1) {
      session.evaluation.scores.fluency = clamp(Math.max(7.0, Number(session.evaluation.scores.fluency) || 7.0));
    }
  }

  rebalanceFinalScores(session);
  session.evaluation.flagged = session.toxicCount > 0 || toxicWordCount > 0;
  applyBaselineOutcomeSummary(session, toxicWordCount);

  session.status = "completed";
  return session;
};

export const registerBehaviorSignals = ({ session, quality, toxicity, irrelevant, responseText }) => {
  if (quality === "silence") {
    session.silenceRetries += 1;
    session.violations.push({
      type: "silence",
      severity: "none",
      note: "No spoken response detected before timeout."
    });
  } else {
    session.silenceRetries = 0;
  }

  if (irrelevant || quality === "off_topic" || quality === "nonsense") {
    session.irrelevantCount += 1;
    session.violations.push({
      type: "irrelevance",
      severity: "none",
      note: "Response appears unrelated or low relevance."
    });
  }

  if (toxicity !== "none") {
    const toxicWordCount = countInappropriateWords(responseText);
    session.toxicCount += 1;
    session.violations.push({
      type: "toxicity",
      severity: toxicity,
      note: "Inappropriate or disrespectful language detected."
    });
    applyProfessionalismPenalty(session, toxicity);
    return;
  }

  // Keep scores moving on each non-toxic spoken answer.
  if (quality !== "silence") {
    applyParticipationProgress(session);
  }

  if (quality === "good" && !irrelevant) {
    rewardGoodResponse(session);
  }

  // Keep real-time hints in a realistic band:
  // ~6 for average, 7-8 decent, 8-9 excellent.
  rebalanceLiveScores(session);
};

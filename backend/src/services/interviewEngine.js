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

const applyCrossCategoryToxicityPenalty = (scores, toxicWordCount) => {
  if (!toxicWordCount) {
    return;
  }

  const deduction = toxicWordCount * 0.5;
  const categories = ["clarity", "patience", "simplicity", "warmth", "fluency"];
  categories.forEach((category) => {
    scores[category] = clamp(Number(scores[category]) - deduction);
  });
};

const rewardGoodResponse = (session) => {
  const bonusMap = {
    clarity: 0.8,
    simplicity: 0.8,
    fluency: 0.7,
    patience: 0.6,
    warmth: 0.6,
    professionalism: 0.6
  };

  Object.entries(bonusMap).forEach(([category, bonus]) => {
    session.evaluation.scores[category] = clamp(session.evaluation.scores[category] + bonus);
  });
};

const applyParticipationProgress = (session) => {
  const categories = ["clarity", "patience", "simplicity", "warmth", "fluency", "professionalism"];
  categories.forEach((category) => {
    session.evaluation.scores[category] = clamp(session.evaluation.scores[category] + 0.1);
  });
};

const firstFollowUpPrompts = [
  "Please explain the solution clearly, step by step, in simple words as if you are teaching a 9-year-old.",
  "Can you try again using a very simple real-life example and explain each step slowly?",
  "Please break your explanation into 3 clear steps and say why each step helps the student understand.",
  "Could you answer again in child-friendly language and include one quick check question for the student?"
];

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

export const chooseNextStep = async ({ session, latestResponse, quality, toxicity, irrelevant }) => {
  const requiredCoreMathQuestions = Math.min(4, seedQuestions.length);
  const hasAskedRequiredCoreQuestions = session.questionCount >= requiredCoreMathQuestions;
  const reachedLimit = session.questionCount >= session.maxQuestions;
  const reachedMinimum = session.questionCount >= config.minQuestions;
  const currentFollowUpCount = Number(session.followUpCountForCurrentQuestion || 0);
  const maxFollowUpsPerQuestion = 3;

  if (reachedLimit) {
    return { endInterview: true, nextQuestion: "" };
  }

  // Force 3-4 core math scenarios before adaptive follow-ups.
  if (!hasAskedRequiredCoreQuestions) {
    const answeredWell = quality === "good" && !irrelevant && toxicity === "none";

    if (!answeredWell && currentFollowUpCount < maxFollowUpsPerQuestion) {
      if (currentFollowUpCount === 0) {
        const promptIndex = Math.max(0, (session.questionCount - 1) % firstFollowUpPrompts.length);
        return {
          endInterview: false,
          nextQuestion: firstFollowUpPrompts[promptIndex],
          countsAsQuestion: false,
          nextFollowUpCount: 1
        };
      }

      const followUp = await generateNextQuestion({
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

    // Either answered well, or we already asked max follow-ups and should proceed.
    return {
      endInterview: false,
      nextQuestion: seedQuestions[session.questionCount],
      countsAsQuestion: true,
      nextFollowUpCount: 0
    };
  }

  if (reachedMinimum && quality === "good" && !irrelevant && toxicity === "none") {
    const concise = latestResponse.trim().split(/\s+/).length > 25;
    if (!concise || session.questionCount >= config.maxQuestions - 1) {
      return { endInterview: true, nextQuestion: "" };
    }
  }

  const nextQuestion = await generateNextQuestion({
    session,
    latestResponse
  });

  return {
    endInterview: false,
    nextQuestion,
    countsAsQuestion: true,
    nextFollowUpCount: 0
  };
};

export const finalizeSessionEvaluation = async (session) => {
  const llmEvaluation = await generateFinalEvaluation({ session });
  session.evaluation = llmEvaluation;

  // Keep final scores aligned with policy: deduct 0.5 per inappropriate word
  // across non-professionalism dimensions.
  const toxicWordCount = session.transcript
    .filter((entry) => entry.role === "candidate")
    .reduce((total, entry) => total + countInappropriateWords(entry.text), 0);
  applyCrossCategoryToxicityPenalty(session.evaluation.scores, toxicWordCount);
  session.evaluation.flagged = session.toxicCount > 0 || toxicWordCount > 0;

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
    applyCrossCategoryToxicityPenalty(session.evaluation.scores, toxicWordCount || 1);
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
};

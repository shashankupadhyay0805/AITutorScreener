import { Session } from "../models/Session.js";
import { config } from "../config.js";
import { seedQuestions } from "../prompts/interviewerPrompts.js";
import { classifyResponse } from "../services/llmService.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildPolicyReply,
  chooseNextStep,
  finalizeSessionEvaluation,
  registerBehaviorSignals
} from "../services/interviewEngine.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, "../../uploads");

const saveCandidateAudio = async ({ sessionId, audioBase64 }) => {
  if (!audioBase64 || typeof audioBase64 !== "string") {
    return "";
  }

  const base64Body = audioBase64.includes(",") ? audioBase64.split(",")[1] : audioBase64;
  if (!base64Body) {
    return "";
  }

  const buffer = Buffer.from(base64Body, "base64");
  if (!buffer.length) {
    return "";
  }

  await fs.mkdir(uploadsDir, { recursive: true });
  const fileName = `${sessionId}-${Date.now()}.webm`;
  const filePath = path.join(uploadsDir, fileName);
  await fs.writeFile(filePath, buffer);
  return `/uploads/${fileName}`;
};

export const startSession = async (req, res, next) => {
  try {
    const name = (req.body?.name || "").trim();
    const email = (req.body?.email || "").trim().toLowerCase();

    if (!name) {
      return res.status(400).json({ error: "Candidate name is required." });
    }

    if (!email) {
      return res.status(400).json({ error: "Candidate email is required." });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email address." });
    }

    const firstQuestion = seedQuestions[0];
    const session = await Session.create({
      candidate: { name, email },
      questionCount: 1,
      maxQuestions: 5,
      followUpCountForCurrentQuestion: 0,
      currentQuestion: firstQuestion,
      transcript: [{ role: "assistant", text: firstQuestion }]
    });

    res.status(201).json({
      sessionId: session.id,
      question: firstQuestion,
      questionCount: session.questionCount,
      status: session.status
    });
  } catch (error) {
    next(error);
  }
};

export const processResponse = async (req, res, next) => {
  try {
    const { sessionId, transcript, transcriptionConfidence = 1, audioBase64 = "" } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    if (session.status === "completed") {
      return res.status(400).json({ error: "Session already completed." });
    }

    const text = (transcript || "").trim();
    const audioUrl = await saveCandidateAudio({ sessionId, audioBase64 });

    if (text || audioUrl) {
      session.transcript.push({
        role: "candidate",
        text: text || "[Voice response]",
        metadata: {
          confidence: transcriptionConfidence,
          audioUrl
        }
      });
    }

    const classification = await classifyResponse({
      session,
      responseText: text,
      confidence: transcriptionConfidence
    });

    registerBehaviorSignals({
      session,
      quality: classification.quality,
      toxicity: classification.toxicity,
      irrelevant: classification.irrelevant,
      responseText: text
    });

    const policy = buildPolicyReply({
      quality: classification.quality,
      toxicity: classification.toxicity,
      session,
      guidance: classification.guidance
    });

    if (policy.terminateInterview) {
      session.transcript.push({
        role: "assistant",
        text: policy.message
      });

      await finalizeSessionEvaluation(session);
      session.evaluation.flagged = true;
      session.evaluation.summary = "Interview ended early due to policy violations and inappropriate language.";
      await session.save();

      return res.json({
        status: session.status,
        messageType: "completed",
        aiText: policy.message,
        evaluation: session.evaluation,
        questionCount: session.questionCount,
        toxicCount: session.toxicCount,
        irrelevantCount: session.irrelevantCount,
        liveHints: {
          currentScores: session.evaluation.scores,
          riskSignals: {
            toxicCount: session.toxicCount,
            irrelevantCount: session.irrelevantCount
          }
        }
      });
    }

    if (policy.shouldReask) {
      session.transcript.push({
        role: "assistant",
        text: policy.message
      });

      await session.save();

      return res.json({
        status: session.status,
        messageType: "follow_up",
        aiText: policy.message,
        questionCount: session.questionCount,
        toxicCount: session.toxicCount,
        irrelevantCount: session.irrelevantCount,
        liveHints: {
          currentScores: session.evaluation.scores,
          riskSignals: {
            toxicCount: session.toxicCount,
            irrelevantCount: session.irrelevantCount
          }
        }
      });
    }

    const step = await chooseNextStep({
      session,
      latestResponse: text,
      quality: classification.quality,
      toxicity: classification.toxicity,
      irrelevant: classification.irrelevant
    });

    if (step.endInterview) {
      await finalizeSessionEvaluation(session);
      await session.save();

      return res.json({
        status: session.status,
        messageType: "completed",
        aiText: "Thanks for your responses. The interview is complete.",
        evaluation: session.evaluation,
        liveHints: {
          currentScores: session.evaluation.scores,
          riskSignals: {
            toxicCount: session.toxicCount,
            irrelevantCount: session.irrelevantCount
          }
        }
      });
    }

    if (step.countsAsQuestion !== false) {
      session.questionCount += 1;
    }
    if (typeof step.nextFollowUpCount === "number") {
      session.followUpCountForCurrentQuestion = step.nextFollowUpCount;
    }
    session.currentQuestion = step.nextQuestion;
    session.transcript.push({ role: "assistant", text: step.nextQuestion });

    await session.save();

    return res.json({
      status: session.status,
      messageType: "question",
      aiText: step.nextQuestion,
      questionCount: session.questionCount,
      toxicCount: session.toxicCount,
      irrelevantCount: session.irrelevantCount,
      liveHints: {
        currentScores: session.evaluation.scores,
        riskSignals: {
          toxicCount: session.toxicCount,
          irrelevantCount: session.irrelevantCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getEvaluation = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    if (session.status !== "completed") {
      return res.status(400).json({
        error: "Session is still active.",
        status: session.status
      });
    }

    return res.json({
      sessionId: session.id,
      status: session.status,
      evaluation: session.evaluation,
      violations: session.violations,
      transcript: session.transcript
    });
  } catch (error) {
    next(error);
  }
};

export const listSessions = async (_req, res, next) => {
  try {
    const sessions = await Session.find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const rows = sessions.map((session) => ({
      sessionId: String(session._id),
      candidateName: session.candidate?.name || "",
      candidateEmail: session.candidate?.email || "",
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      questionCount: session.questionCount,
      toxicCount: session.toxicCount,
      irrelevantCount: session.irrelevantCount,
      flagged: Boolean(session.evaluation?.flagged),
      summary: session.evaluation?.summary || "",
      scores: session.evaluation?.scores || null
    }));

    return res.json({ sessions: rows });
  } catch (error) {
    next(error);
  }
};

export const getSessionDetails = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId).lean();

    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    return res.json({
      session: {
        sessionId: String(session._id),
        candidate: {
          name: session.candidate?.name || "",
          email: session.candidate?.email || ""
        },
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        questionCount: session.questionCount,
        maxQuestions: session.maxQuestions,
        silenceRetries: session.silenceRetries,
        toxicCount: session.toxicCount,
        irrelevantCount: session.irrelevantCount,
        currentQuestion: session.currentQuestion,
        flagged: Boolean(session.evaluation?.flagged),
        evaluation: session.evaluation || null,
        violations: session.violations || [],
        transcript: session.transcript || []
      }
    });
  } catch (error) {
    next(error);
  }
};

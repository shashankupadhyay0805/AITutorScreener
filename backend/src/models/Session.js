import mongoose from "mongoose";

const transcriptEntrySchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["assistant", "candidate"], required: true },
    text: { type: String, required: true },
    metadata: {
      confidence: Number,
      audioUrl: String,
      responseQuality: String,
      toxicitySeverity: String,
      irrelevant: Boolean,
      silence: Boolean
    }
  },
  { _id: false, timestamps: true }
);

const evaluationSchema = new mongoose.Schema(
  {
    scores: {
      clarity: { type: Number, default: 5 },
      patience: { type: Number, default: 5 },
      simplicity: { type: Number, default: 5 },
      warmth: { type: Number, default: 5 },
      fluency: { type: Number, default: 5 },
      professionalism: { type: Number, default: 5 }
    },
    summary: { type: String, default: "" },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    result: { type: String, enum: ["pass", "fail", "pending"], default: "pending" },
    evidence: {
      type: [
        {
          quote: String,
          reason: String
        }
      ],
      default: []
    },
    flagged: { type: Boolean, default: false }
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    candidate: {
      name: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true }
    },
    status: {
      type: String,
      enum: ["active", "completed"],
      default: "active"
    },
    questionCount: { type: Number, default: 0 },
    maxQuestions: { type: Number, default: 5 },
    seedQuestionOrder: { type: [Number], default: [] },
    seedQuestionCursor: { type: Number, default: 0 },
    followUpCountForCurrentQuestion: { type: Number, default: 0 },
    silenceRetries: { type: Number, default: 0 },
    toxicCount: { type: Number, default: 0 },
    irrelevantCount: { type: Number, default: 0 },
    currentQuestion: { type: String, default: "" },
    transcript: { type: [transcriptEntrySchema], default: [] },
    violations: {
      type: [
        {
          type: { type: String, enum: ["toxicity", "irrelevance", "silence"] },
          severity: { type: String, enum: ["low", "medium", "high", "none"], default: "none" },
          note: String
        }
      ],
      default: []
    },
    evaluation: { type: evaluationSchema, default: () => ({}) }
  },
  { timestamps: true }
);

export const Session = mongoose.model("Session", sessionSchema);

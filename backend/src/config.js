import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  groqApiKey: process.env.GROQ_API_KEY || "",
  groqModel: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  recruiterPassword: process.env.RECRUITER_PASSWORD || "recruiter123",
  minQuestions: 10,
  maxQuestions: 10,
  interviewTimeLimitMs: 15 * 60 * 1000,
  silenceTimeoutMs: 6500,
  maxSilenceRetries: 2
};

import express from "express";
import { config } from "../config.js";
import {
  endSession,
  getEvaluation,
  getSessionDetails,
  listSessions,
  processResponse,
  startSession
} from "../controllers/sessionController.js";

const router = express.Router();
const recruiterHeaderKey = "x-recruiter-password";

const requireRecruiterPassword = (req, res, next) => {
  const provided = req.header(recruiterHeaderKey);
  if (!provided || provided !== config.recruiterPassword) {
    return res.status(401).json({ error: "Unauthorized recruiter access." });
  }
  return next();
};

router.post("/start-session", startSession);
router.post("/process-response", processResponse);
router.post("/end-session", endSession);
router.get("/evaluation/:sessionId", getEvaluation);
router.get("/sessions", requireRecruiterPassword, listSessions);
router.get("/sessions/:sessionId", requireRecruiterPassword, getSessionDetails);

export default router;

import express from "express";
import {
  getEvaluation,
  getSessionDetails,
  listSessions,
  processResponse,
  startSession
} from "../controllers/sessionController.js";

const router = express.Router();

router.post("/start-session", startSession);
router.post("/process-response", processResponse);
router.get("/evaluation/:sessionId", getEvaluation);
router.get("/sessions", listSessions);
router.get("/sessions/:sessionId", getSessionDetails);

export default router;

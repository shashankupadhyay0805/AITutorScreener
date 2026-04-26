import { useEffect, useMemo, useState } from "react";
import ChatTimeline from "./components/ChatTimeline";
import EvaluationCard from "./components/EvaluationCard";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { useSpeechInterview } from "./hooks/useSpeechInterview";
import {
  API_BASE,
  endSessionApi,
  getSessionDetailsApi,
  listSessionsApi,
  processResponseApi,
  startSessionApi
} from "./services/api";

const getMessage = (role, text) => ({
  id: `${role}-${Date.now()}-${Math.random()}`,
  role,
  text
});

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    if (!blob) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const getApiOrigin = () => API_BASE.replace(/\/api\/?$/, "");

const toAbsoluteAudioUrl = (audioUrl) => {
  if (!audioUrl) {
    return "";
  }

  if (/^https?:\/\//i.test(audioUrl)) {
    return audioUrl;
  }

  const baseOrigin = getApiOrigin();
  return audioUrl.startsWith("/") ? `${baseOrigin}${audioUrl}` : `${baseOrigin}/${audioUrl}`;
};

const formatScore = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : value;
};

const MOCK_QUESTIONS = [
  "Teach a 10-year-old the idea of percentages using a real-life shopping example.",
  "A student thinks negative numbers are 'not real'. How would you explain negatives with a thermometer or elevator?",
  "Explain ratios using a simple recipe (e.g., juice concentrate and water).",
  "A learner can’t read a bar graph. How would you teach them to interpret it step by step?",
  "How would you introduce prime vs composite numbers using small objects or grouping?",
  "A student mixes up mean and median. How would you explain the difference with a small dataset example?",
  "Explain simple interest in a kid-friendly way with a savings jar example.",
  "A student freezes when they see a word problem. What is your 3-step routine to start confidently?"
];

export default function App() {
  const INTERVIEW_LIMIT_MS = 6 * 60 * 1000;
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidateReady, setCandidateReady] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("idle");
  const [questionCount, setQuestionCount] = useState(0);
  const [evaluation, setEvaluation] = useState(null);
  const [backendError, setBackendError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [liveHints, setLiveHints] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [dashboardRows, setDashboardRows] = useState([]);
  const [view, setView] = useState("home");
  const [selectedSession, setSelectedSession] = useState(null);
  const [loadingSessionDetails, setLoadingSessionDetails] = useState(false);
  const [recruiterPassword, setRecruiterPassword] = useState("");
  const [recruiterAuthenticated, setRecruiterAuthenticated] = useState(false);
  const [micFallbackEnabled, setMicFallbackEnabled] = useState(false);
  const [textFallbackAnswer, setTextFallbackAnswer] = useState("");
  const [remainingMs, setRemainingMs] = useState(INTERVIEW_LIMIT_MS);
  const [menuOpen, setMenuOpen] = useState(false);

  const { supported, listening, interim, error, listenOnce, speakText } = useSpeechInterview({
    silenceMs: 4000
  });
  const { recording, startRecording, stopRecording } = useAudioRecorder();

  const aiSpeaking = useMemo(() => status === "ai_speaking", [status]);
  const isTimeUp = remainingMs <= 0;

  const formatRemainingTime = (ms) => {
    const clamped = Math.max(0, ms);
    const totalSeconds = Math.floor(clamped / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const appendMessage = (role, text) => {
    setMessages((prev) => [...prev, getMessage(role, text)]);
  };

  const validateCandidate = () => {
    const name = candidateName.trim();
    const email = candidateEmail.trim();

    if (!name) {
      setBackendError("Candidate name is required.");
      return null;
    }

    if (!email) {
      setBackendError("Candidate email is required.");
      return null;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setBackendError("Please provide a valid email address.");
      return null;
    }

    return { name, email };
  };

  const startInterview = async () => {
    try {
      const candidate = validateCandidate();
      if (!candidate) {
        return;
      }

      setBackendError("");
      setEvaluation(null);
      setLiveHints(null);
      setRecordings([]);
      setMessages([]);
      setTextFallbackAnswer("");
      setMicFallbackEnabled(false);
      setRemainingMs(INTERVIEW_LIMIT_MS);
      setStatus("starting");

      const data = await startSessionApi(candidate);
      setSessionId(data.sessionId);
      setQuestionCount(data.questionCount || 1);
      setCandidateReady(true);
      setView("interview");
      setRemainingMs(INTERVIEW_LIMIT_MS);

      appendMessage("assistant", data.question);
      setStatus("ai_speaking");
      await speakText(data.question);

      setStatus("ready_for_response");
    } catch (e) {
      setStatus("idle");
      setBackendError(e.message || "Failed to start interview.");
    }
  };

  const submitAnswer = async () => {
    if (!sessionId || processing || isTimeUp) {
      return;
    }

    setProcessing(true);
    setBackendError("");

    try {
      setStatus("listening");
      await startRecording();
      const heard = await listenOnce();
      const audioCapture = await stopRecording();
      const audioBase64 = await blobToBase64(audioCapture?.blob);
      const transcript = (heard.transcript || "").trim();

      if (heard.recognitionError) {
        setStatus("ready_for_response");
        setMicFallbackEnabled(true);
        setBackendError("Microphone capture failed. You can now submit a text answer.");
        return;
      }

      if (!transcript) {
        setStatus("ready_for_response");
        setBackendError("No valid speech captured. Please try again.");
        return;
      }

      appendMessage("candidate", transcript);
      if (audioCapture?.url) {
        setRecordings((prev) => [
          ...prev,
          {
            id: `recording-${Date.now()}-${Math.random()}`,
            text: transcript,
            url: audioCapture.url
          }
        ]);
      }

      setStatus("processing");
      const response = await processResponseApi({
        sessionId,
        transcript,
        transcriptionConfidence: heard.confidence,
        audioBase64,
        remainingMs
      });

      if (response.aiText) {
        appendMessage("assistant", response.aiText);
      }
      if (response.liveHints) {
        setLiveHints(response.liveHints);
      }

      if (response.messageType === "completed") {
        if ((response.aiText || "").toLowerCase().includes("time is up")) {
          setRemainingMs(0);
        }
        setEvaluation(response.evaluation);
        setStatus("completed");
      } else {
        setQuestionCount(response.questionCount || questionCount);
        setStatus("ai_speaking");
        await speakText(response.aiText || "");
        setStatus("ready_for_response");
      }
    } catch (e) {
      await stopRecording();
      setStatus("ready_for_response");
      setBackendError(e.message || "Failed to process response.");
    } finally {
      setProcessing(false);
    }
  };

  const submitTextFallback = async () => {
    const transcript = textFallbackAnswer.trim();
    if (!sessionId || processing || !micFallbackEnabled || isTimeUp) {
      return;
    }
    if (!transcript) {
      setBackendError("Please type your answer before submitting.");
      return;
    }

    setProcessing(true);
    setBackendError("");

    try {
      appendMessage("candidate", transcript);
      setStatus("processing");
      const response = await processResponseApi({
        sessionId,
        transcript,
        transcriptionConfidence: 1,
        audioBase64: "",
        remainingMs
      });

      if (response.aiText) {
        appendMessage("assistant", response.aiText);
      }
      if (response.liveHints) {
        setLiveHints(response.liveHints);
      }

      setTextFallbackAnswer("");
      if (response.messageType === "completed") {
        if ((response.aiText || "").toLowerCase().includes("time is up")) {
          setRemainingMs(0);
        }
        setEvaluation(response.evaluation);
        setStatus("completed");
      } else {
        setQuestionCount(response.questionCount || questionCount);
        setStatus("ai_speaking");
        await speakText(response.aiText || "");
        setStatus("ready_for_response");
      }
    } catch (e) {
      setStatus("ready_for_response");
      setBackendError(e.message || "Failed to process text response.");
    } finally {
      setProcessing(false);
    }
  };

  const finishInterviewEarly = async () => {
    if (!sessionId || processing || status === "completed") {
      return;
    }

    setProcessing(true);
    setBackendError("");
    setStatus("processing");
    try {
      const response = await endSessionApi({ sessionId });
      if (response.aiText) {
        appendMessage("assistant", response.aiText);
      }
      if (response.liveHints) {
        setLiveHints(response.liveHints);
      }
      setEvaluation(response.evaluation);
      setStatus("completed");
    } catch (e) {
      setStatus("ready_for_response");
      setBackendError(e.message || "Failed to submit interview.");
    } finally {
      setProcessing(false);
    }
  };

  const loadDashboard = async () => {
    try {
      setBackendError("");
      if (!recruiterAuthenticated) {
        return;
      }

      const data = await listSessionsApi(recruiterPassword);
      setDashboardRows(data.sessions || []);
      setSelectedSession(null);
      setView("dashboard");
    } catch (e) {
      if ((e.message || "").toLowerCase().includes("unauthorized")) {
        setRecruiterAuthenticated(false);
        setRecruiterPassword("");
      }
      setBackendError(e.message || "Failed to load recruiter dashboard.");
    }
  };

  const openSessionDetails = async (sessionId) => {
    try {
      setBackendError("");
      setLoadingSessionDetails(true);
      setView("dashboard-detail");
      const data = await getSessionDetailsApi(sessionId, recruiterPassword);
      setSelectedSession(data.session || null);
    } catch (e) {
      setView("dashboard");
      setBackendError(e.message || "Failed to load session details.");
    } finally {
      setLoadingSessionDetails(false);
    }
  };

  const switchToCandidateEntry = () => {
    setView("candidate-entry");
    setBackendError("");
  };

  const switchToInterview = () => {
    setView(candidateReady ? "interview" : "candidate-entry");
    setBackendError("");
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const isDashboardView = view === "dashboard" || view === "dashboard-detail";

  useEffect(() => {
    if (!sessionId || status === "completed" || status === "idle" || status === "starting") {
      return;
    }
    const timer = setInterval(() => {
      setRemainingMs((prev) => {
        if (status === "ai_speaking") {
          return prev;
        }
        return Math.max(0, prev - 1000);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionId, status]);

  useEffect(() => {
    if (!recruiterAuthenticated) {
      return;
    }
    loadDashboard();
  }, [recruiterAuthenticated]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const [role, setRole] = useState("");
  const [recruiterPasswordInput, setRecruiterPasswordInput] = useState("");

  const handleRoleSelection = (selectedRole) => {
    setRole(selectedRole);
    setBackendError("");
    setEvaluation(null);
    setLiveHints(null);
    setSelectedSession(null);
    setDashboardRows([]);
    setRecruiterAuthenticated(false);
    setRecruiterPassword("");
    setRecruiterPasswordInput("");
    setMenuOpen(false);
    if (selectedRole === "candidate") {
      setView("candidate-entry");
      return;
    }
    if (selectedRole === "recruiter") {
      setView("recruiter-login");
    }
  };

  const handleRecruiterLogin = () => {
    if (!recruiterPasswordInput) {
      setBackendError("Password is required to continue as a recruiter.");
      return;
    }
    setRecruiterPassword(recruiterPasswordInput);
    setRecruiterAuthenticated(true);
  };

  return (
    <main className="page">
      {!role ? (
        <>
          <div className="topbar">
            <button
              type="button"
              className="hamburger"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <span />
              <span />
              <span />
            </button>
            <button className="secondary" type="button" onClick={toggleTheme}>
              {theme === "light" ? "Dark Mode" : "Light Mode"}
            </button>
          </div>

          {menuOpen ? (
            <>
              <button type="button" className="menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
              <nav className="menu-drawer" aria-label="Homepage menu">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setView("home");
                    setMenuOpen(false);
                  }}
                >
                  Home
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setView("about");
                    setMenuOpen(false);
                  }}
                >
                  About Us
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setView("guidelines");
                    setMenuOpen(false);
                  }}
                >
                  Interview Guidelines
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setView("mock");
                    setMenuOpen(false);
                  }}
                >
                  Mock Questions
                </button>
              </nav>
            </>
          ) : null}

          {view === "home" ? (
            <section className="panel controls">
              <div className="role-selection">
                <button className="primary" type="button" onClick={() => handleRoleSelection("candidate")}>
                  Continue as Candidate
                </button>
                <button className="secondary" type="button" onClick={() => handleRoleSelection("recruiter")}>
                  Continue as Recruiter
                </button>
              </div>
            </section>
          ) : null}

          {view === "about" ? (
            <section className="panel">
              <h2>About Us</h2>
              <ul className="bullet-list">
                <li>We help tutoring teams screen candidates quickly with a consistent, fair voice interview.</li>
                <li>We focus on the teaching skills that matter most: clarity, patience, warmth, and simplicity.</li>
                <li>Recruiters get a structured summary with transcript history for transparent review.</li>
                <li>Candidate experience comes first: short, respectful questions and clear timing.</li>
              </ul>
            </section>
          ) : null}

          {view === "guidelines" ? (
            <section className="panel">
              <h2>Interview Guidelines</h2>
              <ul className="bullet-list">
                <li>Speak clearly and at a steady pace. Use short sentences.</li>
                <li>Give one concrete example (a mini scenario) for each answer.</li>
                <li>Explain as if teaching an 8–12 year old: simple words, step-by-step.</li>
                <li>If you make a mistake, correct yourself calmly and continue.</li>
                <li>Keep it professional and respectful at all times.</li>
              </ul>
            </section>
          ) : null}

          {view === "mock" ? (
            <section className="panel">
              <h2>Mock Questions (Practice)</h2>
              <p className="muted">
                These are practice-only and are <strong>not</strong> used in the real interview.
              </p>
              <ol className="bullet-list">
                {MOCK_QUESTIONS.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : null}

      {role && (
        <section className="panel controls">
          <div className="toolbar toolbar-equal">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setRole("");
                setView("home");
                setMenuOpen(false);
              }}
            >
              Back to Home
            </button>
            <button className="secondary" type="button" onClick={toggleTheme}>
              {theme === "light" ? "Dark Mode" : "Light Mode"}
            </button>
          </div>
        </section>
      )}

      {role === "candidate" && view === "candidate-entry" ? (
        <section className="panel controls">
          <h2>Candidate Details</h2>
          <p>Enter your name and email to begin the interview.</p>
          <div className="candidate-form">
            <input
              type="text"
              placeholder="Candidate name"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
            />
            <input
              type="email"
              placeholder="Candidate email"
              value={candidateEmail}
              onChange={(e) => setCandidateEmail(e.target.value)}
            />
          </div>
          <button className="primary" type="button" onClick={startInterview} disabled={status === "starting"}>
            Continue to Interview
          </button>
          {backendError ? <p className="warning">{backendError}</p> : null}
        </section>
      ) : null}

      {role === "recruiter" && !recruiterAuthenticated && view === "recruiter-login" ? (
        <section className="panel controls">
          <h2>Recruiter Login</h2>
          <p>Enter your password to access the recruiter dashboard.</p>
          <div className="recruiter-form">
            <input
              type="password"
              placeholder="Recruiter password"
              value={recruiterPasswordInput}
              onChange={(e) => setRecruiterPasswordInput(e.target.value)}
            />
          </div>
          <button className="primary" type="button" onClick={handleRecruiterLogin}>
            Continue to Dashboard
          </button>
          {backendError ? <p className="warning">{backendError}</p> : null}
        </section>
      ) : null}

      {view === "interview" ? (
        <>
          <section className="panel controls">
            <div className="toolbar">
              <button
                className="secondary"
                type="button"
                onClick={submitAnswer}
                disabled={!sessionId || status === "completed" || processing || !supported || isTimeUp}
              >
                {listening ? "Listening..." : "Answer via Microphone"}
              </button>
              <button
                className="primary"
                type="button"
                onClick={finishInterviewEarly}
                disabled={!sessionId || status === "completed" || processing}
              >
                Finish &amp; Submit Interview
              </button>
            </div>

            <div className="meta">
              <span>Status: {status}</span>
              <span>Questions Asked: {questionCount}</span>
              <span>AI Speaking: {aiSpeaking ? "Yes" : "No"}</span>
              <span>Recording: {recording ? "On" : "Off"}</span>
            </div>
            <div className={`timer ${isTimeUp ? "expired" : ""}`}>
              Time left: {formatRemainingTime(remainingMs)} / 06:00
            </div>

            {!supported ? <p className="warning">Web Speech API is not supported in this browser.</p> : null}
            {interim ? <p className="interim">Live transcript: {interim}</p> : null}
            {error ? <p className="warning">{error}</p> : null}
            {backendError ? <p className="warning">{backendError}</p> : null}
            {isTimeUp ? <p className="warning">Time is up. Submissions are disabled.</p> : null}

            {micFallbackEnabled ? (
              <div className="text-fallback">
                <label htmlFor="text-fallback-answer">Text fallback (enabled after microphone failure)</label>
                <textarea
                  id="text-fallback-answer"
                  placeholder="Type your answer here..."
                  value={textFallbackAnswer}
                  onChange={(e) => setTextFallbackAnswer(e.target.value)}
                  rows={4}
                  disabled={processing || status === "completed" || isTimeUp}
                />
                <button
                  className="primary"
                  type="button"
                  onClick={submitTextFallback}
                  disabled={processing || status === "completed" || isTimeUp || !textFallbackAnswer.trim()}
                >
                  Submit Text Answer
                </button>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <h2>Conversation</h2>
            <ChatTimeline messages={messages} />
          </section>

          {liveHints ? (
            <section className="panel">
              <h2>Real-Time Scoring Hints</h2>
              <div className="meta">
                {Object.entries(liveHints.currentScores || {}).map(([k, v]) => (
                  <span key={k}>
                    {k}: {formatScore(v)}/10
                  </span>
                ))}
              </div>
              <div className="meta">
                <span>Toxic count: {liveHints.riskSignals?.toxicCount ?? 0}</span>
                <span>Irrelevant count: {liveHints.riskSignals?.irrelevantCount ?? 0}</span>
              </div>
            </section>
          ) : null}

          {recordings.length ? (
            <section className="panel">
              <h2>Response Audio Playback</h2>
              <div className="chat-timeline">
                {recordings.map((item) => (
                  <div key={item.id} className="bubble candidate">
                    <div className="bubble-label">{item.text}</div>
                    <audio controls src={item.url} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <EvaluationCard evaluation={evaluation} />
        </>
      ) : null}

      {view === "dashboard" ? (
        <section className="panel">
          <h2>Recruiter Dashboard</h2>
          <div className="toolbar">
            <button className="secondary" type="button" onClick={switchToInterview}>
              Back to Candidate View
            </button>
          </div>
          {backendError ? <p className="warning">{backendError}</p> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Remark</th>
                  <th>Created</th>
                  <th>Questions</th>
                  <th>Toxic</th>
                  <th>Irrelevant</th>
                  <th>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {dashboardRows.map((row) => (
                  <tr key={row.sessionId} onClick={() => openSessionDetails(row.sessionId)}>
                    <td>{row.sessionId.slice(-8)}</td>
                    <td>{row.candidateName || "-"}</td>
                    <td>{row.candidateEmail || "-"}</td>
                    <td>{row.status}</td>
                    <td>{(row.result || "pending").toUpperCase()}</td>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.questionCount}</td>
                    <td>{row.toxicCount}</td>
                    <td>{row.irrelevantCount}</td>
                    <td>{row.flagged ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {view === "dashboard-detail" ? (
        <section className="panel">
          <div className="toolbar">
            <button className="secondary" type="button" onClick={() => setView("dashboard")}>
              Back to Dashboard
            </button>
            <button className="secondary" type="button" onClick={switchToCandidateEntry}>
              Candidate Start Page
            </button>
          </div>
          {backendError ? <p className="warning">{backendError}</p> : null}
          {loadingSessionDetails ? <p>Loading interview details...</p> : null}

          {!loadingSessionDetails && selectedSession ? (
            <div className="session-details">
              <h2>Interview Details ({selectedSession.sessionId.slice(-8)})</h2>
              <div className="meta">
                <span>Name: {selectedSession.candidate?.name || "-"}</span>
                <span>Email: {selectedSession.candidate?.email || "-"}</span>
                <span>Status: {selectedSession.status}</span>
                <span>Remark: {(selectedSession.result || selectedSession.evaluation?.result || "pending").toUpperCase()}</span>
                <span>Created: {new Date(selectedSession.createdAt).toLocaleString()}</span>
                <span>Updated: {new Date(selectedSession.updatedAt).toLocaleString()}</span>
                <span>
                  Questions: {selectedSession.questionCount}/{selectedSession.maxQuestions}
                </span>
                <span>Toxic: {selectedSession.toxicCount}</span>
                <span>Irrelevant: {selectedSession.irrelevantCount}</span>
                <span>Flagged: {selectedSession.flagged ? "Yes" : "No"}</span>
              </div>

              <h4>Evaluation Summary</h4>
              <p>{selectedSession.evaluation?.summary || "No summary yet."}</p>

              {selectedSession.evaluation?.scores ? (
                <div className="meta">
                  {Object.entries(selectedSession.evaluation.scores).map(([k, v]) => (
                    <span key={k}>
                      {k}: {formatScore(v)}/10
                    </span>
                  ))}
                </div>
              ) : null}

              {selectedSession.violations?.length ? (
                <>
                  <h4>Violations</h4>
                  <ul>
                    {selectedSession.violations.map((violation, index) => (
                      <li key={`${violation.type}-${index}`}>
                        {violation.type} ({violation.severity}) - {violation.note || "No note"}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              <h4>Transcript History</h4>
              <div className="chat-timeline">
                {selectedSession.transcript?.map((entry, index) => (
                  <div key={`${entry.role}-${index}`} className={`bubble ${entry.role}`}>
                    <div className="bubble-label">
                      {entry.role} {entry.createdAt ? `- ${new Date(entry.createdAt).toLocaleString()}` : ""}
                    </div>
                    <div>{entry.text}</div>
                    {entry.role === "candidate" && entry.metadata?.audioUrl ? (
                      <audio controls src={toAbsoluteAudioUrl(entry.metadata.audioUrl)} />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

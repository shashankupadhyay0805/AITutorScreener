import { useMemo, useState } from "react";
import ChatTimeline from "./components/ChatTimeline";
import EvaluationCard from "./components/EvaluationCard";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import { useSpeechInterview } from "./hooks/useSpeechInterview";
import { API_BASE, getSessionDetailsApi, listSessionsApi, processResponseApi, startSessionApi } from "./services/api";

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

export default function App() {
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
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
  const [view, setView] = useState("interview");
  const [selectedSession, setSelectedSession] = useState(null);
  const [loadingSessionDetails, setLoadingSessionDetails] = useState(false);

  const { supported, listening, interim, error, listenOnce, speakText } = useSpeechInterview({
    silenceMs: 4000
  });
  const { recording, startRecording, stopRecording } = useAudioRecorder();

  const aiSpeaking = useMemo(() => status === "ai_speaking", [status]);

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
      setStatus("starting");

      const data = await startSessionApi(candidate);
      setSessionId(data.sessionId);
      setQuestionCount(data.questionCount || 1);

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
    if (!sessionId || processing) {
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
        setBackendError("");
        return;
      }

      if (!transcript) {
        setStatus("ready_for_response");
        setBackendError("No valid speech captured. Please try again.");
        return;
      }

      appendMessage("candidate", transcript);

      setStatus("processing");
      const response = await processResponseApi({
        sessionId,
        transcript,
        transcriptionConfidence: heard.confidence,
        audioBase64
      });

      if (response.aiText) {
        appendMessage("assistant", response.aiText);
      }
      if (response.liveHints) {
        setLiveHints(response.liveHints);
      }

      if (response.messageType === "completed") {
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

  const loadDashboard = async () => {
    try {
      setBackendError("");
      const data = await listSessionsApi();
      setDashboardRows(data.sessions || []);
      setSelectedSession(null);
      setView("dashboard");
    } catch (e) {
      setBackendError(e.message || "Failed to load recruiter dashboard.");
    }
  };

  const openSessionDetails = async (sessionId) => {
    try {
      setBackendError("");
      setLoadingSessionDetails(true);
      setView("dashboard-detail");
      const data = await getSessionDetailsApi(sessionId);
      setSelectedSession(data.session || null);
    } catch (e) {
      setView("dashboard");
      setBackendError(e.message || "Failed to load session details.");
    } finally {
      setLoadingSessionDetails(false);
    }
  };

  const isDashboardView = view === "dashboard" || view === "dashboard-detail";

  return (
    <main className="page">
      <header className="hero">
        <h1>AI Tutor Screener</h1>
        <p>Voice interview to assess tutor soft skills in a realistic screening flow.</p>
      </header>

      <section className="panel controls">
        <div className="toolbar">
          <button className={view === "interview" ? "primary" : "secondary"} type="button" onClick={() => setView("interview")}>
            Interview View
          </button>
          <button className={isDashboardView ? "primary" : "secondary"} type="button" onClick={loadDashboard}>
            Recruiter Dashboard
          </button>
        </div>
      </section>

      {view === "interview" ? (
        <>
          <section className="panel controls">
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
              Start Session
            </button>

            <button
              className="secondary"
              type="button"
              onClick={submitAnswer}
              disabled={!sessionId || status === "completed" || processing || !supported}
            >
              {listening ? "Listening..." : "Answer via Microphone"}
            </button>

            <div className="meta">
              <span>Status: {status}</span>
              <span>Questions Asked: {questionCount}</span>
              <span>AI Speaking: {aiSpeaking ? "Yes" : "No"}</span>
              <span>Recording: {recording ? "On" : "Off"}</span>
            </div>

            {!supported ? <p className="warning">Web Speech API is not supported in this browser.</p> : null}
            {interim ? <p className="interim">Live transcript: {interim}</p> : null}
            {error ? <p className="warning">{error}</p> : null}
            {backendError ? <p className="warning">{backendError}</p> : null}
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
          {backendError ? <p className="warning">{backendError}</p> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
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

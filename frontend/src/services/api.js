export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const request = async (path, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
};

export const startSessionApi = (payload) =>
  request("/start-session", {
    method: "POST",
    body: JSON.stringify(payload)
  });

export const processResponseApi = (payload) =>
  request("/process-response", {
    method: "POST",
    body: JSON.stringify(payload)
  });

export const fetchEvaluationApi = (sessionId) => request(`/evaluation/${sessionId}`);

export const listSessionsApi = (recruiterPassword) =>
  request("/sessions", {
    headers: {
      "x-recruiter-password": recruiterPassword
    }
  });

export const getSessionDetailsApi = (sessionId, recruiterPassword) =>
  request(`/sessions/${sessionId}`, {
    headers: {
      "x-recruiter-password": recruiterPassword
    }
  });

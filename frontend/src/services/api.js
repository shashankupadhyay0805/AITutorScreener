export const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
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

export const listSessionsApi = () => request("/sessions");

export const getSessionDetailsApi = (sessionId) => request(`/sessions/${sessionId}`);

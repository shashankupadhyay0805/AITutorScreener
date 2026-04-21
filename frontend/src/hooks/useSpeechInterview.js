import { useEffect, useMemo, useRef, useState } from "react";

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const normalizeTranscript = (text = "") =>
  text
    .replace(/\s+/g, " ")
    .replace(/\bi\s*\b/g, "I")
    .trim();

const pickBestAlternative = (result) => {
  if (!result || !result.length) {
    return null;
  }

  let best = result[0];
  for (let i = 1; i < result.length; i += 1) {
    const current = result[i];
    const bestConfidence = typeof best?.confidence === "number" ? best.confidence : -1;
    const currentConfidence = typeof current?.confidence === "number" ? current.confidence : -1;
    if (currentConfidence > bestConfidence) {
      best = current;
    }
  }
  return best;
};

const speechErrorMessage = (errorCode) => {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission is blocked. Allow mic access in browser settings.";
    case "audio-capture":
      return "No microphone device detected. Check your input device.";
    case "no-speech":
      return "No speech detected. Please speak clearly and try again.";
    case "network":
      return "Speech service network error. Check internet and retry.";
    default:
      return "Speech recognition error. Please retry.";
  }
};

export const useSpeechInterview = ({ silenceMs = 6500 } = {}) => {
  const recognitionRef = useRef(null);
  const timeoutRef = useRef(null);

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const supported = useMemo(() => Boolean(SpeechRecognition), []);

  useEffect(() => {
    if (!supported) {
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
    };
  }, [supported]);

  const stop = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    recognitionRef.current?.stop();
    setListening(false);
  };

  const resetSilenceTimer = (onTimeout) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(onTimeout, silenceMs);
  };

  const speakText = (text) => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis || !text) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.98;
      utterance.pitch = 1.05;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  };

  const listenOnce = () => {
    return new Promise((resolve) => {
      setError("");
      setInterim("");

      if (!recognitionRef.current) {
        resolve({ transcript: "", confidence: 0, silence: true });
        return;
      }

      let finalChunks = [];
      let latestInterimTranscript = "";
      let finalConfidence = 0.85;
      let resolved = false;
      let lastSpeechAt = Date.now();
      const maxListenMs = 45000;
      const hardStopAt = Date.now() + maxListenMs;

      const safeResolve = (value) => {
        if (resolved) {
          return;
        }
        resolved = true;
        stop();
        resolve(value);
      };

      recognitionRef.current.onresult = (event) => {
        let interimText = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const alt = pickBestAlternative(result);
          if (!alt?.transcript) {
            continue;
          }

          if (result.isFinal) {
            finalChunks.push(alt.transcript);
            finalConfidence = typeof alt.confidence === "number" ? alt.confidence : finalConfidence;
          } else {
            interimText += alt.transcript;
          }
        }

        latestInterimTranscript = interimText.trim();
        lastSpeechAt = Date.now();
        setInterim(interimText);
        resetSilenceTimer(() => {
          const stableTranscript = normalizeTranscript(finalChunks.join(" "));
          const fallbackTranscript = normalizeTranscript(latestInterimTranscript);
          safeResolve({
            transcript: stableTranscript || fallbackTranscript,
            confidence: finalConfidence,
            silence: !(stableTranscript || fallbackTranscript),
            recognitionError: false
          });
        });
      };

      recognitionRef.current.onerror = (event) => {
        if (event?.error === "no-speech") {
          const stableTranscript = normalizeTranscript(finalChunks.join(" "));
          const fallbackTranscript = normalizeTranscript(latestInterimTranscript);
          const transcript = stableTranscript || fallbackTranscript;
          safeResolve({
            transcript,
            confidence: finalConfidence,
            silence: !transcript,
            recognitionError: false
          });
          return;
        }

        setError(speechErrorMessage(event?.error));
        safeResolve({
          transcript: normalizeTranscript(finalChunks.join(" ")),
          confidence: finalConfidence,
          silence: true,
          recognitionError: true
        });
      };

      recognitionRef.current.onend = () => {
        if (resolved) {
          return;
        }

        const now = Date.now();
        const hasRemainingPauseBuffer = now - lastSpeechAt < silenceMs;
        const hasTimeLeft = now < hardStopAt;

        if (hasRemainingPauseBuffer && hasTimeLeft) {
          try {
            recognitionRef.current?.start();
            return;
          } catch {
            // If restart fails, fall through and resolve with what we captured.
          }
        }

        safeResolve({
          transcript: normalizeTranscript(finalChunks.join(" ")) || normalizeTranscript(latestInterimTranscript),
          confidence: finalConfidence,
          silence: !(normalizeTranscript(finalChunks.join(" ")) || normalizeTranscript(latestInterimTranscript)),
          recognitionError: false
        });
      };

      setListening(true);
      recognitionRef.current.start();

      resetSilenceTimer(() => {
        const stableTranscript = normalizeTranscript(finalChunks.join(" "));
        const fallbackTranscript = normalizeTranscript(latestInterimTranscript);
        safeResolve({
          transcript: stableTranscript || fallbackTranscript,
          confidence: finalConfidence,
          silence: !(stableTranscript || fallbackTranscript),
          recognitionError: false
        });
      });
    });
  };

  return {
    supported,
    listening,
    interim,
    error,
    listenOnce,
    speakText,
    stop
  };
};

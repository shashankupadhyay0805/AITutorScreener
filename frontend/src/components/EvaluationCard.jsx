export default function EvaluationCard({ evaluation }) {
  if (!evaluation) {
    return null;
  }

  const entries = Object.entries(evaluation.scores || {});
  const formatScore = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(1) : value;
  };

  return (
    <div className="evaluation-card">
      <h2>Final Assessment</h2>
      <div className="score-grid">
        {entries.map(([key, value]) => (
          <div key={key} className="score-item">
            <div className="score-label">{key}</div>
            <div className="score-value">{formatScore(value)}/10</div>
          </div>
        ))}
      </div>

      <p className="summary">{evaluation.summary}</p>

      <div className="columns">
        <div>
          <h3>Strengths</h3>
          <ul>
            {(evaluation.strengths || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Improvements</h3>
          <ul>
            {(evaluation.improvements || []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <h3>Evidence</h3>
      <ul>
        {(evaluation.evidence || []).map((entry, idx) => (
          <li key={`${entry.quote}-${idx}`}>
            "{entry.quote}" - {entry.reason}
          </li>
        ))}
      </ul>

      {evaluation.flagged ? <div className="flagged">Flagged for professionalism concerns</div> : null}
    </div>
  );
}

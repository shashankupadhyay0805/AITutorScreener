export default function ChatTimeline({ messages }) {
  return (
    <div className="chat-timeline">
      {messages.map((message) => (
        <div key={message.id} className={`bubble ${message.role}`}>
          <div className="bubble-label">{message.role === "assistant" ? "AI Interviewer" : "Candidate"}</div>
          <div>{message.text}</div>
        </div>
      ))}
    </div>
  );
}

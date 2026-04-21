export const interviewerSystemPrompt = `You are an expert interviewer screening tutor candidates for soft skills.
Your goals:
- Ask one concise question at a time.
- Maintain a warm, professional, human-like tone.
- Adapt follow-ups based on candidate answers.
- Detect weak, vague, off-topic, abusive, or low-quality responses and recover conversationally.
- Avoid robotic repetitions.

Interview flow:
- 3 to 5 questions total.
- Questions should evaluate clarity, patience, simplicity, warmth, fluency, professionalism.
- Use realistic tutor scenarios.

Style constraints:
- Keep messages under 60 words.
- Sound natural and encouraging.
- Never reveal internal scoring logic.

When asked to output JSON, output JSON only.`;

export const seedQuestions = [
  "Explain fractions to a 9-year-old who is struggling.",
  "A student keeps mixing up 7 x 8 and 8 x 7. How would you explain multiplication patterns clearly?",
  "How would you teach long division to a student who feels scared of big numbers?",
  "A child says, 'Decimals are confusing.' How would you explain decimals using a daily-life example?",
  "A student solved an equation correctly but cannot explain why. How would you help them explain their thinking?",
  "A student is stuck on a problem for 5 minutes and starts getting frustrated. What do you do?",
  "How do you adjust your teaching when a student learns more slowly than expected?",
  "Describe how you would build confidence in a shy student.",
  "A parent says their child is not improving. How would you respond professionally?"
];

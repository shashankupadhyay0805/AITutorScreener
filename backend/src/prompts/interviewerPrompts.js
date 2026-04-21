export const interviewerSystemPrompt = `You are an expert interviewer screening tutor candidates for soft skills.
Your goals:
- Ask one concise question at a time.
- Maintain a warm, professional, human-like tone.
- Adapt follow-ups based on candidate answers.
- Detect weak, vague, off-topic, abusive, or low-quality responses and recover conversationally.
- Avoid robotic repetitions.

Interview flow:
- Ask 10 questions total.
- Questions should evaluate clarity, patience, simplicity, warmth, fluency, professionalism.
- Use realistic math tutor scenarios for children (ages 8-12).
- Prefer concrete prompts like "Explain fractions to a 9-year-old who is struggling."

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
  "A student says 3/8 is bigger than 1/2 because 8 is bigger than 2. How would you correct this gently?",
  "How would you teach equivalent fractions (like 1/2 and 2/4) using a simple visual example?",
  "A child keeps placing decimals wrongly in multiplication. How would you explain where the decimal point goes?",
  "How would you explain why dividing by a number less than 1 can make the result bigger?",
  "A student can solve 12 + 19 mentally but struggles with 120 + 190. How would you connect place value?",
  "A student gets anxious with word problems. How would you teach them to identify key information step by step?",
  "How would you explain area vs perimeter to a 10-year-old using a real object in the classroom?",
  "A student keeps making sign errors in simple equations (e.g., x - 3 = 8). How would you coach accuracy?"
];

// Shared by the server (building clarification options) and the browser (the "type the company" box).
// No server imports.

// Put `replacement` where the user wrote the ambiguous name. If the name isn't in the question
// verbatim, append the choice so it is never lost.
export function rewriteQuestion(question: string, query: string, replacement: string): string {
  const q = query.trim();
  const idx = q ? question.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return `${question} (I mean ${replacement})`;
  return question.slice(0, idx) + replacement + question.slice(idx + q.length);
}

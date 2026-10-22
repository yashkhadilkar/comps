// Deterministic driver-intent check (docs/ANALYST_DRIVER_ANALYSIS_PLAN.md). It only decides the iteration
// ceiling; whether to call search_news is still the model's decision under the "Why questions" prompt rules.
// No server-only imports: tests and the browser may use it.

export const NORMAL_MAX_ITERATIONS = 6;
export const DRIVER_MAX_ITERATIONS = 8;

const DRIVER_PATTERNS: RegExp[] = [
  /\bwhy\b/i, // why did / why has / why is
  /\bwhat\s+(?:has\s+|have\s+|had\s+)?(?:drove|driven|drives|caused|causes|explains?|explained|led\s+to|leads\s+to|happened|changed|contributed)\b/i,
  /\bwhat(?:'s| is| are| were| was)\s+(?:behind|driving|the\s+(?:reasons?|drivers?|causes?|factors?))\b/i,
  /\b(?:reasons?|drivers?|root\s+causes?)\s+(?:for|behind|of)\b/i,
  /\bexplain(?:s|ed)?\b/i,
  /\b(?:has|have|did|had)\s+(?:it|they|this|that|the\s+\w+)\s+(?:fully\s+)?(?:recover|rebound|bounce)/i,
  /\brecover(?:y|ed)?\b/i,
];

export function isDriverAnalysis(question: string): boolean {
  return DRIVER_PATTERNS.some((p) => p.test(question));
}

export function maxIterationsFor(question: string): number {
  return isDriverAnalysis(question) ? DRIVER_MAX_ITERATIONS : NORMAL_MAX_ITERATIONS;
}

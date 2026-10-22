// calculate: margins, growth rates, CAGR and other math, so the model never does arithmetic itself.
// Uses a locked-down mathjs instance. Never eval().
import { create, all } from "mathjs";
import { formatMoney } from "./getFinancials";
import type { ToolDef } from "./types";

const math = create(all);
const evaluateSafely = math.evaluate.bind(math);

// Disable everything that could reach outside plain arithmetic (pattern from the mathjs security docs).
math.import(
  {
    import: () => { throw new Error("disabled"); },
    createUnit: () => { throw new Error("disabled"); },
    evaluate: () => { throw new Error("disabled"); },
    parse: () => { throw new Error("disabled"); },
    simplify: () => { throw new Error("disabled"); },
    derivative: () => { throw new Error("disabled"); },
  },
  { override: true },
);

const MAX_EXPRESSION_LENGTH = 200;
const MAX_CALCULATIONS = 50; // per call; extras are reported as errors, never silently dropped
const ALLOWED = /^[0-9+\-*/().^\s e]+$/i; // digits, + - * / ^, parentheses, exponent notation (no % or commas)
const STRAY_E = /(?<![0-9.])e|e(?![+\-]?[0-9])/i; // an "e" must sit inside a number like 2.5e10

type Input = { thought: string; calculations: { label: string; expression: string }[] };

// Ready-to-show text for a result, so the model never rounds: money-sized values like get_financials,
// otherwise 1 decimal (2 under 1). The model adds % itself for percentages.
export function displayNumber(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6) return formatMoney(v);
  return v.toFixed(abs < 1 ? 2 : 1);
}

export function evaluateExpression(expression: string): { result: number; display: string } | { error: string } {
  if (expression.length > MAX_EXPRESSION_LENGTH) return { error: "Expression too long." };
  if (!ALLOWED.test(expression) || STRAY_E.test(expression)) {
    return { error: "Use only numbers and + - * / ^ ( ) operators." };
  }
  try {
    const value = evaluateSafely(expression);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { error: "Result is not a finite number (division by zero or overflow?)." };
    }
    return { result: Number(value.toFixed(4)), display: displayNumber(value) };
  } catch (err) {
    return { error: `Could not evaluate: ${err instanceof Error ? err.message : "invalid expression"}` };
  }
}

export const calculate: ToolDef<Input> = {
  name: "calculate",
  timeoutMs: 10_000,
  definition: {
    name: "calculate",
    description:
      "Exact arithmetic for margins, growth rates, CAGR and other ratios. Always use this instead of doing " +
      "math yourself. Batch every calculation you need into one call. Expressions must use raw numbers only " +
      "(for example '22887000000 / 51362000000 * 100' for a margin in percent, '(b - a) / a * 100' written " +
      "with numbers for growth, '((51362000000 / 46710000000) ^ (1 / 2) - 1) * 100' for CAGR). " +
      "Operators: + - * / ^ and parentheses. Each result has a rounded `result` and a `display` string: show " +
      "the display value (add % for percentages) instead of rounding yourself.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        thought: {
          type: "string",
          description: "One short sentence: what you need and why you are calling this tool.",
        },
        calculations: {
          type: "array",
          description: "Up to 50 calculations per call. Put every derived metric you need in one call.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "What this is, e.g. 'NKE FY2024 gross margin %'." },
              expression: { type: "string", description: "Arithmetic expression using raw numbers only." },
            },
            required: ["label", "expression"],
            additionalProperties: false,
          },
        },
      },
      required: ["thought", "calculations"],
      additionalProperties: false,
    },
  },
  label: (input) => `Calculating ${Array.isArray(input.calculations) ? input.calculations.length : 0} values`,
  async run(input, ctx) {
    if (!Array.isArray(input.calculations) || !input.calculations.length) {
      return { ok: false, error: "Pass at least one calculation." };
    }
    // Beyond the cap each item comes back as an explicit error, so the model knows what to resend.
    const results = input.calculations.map((c, i) => ({
      label: c.label,
      expression: c.expression,
      ...(i < MAX_CALCULATIONS
        ? evaluateExpression(String(c.expression))
        : { error: `Not computed: at most ${MAX_CALCULATIONS} calculations per call. Send this one again in a new call.` }),
    }));
    for (const r of results) {
      if ("result" in r) {
        ctx.registerFigure(r.display);
        ctx.registerFigure(r.result.toFixed(1)); // lenient: the model may show 0 to 2 decimals
        ctx.registerFigure(r.result.toFixed(2));
        ctx.registerFigure(r.result.toFixed(0));
      }
    }
    const failed = results.filter((r) => "error" in r).length;
    return {
      ok: true,
      summary: `Computed ${results.length - failed} value${results.length - failed === 1 ? "" : "s"}${failed ? ` (${failed} failed)` : ""}`,
      data: { results },
    };
  },
};

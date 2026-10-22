"use client";

import { useState, type FormEvent } from "react";
import { rewriteQuestion } from "@/lib/agent/clarify";
import type { Clarification } from "@/lib/agent/types";
import { ArrowRightIcon } from "@/components/ui/icons";

// An ambiguous company name: up to 3 candidates to click, or type the exact name or ticker.
export function ClarifyChoices({
  clarification,
  onAsk,
}: {
  clarification: Clarification;
  onAsk: (question: string) => void;
}) {
  const [typed, setTyped] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = typed.trim();
    if (name) onAsk(rewriteQuestion(clarification.question, clarification.query, name));
  }

  return (
    <div className="mt-5">
      {clarification.options.length > 0 && (
        <ul className="border-y border-line-subtle">
          {clarification.options.map((o) => (
            <li key={o.ticker} className="border-b border-line-subtle last:border-0">
              <button
                type="button"
                onClick={() => onAsk(o.question)}
                className="group flex w-full items-center justify-between gap-4 py-3 text-left text-[14px] text-ink transition-colors duration-150 hover:text-accent"
              >
                <span>
                  {o.name} <span className="text-ink-3">({o.ticker})</span>
                </span>
                <ArrowRightIcon size={14} className="shrink-0 text-ink-4 transition-colors duration-150 group-hover:text-ink-2" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="mt-4 flex gap-2">
        <label htmlFor="clarify-company" className="sr-only">
          Company name or ticker
        </label>
        <input
          id="clarify-company"
          type="text"
          value={typed}
          maxLength={100}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Or type the exact company name or ticker"
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-ink-4 focus:border-line-strong"
        />
        <button
          type="submit"
          disabled={!typed.trim()}
          className="rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-canvas transition-colors duration-150 hover:bg-accent-hover disabled:bg-subtle disabled:text-ink-4"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

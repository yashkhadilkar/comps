"use client";

import { useId, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon, SpinnerIcon } from "@/components/ui/icons";
import { MAX_QUESTION_LENGTH } from "@/lib/validation";

// The one question input. `hero` is the large empty-state surface, `dock` the compact sticky follow-up bar.
export function QuestionComposer({
  value,
  onChange,
  onSubmit,
  loading,
  variant,
  inputError,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  variant: "hero" | "dock";
  inputError?: string | null;
  autoFocus?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const isHero = variant === "hero";
  const canSubmit = !loading && value.trim().length > 0;

  // Grow with the text, up to a cap.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, isHero ? 220 : 160)}px`;
  }, [value, isHero]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  // Enter sends, Shift+Enter adds a line. Ignore Enter while an IME is composing.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSubmit) onSubmit();
    }
  }

  const submit = (
    <button
      type="submit"
      disabled={!canSubmit}
      aria-label={loading ? "Researching" : "Ask"}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-canvas transition-colors duration-150 hover:bg-accent-hover disabled:bg-subtle disabled:text-ink-4"
    >
      {loading ? <SpinnerIcon size={15} /> : <ArrowUpIcon size={16} />}
    </button>
  );

  const textarea = (
    <textarea
      ref={ref}
      id={id}
      rows={1}
      autoFocus={autoFocus}
      maxLength={MAX_QUESTION_LENGTH}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      disabled={loading}
      aria-invalid={inputError ? true : undefined}
      aria-describedby={inputError ? `${id}-error` : undefined}
      placeholder={
        isHero ? "Ask about revenue, margins, cash flow, or peer performance…" : "Ask a follow-up…"
      }
      className={`block w-full resize-none bg-transparent text-ink outline-none placeholder:text-ink-4 disabled:opacity-60 ${
        isHero ? "min-h-16 text-base leading-6" : "min-h-6 text-sm leading-6"
      }`}
    />
  );

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor={id} className="sr-only">
        Your question
      </label>
      <div
        className={`rounded-lg border bg-raised transition-colors duration-150 focus-within:border-line-strong ${
          inputError ? "border-neg/60" : "border-line"
        } ${isHero ? "px-4 pb-3 pt-4" : "px-3.5 py-2.5"}`}
      >
        {isHero ? (
          <>
            {textarea}
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-4" aria-hidden={value.length === 0}>
                {value.length > 0 ? `${value.length}/${MAX_QUESTION_LENGTH}` : "Enter to send · Shift+Enter for a new line"}
              </span>
              {submit}
            </div>
          </>
        ) : (
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1 py-1">{textarea}</div>
            {submit}
          </div>
        )}
      </div>
      {inputError && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[13px] text-neg">
          {inputError}
        </p>
      )}
    </form>
  );
}

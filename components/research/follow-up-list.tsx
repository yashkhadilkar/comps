import { ArrowRightIcon } from "@/components/ui/icons";

// Exactly the follow-ups the agent returned, as full-width research continuations. Clicking asks right away.
export function FollowUpList({
  questions,
  onAsk,
  disabled = false, // true while previewing: shown, but not clickable until the answer is final
}: {
  questions: string[];
  onAsk: (question: string) => void;
  disabled?: boolean;
}) {
  if (!questions.length) return null;
  return (
    <section aria-labelledby="followups-heading" className="mt-10">
      <h2 id="followups-heading" className="text-[13px] font-medium text-ink-2">
        Ask a follow-up
      </h2>
      <ul className="mt-2 border-y border-line-subtle">
        {questions.map((q) => (
          <li key={q} className="border-b border-line-subtle last:border-0">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAsk(q)}
              className="group flex w-full items-center justify-between gap-4 py-3 text-left text-[14px] text-ink-2 transition-colors duration-150 hover:text-ink"
            >
              <span>{q}</span>
              <ArrowRightIcon size={14} className="shrink-0 text-ink-4 transition-colors duration-150 group-hover:text-ink-2" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

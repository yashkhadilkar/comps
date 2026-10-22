import { ArrowUpRightIcon } from "@/components/ui/icons";

export function ExampleQuestions({ questions, onPick }: { questions: string[]; onPick: (q: string) => void }) {
  return (
    <section aria-labelledby="examples-heading" className="mt-8">
      <h2 id="examples-heading" className="text-xs font-medium text-ink-3">
        Try asking
      </h2>
      <ul className="mt-2.5 space-y-2">
        {questions.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onPick(q)}
              className="group flex w-full items-center justify-between gap-4 rounded-md border border-line-subtle px-3.5 py-2.5 text-left text-[13px] text-ink-2 transition-colors duration-150 hover:border-line hover:bg-subtle hover:text-ink"
            >
              <span>{q}</span>
              <ArrowUpRightIcon size={14} className="shrink-0 text-ink-4 transition-colors duration-150 group-hover:text-ink-2" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

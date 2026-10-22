// The asked question as a document heading (not a chat bubble).
export function QuestionHeader({ question }: { question: string }) {
  return (
    <header>
      <p className="text-xs font-medium uppercase tracking-wider text-ink-3">Research</p>
      <h1 className="mt-2 text-balance text-2xl font-semibold leading-snug text-ink sm:text-[28px]">{question}</h1>
      <p className="mt-2 text-xs text-ink-4">Asked just now</p>
    </header>
  );
}

"use client";

import { useEffect, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { InfoIcon } from "@/components/ui/icons";
import type { AgentResult, AnswerExtras, AnswerKind, AnswerTable as AnswerTableData } from "@/lib/agent/types";
import { stripMarkersForDraft } from "@/lib/agent/partialJson";
import { SpinnerIcon } from "@/components/ui/icons";
import { AnswerTable } from "./research/answer-table";
import { ClarifyChoices } from "./research/clarify-choices";
import { linkMarkers, markdownMarkerClass } from "./research/citation-marker";
import { FollowUpList } from "./research/follow-up-list";
import { usePacedCount, usePacedText } from "./research/use-reveal";
import { SourcesList } from "./research/sources-list";
import { StatePanel } from "./research/state-panel";

type MdProps<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T>;

// Research-note typography for the model's prose. Raw HTML is not rendered; links open in a new tab.
function Prose({ markdown, known }: { markdown: string; known: Set<string> }) {
  return (
    <div className="text-[15px] leading-[1.7] text-ink sm:text-base sm:leading-[1.7]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (p: MdProps<"p">) => <p className="mb-4 last:mb-0">{p.children}</p>,
          ul: (p: MdProps<"ul">) => <ul className="mb-4 list-disc space-y-1.5 pl-5 last:mb-0">{p.children}</ul>,
          ol: (p: MdProps<"ol">) => <ol className="mb-4 list-decimal space-y-1.5 pl-5 last:mb-0">{p.children}</ol>,
          strong: (p: MdProps<"strong">) => <strong className="font-medium text-ink">{p.children}</strong>,
          h1: (p: MdProps<"h1">) => <p className="mb-2 font-semibold">{p.children}</p>,
          h2: (p: MdProps<"h2">) => <p className="mb-2 font-semibold">{p.children}</p>,
          h3: (p: MdProps<"h3">) => <p className="mb-2 font-semibold">{p.children}</p>,
          table: (p: MdProps<"table">) => (
            <div className="mb-4 overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums">{p.children}</table>
            </div>
          ),
          th: ({ style, children }: MdProps<"th">) => (
            <th style={style} className="border-b border-line px-3 py-2 text-left text-xs font-medium text-ink-3 first:pl-0">
              {children}
            </th>
          ),
          td: ({ style, children }: MdProps<"td">) => (
            <td style={style} className="border-b border-line-subtle px-3 py-2 align-top first:pl-0">
              {children}
            </td>
          ),
          blockquote: (p: MdProps<"blockquote">) => (
            <blockquote className="mb-4 border-l-2 border-line pl-4 text-ink-2 last:mb-0">{p.children}</blockquote>
          ),
          a: ({ href, children }: MdProps<"a">) =>
            href?.startsWith("#source-") ? (
              <sup>
                <a href={href} className={markdownMarkerClass}>
                  {children}
                </a>
              </sup>
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:text-accent-hover hover:underline"
              >
                {children}
              </a>
            ),
        }}
      >
        {linkMarkers(markdown, known)}
      </ReactMarkdown>
    </div>
  );
}

// The answer while it is still being written: the prose, then tables, sources and follow-ups, each revealed at a
// readable pace as it arrives. Everything here is a PREVIEW: the prose is unverified, markers are hidden, and only
// rows/sources the server already verified are shown. `done` means the validated answer has arrived: the preview
// finishes quickly and then calls onDrained so the validated AnswerView takes over.
export function DraftAnswer({
  text,
  extras,
  done,
  onDrained,
}: {
  text: string;
  extras: AnswerExtras | null;
  done: boolean;
  onDrained: () => void;
}) {
  const { text: shown, drained } = usePacedText(stripMarkersForDraft(text), done);

  // Reveal units in page order: per table a header then its rows, then sources, then follow-ups.
  const tables = extras?.tables ?? [];
  const sources = extras?.sources ?? [];
  const followUps = extras?.followUps ?? [];
  const total = tables.reduce((n, t) => n + 1 + t.rows.length, 0) + sources.length + followUps.length;
  const visible = usePacedCount(total, drained, done);
  const allShown = drained && visible >= total;

  useEffect(() => {
    if (!done) return;
    if (allShown) {
      onDrained();
      return;
    }
    const t = setTimeout(onDrained, 2500); // never hold the validated answer back for long
    return () => clearTimeout(t);
  }, [done, allShown, onDrained]);

  let left = visible;
  const shownTables: AnswerTableData[] = [];
  for (const t of tables) {
    if (left <= 0) break;
    left -= 1;
    const rows = t.rows.slice(0, left).map((r) => r.map(stripMarkersForDraft));
    left -= rows.length;
    shownTables.push({ ...t, rows });
  }
  const shownSources = sources.slice(0, Math.max(0, left));
  left -= shownSources.length;
  const shownFollowUps = followUps.slice(0, Math.max(0, left));

  const status = !drained ? "Writing the answer" : !done ? "Checking sources and building tables" : null;
  return (
    <section aria-label="Answer (writing)" aria-busy="true" className="mt-8">
      {status && (
        <p className="mb-3 flex items-center gap-2 text-xs text-ink-3">
          <SpinnerIcon size={12} />
          {status}
        </p>
      )}
      <Prose markdown={shown} known={new Set()} />
      {shownTables.map((table, ti) => (
        <div key={ti} className="reveal">
          <AnswerTable table={table} known={new Set()} />
        </div>
      ))}
      {shownSources.length > 0 && (
        <div className="reveal">
          <SourcesList sources={shownSources} />
        </div>
      )}
      {shownFollowUps.length > 0 && (
        <div className="reveal">
          <FollowUpList questions={shownFollowUps} onAsk={() => {}} disabled />
        </div>
      )}
    </section>
  );
}

function Notes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <aside aria-labelledby="notes-heading" className="mt-8 rounded-md border-l-2 border-line-strong bg-raised px-4 py-3">
      <h2 id="notes-heading" className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
        <InfoIcon size={13} />
        Notes
      </h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[13px] leading-5 text-ink-2 marker:text-ink-4">
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </aside>
  );
}

const TITLES: Partial<Record<AnswerKind, string>> = {
  clarification: "A quick question",
  not_covered: "Not covered by Comps",
  declined: "Comps doesn't make investment recommendations",
  off_topic: "Outside what Comps covers",
  insufficient_data: "Not enough data to answer fully",
  error: "We couldn't complete this research",
};

// Short fixed context under the model's own explanation (the model's text stays the main content).
const HINTS: Partial<Record<AnswerKind, ReactNode>> = {
  not_covered: "Comps analyzes companies that report through SEC EDGAR.",
  declined: "Comps compares reported fundamentals. Not investment advice.",
};

export function AnswerView({
  result,
  onAsk,
  retryQuestion,
}: {
  result: AgentResult;
  onAsk?: (question: string) => void; // omitted for saved (read-only) results: no choices, follow-ups or retry
  retryQuestion?: string; // lets the "error" kind offer Try again
}) {
  const { answer } = result;
  const known = new Set(answer.sources.map((s) => String(s.n)));
  const isAnswer = answer.kind === "answer";
  // Partial research is kept for "insufficient_data"; other non-answers carry no tables or sources.
  const showEvidence = isAnswer || answer.kind === "insufficient_data";

  if (onAsk && answer.kind === "clarification" && answer.clarification) {
    return (
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">
          Which company did you mean by &ldquo;{answer.clarification.query}&rdquo;?
        </h2>
        <p className="mt-1 text-[13px] text-ink-3">More than one company that files with the SEC matches.</p>
        <ClarifyChoices clarification={answer.clarification} onAsk={onAsk} />
      </section>
    );
  }

  const body = (
    <>
      <Prose markdown={answer.answerMarkdown} known={known} />
      {HINTS[answer.kind] && <p className="mt-3 text-xs text-ink-3">{HINTS[answer.kind]}</p>}
    </>
  );

  return (
    <div className="mt-8">
      {isAnswer ? (
        <section aria-label="Answer">{body}</section>
      ) : (
        <StatePanel tone={answer.kind === "error" ? "error" : "neutral"} title={TITLES[answer.kind] ?? "Comps says"}>
          {body}
          {answer.kind === "error" && retryQuestion && onAsk && (
            <button
              type="button"
              onClick={() => onAsk(retryQuestion)}
              className="mt-3 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink"
            >
              Try again
            </button>
          )}
        </StatePanel>
      )}

      {showEvidence && answer.tables.map((table, ti) => <AnswerTable key={ti} table={table} known={known} />)}
      <Notes notes={answer.notes} />
      {showEvidence && <SourcesList sources={answer.sources} />}
      {onAsk && answer.kind !== "error" && <FollowUpList questions={answer.followUps} onAsk={onAsk} />}

      {isAnswer && <p className="mt-10 text-xs text-ink-4">Figures from SEC filings. Not investment advice.</p>}
    </div>
  );
}

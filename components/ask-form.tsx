"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/types";
import type { ThreadDetail } from "@/lib/history";
import type { UsageDenial } from "@/lib/usage-types";
import { PRO_DAILY_LIMIT, PRO_PRICE_USD } from "@/lib/plans";
import { validateQuestion } from "@/lib/validation";
import { NEW_QUESTION_EVENT, THREAD_ACTIVITY_EVENT, type ThreadActivity } from "./layout/events";
import { AgentTrace } from "./agent-trace";
import { AnswerView, DraftAnswer } from "./answer-view";
import { ComparabilityCautions } from "./research/comparability-cautions";
import { SavedTime } from "./history/saved-time";
import { applyEvent, newTurn, turnView, updateTurn, type LiveTurn } from "./research/conversation";
import { ExampleQuestions } from "./research/example-questions";
import { QuestionComposer } from "./research/question-composer";
import { QuestionHeader } from "./research/question-header";
import { StatePanel } from "./research/state-panel";
import { useFollowScroll } from "./research/use-follow-scroll";

const EXAMPLES = [
  "Compare Nike, Lululemon, and Under Armour's gross margin over the last 5 years",
  "How has Deckers' revenue and operating income grown since 2020?",
  "Compare Nike and Under Armour's revenue, operating income and net income",
  "How have VF Corp's margins changed over the last 5 years?",
];

// The research workspace: owns the question and every turn asked in this visit. Without `initialThread` it is the
// empty-state home page, and the first answer creates a thread that later follow-ups in this session continue, each
// appended below the last. With `initialThread` (/history/[threadId]) it shows the saved turns, and every question
// continues that thread the same way.
export function AskForm({ initialThread }: { initialThread?: ThreadDetail }) {
  // Saved turns as loaded when the page opened. Turns asked here stay live turns until the page is loaded again, so
  // a completed turn is never swapped for its saved copy mid-conversation (which could hide or duplicate a turn).
  const [savedTurns] = useState(() => initialThread?.runs ?? []);
  const [liveTurns, setLiveTurns] = useState<LiveTurn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(initialThread?.id ?? null);
  const liveRef = useRef<HTMLElement>(null); // the newest live turn
  const contentRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef(initialThread?.title ?? ""); // thread title for the sidebar (the first question of a new thread)
  const turnSeq = useRef(0);
  const jumpTo = useRef<string | null>(null); // a new turn below earlier ones: bring it into view once it renders
  const refreshFor = useRef<string | null>(null); // refresh the server-rendered parts once this turn's answer shows
  const [draft, setDraft] = useState(""); // what is typed in the composer
  const [loading, setLoading] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null); // the question was rejected before any request
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  const last = liveTurns.at(-1);
  const follow = useFollowScroll(contentRef, loading || (last?.result ?? null) !== null);

  async function ask(raw: string) {
    if (abortRef.current) return; // one run at a time
    const validation = validateQuestion(raw);
    if (!validation.ok) {
      setInputError(validation.error);
      return;
    }
    const question = validation.question;

    const controller = new AbortController();
    abortRef.current = controller;

    // Everything below changes only this turn; earlier turns are never touched.
    const id = `turn-${++turnSeq.current}`;
    const update = (change: (turn: LiveTurn) => LiveTurn) => setLiveTurns((turns) => updateTurn(turns, id, change));
    const hasEarlier = savedTurns.length > 0 || liveTurns.length > 0;

    setLiveTurns((turns) => [...turns, newTurn(id, question)]);
    setDraft("");
    setLoading(true);
    setInputError(null);
    if (hasEarlier) jumpTo.current = id;
    else window.scrollTo({ top: 0 });
    follow(); // follow the new research as it grows, until the reader scrolls up

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, ...(threadId ? { threadId } : {}) }),
        signal: controller.signal,
      });

      // Auth, validation and limit errors come back as plain JSON before streaming starts.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        if (res.status === 402 && (data?.code === "FREE_LIMIT_REACHED" || data?.code === "DAILY_LIMIT_REACHED")) {
          update((t) => ({ ...t, limit: data as UsageDenial }));
          router.refresh(); // sync the plan badge with the server's count
          return;
        }
        update((t) => ({ ...t, runError: data?.error ?? "Something went wrong. Please try again." }));
        return;
      }

      // Follow-ups from here on belong to this thread (set by the server for new conversations).
      const returnedThread = res.headers.get("x-thread-id");
      if (returnedThread) {
        setThreadId(returnedThread);
        // Sidebar: show a new thread (or move a continued one to the top) now that the server has accepted the question.
        if (!threadId) titleRef.current = question.slice(0, 120);
        window.dispatchEvent(
          new CustomEvent<ThreadActivity>(THREAD_ACTIVITY_EVENT, { detail: { id: returnedThread, title: titleRef.current } }),
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotFinal = false;
      let gotResult = false;

      const handleLine = (line: string) => {
        if (!line.trim()) return;
        let event: AgentEvent;
        try {
          event = JSON.parse(line) as AgentEvent;
        } catch {
          return;
        }
        if (event.type === "final") gotFinal = gotResult = true;
        else if (event.type === "error") gotFinal = true;
        update((t) => applyEvent(t, event));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handleLine);
      }
      handleLine(buffer);

      // The run is persisted by now, so re-render the server-side plan badge and sidebar with the new counts.
      // With a result, refresh once it is actually on screen (see the effect below), so the re-render does not land
      // while a preview is still finishing. Errors have nothing to wait for.
      if (gotFinal && !gotResult) router.refresh();
      else if (gotResult) refreshFor.current = id;
      if (!gotFinal) update((t) => ({ ...t, runError: "The connection ended before an answer arrived. Please try again." }));
    } catch {
      // A reset or unmount aborts the request on purpose; that is not an error to show.
      if (!controller.signal.aborted) update((t) => ({ ...t, runError: "Couldn't reach the server. Check your connection and try again." }));
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }

  // Back to the empty state (the sidebar's "New question"). Aborting also cancels the run on the server.
  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setThreadId(null); // "New question" always starts a new thread
    titleRef.current = "";
    jumpTo.current = null;
    refreshFor.current = null;
    setLiveTurns([]);
    setDraft("");
    setLoading(false);
    setInputError(null);
  }, []);

  useEffect(() => {
    window.addEventListener(NEW_QUESTION_EVENT, reset);
    return () => {
      window.removeEventListener(NEW_QUESTION_EVENT, reset);
      abortRef.current?.abort();
    };
  }, [reset]);

  const handleDrained = useCallback(
    (id: string) => setLiveTurns((turns) => updateTurn(turns, id, (t) => ({ ...t, draftDone: true }))),
    [],
  );

  useEffect(() => {
    const pending = liveTurns.find((t) => t.id === refreshFor.current);
    if (pending && turnView(pending).resultVisible) {
      refreshFor.current = null;
      router.refresh();
    }
  }, [liveTurns, router]);

  const lastId = last?.id;
  useEffect(() => {
    // Jump (not animate) so the follow-scroll sees a settled position; the hook then tracks growth.
    if (lastId && jumpTo.current === lastId) {
      jumpTo.current = null;
      liveRef.current?.scrollIntoView({ block: "start" });
    }
  }, [lastId]);

  if (liveTurns.length === 0 && !initialThread) {
    return (
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col justify-center px-4 pb-24 pt-12 sm:px-6">
        <h1 className="text-balance text-center text-2xl font-semibold text-ink sm:text-[28px]">
          Research companies with cited financials
        </h1>
        <p className="mt-2 text-center text-[15px] text-ink-3">
          Compare fundamentals across years and peers using SEC filings.
        </p>
        <div className="mt-8">
          <QuestionComposer
            variant="hero"
            value={draft}
            onChange={(v) => {
              setDraft(v);
              setInputError(null);
            }}
            onSubmit={() => void ask(draft)}
            loading={loading}
            inputError={inputError}
            autoFocus
          />
        </div>
        <ExampleQuestions questions={EXAMPLES} onPick={(q) => void ask(q)} />
      </div>
    );
  }

  // Saved turns first, then this visit's turns, all in order. Only the newest turn offers follow-ups, choices and
  // retry, and only when nothing is running.
  const total = savedTurns.length + liveTurns.length;
  const onAskFor = (i: number) => (i === total - 1 && !loading ? (q: string) => void ask(q) : undefined);
  const sectionClass = (i: number) =>
    `scroll-mt-6 ${i === 0 ? (initialThread ? "mt-8" : "") : "mt-12 border-t border-line-subtle pt-8"}`;

  return (
    <div className="flex flex-1 flex-col">
      <div ref={contentRef} className="mx-auto w-full max-w-(--answer-max) flex-1 px-4 pb-10 pt-8 sm:px-6 sm:pt-10">
        {initialThread && (
          <>
            <Link href="/history" className="text-[13px] text-ink-3 transition-colors duration-150 hover:text-ink">
              &larr; History
            </Link>
            <header className="mt-5">
              <p className="text-xs font-medium uppercase tracking-wider text-ink-3">Research thread</p>
              <h1 className="mt-2 text-balance text-2xl font-semibold leading-snug text-ink [overflow-wrap:anywhere] sm:text-[28px]">
                {initialThread.title}
              </h1>
            </header>
          </>
        )}
        {savedTurns.map((turn, i) => (
          <section key={turn.id} aria-label={`Question ${i + 1}`} className={sectionClass(i)}>
            <TurnHeader question={turn.question} createdAt={turn.createdAt} />
            <AgentTrace steps={turn.run.steps} loading={false} />
            {turn.run.audit && <ComparabilityCautions audit={turn.run.audit} />}
            <AnswerView result={{ status: "success", answer: turn.run.answer, trace: turn.run.steps }} onAsk={onAskFor(i)} />
          </section>
        ))}
        {liveTurns.map((turn, j) => {
          const i = savedTurns.length + j;
          const newest = j === liveTurns.length - 1;
          return (
            <section key={turn.id} ref={newest ? liveRef : undefined} aria-label={`Question ${i + 1}`} className={sectionClass(i)}>
              <LiveTurnView
                turn={turn}
                heading={!initialThread && i === 0 ? "page" : "turn"}
                running={newest && loading}
                onAsk={onAskFor(i)}
                onDrained={handleDrained}
              />
            </section>
          );
        })}
      </div>

      <div className="sticky bottom-0 z-10 bg-gradient-to-t from-canvas from-70% to-transparent pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <div className="mx-auto w-full max-w-(--answer-max) px-4 sm:px-6">
          <QuestionComposer
            variant="dock"
            value={draft}
            onChange={(v) => {
              setDraft(v);
              setInputError(null);
            }}
            onSubmit={() => void ask(draft)}
            loading={loading}
            inputError={inputError}
          />
        </div>
      </div>
    </div>
  );
}

// One turn asked in this visit: its question, trace, and then the preview, the validated answer, or why it failed.
function LiveTurnView({
  turn,
  heading,
  running,
  onAsk,
  onDrained,
}: {
  turn: LiveTurn;
  heading: "page" | "turn"; // the first question on the home page is the page heading
  running: boolean;
  onAsk?: (question: string) => void; // only on the newest turn when nothing is running
  onDrained: (id: string) => void;
}) {
  const { resultVisible, previewVisible } = turnView(turn);
  const { id } = turn;
  const drained = useCallback(() => onDrained(id), [onDrained, id]);

  return (
    <>
      {heading === "page" ? <QuestionHeader question={turn.question} /> : <TurnHeader question={turn.question} />}
      <AgentTrace steps={turn.steps} loading={running} />

      {turn.limit && <LimitPanel denial={turn.limit} />}

      {turn.runError && (
        <div className="mt-8">
          <StatePanel tone="error" title="We couldn't complete this research">
            <p>{turn.runError}</p>
            {onAsk && (
              <button
                type="button"
                onClick={() => onAsk(turn.question)}
                className="mt-3 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:bg-subtle hover:text-ink"
              >
                Try again
              </button>
            )}
          </StatePanel>
        </div>
      )}

      {previewVisible && <DraftAnswer text={turn.draftAnswer} extras={turn.draftExtras} done={turn.result !== null} onDrained={drained} />}

      {resultVisible && turn.result && turn.audit && <ComparabilityCautions audit={turn.audit} />}
      {resultVisible && turn.result && <AnswerView result={turn.result} onAsk={onAsk} retryQuestion={turn.question} />}
    </>
  );
}

function formatReset(iso: string | null) {
  if (!iso) return "midnight UTC";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "midnight UTC";
  return `${d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} (midnight UTC)`;
}

// 402 from /api/agent: the user is out of questions. Informational, not a server error.
function LimitPanel({ denial }: { denial: UsageDenial }) {
  if (denial.code === "FREE_LIMIT_REACHED") {
    return (
      <div className="mt-8">
        <StatePanel title={`You've used all ${denial.usage.limit} free questions`}>
          <p>Upgrade to Pro for {PRO_DAILY_LIMIT} questions a day. One-time ${PRO_PRICE_USD}, no subscription.</p>
          <Link
            href="/pricing"
            className="mt-3 inline-block rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-canvas transition-opacity duration-150 hover:opacity-90"
          >
            Upgrade to Pro
          </Link>
        </StatePanel>
      </div>
    );
  }
  return (
    <div className="mt-8">
      <StatePanel title="You've reached today's limit">
        <p>
          You&rsquo;ve used all {denial.usage.limit} questions for today. Your limit resets {formatReset(denial.usage.resetAt)}.
        </p>
      </StatePanel>
    </div>
  );
}

// One turn's question inside a thread: a section heading under the thread title.
function TurnHeader({ question, createdAt }: { question: string; createdAt?: string }) {
  return (
    <header>
      <h2 className="text-balance text-lg font-semibold leading-snug text-ink [overflow-wrap:anywhere] sm:text-xl">{question}</h2>
      {createdAt ? (
        <SavedTime iso={createdAt} className="mt-1.5 block text-xs text-ink-4" />
      ) : (
        <p className="mt-1.5 text-xs text-ink-4">Asked just now</p>
      )}
    </header>
  );
}

import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/loop";
import { runResearchAudit } from "@/lib/audit/research";
import { fetchCompanyData } from "@/lib/audit/retrieve";
import { createAgentStream } from "@/lib/agent/runStream";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/server";
import { createThread, isThreadId, loadPriorContext, touchThread, userOwnsThread } from "@/lib/threads";
import { checkUsage, usageDenialBody } from "@/lib/usage";
import { validateQuestion } from "@/lib/validation";

// Agent runs can take 30 to 60 seconds.
export const maxDuration = 120;

// Streams NDJSON (one AgentEvent per line): "step" events while the agent works, then one
// "final" event (or "error"). Auth and validation errors are plain JSON with a status code,
// returned before any streaming starts.
export async function POST(request: Request) {
  try {
    // getCurrentUser reads cookies, so call it before the stream is created.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Please log in to ask a question." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Send a JSON body like { "question": "..." }.' },
        { status: 400 },
      );
    }

    const validation = validateQuestion((body as { question?: unknown } | null)?.question);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { question } = validation;

    // Optional thread to continue. Only the id comes from the browser; history is always derived server-side.
    const rawThreadId = (body as { threadId?: unknown } | null)?.threadId;
    if (rawThreadId != null && !isThreadId(rawThreadId)) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }
    let threadId: string | null = isThreadId(rawThreadId) ? rawThreadId : null;
    // Ownership is checked before usage and before any model spend. Another user's thread looks like a missing one.
    if (threadId && !(await userOwnsThread(user.id, threadId))) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    // Usage is checked before the stream (and any model spend). A failed check throws to the 500 below
    // rather than letting the run through.
    const usage = await checkUsage(user.id);
    if (!usage.allowed) {
      return NextResponse.json(usageDenialBody(usage), { status: 402 });
    }

    // A new conversation gets its thread only now (auth, validation and quota passed), so rejected requests leave no
    // empty threads. Context for a continued thread must load completely or the request fails (no partial context).
    let priorContext = "";
    if (threadId) priorContext = await loadPriorContext(user.id, threadId);
    else threadId = await createThread(user.id, question);
    const runThreadId = threadId;

    const stream = createAgentStream(question, {
      run: (q, onStep, signal, onAnswerDelta, onAnswerExtras) =>
        runAgent(q, onStep, signal, priorContext, onAnswerDelta, onAnswerExtras),
      // Deterministic, bounded (6s), no model call; only for validated answers comparing 2+ companies.
      audit: (result, signal) => runResearchAudit(result, fetchCompanyData, { signal }),
      save: async (record) => {
        // createAdminClient throws if env vars are missing; createAgentStream treats that as a failed save.
        const { error } = await createAdminClient()
          .from("runs")
          .insert({ user_id: user.id, thread_id: runThreadId, ...record });
        if (error) throw new Error(error.message);
        await touchThread(user.id, runThreadId);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Thread-Id": runThreadId, // lets the client keep follow-ups in this thread without changing the NDJSON events
      },
    });
  } catch (err) {
    console.error("[api/agent]", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}

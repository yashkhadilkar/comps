import { NextResponse } from "next/server";
import { fetchCompanyData } from "@/lib/audit/retrieve";
import { handleAudit } from "@/lib/audit/handler";
import { getCurrentUser } from "@/lib/supabase/server";

// Two SEC retrievals plus one bounded model call; the handler aborts at 45s.
export const maxDuration = 60;

// Comparability audit: { tickerA, tickerB, period } -> { audit } as plain JSON (not streamed).
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const res = await handleAudit(
      body,
      {
        getUser: getCurrentUser,
        fetchCompany: fetchCompanyData,
        interpret: process.env.ANTHROPIC_API_KEY ? undefined : null,
      },
      request.signal,
    );
    return NextResponse.json(res.body, { status: res.status });
  } catch (err) {
    console.error("[api/audit]", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

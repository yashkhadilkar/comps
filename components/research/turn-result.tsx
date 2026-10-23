import { AnswerView } from "@/components/answer-view";
import type { AgentResult } from "@/lib/agent/types";
import type { ResearchAuditSummary } from "@/lib/audit/types";
import { ComparabilityCautions } from "./comparability-cautions";

// A turn's validated result: the complete answer (prose, tables, notes, sources, follow-ups) first, then its integrity
// review. The review arrives after the answer has streamed, so it goes below it and never pushes read content down.
// Shared by live and saved turns so both keep the same order.
export function TurnResult({
  result,
  audit,
  onAsk,
  retryQuestion,
}: {
  result: AgentResult;
  audit: ResearchAuditSummary | null;
  onAsk?: (question: string) => void;
  retryQuestion?: string;
}) {
  return (
    <>
      <AnswerView result={result} onAsk={onAsk} retryQuestion={retryQuestion} />
      {audit && <ComparabilityCautions audit={audit} />}
    </>
  );
}

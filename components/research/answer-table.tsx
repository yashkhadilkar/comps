import type { AnswerTable as AnswerTableData } from "@/lib/agent/types";
import { renderWithMarkers } from "./citation-marker";
import { isMissingCell, splitPeriod } from "./format";

function Cell({ text, known }: { text: string; known: Set<string> }) {
  if (isMissingCell(text)) {
    return (
      <span className="text-ink-4" title={text} aria-label={text}>
        —
      </span>
    );
  }
  const { main, secondary } = splitPeriod(text);
  return (
    <>
      <span>{renderWithMarkers(main, known)}</span>
      {secondary && <span className="block text-[11px] font-normal leading-4 text-ink-3">{secondary}</span>}
    </>
  );
}

// Dense comparison table from `answer.tables`: muted headers, hairline rows, right-aligned tabular numbers.
// Period ends stay visible as a second line under the fiscal-year label.
export function AnswerTable({ table, known }: { table: AnswerTableData; known: Set<string> }) {
  return (
    <section className="mt-8">
      <h3 className="text-[13px] font-medium text-ink-2">{table.title}</h3>
      <div
        role="region"
        aria-label={`${table.title}, scrollable table`}
        tabIndex={0}
        className="mt-2 overflow-x-auto border-y border-line-subtle"
      >
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-line-subtle">
              {table.columns.map((c, ci) => {
                const { main, secondary } = splitPeriod(c);
                return (
                  <th
                    key={ci}
                    scope="col"
                    className={`whitespace-nowrap px-3 py-2.5 align-bottom text-xs font-medium text-ink-3 first:pl-0 last:pr-0 ${
                      ci === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {main}
                    {secondary && <span className="block text-[11px] font-normal leading-4 text-ink-4">{secondary}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} className="border-b border-line-subtle last:border-0">
                {row.map((cell, ci) =>
                  ci === 0 ? (
                    <th
                      key={ci}
                      scope="row"
                      className="min-w-32 px-3 py-3 pl-0 text-left align-top text-[13px] font-medium text-ink"
                    >
                      <Cell text={cell} known={known} />
                    </th>
                  ) : (
                    <td key={ci} className="whitespace-nowrap px-3 py-3 text-right align-top text-ink last:pr-0">
                      <Cell text={cell} known={known} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

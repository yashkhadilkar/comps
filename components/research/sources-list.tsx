import { ArrowUpRightIcon } from "@/components/ui/icons";
import type { Source } from "@/lib/agent/types";
import { formatDate } from "./format";

function SourceRow({ s }: { s: Source }) {
  const title = s.type === "filing" ? `${s.company} ${s.form}` : s.title;
  const meta =
    s.type === "filing"
      ? `FY${s.fiscalYear} · ended ${formatDate(s.periodEnd)} · filed ${formatDate(s.filed)} · SEC EDGAR`
      : [s.domain, s.publishedDate ? formatDate(s.publishedDate) : null].filter(Boolean).join(" · ");

  return (
    <li id={`source-${s.n}`} className="scroll-mt-20">
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group -mx-2 flex items-start gap-3 rounded-md px-2 py-2.5 transition-colors duration-150 hover:bg-subtle"
      >
        <span className="w-7 shrink-0 pt-0.5 text-xs tabular-nums text-ink-3">[{s.n}]</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-5 text-ink">{title}</span>
          <span className="mt-0.5 block text-xs leading-5 text-ink-3">{meta}</span>
        </span>
        <ArrowUpRightIcon size={14} className="mt-1 shrink-0 text-ink-4 transition-colors duration-150 group-hover:text-ink-2" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </li>
  );
}

export function SourcesList({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <section aria-labelledby="sources-heading" className="mt-10">
      <h2 id="sources-heading" className="text-[13px] font-medium text-ink-2">
        Sources
      </h2>
      <ol className="mt-2">
        {sources.map((s) => (
          <SourceRow key={s.n} s={s} />
        ))}
      </ol>
    </section>
  );
}

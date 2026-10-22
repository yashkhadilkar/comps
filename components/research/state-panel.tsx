import type { ReactNode } from "react";
import { AlertIcon, InfoIcon } from "@/components/ui/icons";

// A restrained in-workspace panel for non-answer results and errors. Red is only the icon and left rule.
export function StatePanel({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "error";
  title: string;
  children?: ReactNode;
}) {
  const isError = tone === "error";
  return (
    <section
      role={isError ? "alert" : undefined}
      className={`rounded-md border border-line-subtle border-l-2 bg-raised px-5 py-4 ${
        isError ? "border-l-neg" : "border-l-line-strong"
      }`}
    >
      <h2 className="flex items-center gap-2 text-[15px] font-medium text-ink">
        {isError ? <AlertIcon size={16} className="text-neg" /> : <InfoIcon size={16} className="text-ink-3" />}
        {title}
      </h2>
      {children && <div className="mt-2 text-[14px] leading-6 text-ink-2">{children}</div>}
    </section>
  );
}

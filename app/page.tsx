import { AskForm } from "@/components/ask-form";
import { AppShell } from "@/components/layout/app-shell";

export default function Home() {
  return (
    <AppShell section="Research" requireUser>
      <AskForm />
    </AppShell>
  );
}

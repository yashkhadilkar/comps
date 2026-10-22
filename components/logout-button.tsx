"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOutIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink disabled:opacity-50"
    >
      <LogOutIcon size={15} />
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}

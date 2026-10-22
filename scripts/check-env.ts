// Prints whether each env var the agent needs is set. Never prints values.
const names = [
  "ANTHROPIC_API_KEY",
  "LLM_MODEL",
  "TAVILY_API_KEY",
  "SEC_USER_AGENT",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
];
let missing = 0;
for (const name of names) {
  const ok = !!process.env[name];
  if (!ok) missing++;
  console.log(`${name}: ${ok ? "set" : "MISSING"}`);
}
process.exit(missing ? 1 : 0);

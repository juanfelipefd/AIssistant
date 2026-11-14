import { getMonthToDateUsage } from "@/lib/ai";

// Read from the database on every request — never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const usage = await getMonthToDateUsage();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white px-4 text-center dark:bg-black">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Model spend, month-to-date (UTC) — estimated
      </p>
      <p className="text-4xl font-semibold text-black dark:text-white">
        ${usage.costUsd.toFixed(4)}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {usage.inputTokens.toLocaleString("en-US")} input ·{" "}
        {usage.outputTokens.toLocaleString("en-US")} output tokens
      </p>
    </div>
  );
}

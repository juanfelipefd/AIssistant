"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    setSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError(true);
        setSubmitting(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError(true);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-4 text-center dark:bg-black">
      <h1 className="text-2xl font-semibold text-black dark:text-white">
        AIssistant
      </h1>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-xs flex-col gap-3"
      >
        <input
          type="password"
          name="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-black dark:text-white dark:focus:border-zinc-400"
          placeholder="Password"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        {error && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Something went wrong. Try again.
          </p>
        )}
      </form>
    </div>
  );
}

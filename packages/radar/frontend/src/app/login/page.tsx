"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { branding } from "@/lib/branding";

export default function LoginPage() {
  const { login, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md px-4">
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] p-8 shadow-lg">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center">
            <div className="relative flex h-12 w-12 items-center justify-center">
              <div className="absolute inset-0 rounded-full border border-radar-500/30" />
              <div className="absolute inset-1.5 rounded-full border border-radar-400/20" />
              <div className="h-2.5 w-2.5 rounded-full bg-radar-400 shadow-[0_0_10px_rgba(51,139,255,0.5)]" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-[var(--text-primary)]">
            {branding.appName}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            Sign in to your account
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-[var(--text-secondary)]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none transition-colors focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-radar-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-radar-700 focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {branding.organizationName && (
          <p className="mt-6 text-center text-xs text-[var(--text-tertiary)]">
            {branding.organizationName}
          </p>
        )}
      </div>
    </div>
  );
}

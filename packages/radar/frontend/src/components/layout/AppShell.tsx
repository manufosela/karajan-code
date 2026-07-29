"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";

/**
 * Application shell that conditionally renders sidebar and header.
 * The login page renders without navigation chrome.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isAuthenticated, isLoading } = useAuth();

  const isLoginPage = pathname === "/login";

  // While loading auth state, show a minimal spinner
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-500 border-t-transparent" />
      </div>
    );
  }

  // Login page or unauthenticated: render without sidebar/header
  if (isLoginPage || !isAuthenticated) {
    return <>{children}</>;
  }

  // Authenticated: full layout with sidebar and header
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col lg:pl-64">
        <Header />
        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

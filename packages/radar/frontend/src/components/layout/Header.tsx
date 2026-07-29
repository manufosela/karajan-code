"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { branding } from "@/lib/branding";

interface Breadcrumb {
  label: string;
  href?: string;
}

function getBreadcrumbs(pathname: string, t: ReturnType<typeof useTranslation>["t"]): Breadcrumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: Breadcrumb[] = [{ label: t("nav.dashboard"), href: "/" }];

  const labelMap: Record<string, string> = {
    signals: t("nav.signals"),
    configuration: t("nav.configuration"),
    analytics: t("nav.analytics"),
  };

  let currentPath = "";
  for (const segment of segments) {
    currentPath += `/${segment}`;
    const label = labelMap[segment] || segment;
    breadcrumbs.push({ label, href: currentPath });
  }

  return breadcrumbs;
}

function getPageTitle(pathname: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const titleMap: Record<string, string> = {
    "/": t("nav.dashboard"),
    "/signals": t("nav.signals"),
    "/configuration": t("nav.configuration"),
    "/analytics": t("nav.analytics"),
  };

  return titleMap[pathname] || branding.appName;
}

const THEME_CYCLE = ["light", "dark", "system"] as const;

function useThemeLabels(): Record<string, string> {
  const { t } = useTranslation();
  return {
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };
}

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const themeLabels = useThemeLabels();

  const cycleTheme = () => {
    const currentIndex = THEME_CYCLE.indexOf(theme);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
    setTheme(THEME_CYCLE[nextIndex]);
  };

  return (
    <button
      type="button"
      onClick={cycleTheme}
      className="group relative rounded-lg p-2 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      aria-label={`${t("theme.toggle")} (${themeLabels[theme]})`}
    >
      <div className="relative h-5 w-5">
        {/* Sun icon - light mode */}
        <svg
          className={clsx(
            "absolute inset-0 h-5 w-5 transition-all duration-300",
            theme === "light"
              ? "scale-100 rotate-0 opacity-100"
              : "scale-0 rotate-90 opacity-0"
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
          />
        </svg>

        {/* Moon icon - dark mode */}
        <svg
          className={clsx(
            "absolute inset-0 h-5 w-5 transition-all duration-300",
            theme === "dark"
              ? "scale-100 rotate-0 opacity-100"
              : "scale-0 -rotate-90 opacity-0"
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
          />
        </svg>

        {/* Monitor icon - system mode */}
        <svg
          className={clsx(
            "absolute inset-0 h-5 w-5 transition-all duration-300",
            theme === "system"
              ? "scale-100 rotate-0 opacity-100"
              : "scale-0 rotate-90 opacity-0"
          )}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z"
          />
        </svg>
      </div>

      {/* Tooltip */}
      <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {themeLabels[theme]}
      </span>
    </button>
  );
}

function LanguageSwitchButton() {
  const { locale, setLocale } = useTranslation();

  const toggleLocale = () => {
    setLocale(locale === "en" ? "es" : "en");
  };

  return (
    <button
      type="button"
      onClick={toggleLocale}
      className="group relative rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition-colors tracking-wide"
      aria-label={locale === "en" ? "Cambiar a espa\u00f1ol" : "Switch to English"}
    >
      {locale === "en" ? "ES" : "EN"}
    </button>
  );
}

const ROLE_BADGE_STYLES: Record<string, string> = {
  superadmin: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  user: "bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-400",
};

function ActiveUsersIndicator() {
  const { activeUsers } = useAuth();
  const { t } = useTranslation();
  const count = activeUsers.length;

  if (count === 0) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-[var(--bg-secondary)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
      title={activeUsers.map((u) => u.name).join(", ")}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
      <span className="tabular-nums font-medium">
        {count} {t("header.usersOnline")}
      </span>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const badgeStyle = ROLE_BADGE_STYLES[user.role] ?? ROLE_BADGE_STYLES.user;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center gap-2 sm:flex">
        <div className="h-7 w-7 rounded-full bg-radar-600 flex items-center justify-center">
          <span className="text-xs font-semibold text-white">{initials}</span>
        </div>
        <span className="text-sm text-[var(--text-secondary)]">{user.name}</span>
        <span className={clsx("rounded-full px-2 py-0.5 text-2xs font-semibold", badgeStyle)}>
          {user.role}
        </span>
      </div>
      <button
        type="button"
        onClick={logout}
        className="rounded-lg p-2 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        aria-label="Logout"
        title="Logout"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
          />
        </svg>
      </button>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const { t } = useTranslation();
  const breadcrumbs = getBreadcrumbs(pathname, t);
  const pageTitle = getPageTitle(pathname, t);

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border-primary)] bg-[var(--bg-card)]/80 backdrop-blur-sm">
      <div className="flex h-16 items-center justify-between px-4 lg:px-8">
        {/* Left: Page title & breadcrumbs */}
        <div className="ml-12 lg:ml-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {pageTitle}
          </h2>
          {breadcrumbs.length > 1 && (
            <nav aria-label="Breadcrumb" className="mt-0.5">
              <ol className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                {breadcrumbs.map((crumb, index) => (
                  <li key={crumb.label} className="flex items-center gap-1">
                    {index > 0 && (
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m8.25 4.5 7.5 7.5-7.5 7.5"
                        />
                      </svg>
                    )}
                    {crumb.href && index < breadcrumbs.length - 1 ? (
                      <Link
                        href={crumb.href}
                        className="hover:text-[var(--text-secondary)] transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        className={clsx(
                          index === breadcrumbs.length - 1 &&
                            "text-[var(--text-secondary)]"
                        )}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {/* Connected users indicator */}
          <ActiveUsersIndicator />

          {/* Language switcher */}
          <LanguageSwitchButton />

          {/* Theme toggle */}
          <ThemeToggleButton />

          {/* User info & logout */}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

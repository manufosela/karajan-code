"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { SourcesPanel } from "@/components/configuration/SourcesPanel";
import { ThematicPanel } from "@/components/configuration/ThematicPanel";
import { ScoringPanel } from "@/components/configuration/ScoringPanel";
import { DeliveryPanel } from "@/components/configuration/DeliveryPanel";
import clsx from "clsx";

type ConfigTab = "sources" | "thematic" | "scoring" | "delivery";

interface TabDefinition {
  id: ConfigTab;
  labelKey: "config.sources" | "config.thematic" | "config.scoring" | "config.delivery";
  descriptionKey: "config.sourcesDesc" | "config.thematicDesc" | "config.scoringDesc" | "config.deliveryDesc";
  icon: React.ReactNode;
}

const TABS: TabDefinition[] = [
  {
    id: "sources",
    labelKey: "config.sources",
    descriptionKey: "config.sourcesDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
      </svg>
    ),
  },
  {
    id: "thematic",
    labelKey: "config.thematic",
    descriptionKey: "config.thematicDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
      </svg>
    ),
  },
  {
    id: "scoring",
    labelKey: "config.scoring",
    descriptionKey: "config.scoringDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z" />
      </svg>
    ),
  },
  {
    id: "delivery",
    labelKey: "config.delivery",
    descriptionKey: "config.deliveryDesc",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
      </svg>
    ),
  },
];

function getInitialTab(): ConfigTab {
  if (typeof window === "undefined") return "sources";
  const hash = window.location.hash.replace("#", "");
  const validTabs: ConfigTab[] = ["sources", "thematic", "scoring", "delivery"];
  return validTabs.includes(hash as ConfigTab) ? (hash as ConfigTab) : "sources";
}

export default function ConfigurationPage() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ConfigTab>(getInitialTab);

  // Redirect non-admin users
  useEffect(() => {
    if (user && !isAdmin) {
      router.replace("/");
    }
  }, [user, isAdmin, router]);

  // Declared before the early return: isAdmin starts false while the session
  // resolves, so a hook after the return would change the hook count between
  // renders as soon as the user loads.
  const handleTabChange = useCallback((tab: ConfigTab) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `#${tab}`);
  }, []);

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-[var(--text-tertiary)]">{t("admin.noAccess")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
          {t("config.title")}
        </h1>
        <p className="mt-2 text-[var(--text-secondary)]">
          {t("config.description")}
        </p>
      </div>

      {/* Tab Navigation */}
      <nav
        className="flex gap-1 rounded-lg bg-[var(--bg-secondary)] p-1"
        role="tablist"
        aria-label="Configuration sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            onClick={() => handleTabChange(tab.id)}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all",
              "focus:outline-none focus:ring-2 focus:ring-radar-500 focus:ring-offset-1",
              activeTab === tab.id
                ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )}
          >
            <span className={clsx(
              activeTab === tab.id ? "text-radar-600" : "text-[var(--text-tertiary)]"
            )}>
              {tab.icon}
            </span>
            <span className="hidden sm:inline">{t(tab.labelKey)}</span>
            <span className="sm:hidden">{t(tab.labelKey)}</span>
          </button>
        ))}
      </nav>

      {/* Tab Description */}
      <p className="text-sm text-[var(--text-tertiary)]">
        {(() => { const tab = TABS.find((tb) => tb.id === activeTab); return tab ? t(tab.descriptionKey) : ""; })()}
      </p>

      {/* Tab Panels */}
      <div
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        className="animate-fade-in"
      >
        {activeTab === "sources" && <SourcesPanel />}
        {activeTab === "thematic" && <ThematicPanel />}
        {activeTab === "scoring" && <ScoringPanel />}
        {activeTab === "delivery" && <DeliveryPanel />}
      </div>
    </div>
  );
}

export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
  changes: {
    category: "feat" | "fix" | "refactor" | "perf";
    description: string;
  }[];
}

export const changelog: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: "2026-03-23",
    highlights: [
      "Analytics dashboard with trends, scores, and ingestion health",
      "Role-based access control (superadmin/admin/user)",
      "Connected users indicator",
    ],
    changes: [
      { category: "feat", description: "Analytics page with 3 tabs: Trends, Scores, Ingestion Health" },
      { category: "feat", description: "Role-based access: superadmin, admin, user roles" },
      { category: "feat", description: "Connected users indicator in header" },
      { category: "feat", description: "Source management UI: edit priority, queries, base URL" },
      { category: "feat", description: "User management panel for superadmins" },
      { category: "fix", description: "Dashboard stats show correct pending review count" },
      { category: "fix", description: "ScoreBadge handles Decimal strings from backend" },
      { category: "fix", description: "Favicon loads correctly" },
      { category: "fix", description: "Analytics placeholder replaced with real data" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-03-20",
    highlights: [
      "Full production deployment on GCP Cloud Run",
      "Real-time research signal ingestion from 5 sources",
      "LLM-powered classification, scoring, and summarization",
    ],
    changes: [
      { category: "feat", description: "Dashboard with real-time stats from backend API" },
      { category: "feat", description: "Signal inbox with sortable table, filters, and pagination" },
      { category: "feat", description: "Signal detail view with scores, classification, and review" },
      { category: "feat", description: "Configuration panel: Sources, Thematic, Scoring, Delivery" },
      { category: "feat", description: "i18n support: English and Spanish with language switcher" },
      { category: "feat", description: "Dark/Light/System theme toggle" },
      { category: "feat", description: "Authentication with JWT login/logout" },
      { category: "feat", description: "Editorial design system: DM Sans + Source Serif 4" },
      { category: "feat", description: "Backend deployed on GCP Cloud Run + Cloud SQL" },
      { category: "feat", description: "5 research connectors: PubMed, arXiv, ClinicalTrials, Crossref, Semantic Scholar" },
      { category: "feat", description: "LLM pipeline: classification, scoring, impact analysis, executive summary" },
      { category: "feat", description: "Daily ingestion cron job at 7:00 Madrid time" },
    ],
  },
];

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useTranslation } from "@/lib/i18n";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ScoreBadge } from "@/components/signals/ScoreBadge";
import { StatusBadge } from "@/components/signals/StatusBadge";
import { fetchSignalById, updateSignalStatus } from "@/lib/api";
import { formatDate, formatScore } from "@/lib/utils";
import type { SignalDetail, ReviewStatus, HypeRisk, TimeHorizon, RecommendedAction } from "@/types/signal";

/* ─── Constants ──────────────────────────────────────────── */

const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "relevant", label: "Relevant" },
  { value: "review", label: "Review" },
  { value: "discarded", label: "Discarded" },
  { value: "opportunity", label: "Opportunity" },
  { value: "follow_up", label: "Follow Up" },
];

const HYPE_RISK_CONFIG: Record<HypeRisk, { label: string; color: string; bg: string }> = {
  low: { label: "Low", color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  medium: { label: "Medium", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
  high: { label: "High", color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/30" },
  very_high: { label: "Very High", color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
};

const TIME_HORIZON_LABELS: Record<TimeHorizon, string> = {
  immediate: "Immediate",
  short_term: "Short Term",
  medium_term: "Medium Term",
  long_term: "Long Term",
  speculative: "Speculative",
};

const RECOMMENDED_ACTION_LABELS: Record<RecommendedAction, string> = {
  adopt_now: "Adopt Now",
  start_pilot: "Start Pilot",
  deep_evaluation: "Deep Evaluation",
  monitor_closely: "Monitor Closely",
  periodic_review: "Periodic Review",
  archive: "Archive",
  partner_search: "Partner Search",
  internal_rd: "Internal R&D",
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  journal_article: "Journal Article",
  conference_paper: "Conference Paper",
  patent: "Patent",
  clinical_trial: "Clinical Trial",
  preprint: "Preprint",
  review_article: "Review Article",
  case_report: "Case Report",
  thesis: "Thesis",
  technical_report: "Technical Report",
  news: "News",
  blog_post: "Blog Post",
  other: "Other",
};

/* ─── (Mock data removed - using API only) ──────────────── */

/* ─── Collapsible Section ────────────────────────────────── */

function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between py-2 text-sm font-semibold text-[var(--text-primary)] hover:text-radar-600 transition-colors focus:outline-none focus:underline"
        aria-expanded={isOpen}
      >
        {title}
        <svg
          className={clsx("h-4 w-4 transition-transform", isOpen && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {isOpen && <div className="animate-fade-in pt-2">{children}</div>}
    </div>
  );
}

/* ─── Page Component ─────────────────────────────────────── */

export default function SignalDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const { t } = useTranslation();
  const router = useRouter();

  const [signal, setSignal] = useState<SignalDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [notFound, setNotFound] = useState(false);

  /* Review state */
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("pending");
  const [reviewNotes, setReviewNotes] = useState("");
  const [isSavingReview, setIsSavingReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  /* Score reasons toggle */
  const [showScientificReasons, setShowScientificReasons] = useState(false);
  const [showStrategicReasons, setShowStrategicReasons] = useState(false);

  /* Fetch signal */
  useEffect(() => {
    let cancelled = false;

    async function loadSignal() {
      setIsLoading(true);
      try {
        const data = await fetchSignalById(id);
        if (!cancelled) {
          setSignal(data);
          setReviewStatus(data.review_status);
          setReviewNotes(data.reviewer_notes ?? "");
          setHasError(false);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          const isNotFound = error instanceof Error && "status" in error && (error as { status: number }).status === 404;
          if (isNotFound) {
            setNotFound(true);
          } else {
            setHasError(true);
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSignal();
    return () => {
      cancelled = true;
    };
  }, [id]);

  /* Save review */
  const handleSaveReview = useCallback(async () => {
    if (!signal) return;
    setIsSavingReview(true);
    setReviewMessage(null);

    try {
      const updated = await updateSignalStatus(signal.id, reviewStatus, reviewNotes || undefined);
      setSignal((prev) =>
        prev ? { ...prev, review_status: updated.review_status as ReviewStatus, reviewer_notes: updated.reviewer_notes, updated_at: updated.updated_at } : prev
      );
      setReviewMessage({ type: "success", text: t("detail.saveSuccess") });
    } catch {
      setReviewMessage({ type: "error", text: t("detail.saveError") });
    } finally {
      setIsSavingReview(false);
      setTimeout(() => setReviewMessage(null), 4000);
    }
  }, [signal, reviewStatus, reviewNotes, t]);

  /* Loading */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 animate-fade-in">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-radar-500 border-t-transparent" />
        <span className="ml-3 text-sm text-[var(--text-secondary)]">
          {t("signals.loadingSignal")}
        </span>
      </div>
    );
  }

  /* Error state */
  if (hasError && !signal) {
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
        <svg className="h-16 w-16 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
          Unable to load signal details
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Check that the backend is running and try again.
        </p>
        <button
          type="button"
          onClick={() => router.push("/signals")}
          className="btn-primary mt-6"
        >
          {t("signals.backToSignals")}
        </button>
      </div>
    );
  }

  /* Not found */
  if (notFound || !signal) {
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-fade-in">
        <svg className="h-16 w-16 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">
          {t("signals.notFound")}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {t("signals.notFoundDesc")} {id}
        </p>
        <button
          type="button"
          onClick={() => router.push("/signals")}
          className="btn-primary mt-6"
        >
          {t("signals.backToSignals")}
        </button>
      </div>
    );
  }

  const hypeConfig = signal.hype_risk ? HYPE_RISK_CONFIG[signal.hype_risk] : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 animate-fade-in">
      {/* Back Button */}
      <button
        type="button"
        onClick={() => router.push("/signals")}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors focus:outline-none focus:underline"
        aria-label="Back to signals list"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        {t("signals.backToSignals")}
      </button>

      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{DOCUMENT_TYPE_LABELS[signal.document_type] ?? signal.document_type}</Badge>
              {signal.strategic_buckets?.[0] && (
                <Badge variant="bucket" bucket={signal.strategic_buckets[0]}>
                  {signal.strategic_buckets[0]}
                </Badge>
              )}
              <StatusBadge status={signal.review_status} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)] lg:text-2xl">
              {signal.original_title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
              <span>
                {signal.authors?.length > 0
                  ? signal.authors.map((a) => {
                      const name = (a as Record<string, unknown>).name;
                      return typeof name === "string" ? name : String(Object.values(a)[0] ?? "");
                    }).filter(Boolean).join(", ")
                  : "—"}
              </span>
              <span className="text-[var(--text-tertiary)]">|</span>
              <span>{signal.journal_or_origin ?? "—"}</span>
              <span className="text-[var(--text-tertiary)]">|</span>
              <span>{formatDate(signal.publication_date)}</span>
            </div>
          </div>
        </CardHeader>

        <CardBody>
          {/* Scores */}
          <div className="flex flex-wrap items-start gap-8">
            <div className="flex items-center gap-6">
              {signal.scientific_strength_score != null ? (
                <ScoreBadge
                  score={signal.scientific_strength_score}
                  label="Scientific"
                  variant="circle"
                  size="lg"
                />
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-lg font-bold text-[var(--text-tertiary)]">—</span>
                  <span className="text-2xs font-medium text-[var(--text-tertiary)]">Scientific</span>
                </div>
              )}
              {signal.strategic_relevance_score != null ? (
                <ScoreBadge
                  score={signal.strategic_relevance_score}
                  label="Strategic"
                  variant="circle"
                  size="lg"
                />
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <span className="text-lg font-bold text-[var(--text-tertiary)]">—</span>
                  <span className="text-2xs font-medium text-[var(--text-tertiary)]">Strategic</span>
                </div>
              )}
              <div className="flex flex-col items-center gap-1">
                <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                  {formatScore(
                    signal.scientific_strength_score != null && signal.strategic_relevance_score != null
                      ? ((typeof signal.scientific_strength_score === "string" ? parseFloat(signal.scientific_strength_score) : signal.scientific_strength_score) +
                         (typeof signal.strategic_relevance_score === "string" ? parseFloat(signal.strategic_relevance_score) : signal.strategic_relevance_score)) / 2
                      : null
                  )}
                </span>
                <span className="text-2xs font-medium text-[var(--text-tertiary)]">
                  {t("detail.composite")}
                </span>
              </div>
            </div>
          </div>

          {/* Score Reasons */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {signal.scientific_strength_reasons && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowScientificReasons((prev) => !prev)}
                  className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] hover:text-radar-600 transition-colors focus:outline-none focus:underline"
                  aria-expanded={showScientificReasons}
                >
                  <svg
                    className={clsx("h-3.5 w-3.5 transition-transform", showScientificReasons && "rotate-90")}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                  {t("detail.scientificReasons")}
                </button>
                {showScientificReasons && (
                  <dl className="mt-2 animate-fade-in space-y-1.5 pl-6">
                    {Object.entries(signal.scientific_strength_reasons).map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <dt className="font-medium text-[var(--text-primary)] inline">{key}: </dt>
                        <dd className="text-[var(--text-secondary)] inline">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
            {signal.strategic_relevance_reasons && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowStrategicReasons((prev) => !prev)}
                  className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] hover:text-radar-600 transition-colors focus:outline-none focus:underline"
                  aria-expanded={showStrategicReasons}
                >
                  <svg
                    className={clsx("h-3.5 w-3.5 transition-transform", showStrategicReasons && "rotate-90")}
                    fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                  {t("detail.strategicReasons")}
                </button>
                {showStrategicReasons && (
                  <dl className="mt-2 animate-fade-in space-y-1.5 pl-6">
                    {Object.entries(signal.strategic_relevance_reasons).map(([key, value]) => (
                      <div key={key} className="text-sm">
                        <dt className="font-medium text-[var(--text-primary)] inline">{key}: </dt>
                        <dd className="text-[var(--text-secondary)] inline">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Classification & Metadata */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Classification */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("detail.classification")}
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {/* Hype Risk */}
            {hypeConfig && (
              <div>
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  {t("detail.hypeRisk")}
                </span>
                <div className="mt-1">
                  <span
                    className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      hypeConfig.bg,
                      hypeConfig.color
                    )}
                  >
                    <svg className="h-2 w-2" fill="currentColor" viewBox="0 0 8 8">
                      <circle cx="4" cy="4" r="4" />
                    </svg>
                    {hypeConfig.label}
                  </span>
                </div>
              </div>
            )}

            {/* Time Horizon */}
            {signal.time_horizon && (
              <div>
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  {t("detail.timeHorizon")}
                </span>
                <div className="mt-1">
                  <Badge>{TIME_HORIZON_LABELS[signal.time_horizon]}</Badge>
                </div>
              </div>
            )}

            {/* Recommended Action */}
            {signal.recommended_action && (
              <div>
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  {t("detail.recommendedAction")}
                </span>
                <div className="mt-1">
                  <Badge className="bg-radar-50 text-radar-700 border-radar-200 dark:bg-radar-900/20 dark:text-radar-400 dark:border-radar-800">
                    {RECOMMENDED_ACTION_LABELS[signal.recommended_action]}
                  </Badge>
                </div>
              </div>
            )}

            {/* Strategic Buckets */}
            {signal.strategic_buckets.length > 0 && (
              <div>
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  {t("table.bucket")}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {signal.strategic_buckets.map((bucket) => (
                    <Badge key={bucket} variant="bucket" bucket={bucket}>
                      {bucket}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Thematic Tags */}
            {signal.thematic_tags.length > 0 && (
              <div>
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  {t("detail.keywords")}
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {signal.thematic_tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Source Info */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("detail.sourceInfo")}
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
              <span className="font-medium text-[var(--text-tertiary)]">{t("table.source")}</span>
              <span className="text-[var(--text-primary)]">{signal.journal_or_origin ?? "—"}</span>

              {signal.pmid && (
                <>
                  <span className="font-medium text-[var(--text-tertiary)]">PMID</span>
                  <span className="text-[var(--text-primary)] font-mono text-xs">{signal.pmid}</span>
                </>
              )}

              {signal.arxiv_id && (
                <>
                  <span className="font-medium text-[var(--text-tertiary)]">arXiv ID</span>
                  <span className="text-[var(--text-primary)] font-mono text-xs">{signal.arxiv_id}</span>
                </>
              )}

              {signal.nct_id && (
                <>
                  <span className="font-medium text-[var(--text-tertiary)]">NCT ID</span>
                  <span className="text-[var(--text-primary)] font-mono text-xs">{signal.nct_id}</span>
                </>
              )}

              {signal.doi && (
                <>
                  <span className="font-medium text-[var(--text-tertiary)]">DOI</span>
                  <a
                    href={`https://doi.org/${signal.doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-radar-600 hover:text-radar-700 hover:underline transition-colors"
                  >
                    {signal.doi}
                  </a>
                </>
              )}

              {signal.language && (
                <>
                  <span className="font-medium text-[var(--text-tertiary)]">{t("detail.language")}</span>
                  <span className="text-[var(--text-primary)] uppercase">{signal.language}</span>
                </>
              )}

              <span className="font-medium text-[var(--text-tertiary)]">{t("detail.captured")}</span>
              <span className="text-[var(--text-primary)]">{formatDate(signal.created_at, "d MMM yyyy HH:mm")}</span>
            </div>

            {/* Original Source Link */}
            {signal.original_url && (
              <a
                href={signal.original_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-radar-600 hover:text-radar-700 transition-colors"
              >
                {t("detail.viewOriginal")}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
              </a>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Abstract */}
      {signal.abstract && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {t("detail.abstract")}
            </h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm leading-relaxed text-[var(--text-primary)]">
              {signal.abstract}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Review Status */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            {t("detail.review")}
          </h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="review-status-select"
                className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]"
              >
                {t("detail.reviewStatus")}
              </label>
              <select
                id="review-status-select"
                value={reviewStatus}
                onChange={(e) => setReviewStatus(e.target.value as ReviewStatus)}
                className="input w-full"
                aria-label="Review status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {signal.reviewer_notes && (
              <div className="text-sm text-[var(--text-secondary)]">
                <p>
                  <span className="font-medium text-[var(--text-tertiary)]">Current notes:</span>{" "}
                  {signal.reviewer_notes}
                </p>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="review-notes"
              className="mb-1.5 block text-xs font-medium text-[var(--text-tertiary)]"
            >
              {t("detail.notes")}
            </label>
            <textarea
              id="review-notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder={t("detail.notesPlaceholder")}
              rows={3}
              className="input w-full resize-y"
              aria-label="Review notes"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveReview}
              disabled={isSavingReview}
              className={clsx(
                "btn-primary",
                isSavingReview && "cursor-not-allowed opacity-50"
              )}
            >
              {isSavingReview ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  {t("detail.saving")}
                </span>
              ) : (
                t("detail.saveReview")
              )}
            </button>

            {reviewMessage && (
              <span
                className={clsx(
                  "animate-fade-in text-sm font-medium",
                  reviewMessage.type === "success"
                    ? "text-emerald-600"
                    : "text-red-600"
                )}
                role="alert"
              >
                {reviewMessage.text}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Processing Metadata */}
      {(signal.llm_provider || signal.llm_model || signal.processing_timestamp) && (
        <Card>
          <CardBody>
            <CollapsibleSection title={t("detail.processingMetadata")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {signal.llm_provider && (
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-3">
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">
                      LLM Provider
                    </span>
                    <p className="mt-1 font-mono text-sm text-[var(--text-primary)]">
                      {signal.llm_provider}
                    </p>
                  </div>
                )}
                {signal.llm_model && (
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-3">
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">
                      LLM Model
                    </span>
                    <p className="mt-1 font-mono text-sm text-[var(--text-primary)]">
                      {signal.llm_model}
                    </p>
                  </div>
                )}
                {signal.processing_timestamp && (
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-3">
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">
                      Processed At
                    </span>
                    <p className="mt-1 text-sm text-[var(--text-primary)]">
                      {formatDate(signal.processing_timestamp, "d MMM yyyy HH:mm")}
                    </p>
                  </div>
                )}
                {signal.confidence_level != null && (
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-3">
                    <span className="text-xs font-medium text-[var(--text-tertiary)]">
                      {t("detail.confidence")}
                    </span>
                    <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                      {((typeof signal.confidence_level === "string" ? parseFloat(signal.confidence_level) : signal.confidence_level ?? 0) * 100).toFixed(0)}%
                    </p>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

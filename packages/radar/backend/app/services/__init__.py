"""Services package for research data processing."""

from app.services.classification import (
    ClassificationError,
    ClassificationResult,
    ClassificationService,
    ThemeScore,
)
from app.services.deduplication import (
    DedupCandidate,
    DedupVerdict,
    ExistingItem,
    compute_content_hash,
    deduplicate,
    find_doi_duplicate,
    find_fuzzy_title_match,
)
from app.services.digest import DigestService
from app.services.impact import (
    ImpactAnalysisError,
    ImpactAnalysisResult,
    ImpactAnalysisService,
)
from app.services.ingestion import IngestionOrchestrator
from app.services.scoring import (
    ScoringError,
    ScoringResult,
    ScoringService,
)
from app.services.signal_pipeline import (
    PipelineError,
    PipelineResult,
    SignalPipelineService,
    StepResult,
    StepStatus,
)
from app.services.strategic import (
    StrategicClassificationError,
    StrategicClassificationResult,
    StrategicClassificationService,
)
from app.services.summary import (
    SummaryError,
    SummaryResult,
    SummaryService,
)
from app.services.teams_webhook import TeamsWebhookService

__all__ = [
    "DigestService",
    "TeamsWebhookService",
    "ClassificationError",
    "ClassificationResult",
    "ClassificationService",
    "DedupCandidate",
    "DedupVerdict",
    "ExistingItem",
    "ImpactAnalysisError",
    "ImpactAnalysisResult",
    "ImpactAnalysisService",
    "IngestionOrchestrator",
    "PipelineError",
    "PipelineResult",
    "SignalPipelineService",
    "StepResult",
    "StepStatus",
    "ScoringError",
    "ScoringResult",
    "ScoringService",
    "StrategicClassificationError",
    "StrategicClassificationResult",
    "StrategicClassificationService",
    "SummaryError",
    "SummaryResult",
    "SummaryService",
    "ThemeScore",
    "compute_content_hash",
    "deduplicate",
    "find_doi_duplicate",
    "find_fuzzy_title_match",
]

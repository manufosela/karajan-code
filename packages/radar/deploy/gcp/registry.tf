# Artifact Registry for this instance's images (backend and frontend). The
# backend image is shared across instances; the frontend image is per-instance
# because Next.js inlines the branding at build time.

resource "google_artifact_registry_repository" "images" {
  repository_id = var.service_name
  location      = var.region
  format        = "DOCKER"
  description   = "Karajan Radar instance images (backend and frontend)."
  depends_on    = [google_project_service.apis]
}

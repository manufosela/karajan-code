# Cloud Scheduler triggers the ingestion job on the instance's cron. It calls
# the Cloud Run Admin API to execute the job, authenticated as the runtime
# service account, which is granted run.invoker on that job. The digest job and
# its own trigger ship with KRD-TSK-0024 (its CLI command does not exist yet).

resource "google_cloud_run_v2_job_iam_member" "ingestion_invoker" {
  name     = google_cloud_run_v2_job.ingestion.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.run.email}"
}

resource "google_cloud_scheduler_job" "ingestion" {
  name      = "${var.service_name}-ingestion"
  region    = var.region
  schedule  = var.ingestion_schedule
  time_zone = var.scheduler_timezone

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.ingestion.name}:run"

    oauth_token {
      service_account_email = google_service_account.run.email
    }
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_job_iam_member.ingestion_invoker,
  ]
}

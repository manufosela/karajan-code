# Cloud Scheduler triggers the batch jobs on the instance's crons. It calls the
# Cloud Run v2 execution endpoint, authenticated as the runtime service account,
# which is granted run.invoker on each job.

resource "google_cloud_run_v2_job_iam_member" "ingestion_invoker" {
  name     = google_cloud_run_v2_job.ingestion.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.run.email}"
}

resource "google_cloud_run_v2_job_iam_member" "digest_invoker" {
  name     = google_cloud_run_v2_job.digest.name
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

resource "google_cloud_scheduler_job" "digest" {
  name      = "${var.service_name}-digest"
  region    = var.region
  schedule  = var.digest_schedule
  time_zone = var.scheduler_timezone

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.digest.name}:run"

    oauth_token {
      service_account_email = google_service_account.run.email
    }
  }

  depends_on = [
    google_project_service.apis,
    google_cloud_run_v2_job_iam_member.digest_invoker,
  ]
}

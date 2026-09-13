# The runtime identity for the instance. Cloud Run services and jobs run as
# this service account: it reaches Cloud SQL through the connector and reads
# only the secrets this instance owns. No key is generated: workloads use the
# account through their own metadata, never a downloaded credential.

resource "google_service_account" "run" {
  account_id   = "${var.service_name}-run"
  display_name = "Karajan Radar runtime (${var.service_name})"
}

resource "google_project_iam_member" "cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "app_secret_key" {
  secret_id = google_secret_manager_secret.app_secret_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "optional" {
  for_each  = local.optional_secrets
  secret_id = google_secret_manager_secret.optional[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

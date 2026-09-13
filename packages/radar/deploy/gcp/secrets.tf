# Secrets live in Secret Manager and are injected at runtime; none travels
# inside an image or the repository. APP_SECRET_KEY is generated here (stable in
# state); DATABASE_URL is assembled from the Cloud SQL resources; the rest are
# instance variables, created only when a value is supplied.

resource "random_password" "app_secret_key" {
  length  = 48
  special = false
}

locals {
  database_url = "postgresql+asyncpg://${google_sql_user.radar.name}:${random_password.db.result}@/${google_sql_database.radar.name}?host=/cloudsql/${google_sql_database_instance.radar.connection_name}"

  # Optional secrets: only created for the values the instance actually sets.
  optional_secrets = {
    for key, value in {
      "llm-api-key"       = var.llm_api_key
      "teams-webhook-url" = var.teams_webhook_url
      "digest-recipients" = var.digest_email_recipients
    } : key => value if value != ""
  }
}

resource "google_secret_manager_secret" "app_secret_key" {
  secret_id = "${var.service_name}-app-secret-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app_secret_key" {
  secret      = google_secret_manager_secret.app_secret_key.id
  secret_data = random_password.app_secret_key.result
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.service_name}-database-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = local.database_url
}

resource "google_secret_manager_secret" "optional" {
  for_each  = local.optional_secrets
  secret_id = "${var.service_name}-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "optional" {
  for_each    = local.optional_secrets
  secret      = google_secret_manager_secret.optional[each.key].id
  secret_data = each.value
}

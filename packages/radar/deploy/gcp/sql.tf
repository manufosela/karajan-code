# Managed PostgreSQL for the instance. The password is generated and never
# leaves Terraform state / Secret Manager; the connection string is assembled
# in secrets.tf and injected into the services at runtime.

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "radar" {
  name                = "${var.service_name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.db_deletion_protection

  settings {
    # Without an explicit edition the provider ~>6.0 defaults to
    # ENTERPRISE_PLUS, which rejects shared tiers like db-f1-micro.
    edition = "ENTERPRISE"
    tier    = var.db_tier

    ip_configuration {
      # Public IPv4 is on but no authorized networks are declared, so nothing
      # reaches the instance directly. Cloud Run and the proxy connect over the
      # IAM-authenticated Cloud SQL connector (mirrors packages/rag).
      ipv4_enabled = true
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "radar" {
  name     = "karajan_radar"
  instance = google_sql_database_instance.radar.name
}

resource "google_sql_user" "radar" {
  name     = "radar"
  instance = google_sql_database_instance.radar.name
  password = random_password.db.result
}

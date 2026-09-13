# The two batch jobs of the topology (architecture.md): daily ingestion and the
# digest. Both run the backend image as the runtime service account, reach Cloud
# SQL through the connector, and read their secrets from Secret Manager. The
# command is the backend CLI (`python -m app.cli <name>`). The digest also takes
# the optional Teams and recipients secrets, injected only when they exist.

resource "google_cloud_run_v2_job" "ingestion" {
  name     = "${var.service_name}-ingestion"
  location = var.region

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.run.email

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.radar.connection_name]
        }
      }

      containers {
        image   = local.backend_image
        command = ["python", "-m", "app.cli"]
        args    = ["ingest"]

        env {
          name  = "ACTIVE_PROFILE"
          value = var.active_profile
        }

        env {
          name = "APP_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app_secret_key.secret_id
              version = "latest"
            }
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.app_secret_key,
    google_secret_manager_secret_iam_member.database_url,
  ]
}

resource "google_cloud_run_v2_job" "digest" {
  name     = "${var.service_name}-digest"
  location = var.region

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.run.email

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.radar.connection_name]
        }
      }

      containers {
        image   = local.backend_image
        command = ["python", "-m", "app.cli"]
        args    = ["digest"]

        env {
          name  = "ACTIVE_PROFILE"
          value = var.active_profile
        }

        env {
          name = "APP_SECRET_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app_secret_key.secret_id
              version = "latest"
            }
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }

        dynamic "env" {
          for_each = contains(keys(local.optional_secrets), "teams-webhook-url") ? [1] : []
          content {
            name = "TEAMS_WEBHOOK_URL"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.optional["teams-webhook-url"].secret_id
                version = "latest"
              }
            }
          }
        }

        dynamic "env" {
          for_each = contains(keys(local.optional_secrets), "digest-recipients") ? [1] : []
          content {
            name = "DIGEST_EMAIL_RECIPIENTS"
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.optional["digest-recipients"].secret_id
                version = "latest"
              }
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.app_secret_key,
    google_secret_manager_secret_iam_member.database_url,
  ]
}

# The daily ingestion job of the topology (architecture.md). It runs the backend
# image as the runtime service account, reaches Cloud SQL through the connector,
# and reads its secrets from Secret Manager. The command is the backend CLI
# (`python -m app.cli ingest`).
#
# The digest job of the topology is not declared here: the backend CLI does not
# yet expose a `digest` command (only `ingest`), so a digest job would fail on
# every run. It ships together with that command (see KRD-TSK-0024).

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

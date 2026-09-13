# The migration job (KRD-TSK-0019, ADR "Migraciones en el deploy"). Deploy runs
# it once as its own step and checks the exit code BEFORE routing traffic to a
# new revision; a failure stops the deploy. Migrating at API startup is
# deliberately avoided: several Cloud Run replicas would race on the same DB.
#
# It only needs DATABASE_URL (alembic/env.py takes the async URL and hands it to
# the sync driver): no ACTIVE_PROFILE, no APP_SECRET_KEY.

resource "google_cloud_run_v2_job" "migrate" {
  name     = "${var.service_name}-migrate"
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
        command = ["alembic", "upgrade", "head"]

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

  # A targeted `-target` apply of just this job (the deploy's migrate step) pulls
  # only this resource's dependency graph, so everything the execution needs is
  # listed explicitly: the DATABASE_URL secret VERSION (the container reads the
  # value, not the empty secret), the database and user that string points at,
  # the secret-access binding, and the Cloud SQL client role for the socket.
  depends_on = [
    google_secret_manager_secret_version.database_url,
    google_sql_database.radar,
    google_sql_user.radar,
    google_secret_manager_secret_iam_member.database_url,
    google_project_iam_member.cloudsql_client,
  ]
}

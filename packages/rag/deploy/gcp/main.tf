locals {
  # Imagen efectiva: la variable si se pasa, o la del Artifact Registry propio.
  image = var.image != "" ? var.image : "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}/server:latest"

  # postgres://user:pass@/db?host=/cloudsql/<connection> — socket Cloud SQL.
  pg_url = "postgres://${google_sql_user.rag.name}:${random_password.db.result}@/${google_sql_database.rag.name}?host=/cloudsql/${google_sql_database_instance.rag.connection_name}"
}

# --- APIs necesarias --------------------------------------------------------

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# --- Artifact Registry (imagen del servidor) --------------------------------

resource "google_artifact_registry_repository" "images" {
  repository_id = var.service_name
  location      = var.region
  format        = "DOCKER"
  description   = "Imagen del servidor karajan-rag (Dockerfile del repo)."
  depends_on    = [google_project_service.apis]
}

# --- Bucket del índice (fuentes + .karajan/manifest.json) -------------------

resource "google_storage_bucket" "index" {
  name                        = "${var.project_id}-${var.service_name}-index"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = var.bucket_force_destroy
  depends_on                  = [google_project_service.apis]
}

# --- Cloud SQL Postgres + pgvector ------------------------------------------

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "rag" {
  name                = "${var.service_name}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = var.db_deletion_protection

  settings {
    tier = var.db_tier

    ip_configuration {
      # Sin IP pública: acceso solo por conector Cloud SQL (Cloud Run y proxy).
      ipv4_enabled = true
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "rag" {
  name     = "karajan_rag"
  instance = google_sql_database_instance.rag.name
}

resource "google_sql_user" "rag" {
  name     = "karajan"
  instance = google_sql_database_instance.rag.name
  password = random_password.db.result
}

# --- Secret Manager: PG_URL completo ----------------------------------------

resource "google_secret_manager_secret" "pg_url" {
  secret_id = "${var.service_name}-pg-url"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "pg_url" {
  secret      = google_secret_manager_secret.pg_url.id
  secret_data = local.pg_url
}

# --- Service account y permisos mínimos -------------------------------------

resource "google_service_account" "run" {
  account_id   = "${var.service_name}-run"
  display_name = "Runtime del servidor karajan-rag en Cloud Run"
}

resource "google_project_iam_member" "cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_secret_manager_secret_iam_member" "pg_url_access" {
  secret_id = google_secret_manager_secret.pg_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

resource "google_storage_bucket_iam_member" "index_reader" {
  bucket = google_storage_bucket.index.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.run.email}"
}

# --- Cloud Run v2: el servidor RAG ------------------------------------------

resource "google_cloud_run_v2_service" "rag" {
  name     = var.service_name
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.run.email

    scaling {
      max_instance_count = var.max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.rag.connection_name]
      }
    }

    # Índice montado read-only desde GCS (fuentes + .karajan/manifest.json).
    volumes {
      name = "index"
      gcs {
        bucket    = google_storage_bucket.index.name
        read_only = true
      }
    }

    containers {
      image = local.image

      env {
        name  = "KARAJAN_STORE"
        value = "pgvector"
      }

      env {
        name = "PG_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.pg_url.secret_id
            version = "latest"
          }
        }
      }

      volume_mounts {
        name       = "index"
        mount_path = "/data"
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      ports {
        container_port = 8080
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 6
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.pg_url,
    google_secret_manager_secret_iam_member.pg_url_access,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.rag.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

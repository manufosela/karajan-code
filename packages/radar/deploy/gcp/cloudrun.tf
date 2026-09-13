# The two long-running services of the topology (architecture.md): the FastAPI
# backend and the Next.js frontend. Both run as the runtime service account and
# reach Cloud SQL through the connector. The backend reads its secrets from
# Secret Manager at start; the frontend carries its branding and API URL baked
# into the image (NEXT_PUBLIC_*), so nothing domain-specific is injected here.

locals {
  backend_image  = var.image_backend != "" ? var.image_backend : "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}/karajan-radar-backend:latest"
  frontend_image = var.image_frontend != "" ? var.image_frontend : "${var.region}-docker.pkg.dev/${var.project_id}/${var.service_name}/karajan-radar-frontend:latest"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "${var.service_name}-api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # Stateless (state lives in Cloud SQL): without this the provider default
  # blocks any replace and terraform destroy (mirrors packages/rag).
  deletion_protection = false

  template {
    service_account = google_service_account.run.email

    scaling {
      max_instance_count = var.max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.radar.connection_name]
      }
    }

    containers {
      image = local.backend_image

      env {
        name  = "ACTIVE_PROFILE"
        value = var.active_profile
      }

      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
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

      ports {
        container_port = 8080
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_version.app_secret_key,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_iam_member.app_secret_key,
    google_secret_manager_secret_iam_member.database_url,
  ]
}

resource "google_cloud_run_v2_service" "frontend" {
  name     = "${var.service_name}-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    service_account = google_service_account.run.email

    scaling {
      max_instance_count = var.max_instances
    }

    containers {
      image = local.frontend_image

      ports {
        container_port = 3000
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.frontend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  description = "URL pública del servicio Cloud Run (POST /query, GET /health)."
  value       = google_cloud_run_v2_service.rag.uri
}

output "image" {
  description = "Imagen que sirve Cloud Run (haz push a esta ruta si usaste el default)."
  value       = local.image
}

output "artifact_repository" {
  description = "Repositorio de Artifact Registry para la imagen del servidor."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "index_bucket" {
  description = "Bucket GCS del índice — sube aquí las fuentes y .karajan/ (gsutil rsync)."
  value       = google_storage_bucket.index.name
}

output "sql_connection_name" {
  description = "Connection name de Cloud SQL (para cloud-sql-proxy al indexar)."
  value       = google_sql_database_instance.rag.connection_name
}

output "pg_url_secret" {
  description = "Secreto de Secret Manager con el PG_URL completo."
  value       = google_secret_manager_secret.pg_url.secret_id
}

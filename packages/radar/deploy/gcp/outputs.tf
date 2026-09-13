output "api_url" {
  description = "URL del servicio Cloud Run de la API (privada salvo allow_unauthenticated)."
  value       = google_cloud_run_v2_service.api.uri
}

output "frontend_url" {
  description = "URL del servicio Cloud Run del frontend (privada salvo allow_unauthenticated)."
  value       = google_cloud_run_v2_service.frontend.uri
}

output "backend_image" {
  description = "Imagen del backend que sirven la API y el job (haz push aquí si usaste el default)."
  value       = local.backend_image
}

output "frontend_image" {
  description = "Imagen del frontend (una por instancia: hornea NEXT_PUBLIC_* en build)."
  value       = local.frontend_image
}

output "artifact_repository" {
  description = "Repositorio de Artifact Registry para las imágenes de la instancia."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "sql_connection_name" {
  description = "Connection name de Cloud SQL (para cloud-sql-proxy y migraciones)."
  value       = google_sql_database_instance.radar.connection_name
}

output "runtime_service_account" {
  description = "Service account de runtime de la instancia (Cloud Run y jobs)."
  value       = google_service_account.run.email
}

output "ingestion_job" {
  description = "Nombre del Cloud Run Job de ingesta que dispara Cloud Scheduler."
  value       = google_cloud_run_v2_job.ingestion.name
}

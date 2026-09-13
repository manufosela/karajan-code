variable "project_id" {
  description = "ID del proyecto GCP donde se levanta la instancia."
  type        = string
}

variable "region" {
  description = "Región GCP para todos los recursos."
  type        = string
  default     = "europe-southwest1"
}

variable "service_name" {
  description = "Nombre base de la instancia (servicios, jobs, bucket, secretos...)."
  type        = string
  default     = "karajan-radar"
}

variable "image_backend" {
  description = <<-EOT
    Imagen del backend (una sirve a todas las instancias: su config es de
    runtime). Vacía usa la ruta del Artifact Registry que crea el módulo:
    <region>-docker.pkg.dev/<project>/<service>/karajan-radar-backend:latest
    (hay que hacer push tras el primer apply, con packages/radar/backend/cloudbuild.yaml).
  EOT
  type        = string
  default     = ""
}

variable "image_frontend" {
  description = <<-EOT
    Imagen del frontend. NO se comparte entre instancias: Next.js hornea las
    NEXT_PUBLIC_* (branding) en build, así que cada instancia construye la
    suya con packages/radar/frontend/cloudbuild.yaml. Vacía usa la ruta del
    Artifact Registry que crea el módulo.
  EOT
  type        = string
  default     = ""
}

variable "active_profile" {
  description = "Radar Profile activo de esta instancia (ACTIVE_PROFILE), p. ej. software-engineering."
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Orígenes CORS permitidos por el backend (ALLOWED_ORIGINS), separados por comas."
  type        = string
  default     = ""
}

variable "db_tier" {
  description = "Tier de la instancia Cloud SQL (db-f1-micro solo para pruebas)."
  type        = string
  default     = "db-f1-micro"
}

variable "db_deletion_protection" {
  description = "Protección de borrado de Cloud SQL. Desactivar solo en entornos efímeros."
  type        = bool
  default     = true
}

variable "allow_unauthenticated" {
  description = "Si true, la API y el frontend quedan públicos (run.invoker para allUsers). Por defecto false."
  type        = bool
  default     = false
}

variable "max_instances" {
  description = "Máximo de instancias de cada servicio Cloud Run."
  type        = number
  default     = 2
}

variable "ingestion_schedule" {
  description = "Cron (zona del scheduler) para la ingesta diaria."
  type        = string
  default     = "0 6 * * *"
}

variable "llm_api_key" {
  description = "Clave del proveedor LLM que declare el perfil. Vacía para perfiles con proveedor local (Ollama)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "teams_webhook_url" {
  description = "Webhook de Teams para el digest (TEAMS_WEBHOOK_URL). Vacío si no se usa."
  type        = string
  default     = ""
  sensitive   = true
}

variable "digest_email_recipients" {
  description = "Destinatarios del digest (DIGEST_EMAIL_RECIPIENTS), separados por comas. Vacío si no se usa."
  type        = string
  default     = ""
  sensitive   = true
}

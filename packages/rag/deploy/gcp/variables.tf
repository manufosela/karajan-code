variable "project_id" {
  description = "ID del proyecto GCP donde se despliega el RAG."
  type        = string
}

variable "region" {
  description = "Región GCP para todos los recursos."
  type        = string
  default     = "europe-west1"
}

variable "service_name" {
  description = "Nombre base del servicio (Cloud Run, bucket, secretos...)."
  type        = string
  default     = "karajan-rag"
}

variable "image" {
  description = <<-EOT
    Imagen del servidor RAG (Dockerfile del repo) ya subida a un registry
    accesible. Si se deja vacía, se usa la ruta del Artifact Registry que
    crea este módulo: <region>-docker.pkg.dev/<project>/<service>/server:latest
    (hay que hacer push de la imagen tras el primer apply).
  EOT
  type        = string
  default     = ""
}

variable "db_tier" {
  description = "Tier de la instancia Cloud SQL (db-f1-micro solo para pruebas)."
  type        = string
  default     = "db-f1-micro"
}

variable "db_deletion_protection" {
  description = "Protección de borrado de la instancia Cloud SQL. Desactivar solo para entornos efímeros."
  type        = bool
  default     = true
}

variable "bucket_force_destroy" {
  description = <<-EOT
    Si true, terraform destroy borra el bucket del índice aunque tenga
    objetos. Con el valor por defecto (false) el bucket con datos es el
    único recurso que sobrevive a un destroy, y queda documentado así.
  EOT
  type        = bool
  default     = false
}

variable "allow_unauthenticated" {
  description = <<-EOT
    Si true, la API HTTP del RAG queda pública (roles/run.invoker para
    allUsers). Por defecto false: solo identidades con permiso invoker
    pueden consultarla (p. ej. via `gcloud run services proxy`).
  EOT
  type        = bool
  default     = false
}

variable "max_instances" {
  description = "Máximo de instancias de Cloud Run."
  type        = number
  default     = 2
}

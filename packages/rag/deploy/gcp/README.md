# Easy RAG en GCP (Terraform)

Módulo autocontenido que monta el RAG de karajan-rag en Google Cloud:

| Recurso | Para qué |
|---------|----------|
| **Cloud Run v2** | Sirve la API HTTP del índice (`POST /query`, `GET /health`) con la imagen del `Dockerfile` del repo. |
| **Cloud SQL Postgres 16** | Vector store (`pgvector`), conectado por socket Cloud SQL. |
| **GCS bucket** | El índice: fuentes + `.karajan/manifest.json`, montado read-only en `/data` vía GCS FUSE. |
| **Secret Manager** | `PG_URL` completo (usuario/contraseña generados por Terraform, nunca en texto plano). |
| **Artifact Registry** | Registry Docker para la imagen del servidor. |
| **Service account** | Permisos mínimos: `cloudsql.client`, `secretAccessor`, `objectViewer`. |

El layout `deploy/gcp/` está pensado para crecer con hermanos `deploy/aws/` y `deploy/azure/`.

## Requisitos

- Terraform >= 1.7 y `gcloud` autenticado (`gcloud auth application-default login`).
- Un proyecto GCP con facturación activa.
- Docker en local para construir la imagen.

## Despliegue paso a paso

```bash
cd deploy/gcp
terraform init
terraform apply -var project_id=MI_PROYECTO
```

El primer `apply` crea toda la infraestructura. Después, tres pasos de datos:

### 1. Publicar la imagen

```bash
REPO=$(terraform output -raw artifact_repository)
gcloud auth configure-docker $(terraform output -raw artifact_repository | cut -d/ -f1)
docker build -t "$REPO/server:latest" ../..
docker push "$REPO/server:latest"
```

### 2. Migrar la base de datos e indexar

```bash
# Túnel local a Cloud SQL:
cloud-sql-proxy $(terraform output -raw sql_connection_name) --port 5432 &

# PG_URL local (la contraseña vive en Secret Manager):
export PG_URL="postgres://karajan:$(gcloud secrets versions access latest \
  --secret $(terraform output -raw pg_url_secret) | sed -E 's|.*:([^@]+)@.*|\1|')@127.0.0.1:5432/karajan_rag"

# Extensión pgvector + schema:
psql "$PG_URL" -f ../../migrations/001-init-pgvector.sql

# Indexar la carpeta con tus fuentes:
npx karajan-rag index ./mi-proyecto --store pgvector
```

### 3. Subir el índice al bucket y redesplegar

```bash
gsutil -m rsync -r ./mi-proyecto gs://$(terraform output -raw index_bucket)
gcloud run services update $(terraform output -raw service_url | sed 's|https://||;s|-.*||') \
  --region europe-west1 --no-traffic 2>/dev/null || true  # opcional: forzar nueva revisión
```

### Consultar

```bash
URL=$(terraform output -raw service_url)
# Con allow_unauthenticated=false (default), usa un token de identidad:
curl -s -X POST "$URL/query" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H 'content-type: application/json' \
  -d '{"question": "¿cómo se factura?", "topK": 5}'
```

## Variables principales

| Variable | Default | Notas |
|----------|---------|-------|
| `project_id` | — | Obligatoria. |
| `region` | `europe-west1` | |
| `service_name` | `karajan-rag` | Prefijo de todos los recursos. |
| `image` | Artifact Registry propio | Pasa otra ruta si ya publicas la imagen en otro registry. |
| `db_tier` | `db-f1-micro` | Solo pruebas; sube a `db-custom-*` en serio. |
| `allow_unauthenticated` | `false` | `true` deja la API pública — piénsalo dos veces. |
| `bucket_force_destroy` | `false` | Ver destroy. |
| `db_deletion_protection` | `true` | Ver destroy. |

## Destroy

```bash
terraform destroy -var project_id=MI_PROYECTO
```

Sin huérfanos, con dos protecciones deliberadas que hay que levantar a mano:

- La instancia Cloud SQL tiene `deletion_protection=true` por defecto → `-var db_deletion_protection=false` y un `apply` previo antes del destroy.
- El bucket del índice con objetos no se borra salvo `-var bucket_force_destroy=true`.

## Coste orientativo

Con defaults (db-f1-micro + Cloud Run scale-to-zero + bucket pequeño): pocos euros/mes dominados por Cloud SQL. Apaga la instancia si no la usas.

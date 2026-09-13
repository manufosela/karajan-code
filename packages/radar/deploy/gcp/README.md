# Instancia de Karajan Radar en GCP (Terraform)

Módulo autocontenido que levanta una instancia del radar en Google Cloud. Una
instancia = un `apply` de este módulo con sus propias variables: el módulo no
lleva dentro ningún `project_id`, hostname ni secreto, así que la misma
descripción sirve para N instancias. Espeja `packages/rag/deploy/gcp`.

| Recurso | Para qué |
|---------|----------|
| **Cloud Run v2 (API)** | El backend FastAPI. Secretos desde Secret Manager, Cloud SQL por conector. |
| **Cloud Run v2 (frontend)** | El frontend Next.js. Su imagen es **por instancia** (hornea `NEXT_PUBLIC_*` en build). |
| **Cloud Run Job (ingesta)** | `python -m app.cli ingest`, disparado por Cloud Scheduler. |
| **Cloud Run Job (digest)** | `python -m app.cli digest`, disparado por Cloud Scheduler. |
| **Cloud Scheduler** | Ejecuta ingesta y digest en sus crons (`ingestion_schedule`, `digest_schedule`). |
| **Cloud SQL Postgres 16** | Base de datos gestionada (`karajan_radar`), conectada por socket Cloud SQL. |
| **Secret Manager** | `APP_SECRET_KEY`, `DATABASE_URL` y secretos opcionales por instancia. |
| **Artifact Registry** | Registry Docker para las imágenes de backend y frontend. |
| **Service account** | Runtime con permiso mínimo: `cloudsql.client`, `secretAccessor`, `run.invoker`. |

## Requisitos

- Terraform >= 1.7 y `gcloud` autenticado (`gcloud auth application-default login`).
- Un proyecto GCP con facturación activa.
- Docker en local para construir las imágenes (o Cloud Build con los `cloudbuild.yaml` del backend y del frontend).

## Despliegue

El orden importa: las migraciones tienen que correr **antes** de que el API
sirva la revisión nueva. Un `terraform apply` completo actualiza el API a la vez
que todo lo demás, así que el deploy se hace **por fases**, no en un solo apply.

Cada release usa un **tag inmutable** (por ejemplo el SHA de git), no `:latest`.
Es lo que hace que Terraform vea un cambio en el template del job y del servicio,
y que el job de migración ejecute la imagen recién publicada y no una anterior.

### 1. Bootstrap: crear el Artifact Registry

Antes de poder publicar imágenes hace falta que exista el registry. En una
instancia nueva no hay estado todavía, así que se crea con un apply dirigido
(no toca servicios ni jobs):

```bash
cd packages/radar/deploy/gcp
terraform init
terraform apply -var project_id=MI_PROYECTO -var active_profile=software-engineering \
  -target=google_artifact_registry_repository.images
```

### 2. Publicar las imágenes

El backend es compartible entre instancias; el frontend NO (hornea el branding).

```bash
REPO=$(terraform output -raw artifact_repository)
gcloud auth configure-docker "$(echo "$REPO" | cut -d/ -f1)"
TAG=$(git rev-parse --short HEAD)   # tag inmutable de esta release

docker build -t "$REPO/karajan-radar-backend:$TAG" ../../backend
docker push "$REPO/karajan-radar-backend:$TAG"

docker build -t "$REPO/karajan-radar-frontend:$TAG" \
  --build-arg NEXT_PUBLIC_API_URL="https://<api-host-previsto>" ../../frontend
docker push "$REPO/karajan-radar-frontend:$TAG"
```

### 3. Migrar y solo entonces servir

El orden importa: las migraciones corren **antes** de que el API sirva la
revisión nueva. El deploy es por fases: primero se refresca y ejecuta el Cloud
Run Job de migración (`alembic upgrade head`) con `--wait`; solo si termina bien
(exit 0), el `apply` completo crea/actualiza los servicios y les da tráfico. La
cadena con `&&` para el deploy en cuanto una fase falla, así que un fallo de
migración no deja el API sirviendo contra un esquema que no le corresponde.

```bash
terraform apply -var project_id=MI_PROYECTO -var active_profile=software-engineering \
    -var image_backend="$REPO/karajan-radar-backend:$TAG" \
    -target=google_cloud_run_v2_job.migrate \
  && gcloud run jobs execute "$(terraform output -raw migrate_job)" \
       --region "$(terraform output -raw region)" --wait \
  && terraform apply -var project_id=MI_PROYECTO -var active_profile=software-engineering \
    -var image_backend="$REPO/karajan-radar-backend:$TAG" \
    -var image_frontend="$REPO/karajan-radar-frontend:$TAG"
```

Si cambias `region`, pásala con `-var region=...` en los `apply`; el `gcloud`
la toma del output, así que ambos quedan en la misma región.

Repite los pasos 2 y 3 en cada deploy con imagen nueva (el registry del paso 1
ya existe). Un pipeline de CD (fuera de alcance hoy) codificaría este orden.

Nunca migres en el arranque del API: varias réplicas de Cloud Run lo harían en
paralelo sobre la misma base (condición de carrera).

### 4. Consultar

Con `allow_unauthenticated=false` (default) los servicios son privados:

```bash
curl -s "$(terraform output -raw api_url)/health" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)"
```

## Variables principales

| Variable | Default | Notas |
|----------|---------|-------|
| `project_id` | — | Obligatoria. |
| `region` | `europe-southwest1` | |
| `service_name` | `karajan-radar` | Prefijo de todos los recursos. |
| `active_profile` | — | Radar Profile de la instancia (`ACTIVE_PROFILE`). |
| `allowed_origins` | — | Orígenes CORS del backend, separados por comas. |
| `image_backend` / `image_frontend` | Artifact Registry propio | Pasa otra ruta si publicas en otro registry. |
| `db_tier` | `db-f1-micro` | Solo pruebas; sube a `db-custom-*` en serio. |
| `allow_unauthenticated` | `false` | `true` deja API y frontend públicos: piénsalo dos veces. |
| `ingestion_schedule` | `0 6 * * *` | Cron de la ingesta. |
| `digest_schedule` | `0 8 * * 1` | Cron del digest. |
| `scheduler_timezone` | `Europe/Madrid` | Zona de los cron. |
| `db_deletion_protection` | `true` | Ver destroy. |
| `llm_api_key` / `teams_webhook_url` / `digest_email_recipients` | `""` | Secretos opcionales; solo se crean si tienen valor. |

## Destroy

```bash
terraform destroy -var project_id=MI_PROYECTO
```

Cloud SQL tiene `deletion_protection=true` por defecto: para borrarla, un
`apply` previo con `-var db_deletion_protection=false` y luego el destroy. Las
APIs habilitadas no se desactivan al destruir (otra instancia del mismo
proyecto podría usarlas).

## Coste orientativo

Con defaults (db-f1-micro + Cloud Run scale-to-zero): pocos euros/mes,
dominados por Cloud SQL. Apaga la instancia si no la usas.

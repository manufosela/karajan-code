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
| **Cloud Scheduler** | Ejecuta la ingesta en el cron de la instancia (`ingestion_schedule`). |
| **Cloud SQL Postgres 16** | Base de datos gestionada (`karajan_radar`), conectada por socket Cloud SQL. |
| **Secret Manager** | `APP_SECRET_KEY`, `DATABASE_URL` y secretos opcionales por instancia. |
| **Artifact Registry** | Registry Docker para las imágenes de backend y frontend. |
| **Service account** | Runtime con permiso mínimo: `cloudsql.client`, `secretAccessor`, `run.invoker`. |

> **El job de digest no está aquí todavía.** La topología pide dos jobs
> (ingesta y digest), pero el CLI del backend solo expone `ingest`: el comando
> `digest` y su job/scheduler llegan con **KRD-TSK-0024**.

## Requisitos

- Terraform >= 1.7 y `gcloud` autenticado (`gcloud auth application-default login`).
- Un proyecto GCP con facturación activa.
- Docker en local para construir las imágenes (o Cloud Build con los `cloudbuild.yaml` del backend y del frontend).

## Despliegue

```bash
cd packages/radar/deploy/gcp
terraform init
terraform apply -var project_id=MI_PROYECTO -var active_profile=software-engineering
```

El primer `apply` crea la infraestructura. Después, los datos:

### 1. Publicar las imágenes

El backend es compartible entre instancias; el frontend NO (hornea el branding).

```bash
REPO=$(terraform output -raw artifact_repository)
gcloud auth configure-docker "$(echo "$REPO" | cut -d/ -f1)"

# Backend (o usa packages/radar/backend/cloudbuild.yaml):
docker build -t "$REPO/karajan-radar-backend:latest" ../../backend
docker push "$REPO/karajan-radar-backend:latest"

# Frontend, con el branding de ESTA instancia en build args
# (o usa packages/radar/frontend/cloudbuild.yaml):
docker build -t "$REPO/karajan-radar-frontend:latest" \
  --build-arg NEXT_PUBLIC_API_URL="$(terraform output -raw api_url)" \
  ../../frontend
docker push "$REPO/karajan-radar-frontend:latest"
```

Vuelve a `terraform apply` para que los servicios tomen las imágenes recién
publicadas (si dejaste `image_backend`/`image_frontend` en su default).

### 2. Migrar la base de datos

Las migraciones de despliegue son su propia card (**KRD-TSK-0019**). Mientras,
a mano con un túnel:

```bash
cloud-sql-proxy "$(terraform output -raw sql_connection_name)" --port 5432 &
# DATABASE_URL local desde el secreto; luego alembic upgrade head.
```

### 3. Consultar

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

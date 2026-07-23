# Caso de uso real: RAG en producción sobre Google Cloud

> Criterio de salida hacia la 1.0: *"al menos un despliegue real
> documentado"*. Este es el registro del despliegue de validación
> ejecutado el **2026-07-22** con el módulo Terraform de `deploy/gcp/`
> sobre un proyecto GCP real (facturación activa), de cero a servicio
> respondiendo queries y vuelta a cero con `terraform destroy`.

## Qué se desplegó

La arquitectura completa del módulo, 19 recursos:

- **Cloud Run v2** sirviendo la imagen del `Dockerfile` del repo
  (`karajan-rag serve --http` sobre el `RagService`), **privada por
  defecto** — invocación solo con identity token vía IAM.
- **Cloud SQL Postgres 16** con **pgvector** (edición ENTERPRISE,
  `db-f1-micro` para la validación), inicializada con
  `migrations/001-init-pgvector.sql`.
- **GCS + FUSE** montado en `/data` para el corpus y el manifest del
  índice.
- **Secret Manager** para `PG_URL` — la connection string nunca toca la
  imagen ni las variables de entorno en claro.

## Flujo ejecutado

1. `terraform apply -var project_id=<PROJECT_ID>` (~20 minutos, dominados
   por la creación de la instancia Cloud SQL).
2. Build y push de la imagen a Artifact Registry.
3. Migración pgvector aplicada vía `cloud-sql-proxy`.
4. Indexado del corpus de prueba con `--store pgvector` y rsync del
   manifest a GCS.
5. Verificación end-to-end:
   - `GET /health` → `200 {"status":"ok"}` con identity token.
   - `POST /query` → hits correctos servidos desde pgvector (retrieval
     híbrido vector + BM25, igual que en local).
6. `terraform destroy` → 19 recursos eliminados sin residuos.

**Tiempo total de recreación desde cero: ~25 minutos.** El coste de la
validación (unas horas de Cloud SQL micro + Cloud Run a cero réplicas) fue
de céntimos.

## Qué encontró la validación

Probar contra GCP real —no solo `terraform validate`— destapó 4 bugs que
ningún test local podía ver, todos corregidos en la 0.4.0:

| Bug | Síntoma | Fix |
|-----|---------|-----|
| KJR-BUG-0001 | Cloud SQL rechaza `db-f1-micro` (edición ENTERPRISE_PLUS por defecto) | `edition = "ENTERPRISE"` explícito |
| KJR-BUG-0002 | La migración declaraba `id uuid`, incompatible con los chunk ids (`doc:path#n`) | `id text PRIMARY KEY` |
| KJR-BUG-0003 | `deletion_protection` bloqueaba replace/destroy de Cloud Run | Desactivado con nota: protege producción activándolo tras estabilizar |
| KJR-BUG-0004 | `pg` ausente de la imagen (colisión con devDependencies en `--omit=dev`) | Stage de deps con `package.json` aislado |

De la misma sesión salió también KJR-BUG-0005 (guarda de integridad
manifest↔store: manifest presente + store vacío → reindex completo, nunca
un "sin cambios" con queries vacías).

## Lecciones

- **El plan de infraestructura solo cuenta cuando aplica de verdad**: los
  4 bugs eran invisibles para `terraform validate` y `docker build`.
- **Privado por defecto funciona**: en ningún momento hubo un endpoint
  público; la verificación usó identity tokens IAM.
- **Reproducibilidad**: entorno completo desechable en ~25 min lo hace
  viable como entorno de staging bajo demanda, no solo producción.

El paso a paso genérico está en [`deploy/gcp/README.md`](../deploy/gcp/README.md).

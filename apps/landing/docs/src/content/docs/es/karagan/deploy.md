---
title: 'Contenedor y Google Cloud'
description: 'Docker, docker compose con pgvector y despliegue GCP con Terraform: Cloud Run + Cloud SQL + Secret Manager, privado por defecto.'
---

<!-- synced-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · section-sha256: 2866e9c0c3952078595c7026679a48c6b70ac595f90c18c5eca498e23f26e143
     NO EDITAR A MANO — regenerado con `npm run sync:family-docs` -->

```bash
docker build -t karajan-rag-server .
docker run --rm -v $PWD/mi-proyecto:/data --entrypoint node \
  karajan-rag-server bin/karajan-rag.js index /data
docker run -d -p 8080:8080 -v $PWD/mi-proyecto:/data karajan-rag-server
```

`docker compose up` levanta además Postgres+pgvector para el modo
`KARAJAN_STORE=pgvector` (ver `docker-compose.yml`).

## 7. En Google Cloud

```bash
cd deploy/gcp
terraform apply -var project_id=MI_PROYECTO
```

Cloud Run + Cloud SQL pgvector + GCS + Secret Manager, privado por defecto.
Flujo completo (imagen, migración, indexado, rsync del índice, query con
identity token) en [`deploy/gcp/README.md`](https://github.com/manufosela/karajan-rag/blob/v1.5.0/deploy/gcp/README.md). El
despliegue está validado contra GCP real: [caso de uso documentado](https://github.com/manufosela/karajan-rag/blob/v1.5.0/docs/case-study-gcp.md).

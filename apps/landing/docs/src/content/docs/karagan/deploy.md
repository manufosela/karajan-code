---
title: 'Container and Google Cloud'
description: 'Docker, docker compose with pgvector, and GCP deployment via Terraform: Cloud Run + Cloud SQL + Secret Manager, private by default.'
---

<!-- translated-from: manufosela/karajan-rag@v1.5.0:docs/easy-rag.md · source-sha256: 2866e9c0c3952078595c7026679a48c6b70ac595f90c18c5eca498e23f26e143
     English translation maintained in this repo; `npm run sync:family-docs` flags it when the source changes. -->

## 6. In a container

```bash
docker build -t karajan-rag-server .
docker run --rm -v $PWD/my-project:/data --entrypoint node \
  karajan-rag-server bin/karajan-rag.js index /data
docker run -d -p 8080:8080 -v $PWD/my-project:/data karajan-rag-server
```

`docker compose up` additionally brings up Postgres+pgvector for the
`KARAJAN_STORE=pgvector` mode (see `docker-compose.yml`).

## 7. On Google Cloud

```bash
cd deploy/gcp
terraform apply -var project_id=MY_PROJECT
```

Cloud Run + Cloud SQL pgvector + GCS + Secret Manager, private by
default. The full flow (image, migration, indexing, index rsync, query
with identity token) lives in
[`deploy/gcp/README.md`](https://github.com/manufosela/karajan-rag/blob/v1.5.0/deploy/gcp/README.md).
The deployment is validated against real GCP:
[documented case study](https://github.com/manufosela/karajan-rag/blob/v1.5.0/docs/case-study-gcp.md).

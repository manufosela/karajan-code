# Deployment

## Deploy to production

Deploys go through the pipeline only: a tag `vX.Y.Z` on `main` builds the image, runs the smoke tests and promotes it to the production cluster. Nobody deploys from a laptop.

## Rollback

To roll back, promote the previous tag again. Database migrations are forward-only, so a rollback never undoes a migration; write a new one instead.

## Secrets

Secrets live in the secret manager and reach the containers as environment variables. They are never written to the repo, the image or the logs.

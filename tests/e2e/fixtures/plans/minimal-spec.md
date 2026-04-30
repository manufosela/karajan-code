# Minimal SPEC.md (3 HUs)

## 1. Greeting endpoint

The system shall expose `GET /hello` that returns `{"msg": "hello"}`.

## 2. Greeting language toggle

The system shall accept a `?lang=es` query parameter and return
`{"msg": "hola"}` when set.

## 3. Greeting log

Every request to the greeting endpoint shall append a line to
`access.log` containing the language used.

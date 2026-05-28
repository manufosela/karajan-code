FROM node:20-alpine

# Install git (required for diff generation in the pipeline)
RUN apk add --no-cache git

# Install karajan-code globally from npm
RUN npm install -g karajan-code

# Default working directory for mounted projects
WORKDIR /workspace

# Drop root: an exploit inside the pipeline (or a CVE in a transitive dep)
# would otherwise land as UID 0 inside the container — and, with the typical
# `docker run -v $PWD:/workspace`, that root maps onto the host filesystem.
# Audited via semgrep dockerfile.security.missing-user-entrypoint (KJC-BUG-0071).
RUN addgroup -S kj && adduser -S kj -G kj && chown -R kj:kj /workspace
USER kj

# All three CLIs are available: kj, kj-tail, karajan-mcp
ENTRYPOINT ["kj"]

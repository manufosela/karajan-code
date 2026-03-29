FROM node:20-alpine

# Install git (required for diff generation in the pipeline)
RUN apk add --no-cache git

# Install karajan-code globally from npm
RUN npm install -g karajan-code

# Default working directory for mounted projects
WORKDIR /workspace

# All three CLIs are available: kj, kj-tail, karajan-mcp
ENTRYPOINT ["kj"]

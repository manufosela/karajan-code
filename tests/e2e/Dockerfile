FROM node:20-slim

# Clean environment: only node and npm, nothing else
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Create a non-root user (simulates real user)
RUN useradd -m -s /bin/bash kjuser
USER kjuser
WORKDIR /home/kjuser

# Install karajan-code from local tarball (mounted at build or copied)
COPY --chown=kjuser:kjuser karajan-code.tgz /tmp/karajan-code.tgz
RUN npm install -g /tmp/karajan-code.tgz

# Create a test project
RUN mkdir test-project && cd test-project && git init && git remote add origin https://github.com/example/test.git

WORKDIR /home/kjuser/test-project

# Run smoke tests
COPY --chown=kjuser:kjuser e2e-smoke.sh /home/kjuser/e2e-smoke.sh
RUN chmod +x /home/kjuser/e2e-smoke.sh

ENTRYPOINT ["/home/kjuser/e2e-smoke.sh"]

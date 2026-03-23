FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ src/
COPY public/ public/
ENV PORT=4000
ENV KJ_HOME=/data
EXPOSE 4000
CMD ["node", "src/server.js"]

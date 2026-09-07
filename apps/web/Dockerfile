# 베이스 이미지는 digest 로 고정하고, 의존성은 lockfile 그대로만 설치한다 (ODY-013)
FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Monaco를 셀프호스팅 (외부 CDN 의존 제거 — 폐쇄망 배포 지원)
RUN mkdir -p public/monaco && cp -r node_modules/monaco-editor/min/vs public/monaco/vs
# standalone 빌드는 rewrite 대상(next.config)을 빌드 시점에 고정한다 — compose 내부 주소로 명시
ARG API_URL=http://api:8000
ENV API_URL=${API_URL}
RUN npm run build

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

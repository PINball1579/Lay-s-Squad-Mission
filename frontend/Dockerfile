# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=true \
    NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true --no-audit --no-fund
COPY . .
ARG VITE_MOCK_LIFF=true
ARG VITE_LIFF_ID=
ENV VITE_MOCK_LIFF=$VITE_MOCK_LIFF VITE_LIFF_ID=$VITE_LIFF_ID
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --chmod=0644 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080


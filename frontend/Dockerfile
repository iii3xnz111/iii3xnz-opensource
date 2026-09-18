FROM node:20-slim AS build
WORKDIR /app
ARG VITE_SELF_HOSTED=true
ENV VITE_SELF_HOSTED=$VITE_SELF_HOSTED
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

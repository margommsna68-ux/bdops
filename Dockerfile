FROM node:22-alpine

RUN apk add --no-cache openssl postgresql-client

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --legacy-peer-deps

COPY . .

RUN npx prisma generate
# Theme "Đồng ấm": regenerate its colour rules from this source so a new colour is never released without them
# (deterministic; the test suite checks the committed copy with --check).
RUN node scripts/build-bronze-theme.cjs
RUN npx next build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]

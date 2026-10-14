FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json* ./
COPY prisma ./prisma/

RUN npm ci --legacy-peer-deps

COPY . .

RUN npx prisma generate
RUN npx next build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]

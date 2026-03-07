# BDOps - Railway Deployment Guide

## Prerequisites
- Railway account (https://railway.app)
- GitHub repo linked to Railway
- Google OAuth credentials (for production domain)

## Step 1: Create Railway Project
1. Go to Railway dashboard > New Project
2. Choose "Deploy from GitHub repo"
3. Select your BDOps repo

## Step 2: Add PostgreSQL
1. In Railway project > New > Database > PostgreSQL
2. Railway auto-provisions and sets `DATABASE_URL`

## Step 3: Set Environment Variables
In Railway project > Variables, add:

```
NEXTAUTH_URL=https://your-app.railway.app
NEXTAUTH_SECRET=<generate: openssl rand -base64 32>
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
ENCRYPTION_KEY=<generate: openssl rand -hex 32>
```

**Note**: `DATABASE_URL` is auto-set by Railway PostgreSQL addon.

## Step 4: Deploy
Railway auto-deploys on push. The `railway.toml` handles:
- Install dependencies
- Generate Prisma client
- Push schema to DB
- Build Next.js

## Step 5: Seed Data (first time)
In Railway project > your service > Settings > Run Command (one-time):
```bash
npx tsx prisma/seed.ts
```
Or use Railway CLI:
```bash
railway run npx tsx prisma/seed.ts
```

## Step 6: Google OAuth
Update Google Cloud Console OAuth:
- Authorized redirect URI: `https://your-app.railway.app/api/auth/callback/google`

## Backups
- Railway PostgreSQL supports automatic daily snapshots
- Enable in Database > Settings > Backups

## Custom Domain (optional)
1. Railway project > Settings > Domains
2. Add custom domain
3. Update DNS CNAME to Railway
4. Update `NEXTAUTH_URL` to new domain

# EduSafe

Attendance, family communication, and school incident coordination. Built with Next.js, TypeScript, and Supabase.

**Live site:** https://edu-safe-alpha.vercel.app/ · **[Interactive demo](https://edu-safe-alpha.vercel.app/demo)**

**[Полная инструкция на русском → README_RU.md](README_RU.md)**

The public demo uses fictional browser-local data. Signed-in school workspaces persist to PostgreSQL and enforce organization and role isolation. Telegram delivery is disabled by default until explicitly configured.

```sh
npm ci
cp .env.example .env.local
# Configure the Supabase URL and publishable key.
npm run dev
```

See [architecture](ARCHITECTURE.md), [demo script](DEMO_SCENARIO.md), and [verification results](TEST_REPORT.md).

Deployment and remaining email/Telegram setup are tracked in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

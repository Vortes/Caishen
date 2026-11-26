# Caishen

Caishen is a budgeting app for one person or a couple. You give every dollar of cash you actually have a job, the way YNAB does, and the plan only ever counts money that is in your accounts.

Two partners each keep a private budget. The only thing they share is a ledger of what one owes the other, so splitting rent or groceries never means showing someone your whole budget.

Bank transactions come in through Plaid. A daily email tells you what needs a look.

The hosted version runs at [curate.is](https://curate.is).

## Run it locally

You need Node 24, a Postgres database, and a [Clerk](https://clerk.com) application in development mode.

```sh
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Before `npm run db:migrate`, fill in four values in `.env.local`:

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. For a Postgres on your machine, use the same URL for both. For Neon, use the pooled and direct connection strings.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, from your Clerk application's API keys page.

The app then runs at `http://localhost:3000`. Everything else in `.env.example` is optional, and each feature stays off until its keys are set:

- Bank connections need the `PLAID_*` keys and `BANK_TOKEN_ENCRYPTION_KEY`. Generate the key with `openssl rand -hex 32`.
- Email needs `RESEND_API_KEY`, `EMAIL_FROM` and `APP_BASE_URL`.
- The daily job at `/api/jobs/daily` needs `CRON_SECRET`. `vercel.json` schedules it on Vercel.

## Check your work

```sh
npm run check         # ESLint and TypeScript
npm run format:check  # Prettier
npm test              # unit and component tests, no database needed
npm run test:db       # database tests, against the database in .env.local
```

CI runs the first three on every pull request.

The database tests and `npm run db:seed` write test data, so they refuse any database they cannot prove is a development one. A Postgres on localhost always passes. A Neon database passes once the `NEON_*` ids in `.env.local` name your project and its `dev-caishen` branch. `.env.example` explains each id.

## Where things are

- `src/domain/` holds the accounting rules, with no database or network in them.
- `src/server/` holds services, persistence and integrations. `src/app/` holds pages and API routes.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) defines the budgeting terms the code uses.
- [docs/architecture-decision-records/](docs/architecture-decision-records) records why the larger decisions went the way they did.
- [docs/design-system/DESIGN.md](docs/design-system/DESIGN.md) describes the UI components and when to use each.

`AGENTS.md` and `docs/agents/` are instructions for the coding agents I build this with. They are worth a skim before a large change, since they describe how work here is expected to go.

## Security

Please report vulnerabilities privately. [SECURITY.md](SECURITY.md) says how.

## License

Caishen is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you run a modified copy as a service, you have to offer its users your source.

The color themes in `src/components/app-shell/palettes.ts` come from [Monkeytype](https://github.com/monkeytypegame/monkeytype), which is licensed under GPL-3.0.

# SafeNote

A Google Keep style notes app where every note is encrypted in your browser before it leaves it.
Runs on Cloudflare's free plan: one Worker, static assets, and a D1 database. No servers to manage.

- Cards in a grid, quick capture, colours, pins, labels, archive, trash, search, dark mode
- Markdown notes: headings, bold, italic, strikethrough, lists, tickable task lists, quotes, code, links, tables.
  Spoilers: `||secret||` is a black bar until clicked, `||secret||{Users Password}` shows a label on the bar, and each has a copy button.
  The renderer is built in (no libraries) and never treats note text as HTML. Raw HTML and `javascript:` links show as plain text
- Cloudflare Access signs you in. A separate passphrase, which never leaves your browser, unlocks the notes
- One deployment can serve several people. Each person has their own vault and passphrase

## What this protects you from (and what it does not)

**Protects against**
- Someone who gets the database (a leak, a bad backup, a curious admin reading D1). They find random IDs and
  encrypted blobs. No titles, text, colours, labels, pins, dates or emails.
- Someone who gets past or misconfigures Cloudflare Access. Access identity alone cannot decrypt anything:
  decryption needs your passphrase or recovery key, which only exist in your head and your browser.
- Notes being tied to your email in storage. The email is never stored; people are told apart by an HMAC of the opaque
  Access user id, keyed with a secret that only the Worker holds.

**Does not protect against**
- **Cloudflare itself.** It sees your IP, your Access login, and request timing, as it would for any site.
  Use a VPN or Private Relay if that matters to you.
- **Whoever deploys the Worker.** Anyone with deploy rights could change the code to log things or serve a
  malicious client that steals your passphrase. Keep the repository public and review changes.
- **A weak passphrase.** The wrapped key lives in D1, so a database thief can try guesses offline. PBKDF2 with 600,000
  iterations slows that down, but only a long passphrase (5+ random words) really stops it.
- **A compromised device or browser.** Malware or a hostile extension can read notes while unlocked.
- **Traffic analysis.** The server can count how many notes you have, how often you save, and in what order.
  Note sizes are padded to coarse buckets (1 KB, 4 KB, 16 KB, ...), not hidden completely.
- **Losing your keys.** If you lose both the passphrase and the recovery key, the notes cannot be recovered by anyone.

## How the encryption works

1. On first use your browser makes a random 256-bit AES-GCM **data key**.
2. The data key is wrapped (encrypted) twice: once with a key derived from your passphrase (PBKDF2-SHA256, 600k
   iterations, random salt), once with a random 256-bit **recovery key** shown once as 13 groups of 4 letters.
3. Only the two wrapped copies are sent to the server.
4. Every note is padded to a size bucket, then encrypted with AES-GCM using a fresh random IV. The note ID is bound in
   as authenticated data, so the server can't swap one note's ciphertext into another.
5. The unlocked key is a non-extractable WebCrypto key held in memory only. Locking, auto-lock or closing the tab
   discards it. Nothing secret is written to browser storage (only the theme and zoom choices, so they apply before unlock).

Changing your passphrase re-wraps the data key, so notes are not re-encrypted. Making a new recovery key replaces the
old one.

## What the server stores

`users`: `owner` (HMAC fingerprint), `key_blob` (salt, KDF settings, two wrapped keys), `key_version`, `seq` counter.
`notes`: `owner`, random `id`, `seq`, `iv`, `ct`. Deleted notes keep an empty tombstone row so other devices
learn of the deletion. There are no timestamps, names, emails or IPs in the schema. See [schema.sql](schema.sql).

## One command setup

Create an API token at dash.cloudflare.com/profile/api-tokens with these permissions: Account, Workers Scripts, Edit;
Account, D1, Edit; Account, Access: Apps and Policies, Edit; Account, Access: Organizations, Identity Providers, and
Groups, Read. Then:

```bash
npm install
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export ALLOWED_EMAIL=you@example.com
npm run setup
```

It creates the database, deploys, generates and stores `OWNER_SECRET` (printed once, back it up), creates the Access
application for your email and redeploys with the right values. Running it again is safe. Zero Trust must already be
enabled on the account. Nothing is written to the repo. The manual steps below do the same thing by hand and set up
automatic deploys on push.

## Deploy on a free Cloudflare account

You need a Cloudflare account and a Zero Trust organisation, which has a free plan for up to 50 users. Cloudflare may
ask for a payment method when you first set up Zero Trust, even on the free plan. Nothing private is committed: the
database id and Access values live in Cloudflare, and `scripts/deploy.mjs` fills them in at build time.

**1. Create the database** in the dashboard (Storage and databases, then D1, then Create) or with
`npx wrangler d1 create safenote`, and copy its database id.

**2. Connect the repo.** Workers and Pages, Create, Import a repository, pick this repo. Set:
- Build command: leave empty
- Deploy command: `npm run deploy`
- Build variables (Settings, Build, Variables and secrets): `D1_DATABASE_ID`, `ACCESS_TEAM_DOMAIN`
  (`yourteam.cloudflareaccess.com`) and `ACCESS_AUD` (from step 4).

The first build will fail until step 4 gives you the AUD tag. That is expected; add it and retry the build.

**3. Set the owner secret.** Worker settings, Variables and secrets, add a **Secret** named `OWNER_SECRET`. Generate it
with `openssl rand -hex 32` and **back it up** in a password manager. If you lose or change it, existing vaults become
unreachable. Secrets are kept across deploys.

**4. Put Cloudflare Access in front of it.** In the Cloudflare dashboard:
1. Zero Trust, then Access, then Applications, then Add an application, then Self-hosted.
2. Use your Worker's hostname (your `*.workers.dev` URL or a custom domain) and add a policy allowing the emails or
   login method you want (for example "Emails: you@example.com"). Add other people here to give them a vault.
3. Open the application and copy its **Application Audience (AUD) Tag**. Your team domain
   (`yourteam.cloudflareaccess.com`) is shown under Zero Trust settings.
4. Add both as build variables from step 2 and retry the build.

Every push to the production branch now applies `schema.sql` (it only uses `IF NOT EXISTS`) and deploys. The Worker
refuses every API call that doesn't carry a valid Access token for your application, so a missing or wrong setup fails
closed.

**5. Leave Worker logs off.** `wrangler.toml` sets `observability.enabled = false`. Don't turn on Workers Logs or Logpush
if you want minimal retention.

Open your URL, sign in through Access, create your passphrase, and **save the recovery key**.

### Free plan limits

Static files are free and unlimited. The Worker has a daily request cap on the free plan and D1 has storage and
daily read/write caps. Text notes use a tiny fraction of these. Check Cloudflare's current limits page, as they change.
Each note is limited to about 1 MB of ciphertext. Images are not supported yet.

## Local development

```bash
printf 'OWNER_SECRET=dev-secret\nDEV_SUB=dev-user\n' > .dev.vars   # DEV_SUB skips Access, only on localhost
npm run db:init:local
npm run dev                                                         # http://localhost:8787
npm test                                                            # crypto, markdown and Worker tests (Node 22+)
```

`DEV_SUB` is honoured only when the request hostname is `localhost`, so it cannot bypass Access when deployed. Never
set it as a deployed variable.

## Backups

Settings has **Export encrypted backup** (the raw server data plus your wrapped key; useless without your passphrase)
and **Export decrypted notes** (plain JSON; handle with care). Importing a backup is not built yet.

## Layout

```
public/       static client (plain ES modules, no build step)
  app.js        entry point
  auth.js       setup, unlock and recovery-key screens
  session.js    start, auto-lock and lock
  sync.js       pull/push of encrypted notes and settings
  state.js      in-memory state (nothing is persisted)
  notes-view.js sidebar, search and note grid
  editor.js     note editor; editor-text.js has its Markdown text helpers
  settings.js   settings screen
  dom.js, api.js  DOM helpers and fetch wrapper
  crypto.js     all cryptography
  markdown.js   safe Markdown renderer
  style.css
src/worker.js API: Access JWT check, HMAC owner, notes sync
schema.sql    D1 tables
test/         crypto, markdown, editor-helper and Worker API tests (node --test)
```

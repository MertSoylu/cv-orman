# cv-orman

Standalone Next.js page for [sergi.mertsoylu.dev](https://sergi.mertsoylu.dev): the owner's public GitHub repos rendered as trees in a 3D forest.

- **Size** → stars + commits + age  
- **Color / wilt** → days since last push  
- **Species** → primary language  

Single-user, single-page. No auth, no DB — live GitHub GraphQL + ISR cache.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19  
- react-three-fiber / drei / Three.js  
- Tailwind CSS 4  

## Setup

```bash
cp .env.example .env.local
# fill GITHUB_TOKEN + GITHUB_USERNAME
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Env

| Var | Purpose |
|-----|---------|
| `GITHUB_TOKEN` | PAT for GraphQL (classic or fine-grained) |
| `GITHUB_USERNAME` | Whose public repos become trees |

Missing either → `/` and `/api/repos` fail with a clear error (not silent empty forest).

## Scripts

```bash
npm run dev      # Turbopack dev
npm run build    # production build (+ typecheck)
npm run start    # serve production build
npm run lint     # eslint
npx tsc --noEmit # typecheck only
```

No test runner. Verify with tsc + lint + build + manual browser check of `/`.

## Deploy (Vercel)

1. Import this repo on [Vercel](https://vercel.com).  
2. Project env: `GITHUB_TOKEN`, `GITHUB_USERNAME`.  
3. Domain: `sergi.mertsoylu.dev` (DNS → Vercel).  
4. Deploy.  

`/` revalidates every **3600s** (`revalidate` on the page + `fetch` cache). After first generation, GitHub is not hit every request.

### Production checklist

- [ ] Env vars set in Vercel (Production + Preview if needed)  
- [ ] Custom domain + HTTPS  
- [ ] `/` loads forest (or explicit error state if GitHub fails)  
- [ ] OG card: share `https://sergi.mertsoylu.dev` once  
- [ ] Main site links to sergi if desired  

## Architecture (short)

```
lib/github/*     GraphQL fetch + normalize
lib/forest/*     growth / health / species / layout
app/page.tsx     Server: fetch → layout → ForestPageClient
components/renderers/three-3d/   R3F scene
```

`/api/repos` JSON endpoint exists but the page path does **not** call it — server component fetches directly.

## License

Private portfolio project.

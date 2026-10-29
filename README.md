# Mind Graph

Concept mapping with built-in recall practice. Build a reference map with your notes open, rebuild it from memory in Recall mode, then compare the two to see what you missed.

Built with Vite, React, [React Flow](https://reactflow.dev), [Convex](https://convex.dev), and [Clerk](https://clerk.com).

## Development

```sh
pnpm install
clerk auth login  # Select the Mind Graph workspace
clerk link        # Select the Mind Graph application
clerk env pull --instance dev
pnpm dev:convex   # Configure/sync your Convex dev deployment
pnpm dev          # Start Vite in another terminal
```

See `.env.example` for local configuration. Each signed-in account gets a private demo library. The account menu provides profile settings and sign-out.

Authentication uses email/password, with Google and mandatory email verification disabled. Convex verifies Clerk tokens and checks ownership on all map operations. Data created before accounts existed stays stored but unclaimed.

```sh
pnpm test
pnpm build
pnpm lint
pnpm exec tsc -p convex/tsconfig.json --noEmit
```

## Editing the map

| Action            | How                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Add a child       | Select a node and press `Tab`, or drag out of its right handle and release                                                         |
| Add a sibling     | Select a node and press `Enter`                                                                                                    |
| Place a free node | Click empty canvas, type, `Enter`, then click a parent (`Esc` leaves it floating; select it and press `Enter` to connect it later) |
| Rename            | Double-click, or `F2` (`Enter` saves, `Esc` cancels)                                                                               |
| Reattach          | Drag a node onto a new parent                                                                                                      |
| Move              | Drag (tree nodes snap back into the layout; `G` toggles grid snapping)                                                             |
| Reorder siblings  | `Alt` + `↑`/`↓`                                                                                                                    |
| Navigate          | Arrow keys                                                                                                                         |
| Delete            | `Del` (`Shift`+`Del` with children, `Alt`+`Del` leaves children floating), or right-click                                          |
| Undo / redo       | `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z`                                                                                                    |

## Deployment

Vercel builds deploy the Convex backend and inject its URL into the frontend. Configure these variables separately for each Vercel environment:

- **Preview:** Clerk development publishable key and a Convex project preview deploy key. Each branch gets a separate Convex backend; previews share Clerk development accounts.
- **Production:** Clerk production publishable key and the Convex production deploy key.

The variables are `VITE_CLERK_PUBLISHABLE_KEY` and `CONVEX_DEPLOY_KEY`. On Convex, `CLERK_JWT_ISSUER_DOMAIN` must match the selected Clerk instance, which needs a JWT template named `convex` with `{"aud":"convex"}`. New dev and preview deployments inherit the issuer from project defaults. Environment variable changes require a new Vercel deployment.

Manage keys, domains, and DNS records in the [Clerk dashboard](https://dashboard.clerk.com), [Convex dashboard](https://dashboard.convex.dev), and [Vercel dashboard](https://vercel.com/dashboard). See [Convex's Vercel guide](https://docs.convex.dev/production/hosting/vercel) and [Clerk's production guide](https://clerk.com/docs/guides/development/deployment/production) for setup details.

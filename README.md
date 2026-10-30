# Mind Graph

Concept mapping with built-in recall practice. Build a reference map with your notes open, rebuild it from memory in Recall mode, then compare the two to see what you missed.

Built with Vite, React, [React Flow](https://reactflow.dev), [shadcn/ui](https://ui.shadcn.com), [Convex](https://convex.dev), and [Clerk](https://clerk.com).

## Development

```sh
pnpm install
clerk auth login  # Select the Mind Graph workspace
clerk link        # Select the Mind Graph application
clerk env pull --instance dev
pnpm dev:convex   # Configure/sync your Convex dev deployment
pnpm dev          # Start Vite in another terminal
```

See `.env.example` for local configuration. Each new account starts as the sole owner of "Example Project", containing Cellular respiration and Hypothesis testing maps. The account menu provides profile settings and sign-out.

Authentication uses email/password, with Google and mandatory email verification disabled. Convex checks project membership on all map operations. Owners manage projects; members share maps and notes and can edit maps. Recall attempts and comparisons stay private to each member. Invitations are not implemented yet.

```sh
pnpm test
pnpm build
pnpm lint
pnpm exec tsc -p convex/tsconfig.json --noEmit
```

The sidebar supports map search with `Ctrl`/`Cmd` + `K` and collapses with `Ctrl`/`Cmd` + `\`. Project and map actions are available from their menus or a right-click.

Existing account-owned folders migrate to projects on sign-in, preserving map URLs and recall history. The internal `workspace:migrateProjects` backfill accepts `phase: "folders"` or `phase: "topics"` and an optional `cursor`; finish the folders phase before running topics, passing each returned cursor until `isDone`. Legacy tables remain for migration compatibility, and pre-account data stays unclaimed.

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

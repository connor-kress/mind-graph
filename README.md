# Mind Graph

Concept mapping with built-in recall practice. Build a reference map with your notes open, rebuild it from memory in Recall mode, then compare the two to see what you missed.

Built with Vite, React, [React Flow](https://reactflow.dev), and [Convex](https://convex.dev).

## Development

```sh
pnpm install
pnpm dev:convex   # Convex dev deployment: pushes functions and regenerates types
pnpm dev          # Vite dev server
```

The first `pnpm dev:convex` run configures a dev deployment and writes `.env.local`. The app seeds a demo topic on first load.

## Account components

Standalone Clerk components are available for the upcoming sidebar integration. They are not mounted in the app yet and do not change Convex authentication or map access.

- `AccountProvider` supplies Clerk context. Set `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local` before mounting it.
- `AccountGate` shows Clerk's sign-in screen with a sign-up link, then renders its children once signed in.
- `AccountButtons` opens sign-in or sign-up in a modal.
- `AccountMenu` displays the current user and Clerk's menu for profile, account security, sessions, and sign-out. Its `compact` option shows only the avatar.

The Mind Graph Clerk application is in the dedicated Mind Graph workspace. Authorize the CLI for that workspace, then link the application and fetch development keys:

```sh
clerk auth login
clerk link --app app_3LNFscjNO00bK4AxmaH94B0UhAj
clerk env pull --instance dev
```

The browser only needs the publishable key. Never expose `CLERK_SECRET_KEY` through a `VITE_` variable. See `.env.example` for the local environment shape. The UI components do not enforce backend access. Convex authentication and ownership checks will be added separately on `feat/sidebar`.

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

## Deploying to Vercel

`vercel.json` runs `convex deploy` before building, which pushes the Convex functions to production and points the build at the production deployment. In the Vercel project settings, set `CONVEX_DEPLOY_KEY` to a production deploy key from the Convex dashboard.

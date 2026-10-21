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

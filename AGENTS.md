# Agent instructions

Read [README.md](README.md) for setup, checks, and environment configuration.

- Use `pnpm` for packages and scripts.

## Authenticated CLIs

- **Clerk:** Check `clerk whoami`; log in with `clerk auth login`, selecting the **Mind Graph** workspace. Use `clerk apps list` to find the application ID and `clerk link --app <id>` to link it. Specify `--instance dev` or `--instance prod` on instance-specific commands.
- **Convex:** Check `pnpm exec convex login status`; authenticate with `pnpm exec convex login`. Target project `connor-kress:mind-graph`. Use `--deployment <reference>` where supported, or `pnpm exec convex deployment select connor-kress:mind-graph:dev` for personal development. `convex deploy` ignores that selection and targets production or a preview according to `CONVEX_DEPLOY_KEY`; use `convex dev` for development updates.
- **Vercel:** Check `vercel whoami`; authenticate with `vercel login`. Use project `mind-graph` in scope `connors-projects-3beb6af0`. Pass `--project mind-graph` and an explicit environment where supported; otherwise link with `vercel link --project mind-graph --team connors-projects-3beb6af0` and verify with `vercel project inspect`.
- **GitHub:** Check `gh auth status`; authenticate with `gh auth login`. Use `gh` for issues, pull requests, and checks, targeting `-R connor-kress/mind-graph` where supported.

## Working rules

- If a CLI is missing or not logged in, clearly tell the developer what you can do once it is available and give the install or login command. Have them complete only that prerequisite, then perform the task yourself instead of handing them manual dashboard steps.
- Always obtain explicit user confirmation before mutations, including file edits, remote configuration changes, deployments, commits, and pushes. State the intended change and target environment before asking; read-only inspection needs no confirmation.
- Be especially careful with production. Before any production mutation, explicitly confirm with the user that the requested action is intended for the production environment. General approval to perform an action is not confirmation of its production target.
- Commit and push only when explicitly requested.

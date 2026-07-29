# Devbot Workspace

This directory is a public, credential-free OpenClaw agent workspace fixture shared by Devbot scenarios.

- Keep the workspace minimal and deterministic.
- Use `IDENTITY.md`, `SOUL.md`, `USER.md`, and `TOOLS.md` as agent context.
- Do not add credentials, sessions, runtime config, memory, or generated files.
- Preserve the `assets/devbot.png` avatar reference; scenarios supply the repository-owned product asset at runtime.

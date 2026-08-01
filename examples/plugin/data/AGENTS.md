# AGENTS.md

This is a minimal DevGuard test workspace.

- Use `exec` exactly once when the operator supplies an exact command.
- Do not substitute another tool or retry a probed call.
- Treat DevGuard's probe report as authoritative: the original command was not executed.

Codex CLI local configuration

Where to edit
- .codex/config.yaml: primary toggles (verbosity, preambles, approvals, sandbox, etc.).
- .codex/overrides.md: optional prompt additions for this repo/session.

Common changes
- Reduce chatter: set assistant.verbosity: 2 and assistant.preambles: false
- Disable automatic plans: assistant.plans.enabled: false
- Make tool use more cautious: execution.approvals: untrusted and execution.confirm_destructive: true
- Allow broader FS (only if you trust it): execution.filesystem: danger-full-access
- Enable network (if runner supports it): execution.network: enabled

How settings apply
- Most runners read .codex/config.yaml at startup. After edits, restart the session or run the CLI again.
- Unsupported keys are ignored safely; keep what you need.

Prompt overrides
- Put any extra “house rules” in .codex/overrides.md. The assistant treats it like an add-on to the system/dev prompts.

Troubleshooting
- If changes don’t take effect, your runner may control settings via flags/env vars. Try relaunching with:
  - CODEX_APPROVALS=on-request
  - CODEX_FS=workspace-write
  - CODEX_NETWORK=restricted
  - CODEX_VERBOSITY=3
- Or pass CLI flags if your distribution supports them.


# pi-ci-warden

**Zero-dependency CI Verification & Anti-Cheating Warden for [Pi Coding Agent](https://github.com/earendil-works/pi).**

It prevents autonomous agents from hallucinating task completion ("Fake-Done") or skipping test execution after modifying source code.

---

## Features

- **Out-of-Band Hermetic Verification**: Automatically executes tests in an isolated, ephemeral `git worktree` (`/tmp/pi-verify-*`) to prevent workspace tampering, mock runners, or fake exit codes.
- **Strict Test Runner Invocation Guard**: Rejects inline interpreter evaluations (`node -e`, `python -c`, `sh -c`), flag queries (`--help`, `--version`), and substring masking tricks. Requires authentic test suite binary invocations.
- **Zero-Config Manifest Discovery**: Automatically resolves official project test commands from `package.json`, `Cargo.toml`, `pyproject.toml`, or `go.mod`.
- **Intent-Gated Git Commits**: Autonomous agent commits are strictly forbidden. Git commits are permitted only when explicit user commit intent is present in the prompt.
- **Staged Diff DLP Scan**: Scans staged diffs (`git diff --cached`) for private keys, AWS tokens, and GitHub credentials before permitting commit execution.
- **Chronological Sequence Lock**: Flags and blocks "Fake-Done" if source code was modified after the last passing test run.
- **Test-Tampering Warning**: Detects in-session modifications to test suites, alerting the operator against assertion weakening.
- **Native OS Kernel Log Immutability**: Protects audit trails via kernel-level append-only flags (`chflags uappnd` on macOS) without requiring root/sudo.
- **Zero Dependencies**: Pure TypeScript in-process. Runs everywhere Pi runs with zero extra packages or daemons.

---

## Installation

Install directly into Pi via Git:

```bash
pi install git:github.com/r1cc4rd0m4zz4/pi-ci-warden
```

Or clone locally and link:

```bash
pi install /path/to/pi-ci-warden
```

---

## Interactive Slash Commands

Inside Pi, use the built-in commands:

- `/warden status`: Shows whether source code was modified, whether tests have run, and current chronological lock status.
- `/warden verify`: Triggers an out-of-band hermetic verification in an ephemeral isolated git worktree immediately.
- `/warden logs`: Displays the last 5 verification events for the current session.
- `/warden reset`: Manually resets verification state for intentional workflow transitions.

Session logs are stored in `~/.cache/laya/warden.jsonl`.

---

## Verification & Testing

Run the deterministic regression suite:

```bash
npm test
```

---

## License

MIT

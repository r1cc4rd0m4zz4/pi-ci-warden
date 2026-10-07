# pi-ci-warden

**Zero-dependency CI Verification & Anti-Cheating Warden for [Pi Coding Agent](https://github.com/earendil-works/pi).**

It prevents autonomous agents from hallucinating task completion ("Fake-Done") or skipping test execution after modifying source code.

---

## Features

- **Chronological Sequence Lock**: Flags and blocks "Fake-Done" if source code was modified after the last passing test run.
- **Fake Test Runner Rejection**: Blocks agents attempting to claim verification using `echo`, `printf`, `ls`, `cat`, `--help`, `--version`, or `true`.
- **Exit Code Integrity**: Requires `exitCode === 0` from actual test runners (`npm test`, `pytest`, `cargo test`, `go test`, `vitest`, `jest`, etc.).
- **Anti-Masking Protection**: Detects and rejects error suppression tricks like `pytest || true`, `npm test || exit 0`, or `|| echo`.
- **Manifest Supply-Chain Tracking**: Modifying `package.json`, `tsconfig.json`, `Cargo.toml`, or `pyproject.toml` is tracked as critical source code mutation.
- **Multi-Turn Debt Persistence**: Verification debt does not vanish across prompt turns until a genuine test suite passes.
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
- `/warden logs`: Displays the last 5 verification events for the current session.

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

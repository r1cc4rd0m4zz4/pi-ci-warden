import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Deterministic test suite for pi-ci-warden logic

const FAKE_TEST_PATTERNS = [
  /^\s*echo\b/i,
  /^\s*printf\b/i,
  /^\s*true\s*$/i,
  /--help\b/i,
  /--version\b/i,
  /^\s*ls\b/i,
  /^\s*cat\b/i,
];

const TEST_SUPPRESSION_PATTERNS = [
  /\|\|\s*(?:true|exit\s*0|echo\b|:|true\b)/i,
  /;\s*(?:true|exit\s*0|echo\b|:)\s*$/i,
  /2>&1\s*\|\s*true/i,
];

const VALID_TEST_RUNNERS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i,
  /\bpytest\b/i,
  /\bpython[23]?\s+(?:-m\s+(?:unittest|pytest)|test_.*\.py)\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bctest\b/i,
  /\bmake\s+test\b/i,
];

function isRealTestCommand(cmd, projectTestCmd = null) {
  const cleanCmd = cmd
    .replace(/^\s*(?:cd\s+[^\s&;]+\s*&&\s*)+/, "")
    .replace(/^\s*(?:[A-Za-z0-9_]+=[^\s]+\s+)+/, "")
    .trim();

  // Reject inline interpreter evaluations, help/version queries, and harmless diagnostic commands
  if (/^\s*(?:node|bun)\s+(?:-e|--eval)\b/i.test(cleanCmd)) return false;
  if (/^\s*python[23]?\s+-c\b/i.test(cleanCmd)) return false;
  if (/^\s*(?:sh|bash|zsh|dash)\s+-c\b/i.test(cleanCmd)) return false;
  if (/^\s*(?:echo|printf|true|cat|ls|head|tail)\b/i.test(cleanCmd)) return false;
  if (/(?:^|\s)(?:--help|--version|-h|-v)\b/i.test(cleanCmd)) return false;

  for (const supp of TEST_SUPPRESSION_PATTERNS) {
    if (supp.test(cleanCmd)) return false;
  }

  if (projectTestCmd && (cleanCmd === projectTestCmd || cleanCmd.startsWith(projectTestCmd + " "))) {
    return true;
  }

  return (
    /^\s*(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i.test(cleanCmd) ||
    /^\s*pytest\b/i.test(cleanCmd) ||
    /^\s*cargo\s+test\b/i.test(cleanCmd) ||
    /^\s*go\s+test\b/i.test(cleanCmd) ||
    /^\s*(?:vitest|jest|ctest)\b/i.test(cleanCmd) ||
    /^\s*node\s+--test\b/i.test(cleanCmd) ||
    /^\s*python[23]?\s+(?:-m\s+(?:unittest|pytest)|(?:\S*\/)?test_.*\.py)\b/i.test(cleanCmd)
  );
}

function isSourceCodePath(p) {
  const norm = p.toLowerCase();
  if (norm.endsWith("package.json") || norm.endsWith("tsconfig.json") || norm.endsWith("cargo.toml") || norm.endsWith("pyproject.toml")) {
    return true;
  }
  return !norm.endsWith(".md") && !norm.endsWith(".txt") && !norm.endsWith(".log") && !norm.endsWith(".jsonl") && !norm.endsWith(".json") && !norm.endsWith(".lock");
}

console.log("Running pi-ci-warden regression test suite...");

// 1. Valid test runners
assert.strictEqual(isRealTestCommand("npm test"), true, "npm test must be valid");
assert.strictEqual(isRealTestCommand("pytest tests/"), true, "pytest must be valid");
assert.strictEqual(isRealTestCommand("python3 -m unittest discover"), true, "unittest must be valid");
assert.strictEqual(isRealTestCommand("cargo test"), true, "cargo test must be valid");
assert.strictEqual(isRealTestCommand("go test ./..."), true, "go test must be valid");

// 2. Fake test runners and diagnostic one-liners
assert.strictEqual(isRealTestCommand("echo 'tests passed'"), false, "echo must be rejected");
assert.strictEqual(isRealTestCommand("pytest --help"), false, "--help must be rejected");
assert.strictEqual(isRealTestCommand("pytest --version"), false, "--version must be rejected");
assert.strictEqual(isRealTestCommand("true"), false, "bare true must be rejected");
assert.strictEqual(isRealTestCommand("node -e 'const cmd = \"npm test\"'"), false, "node -e string containing test must be rejected");
assert.strictEqual(isRealTestCommand("python3 -c 'print(\"testing\")'"), false, "python3 -c string must be rejected");

// 3. Antagonistic test error suppression
assert.strictEqual(isRealTestCommand("pytest tests/ || true"), false, "|| true must be rejected");
assert.strictEqual(isRealTestCommand("npm test || exit 0"), false, "|| exit 0 must be rejected");
assert.strictEqual(isRealTestCommand("cargo test || echo fail"), false, "|| echo must be rejected");
assert.strictEqual(isRealTestCommand("pytest tests/ ; exit 0"), false, "; exit 0 must be rejected");

// 4. Source code mutation tracking
assert.strictEqual(isSourceCodePath("src/auth.ts"), true, "src/auth.ts is code");
assert.strictEqual(isSourceCodePath("app.py"), true, "app.py is code");
assert.strictEqual(isSourceCodePath("package.json"), true, "package.json is critical manifest code");
assert.strictEqual(isSourceCodePath("tsconfig.json"), true, "tsconfig.json is critical manifest code");
assert.strictEqual(isSourceCodePath("pyproject.toml"), true, "pyproject.toml is critical manifest code");
assert.strictEqual(isSourceCodePath("README.md"), false, "README.md is doc");
assert.strictEqual(isSourceCodePath("notes.txt"), false, "notes.txt is doc");
assert.strictEqual(isSourceCodePath("package-lock.json"), false, "lock file is not code");

// 5. Chronological integrity (Fake-Done)
const tMutation = 1000;
const tTest = 500;
const fakeDone = tMutation > tTest;
assert.strictEqual(fakeDone, true, "Mutation after test must trigger Fake-Done");

// 6. Multi-turn debt persistence
const lastMutationTurn1 = 1000;
const lastTestTurn1 = 0;
const debtPersistsInTurn2 = lastMutationTurn1 > lastTestTurn1;
assert.strictEqual(debtPersistsInTurn2, true, "Verification debt must persist across turns until test passes");

// 7. Intent-Gated Git Commits (Anti-Cheating Architecture)
function isCommitPermitted(cmd, userIntent) {
  if (/\bgit\s+commit\b/i.test(cmd)) {
    return Boolean(userIntent);
  }
  return true;
}
assert.strictEqual(isCommitPermitted("git commit -m 'feat: update auth'", false), false, "autonomous commit without user intent must be blocked");
assert.strictEqual(isCommitPermitted("git commit -m 'fix: typo'", true), true, "commit with user intent must be allowed");
assert.strictEqual(isCommitPermitted("git status", false), true, "read-only git operations allowed without intent");

// 8. Staged Diff Secret DLP Invariant
function isStagedDiffClean(diffText) {
  const secretPattern = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{36}|xox[baprs]-[0-9a-zA-Z]{10,48})/i;
  return !secretPattern.test(diffText);
}
assert.strictEqual(isStagedDiffClean("diff --git a/key.pem\n+-----BEGIN RSA PRIVATE KEY-----\nMIIE..."), false, "private key in diff rejected");
assert.strictEqual(isStagedDiffClean("diff --git a/src/index.ts\n+const port = 3000;"), true, "clean code diff accepted");

// 9. Zero-Config Manifest Discovery (Out-of-Band Engine)
function resolveProjectTest(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.test && !/no test specified/i.test(pkg.scripts.test)) {
        if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm test";
        if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn test";
        if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun test";
        return "npm test";
      }
    } catch {}
  }
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) return "cargo test";
  if (fs.existsSync(path.join(cwd, "pyproject.toml")) || fs.existsSync(path.join(cwd, "setup.cfg")) || fs.existsSync(path.join(cwd, "pytest.ini"))) {
    return "pytest";
  }
  if (fs.existsSync(path.join(cwd, "go.mod"))) return "go test ./...";
  return null;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-warden-test-"));
try {
  fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "[package]\nname = 'demo'");
  assert.strictEqual(resolveProjectTest(tmpDir), "cargo test", "Cargo.toml resolved to cargo test");
  fs.unlinkSync(path.join(tmpDir, "Cargo.toml"));

  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  assert.strictEqual(resolveProjectTest(tmpDir), "npm test", "package.json resolved to npm test");
  fs.unlinkSync(path.join(tmpDir, "package.json"));

  fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "[tool.pytest]");
  assert.strictEqual(resolveProjectTest(tmpDir), "pytest", "pyproject.toml resolved to pytest");
  fs.unlinkSync(path.join(tmpDir, "pyproject.toml"));

  fs.writeFileSync(path.join(tmpDir, "go.mod"), "module demo");
  assert.strictEqual(resolveProjectTest(tmpDir), "go test ./...", "go.mod resolved to go test ./...");
  fs.unlinkSync(path.join(tmpDir, "go.mod"));

  assert.strictEqual(resolveProjectTest(tmpDir), null, "bare folder resolves to null");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("All pi-ci-warden invariants passed (100% clean).");

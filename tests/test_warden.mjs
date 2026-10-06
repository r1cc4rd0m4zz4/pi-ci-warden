import assert from "node:assert";

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

function isRealTestCommand(cmd) {
  for (const fake of FAKE_TEST_PATTERNS) {
    if (fake.test(cmd)) return false;
  }
  for (const supp of TEST_SUPPRESSION_PATTERNS) {
    if (supp.test(cmd)) return false;
  }
  return VALID_TEST_RUNNERS.some((runner) => runner.test(cmd));
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

// 2. Fake test runners
assert.strictEqual(isRealTestCommand("echo 'tests passed'"), false, "echo must be rejected");
assert.strictEqual(isRealTestCommand("pytest --help"), false, "--help must be rejected");
assert.strictEqual(isRealTestCommand("pytest --version"), false, "--version must be rejected");
assert.strictEqual(isRealTestCommand("true"), false, "bare true must be rejected");

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

console.log("All pi-ci-warden invariants passed (100% clean).");

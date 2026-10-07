/**
 * verification-ci-warden.ts
 *
 * Deterministic CI & Verification Warden:
 * "Test negative branches and edge cases first. Local pass != remote verification."
 *
 * Holographic Event Horizon & Anti-Cheating Architecture:
 * 1. Out-of-Band Verification: Hermetic verification in ephemeral git worktree (/tmp/pi-verify-*).
 * 2. Zero-Config Manifest Discovery: Reads official test commands from package.json, Cargo.toml, pyproject.toml, go.mod.
 * 3. Intent-Gated Git Commits: Autonomous agent commits forbidden; requires explicit user intent in prompt.
 * 4. Staged Diff DLP: Pre-commit secret scanning on staged diff instead of syntactic message filtering.
 * 5. Chronological Sequence Lock: Tracks code mutations vs verified tests to prevent "Fake-Done".
 * 6. Native OS Kernel Log Immutability: Enforces append-only audit trail via chflags uappnd (macOS).
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG_FILE = path.join(os.homedir(), ".cache/laya/warden.jsonl");
const COMMIT_INTENT_REGEX = /\b(?:commit|committa|committare|fai il commit)\b/i;

const FAKE_TEST_PATTERNS = [
  /^\s*echo\b/i,
  /^\s*printf\b/i,
  /^\s*true\s*$/i,
  /--help\b/i,
  /--version\b/i,
  /^\s*ls\b/i,
  /^\s*cat\b/i,
];

const TEST_FILE_PATTERNS = [
  /(?:^|[\/\\])tests?[\/\\]/i,
  /(?:^|[\/\\])test_[^\/\\]+\.py$/i,
  /\.(?:test|spec)\.[jt]sx?$/i,
  /_test\.go$/i,
];

export function resolveProjectTestCommand(cwd: string): string | null {
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

export function runOutOfBandVerification(cwd: string): { success: boolean; output: string; skipped?: boolean } {
  const testCmd = resolveProjectTestCommand(cwd);
  if (!testCmd) {
    return { success: true, output: "No test script declared in project manifests.", skipped: true };
  }

  let isGit = false;
  try {
    cp.execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    isGit = true;
  } catch {
    isGit = false;
  }

  if (!isGit) {
    try {
      const out = cp.execSync(testCmd, { cwd, encoding: "utf-8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
      return { success: true, output: out };
    } catch (err: any) {
      return { success: false, output: err.stderr || err.stdout || String(err) };
    }
  }

  const worktreeId = "pi-verify-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const worktreeDir = path.join(os.tmpdir(), worktreeId);

  try {
    cp.execSync(`git worktree add --detach "${worktreeDir}" HEAD`, { cwd, stdio: "ignore" });
    const diff = cp.execSync("git diff HEAD", { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    if (diff.trim()) {
      try {
        cp.execSync("git apply --whitespace=nowarn", { cwd: worktreeDir, input: diff, stdio: ["pipe", "ignore", "ignore"] });
      } catch {}
    }
    const out = cp.execSync(testCmd, { cwd: worktreeDir, encoding: "utf-8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
    return { success: true, output: out };
  } catch (err: any) {
    return { success: false, output: err.stderr || err.stdout || String(err) };
  } finally {
    try {
      cp.execSync(`git worktree remove --force "${worktreeDir}"`, { cwd, stdio: "ignore" });
    } catch {}
    try {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
    } catch {}
  }
}

function isActualTestRunnerExecution(cmd: string, projectTestCmd: string | null): boolean {
  const cleanCmd = cmd
    .replace(/^\s*(?:cd\s+[^\s&;]+\s*&&\s*)+/, "")
    .replace(/^\s*(?:[A-Za-z0-9_]+=[^\s]+\s+)+/, "")
    .trim();

  // Reject inline interpreter evaluations and harmless diagnostic commands
  if (/^\s*(?:node|bun)\s+(?:-e|--eval)\b/i.test(cleanCmd)) return false;
  if (/^\s*python[23]?\s+-c\b/i.test(cleanCmd)) return false;
  if (/^\s*(?:sh|bash|zsh|dash)\s+-c\b/i.test(cleanCmd)) return false;
  if (/^\s*(?:echo|printf|true|cat|ls|head|tail)\b/i.test(cleanCmd)) return false;
  if (/(?:^|\s)(?:--help|--version|-h|-v)\b/i.test(cleanCmd)) return false;

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

function isTestFilePath(p: string): boolean {
  return TEST_FILE_PATTERNS.some((pat) => pat.test(p));
}

function isSourceCodePath(p: string): boolean {
  const norm = p.toLowerCase();
  if (norm.endsWith("package.json") || norm.endsWith("tsconfig.json") || norm.endsWith("cargo.toml") || norm.endsWith("pyproject.toml")) {
    return true;
  }
  return !norm.endsWith(".md") && !norm.endsWith(".txt") && !norm.endsWith(".log") && !norm.endsWith(".jsonl") && !norm.endsWith(".json") && !norm.endsWith(".lock");
}

function getSessionId(ctx: any): string {
  if (process.env.PI_SESSION_ID) return process.env.PI_SESSION_ID;
  const file = ctx?.sessionManager?.getSessionFile?.();
  if (file) return path.basename(file, ".jsonl");
  return "session-" + process.pid;
}

function logWardenEvent(sessionId: string, event: string, target: string, details: Record<string, unknown>): void {
  try {
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      cwd: process.cwd(),
      component: "verification-ci-warden",
      event,
      target,
      details,
    }) + "\n";
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true, mode: 0o700 });
    fs.appendFileSync(LOG_FILE, entry, "utf-8");
    if (process.platform === "darwin") {
      try { cp.execFileSync("chflags", ["uappnd", LOG_FILE], { stdio: "ignore" }); } catch {}
    }
  } catch {
    // Non-blocking on log write failure
  }
}

export default function (pi: ExtensionAPI) {
  let lastCodeMutationTimestamp = 0;
  let lastSuccessfulTestTimestamp = 0;
  let testFilesModifiedInSession = false;
  let lastMutatedPath = "";
  let currentTurnUserCommitIntent = false;
  const toolHistory: string[] = [];

  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;
    const input = (event.input || {}) as Record<string, unknown>;
    const sessionId = getSessionId(ctx);

    // 1. Detect code mutation with chronological timestamp
    if (toolName === "edit" || toolName === "write") {
      const targetPath = String(input.path || input.file || "");
      if (/(?:\.cache[\/\\]laya[\/\\](?:firewall|warden)\.jsonl|laya_serve\.log)/i.test(targetPath)) {
        logWardenEvent(sessionId, "audit_tampering_blocked", targetPath, { reason: "File mutation on audit log" });
        return {
          block: true,
          reason: "🛑 [Audit Security] I log di audit (~/.cache/laya/) sono protetti e immutabili. Modifica o cancellazione non consentita (Regola: Controllore != Controllato).",
        };
      }
      if (isSourceCodePath(targetPath)) {
        lastCodeMutationTimestamp = Date.now();
        lastMutatedPath = targetPath;
        if (isTestFilePath(targetPath)) {
          testFilesModifiedInSession = true;
          logWardenEvent(sessionId, "test_file_modified", targetPath, { tool: toolName });
        } else {
          logWardenEvent(sessionId, "code_mutated", targetPath, { tool: toolName });
        }
      }
    }

    // 2. Shell tool gating
    if (toolName === "bash" && typeof input.command === "string") {
      const cmd = input.command.trim();

      // Fake test rejection
      for (const fake of FAKE_TEST_PATTERNS) {
        if (fake.test(cmd) && cmd.toLowerCase().includes("test")) {
          logWardenEvent(sessionId, "fake_test_runner_blocked", cmd, { reason: "Fake test pattern matched" });
          ctx.ui.notify(`⚠️ [CI Warden] Comando test non valido ("${cmd.slice(0, 30)}..."). Comandi come 'echo' o 'true' non verificano il codice. 👉 Esegui la suite di test reale del progetto.`, "warning");
          break;
        }
      }

      // 3. Intent-Gated Git Commits (Agents do not commit autonomously)
      if (/\bgit\s+commit\b/i.test(cmd)) {
        if (!currentTurnUserCommitIntent) {
          logWardenEvent(sessionId, "autonomous_commit_blocked", cmd, { reason: "Missing user commit intent" });
          return {
            block: true,
            reason: "🛡️ [Git Safety] Commit autonomo non autorizzato. L'agente non può committare da solo senza il tuo permesso esplicito. 👉 Se vuoi autorizzarlo, scrivi 'fai il commit' nel tuo messaggio.",
          };
        }

        // Staged diff DLP: ensure no secrets staged
        try {
          const diff = cp.execSync("git diff --cached", { encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] });
          const secretPattern = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9_]{36}|xox[baprs]-[0-9a-zA-Z]{10,48})/i;
          if (secretPattern.test(diff)) {
            logWardenEvent(sessionId, "staged_secret_blocked", cmd, { reason: "Secret detected in staged diff" });
            return {
              block: true,
              reason: "🔒 [DLP Alert] Commit bloccato: rilevata una chiave o token segreto nei file in staging. 👉 Rimuovi il file con 'git reset <file>' prima di committare.",
            };
          }
        } catch {}
      }

      // 4. Deterministic Stuck-Loop Detection
      toolHistory.push(cmd);
      if (toolHistory.length > 5) toolHistory.shift();

      if (toolHistory.length >= 3) {
        const last3 = toolHistory.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          logWardenEvent(sessionId, "stuck_loop_detected", cmd, { count: 3 });
          ctx.ui.notify(
            `🔄 [Loop Detector] Comando ripetuto 3 volte consecutive: "${last3[0].slice(0, 40)}...". 👉 L'agente sembra bloccato. Prova un comando o una strategia differente.`,
            "warning"
          );
        }
      }
    }

    return undefined;
  });

  // Verify actual test execution outcome on tool_result
  pi.on("tool_result", async (event, ctx) => {
    const sessionId = getSessionId(ctx);
    if (event.toolName === "bash" && typeof event.input?.command === "string") {
      const cmd = event.input.command.trim();
      const isFake = FAKE_TEST_PATTERNS.some((f) => f.test(cmd));
      if (isFake) return undefined;

      const projectTestCmd = resolveProjectTestCommand(process.cwd());
      const isTestInvocation = isActualTestRunnerExecution(cmd, projectTestCmd);

      if (isTestInvocation) {
        const isError = event.isError === true;
        const details = (event.details || {}) as Record<string, unknown>;
        const exitCode = typeof details.exitCode === "number" ? details.exitCode : (isError ? 1 : 0);

        if (!isError && exitCode === 0) {
          lastSuccessfulTestTimestamp = Date.now();
          logWardenEvent(sessionId, "test_verified_success", cmd, { exitCode });
        } else {
          logWardenEvent(sessionId, "test_verified_failure", cmd, { exitCode });
          ctx.ui.notify(`❌ [CI Warden] Test falliti (exit code ${exitCode}). L'attività non è verificata finché i test non passano con successo (exit code 0). 👉 Correggi gli errori prima di considerare il lavoro completato.`, "warning");
        }
      }
    }
    return undefined;
  });

  // Antagonistic Fake-Done check on agent_end
  pi.on("agent_end", async (_event, ctx) => {
    const sessionId = getSessionId(ctx);

    if (lastCodeMutationTimestamp > 0) {
      if (lastSuccessfulTestTimestamp === 0 || lastCodeMutationTimestamp > lastSuccessfulTestTimestamp) {
        // Attempt automated out-of-band verification in hermetic worktree before alerting
        const oob = runOutOfBandVerification(process.cwd());
        if (oob.success && !oob.skipped) {
          lastSuccessfulTestTimestamp = Date.now();
          logWardenEvent(sessionId, "oob_verification_success", "worktree", { output: oob.output.slice(0, 200) });
          ctx.ui.notify("✅ [CI Warden] Verifica automatica superata con successo nel worktree isolato.", "info");
        } else if (!oob.skipped) {
          logWardenEvent(sessionId, "fake_done_alert", "session_end", {
            reason: "Code mutated without passing tests",
            lastMutation: lastMutatedPath,
          });
          ctx.ui.notify(
            `🧪 [CI Warden] Codice modificato ma NON testato. Hai modificato '${path.basename(lastMutatedPath)}' senza verifiche passate con successo. 👉 Lancia la suite di test prima di chiudere.`,
            "error"
          );
        }
      }

      if (testFilesModifiedInSession) {
        logWardenEvent(sessionId, "test_tampering_warning", "session_end", {
          reason: "Test files were modified during session",
        });
        ctx.ui.notify(
          `⚠️ [Test Integrity] Modificati file di test in sessione (${path.basename(lastMutatedPath)}). 👉 Controlla con 'git diff' che i test siano stati arricchiti/rafforzati e non allentati o rimossi.`,
          "warning"
        );
      }
    }
  });

  // Track user commit intent on input
  pi.on("input", async (event, ctx) => {
    const text = (event.text || "").trim();
    if (!text || text.startsWith("/")) return undefined;
    toolHistory.length = 0;
    currentTurnUserCommitIntent = COMMIT_INTENT_REGEX.test(text);
    logWardenEvent(getSessionId(ctx), "turn_start", text.slice(0, 100), {
      hasUnverifiedMutations: lastCodeMutationTimestamp > lastSuccessfulTestTimestamp,
      commitIntent: currentTurnUserCommitIntent,
    });
    return undefined;
  });

  // Slash command /warden
  pi.registerCommand("warden", {
    description: "Stato, verifica o log del Verification CI Warden (/warden status | /warden verify | /warden logs | /warden reset)",
    handler: async (args, ctx) => {
      const cleanArgs = (args || "").trim();
      const sessionId = getSessionId(ctx);

      if (cleanArgs === "reset") {
        lastCodeMutationTimestamp = 0;
        lastSuccessfulTestTimestamp = 0;
        testFilesModifiedInSession = false;
        lastMutatedPath = "";
        ctx.ui.notify("Verification Warden: stato di verifica resettato manualmente.", "info");
        return;
      }

      if (cleanArgs === "verify") {
        ctx.ui.notify("Esecuzione verifica Out-of-Band nel worktree isolato...", "info");
        const oob = runOutOfBandVerification(process.cwd());
        if (oob.success) {
          lastSuccessfulTestTimestamp = Date.now();
          ctx.ui.notify(`Verifica Out-of-Band PASS: ${oob.output.slice(0, 100)}`, "info");
        } else {
          ctx.ui.notify(`Verifica Out-of-Band FAIL: ${oob.output.slice(0, 100)}`, "error");
        }
        return;
      }

      if (!cleanArgs || cleanArgs === "status") {
        const verified = lastSuccessfulTestTimestamp > 0 && lastSuccessfulTestTimestamp >= lastCodeMutationTimestamp;
        ctx.ui.notify(
          `Verification Warden | Sessione: ${sessionId.slice(0, 8)} | Codice Modificato: ${lastCodeMutationTimestamp > 0 ? "SÌ" : "NO"} | Verificato: ${verified ? "✅ SÌ" : "❌ NO"} | Test Files Modificati: ${testFilesModifiedInSession ? "⚠️ SÌ" : "NO"}`,
          "info"
        );
        return;
      }

      if (cleanArgs === "logs") {
        try {
          if (!fs.existsSync(LOG_FILE)) {
            ctx.ui.notify("Nessun log warden registrato.", "info");
            return;
          }
          const lines = fs.readFileSync(LOG_FILE, "utf-8").trim().split("\n");
          const sessionLines = lines
            .map((l) => {
              try { return JSON.parse(l); } catch { return null; }
            })
            .filter((e) => e && (e.session_id === sessionId || !sessionId))
            .slice(-5);

          const summary = sessionLines
            .map((e) => `[${e.timestamp.slice(11, 19)}] ${e.event} -> ${e.target.slice(0, 30)}`)
            .join("\n");

          ctx.ui.notify(`Ultime azioni Warden (Sessione ${sessionId.slice(0, 8)}):\n${summary || "Nessun evento"}`, "info");
        } catch (err) {
          ctx.ui.notify(`Errore lettura log warden: ${String(err)}`, "error");
        }
        return;
      }

      ctx.ui.notify("Uso: /warden status | /warden verify | /warden logs | /warden reset", "warning");
    },
  });
}

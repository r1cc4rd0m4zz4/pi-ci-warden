/**
 * verification-ci-warden.ts
 *
 * Enforcement deterministico di CI & Verification ("Test negative branches and edge cases first. Local pass != remote verification"):
 * "Test negative branches and edge cases first. Local pass != remote verification."
 *
 * Protezione Antagonista Anti-Cheating:
 * 1. Rifiuto Fake Runners: echo, printf, --help, ls, cat non contano come test.
 * 2. Verifica Exit Code: un test conta come valido SOLO se completa con exitCode == 0 su tool_result.
 * 3. Sequenza Cronologica: se il codice viene modificato DOPO l'ultimo test, scatta l'allarme Fake-Done.
 * 4. Rilevamento Test Tampering: traccia se l'agente modifica i file della suite di test per indebolire gli assert.
 * 5. Log strutturato JSONL in ~/.cache/laya/warden.jsonl con correlazione di sessione.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG_FILE = path.join(os.homedir(), ".cache/laya/warden.jsonl");

const FAKE_TEST_PATTERNS = [
  /^\s*echo\b/i,
  /^\s*printf\b/i,
  /^\s*true\s*$/i,
  /--help\b/i,
  /--version\b/i,
  /^\s*ls\b/i,
  /^\s*cat\b/i,
];

const VALID_TEST_RUNNERS = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/i,
  /\bpytest\b/i,
  /\bpython[23]?\s+(?:-m\s+(?:unittest|pytest)|(?:\S*\/)?test_.*\.py)\b/i,
  /\bnode\s+(?:--test|(?:\S*\/)?test_.*\.m?js)\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
  /\bvitest\b/i,
  /\bjest\b/i,
  /\bctest\b/i,
  /\bmake\s+test\b/i,
];

const TEST_FILE_PATTERNS = [
  /(?:^|[\/\\])tests?[\/\\]/i,
  /(?:^|[\/\\])test_[^\/\\]+\.py$/i,
  /\.(?:test|spec)\.[jt]sx?$/i,
  /_test\.go$/i,
];

const TEST_SUPPRESSION_PATTERNS = [
  /\|\|\s*(?:true|exit\s*0|echo\b|:|true\b)/i,
  /;\s*(?:true|exit\s*0|echo\b|:)\s*$/i,
  /2>&1\s*\|\s*true/i,
];

function isRealTestCommand(cmd: string): boolean {
  for (const fake of FAKE_TEST_PATTERNS) {
    if (fake.test(cmd)) return false;
  }
  for (const supp of TEST_SUPPRESSION_PATTERNS) {
    if (supp.test(cmd)) return false;
  }
  return VALID_TEST_RUNNERS.some((runner) => runner.test(cmd));
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
  } catch {
    // Non-blocking on log write failure
  }
}

export default function (pi: ExtensionAPI) {
  let lastCodeMutationTimestamp = 0;
  let lastSuccessfulTestTimestamp = 0;
  let testFilesModifiedInSession = false;
  let lastMutatedPath = "";
  const toolHistory: string[] = [];

  // Track code mutations and detect loops
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName;
    const input = (event.input || {}) as Record<string, unknown>;
    const sessionId = getSessionId(ctx);

    // 1. Detect code mutation with chronological timestamp
    if (toolName === "edit" || toolName === "write") {
      const targetPath = String(input.path || input.file || "");
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

    // 2. Detect cheating attempts on test commands before run
    if (toolName === "bash" && typeof input.command === "string") {
      const cmd = input.command.trim();

      for (const fake of FAKE_TEST_PATTERNS) {
        if (fake.test(cmd) && cmd.toLowerCase().includes("test")) {
          logWardenEvent(sessionId, "fake_test_runner_blocked", cmd, { reason: "Fake test pattern matched" });
          ctx.ui.notify(`[Verification Warden] Comando test ingannevole rilevato ("${cmd.slice(0, 30)}..."). I finti test non contano come verifica.`, "warning");
          break;
        }
      }

      // 3. Deterministic Stuck-Loop Detection
      toolHistory.push(cmd);
      if (toolHistory.length > 5) toolHistory.shift();

      if (toolHistory.length >= 3) {
        const last3 = toolHistory.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          logWardenEvent(sessionId, "stuck_loop_detected", cmd, { count: 3 });
          ctx.ui.notify(
            `[Verification Warden] Rilevato loop ripetitivo sul comando: "${last3[0].slice(0, 40)}...". Cambia approccio.`,
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
      if (isRealTestCommand(cmd)) {
        const isError = event.isError === true;
        const details = (event.details || {}) as Record<string, unknown>;
        const exitCode = typeof details.exitCode === "number" ? details.exitCode : (isError ? 1 : 0);

        if (!isError && exitCode === 0) {
          lastSuccessfulTestTimestamp = Date.now();
          logWardenEvent(sessionId, "test_verified_success", cmd, { exitCode });
        } else {
          logWardenEvent(sessionId, "test_verified_failure", cmd, { exitCode });
          ctx.ui.notify(`[Verification Warden] Suite di test fallita (exit code ${exitCode}). Il fallimento non conta come verifica.`, "warning");
        }
      }
    }
    return undefined;
  });

  // Antagonistic Fake-Done check on agent_end
  pi.on("agent_end", async (_event, ctx) => {
    const sessionId = getSessionId(ctx);

    if (lastCodeMutationTimestamp > 0) {
      if (lastSuccessfulTestTimestamp === 0) {
        logWardenEvent(sessionId, "fake_done_alert", "session_end", {
          reason: "Zero tests executed after code mutation",
          lastMutation: lastMutatedPath,
        });
        ctx.ui.notify(
          `[Verification Warden] FAKE-DONE INTERCETTATO (CI & Verification): Codice modificato (${path.basename(lastMutatedPath)}) senza NESSUN test eseguito con successo!`,
          "error"
        );
      } else if (lastCodeMutationTimestamp > lastSuccessfulTestTimestamp) {
        logWardenEvent(sessionId, "fake_done_alert", "session_end", {
          reason: "Code mutated after last successful test",
          lastMutation: lastMutatedPath,
        });
        ctx.ui.notify(
          `[Verification Warden] FAKE-DONE INTERCETTATO (CI & Verification): Codice modificato DOPO l'ultimo test riuscito. Esegui i test per verificare le ultime modifiche!`,
          "error"
        );
      } else if (testFilesModifiedInSession) {
        logWardenEvent(sessionId, "test_tampering_warning", "session_end", {
          reason: "Test files were modified during session",
        });
        ctx.ui.notify(
          "[Verification Warden] ATTENZIONE: I file di test sono stati modificati durante la sessione. Verifica che i test non siano stati indeboliti o cancellati.",
          "warning"
        );
      }
    }
  });

  // Keep verification debt persistent across turns until a real test passes!
  pi.on("input", async (event, ctx) => {
    const text = (event.text || "").trim();
    if (!text || text.startsWith("/")) return undefined;
    toolHistory.length = 0; // reset loop detector per turn
    logWardenEvent(getSessionId(ctx), "turn_start", text.slice(0, 100), {
      hasUnverifiedMutations: lastCodeMutationTimestamp > lastSuccessfulTestTimestamp,
    });
    return undefined;
  });

  // Slash command /warden (reset allows intentional manual reset)
  pi.registerCommand("warden", {
    description: "Stato o log del Verification CI Warden (/warden status | /warden logs | /warden reset)",
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

      ctx.ui.notify("Uso: /warden status | /warden logs", "warning");
    },
  });
}

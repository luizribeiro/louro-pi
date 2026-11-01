import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Under louro's default 5s filter timeout, so a hung scan fails here with its cause.
const GITLEAKS_TIMEOUT_MS = 4_000;

const run = promisify(execFile);
const GITLEAKS_ARGS = ["stdin", "--no-banner", "--log-level", "error", "--report-format", "json"];
const GITLEAKS_REPORT = ["--report-path", "-", "--exit-code", "0"];

/** The ids of gitleaks' rules that match `text`; throws if gitleaks can't run, so louro sends nothing. */
export async function gitleaksRules(text: string, timeout = GITLEAKS_TIMEOUT_MS): Promise<string[]> {
	const scan = run("gitleaks", [...GITLEAKS_ARGS, ...GITLEAKS_REPORT], { maxBuffer: 16 * 1024 * 1024, timeout });
	// gitleaks exiting before it reads everything rejects `scan` with its own error; the broken pipe adds nothing.
	scan.child.stdin?.on("error", () => {});
	scan.child.stdin?.end(text);
	const findings: { RuleID: string }[] = JSON.parse((await scan).stdout);
	return [...new Set(findings.map((finding) => finding.RuleID))];
}

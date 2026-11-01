const SECRET_NAME = "pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth";
const ASSIGNED_SECRET = new RegExp(`(?<![A-Za-z0-9])(?:${SECRET_NAME})["']?\\s*[:=]\\s*["']?([^\\s"']{6,})`, "gi");
// "password: required" is prose; a real value has a digit or a capital somewhere.
const assignsSecret = (text: string) =>
	[...text.matchAll(ASSIGNED_SECRET)].some(([, value]) => /[\dA-Z]/.test(value ?? ""));
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
/** Why the text looks like it carries a secret that gitleaks has no rule for, or undefined. */
export function secretIn(text: string): string | undefined {
	if (PRIVATE_KEY.test(text)) return "a private key";
	if (assignsSecret(text)) return "a password or key assigned to a name";
	return undefined;
}

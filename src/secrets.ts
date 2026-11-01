const MIN_RANDOM_LENGTH = 24;
const MIN_RANDOM_ENTROPY = 3.5;
// Share of a word in runs like "Request" or "test": code names sit above 0.7, 99% of random 24-character keys below.
const MAX_RANDOM_WORDINESS = 0.6;
// Random keys are about a sixth digits; ids built from dates and counters run well past this.
const MAX_RANDOM_DIGIT_SHARE = 0.4;

function entropy(word: string): number {
	const counts = new Map<string, number>();
	for (const char of word) counts.set(char, (counts.get(char) ?? 0) + 1);
	return [...counts.values()].reduce((bits, count) => {
		const share = count / word.length;
		return bits - share * Math.log2(share);
	}, 0);
}

const alphanumerics = (word: string) => word.replace(/[^A-Za-z0-9]/g, "");

function wordiness(word: string): number {
	const words = alphanumerics(word).match(/[A-Z]?[a-z]{3,}/g) ?? [];
	return words.join("").length / alphanumerics(word).length;
}

const digitShare = (word: string) => word.replace(/\D/g, "").length / alphanumerics(word).length;

/** Long words mixing upper and lower case and digits, spread the way a generated key is, not like a code name. */
function looksRandom(word: string): boolean {
	return (
		word.length >= MIN_RANDOM_LENGTH &&
		/[a-z]/.test(word) &&
		/[A-Z]/.test(word) &&
		/\d/.test(word) &&
		digitShare(word) < MAX_RANDOM_DIGIT_SHARE &&
		entropy(word) >= MIN_RANDOM_ENTROPY &&
		wordiness(word) < MAX_RANDOM_WORDINESS
	);
}

const SECRET_NAME = "pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth";
const ASSIGNED_SECRET = new RegExp(`(?<![A-Za-z0-9])(?:${SECRET_NAME})["']?\\s*[:=]\\s*["']?([^\\s"']{6,})`, "gi");
// "password: required" is prose; a real value has a digit or a capital somewhere.
const assignsSecret = (text: string) =>
	[...text.matchAll(ASSIGNED_SECRET)].some(([, value]) => /[\dA-Z]/.test(value ?? ""));
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const URL_PART_BREAKS = /[/?&=#:,;'"()<>[\]{}]+/;

// A link's own punctuation and path make a whole URL look random, so only its parts are judged.
const piecesOf = (text: string) =>
	text.split(/\s+/).flatMap((word) => [...(word.includes("://") ? [] : [word]), ...word.split(URL_PART_BREAKS)]);

/** Why the text looks like it carries a secret that gitleaks has no rule for, or undefined. */
export function secretIn(text: string): string | undefined {
	if (PRIVATE_KEY.test(text)) return "a private key";
	if (assignsSecret(text)) return "a password or key assigned to a name";
	if (piecesOf(text).some(looksRandom)) return "a long random-looking string, like a key or token";
	return undefined;
}

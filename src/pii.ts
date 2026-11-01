const digitsOf = (text: string) => text.replace(/\D/g, "");
const alphanumericsOf = (text: string) => text.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

function luhn(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let digit = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
		sum += digit;
	}
	return sum % 10 === 0;
}

/** Brazil's mod-11 check digit; a letter counts as its char code minus 48, as alphanumeric CNPJs do. */
function mod11(chars: string, weights: number[]): number {
	const sum = weights.reduce((total, weight, i) => total + weight * (chars.charCodeAt(i) - 48), 0);
	const rest = sum % 11;
	return rest < 2 ? 0 : 11 - rest;
}

const descending = (from: number, count: number) => Array.from({ length: count }, (_, i) => from - i);
const repeated = (chars: string) => /^(.)\1*$/.test(chars);

function validCpf(text: string): boolean {
	const digits = digitsOf(text);
	return (
		!repeated(digits) &&
		mod11(digits, descending(10, 9)) === Number(digits[9]) &&
		mod11(digits, descending(11, 10)) === Number(digits[10])
	);
}

const CNPJ_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function validCnpj(text: string): boolean {
	const chars = alphanumericsOf(text);
	return (
		!repeated(chars) &&
		mod11(chars, CNPJ_WEIGHTS) === Number(chars[12]) &&
		mod11(chars, [6, ...CNPJ_WEIGHTS]) === Number(chars[13])
	);
}

function validIban(text: string): boolean {
	const compact = alphanumericsOf(text);
	const moved = compact.slice(4) + compact.slice(0, 4);
	const numeric = moved.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
	return [...numeric].reduce((rest, digit) => (rest * 10 + Number(digit)) % 97, 0) === 1;
}

const NOT_A_PHONE = /^\d{4}-\d\d-\d\d|^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{1,3}(?:\.\d{1,3}){3}$/;
const hasPhoneFormatting = (text: string) =>
	text.startsWith("+") || /\(\d{2,3}\)/.test(text) || /\d[\s.-]+\d+[\s.-]+\d/.test(text);

function looksLikePhone(text: string): boolean {
	const count = digitsOf(text).length;
	return count >= 10 && count <= 13 && /\d{4}$/.test(text) && !NOT_A_PHONE.test(text) && hasPhoneFormatting(text);
}

type Rule = { label: string; pattern: RegExp; valid?: (match: string) => boolean };

// Checksummed kinds run first, so an 11-digit CPF isn't taken for a phone number.
const RULES: Rule[] = [
	{
		label: "card",
		pattern: /(?<!\d)(?:\d{4}[ -]?){3}\d{1,7}(?!\d)|(?<!\d)\d{4}[ -]?\d{6}[ -]?\d{4,5}(?!\d)/g,
		valid: (match) => luhn(digitsOf(match)),
	},
	{
		label: "cnpj",
		pattern: /(?<![A-Z0-9])[A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2}(?![A-Z0-9])/g,
		valid: validCnpj,
	},
	{ label: "cpf", pattern: /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, valid: validCpf },
	{ label: "ssn", pattern: /(?<!\d)(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/g },
	{ label: "iban", pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/gi, valid: validIban },
	{
		label: "email",
		// Skips IRC hostmasks (nick!~user@host), git remotes (git@host:repo) and image names (logo@2x.png).
		pattern:
			/(?<![!~A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?!(?:png|jpe?g|gif|svg|webp)\b)[A-Za-z]{2,}(?![\w-]|:\S)/g,
	},
	{ label: "phone", pattern: /(?<![\w+])\+?\(?\d[\d\s().-]{8,20}\d(?!\w)/g, valid: looksLikePhone },
];

/** The text with personal details swapped for `[label]`, and the labels it swapped, in rule order. */
export function redactPii(text: string): { text: string; found: string[] } {
	const found = new Set<string>();
	let redacted = text;
	for (const { label, pattern, valid } of RULES) {
		redacted = redacted.replace(pattern, (match) => {
			if (valid && !valid(match)) return match;
			found.add(label);
			return `[${label}]`;
		});
	}
	return { text: redacted, found: [...found] };
}

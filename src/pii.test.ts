import assert from "node:assert/strict";
import { test } from "node:test";
import { redactPii } from "./pii.ts";

const redacts = (text: string, expected: string, found: string[]) =>
	assert.deepEqual(redactPii(text), { text: expected, found }, text);
const keeps = (text: string) => assert.deepEqual(redactPii(text), { text, found: [] }, text);

test("redacts email addresses", () => {
	redacts("mail maria.silva+irc@gmail.com later", "mail [email] later", ["email"]);
	redacts("a@b.co, x_y@sub.example.com.br", "[email], [email]", ["email"]);
	redacts("bob@example.com: thanks", "[email]: thanks", ["email"]);
	keeps("ping @luiz about it");
	keeps("louro@ has no domain");
});

test("keeps hostmasks, git remotes and image names that only look like emails", () => {
	keeps("nick!~u@host.libera.chat joined");
	keeps("luiz!luiz@irc.weblounge.org");
	keeps("clone git@github.com:luizribeiro/louro.git");
	keeps("use logo@2x.png and icon@3x.webp");
});

test("redacts phone numbers in Brazilian, US and international formats", () => {
	redacts("call (11) 98765-4321", "call [phone]", ["phone"]);
	redacts("or +55 11 98765-4321", "or [phone]", ["phone"]);
	redacts("my cell is 415-555-0132.", "my cell is [phone].", ["phone"]);
	redacts("+14155550132", "[phone]", ["phone"]);
	redacts("ring 11 98765 4321", "ring [phone]", ["phone"]);
	redacts("call 415.555.0132", "call [phone]", ["phone"]);
});

test("keeps numbers that only look like phone numbers", () => {
	keeps("at 2026-10-31 12:00 it was done");
	keeps("unix time 1793394495");
	keeps("commit 7325117178a5964724bf0edd5608c34be5de7ea9");
	keeps("vllm 0.1.dev19754 read 37k tokens in 28.9s");
	keeps("louro-timer-1-2026-10-31T12:00:00.000Z");
	keeps("call 555-0132");
	keeps("ip 192.168.1.10 port 6697");
	keeps("ip 192.168.100.200");
	keeps("1 234 567 890 items");
});

test("redacts card numbers only when they pass the Luhn check", () => {
	redacts("card 4111 1111 1111 1111", "card [card]", ["card"]);
	redacts("5500-0000-0000-0004 expires soon", "[card] expires soon", ["card"]);
	redacts("378282246310005", "[card]", ["card"]);
	redacts("3782 822463 10005", "[card]", ["card"]);
	redacts("card 4111111111111111 12 left", "card [card] 12 left", ["card"]);
	keeps("card 4111 1111 1111 1112");
});

test("redacts CPF and CNPJ numbers only when their check digits are right", () => {
	redacts("cpf 529.982.247-25", "cpf [cpf]", ["cpf"]);
	redacts("cpf 52998224725", "cpf [cpf]", ["cpf"]);
	keeps("cpf 529.982.247-26");
	keeps("cpf 111.111.111-11");
	redacts("cnpj 11.222.333/0001-81", "cnpj [cnpj]", ["cnpj"]);
	redacts("cnpj 11222333000181", "cnpj [cnpj]", ["cnpj"]);
	keeps("cnpj 11.222.333/0001-82");
	redacts("cnpj 12.ABC.345/01DE-35", "cnpj [cnpj]", ["cnpj"]);
	redacts("12ABC34501DE35", "[cnpj]", ["cnpj"]);
	keeps("cnpj 12.ABC.345/01DE-36");
	keeps("AAAAAAAAAAAA00");
});

test("redacts US social security numbers, but not impossible ones", () => {
	redacts("ssn 123-45-6789", "ssn [ssn]", ["ssn"]);
	for (const ssn of ["000-12-3456", "666-12-3456", "900-12-3456", "123-00-4567", "123-45-0000"]) keeps(`ssn ${ssn}`);
});

test("redacts IBANs only when their checksum is right", () => {
	redacts("iban DE89 3704 0044 0532 0130 00", "iban [iban]", ["iban"]);
	redacts("GB82WEST12345698765432", "[iban]", ["iban"]);
	keeps("GB82WEST12345698765433");
	redacts("iban de89 3704 0044 0532 0130 00", "iban [iban]", ["iban"]);
});

test("redacts several kinds at once and names each once, in rule order", () => {
	redacts(
		"maria: write to maria@example.com or call (11) 98765-4321; cpf 529.982.247-25, also bob@example.org",
		"maria: write to [email] or call [phone]; cpf [cpf], also [email]",
		["cpf", "email", "phone"],
	);
});

test("keeps everyday chat untouched", () => {
	keeps("luiz: lol yeah, the ergo upgrade went fine. 3 of us on #lounge tonight?");
	keeps("");
	keeps("multi\nline\nmessage with 42 and 1000 in it");
});

test("redacts on any line of a multi-line message", () => {
	redacts("sure\nit's maria@example.com\nbye", "sure\nit's [email]\nbye", ["email"]);
});

test("stays fast on long hostile input", () => {
	const started = performance.now();
	for (const text of ["a@".repeat(500), "1 ".repeat(500), `${"a.".repeat(500)}@`, "DE89".repeat(250)]) redactPii(text);
	assert.ok(performance.now() - started < 200);
});

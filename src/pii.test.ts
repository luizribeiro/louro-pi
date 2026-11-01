import assert from "node:assert/strict";
import { test } from "node:test";
import { redactPii } from "./pii.ts";

const redacts = (text: string, expected: string, found: string[]) =>
	assert.deepEqual(redactPii(text), { text: expected, found }, text);
const keeps = (text: string) => assert.deepEqual(redactPii(text), { text, found: [] }, text);

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

test("keeps everyday chat untouched", () => {
	keeps("luiz: lol yeah, the ergo upgrade went fine. 3 of us on #lounge tonight?");
	keeps("");
	keeps("multi\nline\nmessage with 42 and 1000 in it");
});

test("redacts on any line of a multi-line message", () => {
	redacts("sure\nmy cpf is 529.982.247-25\nbye", "sure\nmy cpf is [cpf]\nbye", ["cpf"]);
});

test("stays fast on long hostile input", () => {
	const started = performance.now();
	for (const text of ["a@".repeat(500), "1 ".repeat(500), `${"a.".repeat(500)}@`, "DE89".repeat(250)]) redactPii(text);
	assert.ok(performance.now() - started < 200);
});

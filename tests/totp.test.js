import {test} from "node:test";
import assert from "node:assert/strict";
import {parseTotp, generateTotp, decodeBase32} from "../extension/lib/totp.js";

function encode(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let text = "";
  for (let i = 0; i < bits.length; i += 5) text += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return text;
}
// Published RFC 6238 Appendix B vectors, including a time beyond 32-bit Unix time.
const vectors = [
  [59, "94287082", "46119246", "90693936"],
  [1111111109, "07081804", "68084774", "25091201"],
  [1111111111, "14050471", "67062674", "99943326"],
  [1234567890, "89005924", "91819424", "93441116"],
  [2000000000, "69279037", "90698825", "38618901"],
  [20000000000, "65353130", "77737706", "47863826"]
];
test("TOTP matches all 18 SHA1/SHA256/SHA512 RFC vectors", async () => {
  const seed = "1234567890123456789012345678901234567890123456789012345678901234";
  for (const [index, algorithm, length] of [[1, "SHA1", 20], [2, "SHA256", 32], [3, "SHA512", 64]]) {
    const secret = encode(new TextEncoder().encode(seed.slice(0, length)));
    const config = parseTotp(`otpauth://totp/TU?secret=${secret}&algorithm=${algorithm}&digits=8`);
    for (const vector of vectors) assert.equal((await generateTotp(config, vector[0] * 1000)).code, vector[index]);
  }
});
test("defaults to TU's six digits and 30 seconds; accepts spacing and padding", async () => {
  const config = parseTotp("gezd gnbv-gy3tqojqgezdgnbvgy3tqojq====");
  assert.equal(config.digits, 6);
  assert.equal(config.period, 30);
  assert.equal((await generateTotp(config, 59000)).code, "287082");
  assert.equal((await generateTotp(config, 59000)).remaining, 1);
});
test("rejects codes, HOTP, invalid Base32 and unsupported settings", () => {
  for (const value of ["123456", "", "otpauth://hotp/TU?secret=GEZDGNBVGY3TQOJQ", "A!not-a-secret", "A".repeat(17),
    "otpauth://totp/TU?secret=GEZDGNBVGY3TQOJQ&algorithm=MD5", "otpauth://totp/TU?secret=GEZDGNBVGY3TQOJQ&period=0",
    "otpauth://totp/TU?secret=GEZDGNBVGY3TQOJQ&digits=9"]) assert.throws(() => parseTotp(value), value);
  assert.equal(decodeBase32("GEZDGNBVGY3TQOJQ").length, 10);
});

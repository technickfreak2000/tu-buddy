const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(value) {
  const text = value.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!/^[A-Z2-7]+$/.test(text)) throw new Error("Enter a Base32 TOTP secret, not a six-digit code.");
  let bits = 0, buffer = 0;
  const bytes = [];
  for (const char of text) {
    buffer = (buffer << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits >= 5 || buffer !== 0 || bytes.length < 10) {
    throw new Error("The TOTP secret is incomplete or too short.");
  }
  return new Uint8Array(bytes);
}

export function parseTotp(value) {
  let secret = value.trim();
  let algorithm = "SHA-1", digits = 6, period = 30;
  if (/^otpauth:/i.test(secret)) {
    let url;
    try { url = new URL(secret); } catch { throw new Error("Invalid otpauth URI."); }
    if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
      throw new Error("Only time-based TOTP tokens are supported.");
    }
    secret = url.searchParams.get("secret") || "";
    const hash = (url.searchParams.get("algorithm") || "SHA1").toUpperCase().replace(/-/g, "");
    algorithm = {SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512"}[hash];
    digits = Number(url.searchParams.get("digits") || 6);
    period = Number(url.searchParams.get("period") || 30);
  }
  if (!algorithm || ![6, 8].includes(digits) || !Number.isInteger(period) || period < 15 || period > 120) {
    throw new Error("Unsupported TOTP settings (SHA1/256/512, 6 or 8 digits, 15–120 seconds).");
  }
  decodeBase32(secret);
  return {secret: secret.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, ""), algorithm, digits, period};
}

export async function generateTotp(config, now = Date.now()) {
  const counter = Math.floor(now / 1000 / config.period);
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey("raw", decodeBase32(config.secret),
    {name: "HMAC", hash: config.algorithm}, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const offset = mac[mac.length - 1] & 15;
  const value = new DataView(mac.buffer).getUint32(offset) & 0x7fffffff;
  return {code: String(value % (10 ** config.digits)).padStart(config.digits, "0"),
    counter, remaining: config.period - (now / 1000) % config.period};
}

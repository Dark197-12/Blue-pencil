import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * `promisify` resolves to scrypt's three-argument overload and drops the one
 * that accepts tuning options, so wrap the callback form by hand.
 */
function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * Password hashing uses Node's built-in scrypt rather than argon2 or bcrypt.
 * Both of those are native modules needing a compiler at install time — a real
 * source of "works on my machine" pain on Windows and in slim CI images.
 * scrypt is memory-hard, in the standard library, and good enough here.
 *
 * This module deliberately imports nothing but node:crypto, so it can be tested
 * without a database or a loaded environment.
 */
const SCRYPT = { N: 16_384, r: 8, p: 1, keyLength: 64 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });

  // Parameters travel with the hash so they can be raised later without
  // invalidating every password already stored.
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts as [string, string, string, string, string, string];

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltRaw, "base64");
  const expected = Buffer.from(keyRaw, "base64");
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

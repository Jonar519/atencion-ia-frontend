import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sesión del ADMIN del seed para las pruebas E2E (solo para crear agentes por la API).
 *
 * Desde la Fase 7 un admin necesita verificación en dos pasos. scripts\e2e.bat
 * (y el CI, que crea la base de cero) dejan al admin SIN MFA, así que el login
 * pide enrolarse: aquí se completa ese flujo REAL (QR → secreto → código TOTP
 * calculado con RFC 6238) una sola vez en el globalSetup, y el access token
 * (15 min) se guarda para las pruebas.
 */
export const SEED_ADMIN = { email: "admin@cordillera.example", password: "Password123!" };
export const ADMIN_SESSION_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  ".generated",
  "admin-session.json"
);

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.replace(/[\s=]/g, "").toUpperCase()) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** TOTP de 6 dígitos (RFC 6238, SHA-1, 30 s). */
export function totp(secret, timeMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(binary).padStart(6, "0");
}

async function post(baseURL, url, body) {
  const res = await fetch(new URL(url, baseURL), {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "atencion-ia" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function loginSeedAdmin(baseURL) {
  const first = await post(baseURL, "/api/auth/login", SEED_ADMIN);
  if (first.accessToken) return first.accessToken;
  if (first.mfaRequired) {
    throw new Error(
      "El admin del seed ya tiene MFA en esta base. scripts\\e2e.bat la quita antes de correr " +
        "(npm run staff:reset-mfa -- admin@cordillera.example con DATABASE_URL de la base E2E)."
    );
  }
  const { secret } = await post(baseURL, "/api/auth/mfa/enroll/start", { enrollmentToken: first.enrollmentToken });
  const done = await post(baseURL, "/api/auth/mfa/enroll/confirm", {
    enrollmentToken: first.enrollmentToken,
    code: totp(secret),
  });
  return done.accessToken;
}

export async function saveAdminSession(baseURL) {
  const accessToken = await loginSeedAdmin(baseURL);
  fs.mkdirSync(path.dirname(ADMIN_SESSION_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_SESSION_FILE, JSON.stringify({ accessToken }));
}

export function adminAccessToken() {
  return JSON.parse(fs.readFileSync(ADMIN_SESSION_FILE, "utf8")).accessToken;
}

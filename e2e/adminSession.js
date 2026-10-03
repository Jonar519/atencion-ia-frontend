import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sesión del ADMIN del seed para las pruebas E2E: invitar agentes por la API y,
 * en el escenario de invitaciones, entrar por la INTERFAZ con su código TOTP.
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
  if (first.accessToken) return { accessToken: first.accessToken };
  if (first.mfaRequired) {
    throw new Error(
      "El admin del seed ya tiene MFA en esta base. scripts\\e2e.bat la quita antes de correr " +
        "(npm run staff:reset-mfa -- admin@cordillera.example con DATABASE_URL de la base E2E)."
    );
  }
  const { secret } = await post(baseURL, "/api/auth/mfa/enroll/start", { enrollmentToken: first.enrollmentToken });
  const now = Date.now();
  const done = await post(baseURL, "/api/auth/mfa/enroll/confirm", {
    enrollmentToken: first.enrollmentToken,
    code: totp(secret, now),
  });
  // El secreto y el paso de 30 s ya usado: para entrar luego por la interfaz con un código NUEVO.
  return { accessToken: done.accessToken, secret, usedStep: Math.floor(now / 30_000) };
}

export async function saveAdminSession(baseURL) {
  const session = await loginSeedAdmin(baseURL);
  fs.mkdirSync(path.dirname(ADMIN_SESSION_FILE), { recursive: true });
  fs.writeFileSync(ADMIN_SESSION_FILE, JSON.stringify(session));
}

function readAdminSession() {
  return JSON.parse(fs.readFileSync(ADMIN_SESSION_FILE, "utf8"));
}

export function adminAccessToken() {
  return readAdminSession().accessToken;
}

/**
 * Código TOTP para el login del admin por la interfaz. El backend rechaza
 * reutilizar el código de un paso de 30 s ya usado (anti-replay): si todavía
 * estamos en ese paso, se espera al siguiente.
 */
export async function freshAdminCode() {
  const { secret, usedStep } = readAdminSession();
  if (!secret) throw new Error("La sesión del admin no guardó el secreto de MFA (¿la base ya tenía MFA?)");
  while (Math.floor(Date.now() / 30_000) <= usedStep) await new Promise((r) => setTimeout(r, 1000));
  const now = Date.now();
  fs.writeFileSync(ADMIN_SESSION_FILE, JSON.stringify({ ...readAdminSession(), usedStep: Math.floor(now / 30_000) }));
  return totp(secret, now);
}

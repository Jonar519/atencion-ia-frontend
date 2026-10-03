import { execFileSync } from "node:child_process";

/**
 * Correo SIMULADO del E2E (EMAIL_PROVIDER=mock → tabla email_outbox de la base
 * E2E). Así una prueba "abre" el enlace que recibiría la persona, igual que en
 * la demo manual (docs/demo-fase7.md).
 *
 *  - En CI: psql con DATABASE_URL (el job e2e la define; el runner trae psql).
 *  - En local (scripts\e2e.bat): psql DENTRO del contenedor de Postgres (en
 *    Windows no hace falta tener psql instalado).
 * Nunca la base de desarrollo: se niega si la URL apunta a "atencion_ia".
 */
const DEFAULT_URL = "postgresql://postgres:postgres@localhost:5434/atencion_ia_e2e";

function query(sql) {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  const database = new URL(url).pathname.replace(/^\//, "");
  if (database === "atencion_ia") throw new Error("El E2E nunca lee la base de desarrollo (atencion_ia).");
  if (process.env.CI) return execFileSync("psql", [url, "-tAc", sql], { encoding: "utf8" });
  const container = process.env.E2E_PG_CONTAINER || "atencion_ia_postgres";
  return execFileSync("docker", ["exec", container, "psql", "-U", "postgres", "-d", database, "-tAc", sql], {
    encoding: "utf8",
  });
}

/** Token del ÚLTIMO correo de invitación enviado a `email` (el enlace lleva #/agente/invitacion?token=…). */
export function invitationToken(email) {
  const safe = email.replace(/'/g, "''");
  const body = query(
    `SELECT body_text FROM email_outbox WHERE to_address = '${safe}' AND template = 'invitation' ORDER BY id DESC LIMIT 1`
  );
  const match = body.match(/#\/agente\/invitacion\?token=([^\s&]+)/);
  if (!match) throw new Error(`No hay correo de invitación para ${email} en email_outbox.`);
  return decodeURIComponent(match[1]);
}

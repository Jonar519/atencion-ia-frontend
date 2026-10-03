import { expect, test } from "@playwright/test";
import { SEED_ADMIN, freshAdminCode } from "./adminSession.js";
import { invitationToken } from "./outbox.js";
import { expectAccessible, expectNoTokensInStorage, loginAsAgent, watchCsp } from "./support.js";

/**
 * INVITACIONES (bloque F2): la ÚNICA forma de obtener una cuenta del panel.
 * En dos navegadores: el admin invita desde "Equipo" (por la interfaz, con su
 * verificación en dos pasos), el enlace llega al correo SIMULADO (email_outbox),
 * la persona invitada completa su cuenta eligiendo su contraseña, el enlace no
 * sirve una segunda vez, y luego ella inicia sesión normalmente.
 */
test("admin invita → correo simulado → la asesora completa su cuenta → inicia sesión", async ({ browser }) => {
  test.setTimeout(120_000); // puede esperar hasta 30 s a un código TOTP nuevo (anti-replay)
  const name = `Invitada ${Date.now().toString(36)}`;
  const email = `invitada-${Date.now().toString(36)}@e2e.example`;
  const chosen = "una frase larga elegida por ella";

  // --- Admin: entra con contraseña + código de su app, e invita desde Equipo ---
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const cspAdmin = watchCsp(admin);
  await admin.goto("/#/agente/login");
  await expect(admin.getByRole("link", { name: /crear|regist/i })).toHaveCount(0); // no hay registro público
  await admin.getByLabel("Correo").fill(SEED_ADMIN.email);
  await admin.getByLabel("Contraseña").fill(SEED_ADMIN.password);
  await admin.getByRole("button", { name: "Entrar" }).click();
  await admin.getByLabel("Código de tu app de autenticación").fill(await freshAdminCode());
  await admin.getByRole("button", { name: "Verificar" }).click();
  await expect(admin.locator(".topbar")).toBeVisible();

  await admin.goto("/#/admin/equipo");
  await admin.getByRole("button", { name: "Invitar asesor", exact: true }).click();
  await admin.getByLabel("Nombre").fill(name);
  await admin.getByLabel("Correo").fill(email);
  await expect(admin.getByLabel("Rol")).toHaveValue("agent");
  await expectAccessible(admin, "Equipo con el formulario de invitación");
  // exact: una invitación pendiente de otra corrida tiene "Reenviar invitación" (contiene el texto).
  await admin.getByRole("button", { name: "Enviar invitación", exact: true }).click();
  const row = admin.locator(".team__member", { hasText: email });
  await expect(row).toContainText("Invitación pendiente · vence");
  await expect(row.getByRole("button")).toHaveText(["Reenviar invitación", "Cancelar invitación"]);

  // --- El correo simulado: el enlace NUNCA estuvo en la pantalla del admin ---
  const token = invitationToken(email);
  expect(await admin.content()).not.toContain(token);

  // --- La persona invitada abre el enlace en SU navegador ---
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const cspGuest = watchCsp(guest);
  const link = `/#/agente/invitacion?token=${encodeURIComponent(token)}`;
  await guest.goto(link);
  await expect(guest.getByRole("heading", { name: "Completa tu cuenta" })).toBeVisible();
  await expect(guest.getByText(`Hola, ${name}.`)).toBeVisible();
  await expect(guest.getByText(email)).toBeVisible();
  await expectAccessible(guest, "Completa tu cuenta");
  await guest.getByLabel("Elige tu contraseña").fill(chosen);
  await guest.getByLabel("Repítela").fill(chosen);
  await guest.getByRole("button", { name: "Completar mi cuenta" }).click();
  await expect(guest.getByRole("heading", { name: "Tu cuenta está lista" })).toBeVisible();
  await guest.getByRole("button", { name: "Ir al panel" }).click();
  await expect(guest.locator(".topbar")).toBeVisible();
  await expectNoTokensInStorage(guest);

  // --- El mismo enlace ya no sirve (un solo uso), con el mensaje de siempre ---
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await expect(again.getByRole("heading", { name: "Invitación no válida" })).toBeVisible();
  await expect(again.getByRole("alert")).toContainText("La invitación no es válida");

  // --- Inicia sesión con SU contraseña, en un navegador limpio ---
  const loginContext = await browser.newContext();
  const fresh = await loginContext.newPage();
  await loginAsAgent(fresh, { email, password: chosen });
  await expect(fresh.locator(".topbar")).toContainText(name);

  // --- En Equipo ya no es una invitación pendiente ---
  await admin.reload();
  await expect(admin.locator(".team__member", { hasText: email })).not.toContainText("Invitación pendiente");

  expect([...cspAdmin, ...cspGuest], "violaciones de CSP").toEqual([]);
  await Promise.all([adminContext.close(), guestContext.close(), loginContext.close()]);
});

import { expect, test } from "@playwright/test";
import { SEED_ADMIN, adminAccessToken, freshAdminCode } from "./adminSession.js";
import { invitationToken } from "./outbox.js";
import { createAgent, expectAccessible, loginAsAgent, sendCustomerMessage, startCustomerChat } from "./support.js";

/**
 * TEMA DEL SISTEMA OPERATIVO en TODAS las pantallas, sin excepción y para todos
 * los roles (reemplaza el modelo del F1). En Chrome real, con el esquema del
 * sistema emulado (lo mismo que activar el modo oscuro de Windows):
 *  - cada pantalla, en claro y en oscuro, pinta el fondo del tema y pasa axe
 *    (que mide el contraste real de lo pintado);
 *  - con una página abierta, cambiar el tema del sistema la cambia AL INSTANTE,
 *    sin recargar.
 */
const BG = { light: "rgb(244, 246, 248)", dark: "rgb(14, 21, 34)" };
const SCHEMES = ["light", "dark"];

const background = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** La pantalla abierta sigue al esquema emulado (fondo + accesibilidad), en los dos temas. */
async function checkBothSchemes(page, label) {
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect.poll(() => background(page), `${label} en ${scheme}`).toBe(BG[scheme]);
    await expectAccessible(page, `${label} (${scheme})`);
  }
}

test("todas las pantallas siguen el tema del sistema (claro y oscuro) y cambian en vivo sin recargar", async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000); // incluye esperar un código TOTP nuevo para el admin

  // --- Públicas: portada, login, recuperación, invitación ---
  const publicContext = await browser.newContext();
  const visitor = await publicContext.newPage();
  await visitor.goto("/#/");
  await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
  await checkBothSchemes(visitor, "portada");

  // Cambio EN VIVO: la misma página, sin recargar (la marca en window sobrevive).
  await visitor.emulateMedia({ colorScheme: "light" });
  await visitor.evaluate(() => (window.__sinRecarga = true));
  await visitor.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => background(visitor)).toBe(BG.dark);
  await visitor.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => background(visitor)).toBe(BG.light);
  expect(await visitor.evaluate(() => window.__sinRecarga === true), "la página no se recargó").toBe(true);

  await visitor.goto("/#/agente/login");
  await expect(visitor.getByRole("heading", { name: "Panel de asesores" })).toBeVisible();
  await checkBothSchemes(visitor, "login");
  await visitor.goto("/#/agente/recuperar");
  await expect(visitor.getByRole("heading", { name: "Recuperar la contraseña" })).toBeVisible();
  await checkBothSchemes(visitor, "recuperar contraseña");

  // "Completa tu cuenta" con una invitación REAL (se lee del correo simulado; no se completa).
  const email = `tema-${Date.now().toString(36)}@e2e.example`;
  const invited = await request.post("/api/staff/invitations", {
    headers: { Authorization: `Bearer ${adminAccessToken()}` },
    data: { name: "Invitada Tema", email, role: "agent" },
  });
  expect(invited.status(), await invited.text()).toBe(201);
  await visitor.goto(`/#/agente/invitacion?token=${encodeURIComponent(invitationToken(email))}`);
  await expect(visitor.getByRole("heading", { name: "Completa tu cuenta" })).toBeVisible();
  await checkBothSchemes(visitor, "completa tu cuenta");

  // --- Widget del cliente: inicio, conversación con mensajes del cliente y de la IA ---
  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage();
  await customer.goto("/#/chat");
  await expect(customer.getByRole("button", { name: "Iniciar chat" })).toBeVisible();
  await checkBothSchemes(customer, "widget: inicio");
  await startCustomerChat(customer, "Cliente Tema");
  await checkBothSchemes(customer, "widget: conversación vacía");
  await sendCustomerMessage(customer, "¿Cuál es el horario de las oficinas?");
  await expect(customer.locator(".msg--ai").first()).toBeVisible();
  await checkBothSchemes(customer, "widget: con mensajes");

  // --- Asesora: panel y perfil ---
  const agent = await createAgent(request, "tema");
  const agentContext = await browser.newContext();
  const panel = await agentContext.newPage();
  await loginAsAgent(panel, agent);
  await checkBothSchemes(panel, "panel");
  await panel.goto("/#/agente/perfil");
  await expect(panel.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await expect(panel.locator(".profile__section").first()).toBeVisible();
  // Ningún control para elegir el tema: lo decide el sistema.
  await expect(panel.getByText(/Apariencia|Tema del panel/)).toHaveCount(0);
  await expect(panel.locator('input[name="theme"]')).toHaveCount(0);
  await checkBothSchemes(panel, "mi perfil");

  // --- Admin: las cuatro pantallas de administración ---
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto("/#/agente/login");
  await admin.getByLabel("Correo").fill(SEED_ADMIN.email);
  await admin.getByLabel("Contraseña").fill(SEED_ADMIN.password);
  await admin.getByRole("button", { name: "Entrar" }).click();
  await admin.getByLabel("Código de tu app de autenticación").fill(await freshAdminCode());
  await admin.getByRole("button", { name: "Verificar" }).click();
  await expect(admin.locator(".topbar")).toBeVisible();
  for (const [path, title] of [
    ["/#/admin/kb", "Base de conocimiento"],
    ["/#/admin/respuestas", "Respuestas predefinidas"],
    ["/#/admin/equipo", "Equipo"],
    ["/#/admin/analytics", "Analítica"],
  ]) {
    await admin.goto(path);
    await expect(admin.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(admin.locator(".admin__main")).toHaveAttribute("aria-busy", "false");
    await checkBothSchemes(admin, title);
  }

  await Promise.all([publicContext, customerContext, agentContext, adminContext].map((c) => c.close()));
});

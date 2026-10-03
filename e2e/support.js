import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminAccessToken } from "./adminSession.js";

/** Contraseña de los agentes que crea cada corrida (solo existen en la base de pruebas). */
const AGENT_PASSWORD = "E2e-Clave-Pruebas-2026";

/**
 * Crea un agente NUEVO por prueba (vía la API de administración): así cada
 * corrida empieza con un agente sin casos, sin chocar con su máximo de
 * conversaciones por las corridas anteriores.
 */
export async function createAgent(request, label) {
  // Token del admin del seed obtenido en el globalSetup (con su verificación en dos pasos).
  const accessToken = adminAccessToken();
  const email = `e2e-${Date.now().toString(36)}-${label}@e2e.example`;
  const res = await request.post("/api/staff", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: `Asesora ${label}`, email, password: AGENT_PASSWORD, role: "agent", maxConcurrent: 3 },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { email, password: AGENT_PASSWORD, name: `Asesora ${label}` };
}

/** Recoge violaciones de la CSP (se reportan en la consola) de una página. */
export function watchCsp(page) {
  const violations = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  return violations;
}

/** axe (WCAG 2.1 A/AA): falla ante violaciones "serious" o "critical". */
export async function expectAccessible(page, label) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`),
    `violaciones de accesibilidad en ${label}`
  ).toEqual([]);
}

/** Ningún token de sesión en el almacenamiento del navegador (solo en memoria / cookie httpOnly). */
export async function expectNoTokensInStorage(page) {
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/eyJ[\w-]+\.[\w-]+\.[\w-]+/); // JWT
  expect(stored).not.toMatch(/wgt_/);
}

export async function loginAsAgent(page, agent) {
  await page.goto("/#/agente/login");
  await page.getByLabel("Correo").fill(agent.email);
  await page.getByLabel("Contraseña").fill(agent.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".topbar")).toBeVisible(); // el login también dice "Panel de asesores"
}

export async function startCustomerChat(page, name) {
  await page.goto("/#/chat");
  await page.getByLabel("Tu nombre (opcional)").fill(name);
  await page.getByRole("button", { name: "Iniciar chat" }).click();
  await expect(page.getByText("Te atiende el asistente virtual")).toBeVisible();
  await expect(page.locator(".chat__header .conn")).toHaveAttribute("data-status", "open");
}

export async function sendCustomerMessage(page, text) {
  const input = page.getByLabel("Tu mensaje");
  await input.fill(text);
  await input.press("Enter");
}

/** Abre un caso de la cola por el nombre del cliente. */
export async function openCase(page, customerName) {
  const item = page.locator(".case", { hasText: customerName });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole("heading", { name: customerName })).toBeVisible();
}

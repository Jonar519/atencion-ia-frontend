import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { match, requireRole, route, startRouter } from "../src/router.js";
import { priorityInfo } from "../src/lib/priority.js";
import { adminNav } from "../src/components/adminNav.js";
import { createCannedPicker, fillPlaceholders, insertAtCursor } from "../src/components/cannedPicker.js";
import { barChart, niceMax, roundedEndPath } from "../src/components/barChart.js";
import { adminAnalyticsView, formatMinutes } from "../src/views/admin/analytics.view.js";
import { adminTeamView } from "../src/views/admin/team.view.js";
import { adminKbView, slugify } from "../src/views/admin/kb.view.js";
import { adminCannedView } from "../src/views/admin/canned.view.js";
import { HttpError } from "../src/api/http.js";
import { flush } from "./support/fakeWebSocket.js";

const ADMIN = { id: "ad1", name: "Admin Soporte", role: "admin", availability: "available" };
const AGENT = { id: "a1", name: "Laura Méndez", role: "agent", availability: "available" };

function fakeSession(staff) {
  return { getStaff: () => staff, restore: vi.fn(async () => staff), onSessionChange: () => () => {} };
}

beforeEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
});
afterEach(() => vi.restoreAllMocks());

describe("prioridad legible", () => {
  it.each([
    [95, "Urgente · 95", "high"],
    [80, "Urgente · 80", "high"],
    [79, "Alta · 79", "mid"],
    [50, "Alta · 50", "mid"],
    [49, "Normal · 49", "low"],
    [0, "Normal · 0", "low"],
  ])("%i → %s", (value, text, level) => {
    expect(priorityInfo(value)).toMatchObject({ text, level });
  });

  it("valores raros no rompen la etiqueta", () => {
    expect(priorityInfo(undefined).text).toBe("Normal · 0");
    expect(priorityInfo(140).text).toBe("Urgente · 100");
  });
});

describe("guard por rol en el router", () => {
  it("un asesor que abre una ruta de admin vuelve al panel con aviso, sin montar la vista", async () => {
    const view = vi.fn(() => () => {});
    const onDenied = vi.fn();
    route("/prueba-admin", view, { guard: requireRole(fakeSession(AGENT), ["admin"], { onDenied }) });
    window.location.hash = "#/prueba-admin";
    await startRouter(document.body.appendChild(document.createElement("div")));
    await flush();
    expect(view).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledWith(AGENT);
    expect(window.location.hash).toBe("#/agente");
  });

  it("sin sesión, al login; un admin sí entra", async () => {
    expect(await requireRole(fakeSession(null), ["admin"])()).toBe("/agente/login");
    expect(await requireRole(fakeSession(ADMIN), ["admin"])()).toBe(true);
    // Ruta propia: el test no depende del orden (corre igual con --sequence.shuffle).
    route("/prueba-guard-propio", () => () => {}, { guard: requireRole(fakeSession(ADMIN), ["admin"]) });
    expect(match("#/prueba-guard-propio").guard).toBeTypeOf("function");
  });

  it("la navegación de administración solo existe para admin", () => {
    expect(adminNav(AGENT)).toBeNull();
    expect(adminNav(null)).toBeNull();
    const nav = adminNav(ADMIN, "/admin/analytics");
    expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "Base de conocimiento",
      "Respuestas",
      "Equipo",
      "Analítica",
    ]);
    expect(nav.querySelector('[aria-current="page"]').textContent).toBe("Analítica");
  });
});

describe("respuestas predefinidas en la caja de respuesta", () => {
  it("reemplaza {cliente} y {asesor} por el nombre de pila; sin nombre no deja 'Hola ,'", () => {
    expect(
      fillPlaceholders("Hola {cliente}, soy {asesor}.", { customerName: "Mariana Ruiz", agentName: "Laura Méndez" })
    ).toBe("Hola Mariana, soy Laura.");
    expect(fillPlaceholders("Hola {cliente}, soy {asesor}.", { customerName: null, agentName: "Laura" })).toBe(
      "Hola, soy Laura."
    );
  });

  it("inserta donde está el cursor, con espacio de separación, y NO envía", async () => {
    const input = document.body.appendChild(document.createElement("textarea"));
    input.value = "Gracias.";
    input.setSelectionRange(8, 8);
    insertAtCursor(input, "Hola Mariana.");
    expect(input.value).toBe("Gracias. Hola Mariana.");

    const form = document.body.appendChild(document.createElement("form"));
    const submit = vi.fn((e) => e.preventDefault());
    form.addEventListener("submit", submit);
    const reply = form.appendChild(document.createElement("textarea"));
    const picker = createCannedPicker({
      load: async () => ({
        items: [{ id: "r1", title: "Saludo", body: "Hola {cliente}, soy {asesor}.", shortcut: "saludo" }],
      }),
      input: reply,
      context: () => ({ customerName: "Mariana", agentName: "Laura" }),
    });
    form.append(picker.el);
    picker.el.querySelector(".canned__toggle").click();
    await flush();
    expect(picker.el.querySelector(".canned__toggle").getAttribute("aria-expanded")).toBe("true");
    picker.el.querySelector(".canned__item").click();
    expect(reply.value).toBe("Hola Mariana, soy Laura.");
    expect(submit).not.toHaveBeenCalled();
    expect(picker.el.querySelector(".canned__panel").hidden).toBe(true);
  });

  it("busca por atajo ('/saludo'), orienta si no hay ninguna y permite reintentar si falla", async () => {
    const reply = document.body.appendChild(document.createElement("textarea"));
    const load = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("Sin conexión", { kind: "network" }))
      .mockResolvedValueOnce({
        items: [
          { id: "r1", title: "Saludo", body: "Hola", shortcut: "saludo" },
          { id: "r2", title: "Cierre", body: "Gracias", shortcut: null },
        ],
      });
    const picker = createCannedPicker({ load, input: reply, context: () => ({}) });
    document.body.append(picker.el);
    await picker.open();
    const retry = [...picker.el.querySelectorAll("button")].find((b) => b.textContent === "Reintentar");
    retry.click();
    await flush();
    const search = picker.el.querySelector('input[type="search"]');
    search.value = "/saludo";
    search.dispatchEvent(new Event("input"));
    expect([...picker.el.querySelectorAll(".canned__item strong")].map((s) => s.textContent)).toEqual(["Saludo"]);

    const empty = createCannedPicker({ load: async () => ({ items: [] }), input: reply, context: () => ({}) });
    document.body.append(empty.el);
    await empty.open();
    expect(empty.el.textContent).toMatch(/Un administrador puede crearlas/);
  });
});

describe("gráfica de barras (SVG)", () => {
  it("tope de eje limpio y barras con el extremo redondeado y la base recta", () => {
    expect([0, 1, 3, 7, 12, 24, 60, 130].map(niceMax)).toEqual([1, 1, 5, 10, 20, 25, 100, 200]);
    const path = roundedEndPath(0, 0, 20, 100, 4, "column");
    expect(path.startsWith("M0,100V4")).toBe(true); // base recta abajo, sube hasta el redondeo
  });

  it("una barra por dato, ≤ 24 px, enfocable con su valor, y tabla con todos los datos", () => {
    const chart = barChart({
      title: "Por hora",
      data: Array.from({ length: 24 }, (_, i) => ({ label: `${i}:00`, value: i === 10 ? 5 : 1 })),
    });
    document.body.append(chart);
    const bars = chart.querySelectorAll(".chart__bar");
    expect(bars).toHaveLength(24);
    const widths = [...chart.querySelectorAll(".chart__hit")].map((r) => Number(r.getAttribute("width")));
    expect(widths.every((w) => w > 0)).toBe(true);
    const hits = chart.querySelectorAll(".chart__hit[tabindex='0']");
    expect(hits).toHaveLength(24);
    hits[10].dispatchEvent(new FocusEvent("focus"));
    expect(chart.querySelector(".chart__tooltip").textContent).toBe("10:00: 5");
    expect(chart.querySelectorAll(".chart__table tbody tr")).toHaveLength(24);
    // Accesible: grupo con el título; cada barra, imagen enfocable con su valor (axe: sin aria-label prohibido).
    expect(chart.querySelector("svg").getAttribute("role")).toBe("group");
    expect(chart.querySelector("svg").getAttribute("aria-label")).toBe("Por hora");
    expect([...hits].every((r) => r.getAttribute("role") === "img")).toBe(true);
    expect(hits[10].getAttribute("aria-label")).toBe("10:00: 5");
  });
});

const ANALYTICS = {
  days: 7,
  window: { timezone: "America/Bogota" },
  resolution: {
    resolved: 4,
    averageMinutes: 380,
    medianMinutes: 35,
    byCloser: {
      resolved_by_ai: { resolved: 2, averageMinutes: 725 },
      resolved_by_agent: { resolved: 2, averageMinutes: 35 },
    },
  },
  escalation: {
    conversations: 6,
    escalated: 2,
    ratePercent: 33.3,
    byReason: [{ reason: "possible_fraud", conversations: 2 }],
  },
  csat: { simulated: true, responses: 5, satisfiedPercent: 60, average: 3.6, distribution: [0, 1, 1, 2, 1] },
  volumeByHour: Array.from({ length: 24 }, (_, i) => (i === 10 ? 2 : 0)),
};

describe("pantalla de analítica", () => {
  it("indicadores con el CSAT rotulado SIMULADO en el propio indicador, y las gráficas", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = { analytics: vi.fn(async () => ANALYTICS) };
    adminAnalyticsView(root, {}, { adminApi: api, session: fakeSession(ADMIN) });
    await flush();
    expect(api.analytics).toHaveBeenCalledWith("7");
    const csatTile = [...root.querySelectorAll(".stat")].find((el) => el.textContent.includes("CSAT"));
    expect(csatTile.querySelector(".badge-simulated").textContent).toBe("SIMULADO");
    expect(csatTile.querySelector(".stat__value").textContent).toBe("60 %");
    expect(root.textContent).toMatch(/6,3 h/); // 380 min
    expect(root.textContent).toMatch(/33,3 %/);
    expect(root.querySelectorAll(".chart")).toHaveLength(3);
    expect(root.textContent).toMatch(/Posible fraude/);
  });

  it("cambiar el periodo vuelve a pedir; sin datos, un estado vacío que orienta; error con Reintentar", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const empty = {
      ...ANALYTICS,
      resolution: { resolved: 0, averageMinutes: null, medianMinutes: null, byCloser: {} },
      escalation: { conversations: 0, escalated: 0, ratePercent: null, byReason: [] },
    };
    const api = {
      analytics: vi
        .fn()
        .mockResolvedValueOnce(ANALYTICS)
        .mockRejectedValueOnce(new HttpError("Sin conexión", { kind: "network" }))
        .mockResolvedValueOnce(empty),
    };
    adminAnalyticsView(root, {}, { adminApi: api, session: fakeSession(ADMIN) });
    await flush();
    const select = root.querySelector("#analytics-days");
    select.value = "30";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(api.analytics).toHaveBeenLastCalledWith("30");
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Reintentar").click();
    await flush();
    expect(root.textContent).toMatch(/No hubo conversaciones en este periodo/);
  });

  it("minutos legibles; sin dato, un guion (nunca un 0 inventado)", () => {
    expect(formatMinutes(35)).toBe("35 min");
    expect(formatMinutes(150)).toBe("2,5 h");
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(0.2)).toBe("< 1 min");
  });
});

const TEAM = [
  {
    id: "ad1",
    name: "Admin Soporte",
    email: "admin@x.example",
    role: "admin",
    isActive: true,
    availability: "available",
    maxConcurrent: 5,
    activeConversations: 0,
  },
  {
    id: "a1",
    name: "Laura Méndez",
    email: "laura@x.example",
    role: "agent",
    isActive: true,
    availability: "available",
    maxConcurrent: 3,
    activeConversations: 1,
  },
  {
    id: "a2",
    name: "Diego Ruiz",
    email: "diego@x.example",
    role: "agent",
    isActive: true,
    availability: "busy",
    maxConcurrent: 3,
    activeConversations: 0,
  },
];

function fakeAdminApi(overrides = {}) {
  return {
    staff: vi.fn(async () => ({ items: TEAM })),
    casesOf: vi.fn(async () => ({ items: [{ id: "c1", priority: 90, customer: { displayName: "Mariana" } }] })),
    reassign: vi.fn(async () => ({})),
    exportStaff: vi.fn(async () => ({ format: "atencion-ia/staff-export@1" })),
    anonymize: vi.fn(async () => ({})),
    ...overrides,
  };
}

const memberRow = (root, id) => root.querySelector(`[data-id="${id}"]`);
const buttonIn = (el, text) => [...el.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));

describe("pantalla de equipo", () => {
  it("con casos en curso, eliminar está deshabilitado y explica por qué; se reasigna caso por caso", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = fakeAdminApi();
    adminTeamView(root, {}, { adminApi: api, session: fakeSession(ADMIN) });
    await flush();
    const laura = memberRow(root, "a1");
    const del = buttonIn(laura, "Eliminar cuenta");
    expect(del.disabled).toBe(true);
    expect(del.textContent).toMatch(/reasigna antes/);

    buttonIn(laura, "Reasignar 1").click();
    await flush();
    expect(api.casesOf).toHaveBeenCalledWith("a1");
    expect(laura.textContent).toMatch(/Mariana.*Urgente · 90/);
    const options = [...laura.querySelectorAll("select option")].map((o) => o.value);
    expect(options).toEqual(["ad1", "a2"]); // nunca a sí misma
    laura.querySelector("select").value = "a2";
    buttonIn(laura.querySelector(".team__cases"), "Reasignar").click();
    await flush();
    expect(api.reassign).toHaveBeenCalledWith("c1", "a2");
  });

  it("eliminar pide un segundo clic que dice qué se borra; los admins y uno mismo no tienen el botón", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = fakeAdminApi();
    adminTeamView(root, {}, { adminApi: api, session: fakeSession(ADMIN) });
    await flush();
    const diego = memberRow(root, "a2");
    buttonIn(diego, "Eliminar cuenta").click();
    expect(api.anonymize).not.toHaveBeenCalled();
    expect(diego.querySelector('[role="alert"]').textContent).toMatch(/No se puede deshacer/);
    buttonIn(diego, "Confirmar").click();
    await flush();
    expect(api.anonymize).toHaveBeenCalledWith("a2");
    expect(buttonIn(memberRow(root, "ad1"), "Eliminar")).toBeUndefined();
  });
});

describe("pantallas de KB y respuestas", () => {
  it("KB: sugiere el identificador desde el título y crea el artículo", async () => {
    expect(slugify("¿Cómo bloqueo mi tarjeta débito?")).toBe("como-bloqueo-mi-tarjeta-debito");
    const root = document.body.appendChild(document.createElement("div"));
    const api = {
      articles: vi.fn(async () => ({ items: [] })),
      createArticle: vi.fn(async (data) => ({ id: "k1", ...data })),
      article: vi.fn(async (id) => ({
        id,
        title: "x",
        slug: "x",
        category: "tarjetas",
        tags: [],
        body: "b".repeat(30),
        status: "draft",
        version: 1,
      })),
    };
    adminKbView(root, {}, { adminApi: api, session: fakeSession(ADMIN) });
    await flush();
    expect(root.textContent).toMatch(/Aún no hay artículos/);
    buttonIn(root, "Nuevo artículo").click();
    await flush();
    root.querySelector("#kb-title").value = "Cómo bloquear mi tarjeta";
    root.querySelector("#kb-title").dispatchEvent(new Event("input"));
    expect(root.querySelector("#kb-slug").value).toBe("como-bloquear-mi-tarjeta");
    root.querySelector("#kb-category").value = "tarjetas";
    root.querySelector("#kb-body").value = "Para bloquear tu tarjeta entra a la app y elige Bloquear.";
    root.querySelector("#kb-status").value = "published";
    root.querySelector(".admin-editor form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(api.createArticle).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "como-bloquear-mi-tarjeta", status: "published", category: "tarjetas", tags: [] })
    );
  });

  it("Respuestas: el error del servidor se muestra en el formulario (p. ej. título repetido)", async () => {
    const root = document.body.appendChild(document.createElement("div"));
    const api = {
      cannedAll: vi.fn(async () => ({ items: [] })),
      createCanned: vi.fn(async () => {
        throw new HttpError("Ya existe una respuesta con ese título o ese atajo", { status: 409 });
      }),
    };
    adminCannedView(root, {}, { adminApi: api, session: fakeSession(ADMIN) });
    await flush();
    buttonIn(root, "Nueva respuesta").click();
    root.querySelector("#canned-title").value = "Saludo";
    root.querySelector("#canned-body").value = "Hola {cliente}";
    root.querySelector(".admin-editor form").dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(api.createCanned).toHaveBeenCalledWith({
      title: "Saludo",
      body: "Hola {cliente}",
      shortcut: null,
      isActive: true,
    });
    expect(root.querySelector(".admin-editor [role='alert']").textContent).toMatch(/Ya existe/);
  });
});

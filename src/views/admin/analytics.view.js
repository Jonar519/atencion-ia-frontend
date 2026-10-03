import { h, replaceChildren } from "../../lib/dom.js";
import { adminApi as defaultAdminApi } from "../../api/admin.js";
import * as defaultSession from "../../auth/session.js";
import { barChart } from "../../components/barChart.js";
import { adminPage, emptyState, errorState, loadingState } from "./adminPage.js";

/**
 * ANALÍTICA (#/admin/analytics, solo admin). Definiciones de cada métrica en
 * docs/analytics.md del backend. El CSAT es SIMULADO (no hay encuestas reales
 * todavía) y la pantalla lo dice en el propio indicador, no en una nota al pie.
 */
const PERIODS = [
  ["1", "Últimas 24 h"],
  ["7", "Últimos 7 días"],
  ["30", "Últimos 30 días"],
  ["90", "Últimos 90 días"],
];

const ESCALATION_REASON = {
  possible_fraud: "Posible fraude",
  angry_customer: "Cliente molesto",
  complaint: "Reclamo",
  low_confidence: "La IA no pudo resolver",
  human_requested: "Pidió un asesor",
  repeated_failure: "Problema repetido",
  voice_call: "Llamada de voz",
};

const number = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 });

/** "95 min" / "2,5 h" / "< 1 min" / "—" (sin datos: nunca un 0 inventado). */
export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 1) return "< 1 min";
  return minutes >= 120 ? `${number.format(minutes / 60)} h` : `${number.format(minutes)} min`;
}

export function adminAnalyticsView(root, _params, deps = {}) {
  const adminApi = deps.adminApi ?? defaultAdminApi;
  const session = deps.session ?? defaultSession;
  const main = adminPage(root, { title: "Analítica", current: "/admin/analytics", staff: session.getStaff(), session });
  const content = h("div", { class: "analytics" });
  let days = "7";
  let disposed = false;

  const period = h(
    "select",
    { id: "analytics-days", class: "input input--compact", on: { change: (e) => ((days = e.target.value), load()) } },
    PERIODS.map(([value, label]) => h("option", { value, selected: value === days }, label))
  );
  replaceChildren(
    main,
    h("div", { class: "admin-toolbar" }, h("label", { for: "analytics-days" }, "Periodo"), period),
    content
  );
  load();
  return () => {
    disposed = true;
  };

  async function load() {
    main.setAttribute("aria-busy", "true");
    replaceChildren(content, loadingState("Cargando la analítica"));
    try {
      const data = await adminApi.analytics(days);
      if (disposed) return;
      render(data);
    } catch (err) {
      replaceChildren(content, errorState(`No se pudo cargar la analítica. ${err.message}`, load));
    } finally {
      main.setAttribute("aria-busy", "false");
    }
  }

  function tile(label, value, detail, extra = null) {
    return h(
      "div",
      { class: "stat" },
      h("p", { class: "stat__label" }, label, extra),
      h("p", { class: "stat__value" }, value),
      detail ? h("p", { class: "stat__detail muted" }, detail) : null
    );
  }

  function render(data) {
    const { resolution, escalation, csat, volumeByHour } = data;
    if (escalation.conversations === 0 && resolution.resolved === 0) {
      replaceChildren(
        content,
        emptyState(
          "No hubo conversaciones en este periodo.",
          "Prueba con un periodo más largo, o abre el chat del cliente (#/chat) para generar actividad."
        )
      );
      return;
    }
    const ai = resolution.byCloser.resolved_by_ai;
    const agent = resolution.byCloser.resolved_by_agent;
    const tiles = h(
      "div",
      { class: "stats" },
      tile(
        "Tiempo medio de resolución",
        formatMinutes(resolution.averageMinutes),
        `Mediana ${formatMinutes(resolution.medianMinutes)} · ${resolution.resolved} resueltas`
      ),
      tile(
        "Tasa de escalamiento",
        escalation.ratePercent === null ? "—" : `${number.format(escalation.ratePercent)} %`,
        `${escalation.escalated} de ${escalation.conversations} conversaciones`
      ),
      tile(
        "Satisfacción (CSAT)",
        csat.satisfiedPercent === null ? "—" : `${number.format(csat.satisfiedPercent)} %`,
        `Nota media ${csat.average === null ? "—" : number.format(csat.average)} de 5 · ${csat.responses} conversaciones`,
        h(
          "span",
          {
            class: "badge-simulated",
            title: "No hay encuestas reales todavía: se estima con una regla fija documentada.",
          },
          "SIMULADO"
        )
      ),
      tile(
        "Resueltas por la IA / por asesores",
        `${ai?.resolved ?? 0} / ${agent?.resolved ?? 0}`,
        `Tiempo medio: IA ${formatMinutes(ai?.averageMinutes ?? null)} · asesores ${formatMinutes(agent?.averageMinutes ?? null)}`
      )
    );

    const hours = barChart({
      title: "Conversaciones iniciadas por hora del día (hora de Bogotá)",
      orientation: "column",
      labelEvery: 3,
      data: volumeByHour.map((value, hour) => ({
        label: `${String(hour).padStart(2, "0")}:00`,
        short: String(hour).padStart(2, "0"),
        value,
      })),
    });

    const reasons = escalation.byReason.length
      ? barChart({
          title: "Conversaciones escaladas, por motivo",
          orientation: "bar",
          data: escalation.byReason.map((r) => ({
            label: ESCALATION_REASON[r.reason] ?? r.reason,
            value: r.conversations,
          })),
        })
      : emptyState(
          "Sin escalamientos en este periodo.",
          "Todas las conversaciones las resolvió la IA o siguen abiertas."
        );

    const csatChart = csat.responses
      ? barChart({
          title: "CSAT SIMULADO: conversaciones por nota (1 a 5)",
          orientation: "bar",
          data: csat.distribution.map((value, i) => ({ label: `Nota ${i + 1}`, value })),
        })
      : emptyState(
          "Sin conversaciones cerradas en este periodo.",
          "El CSAT se calcula sobre las conversaciones cerradas."
        );

    replaceChildren(
      content,
      tiles,
      h("section", { class: "analytics__panel", "aria-label": "Volumen por hora" }, hours),
      h(
        "div",
        { class: "analytics__row" },
        h("section", { class: "analytics__panel", "aria-label": "Escalamientos por motivo" }, reasons),
        h(
          "section",
          { class: "analytics__panel", "aria-label": "CSAT simulado" },
          csatChart,
          h(
            "p",
            { class: "muted analytics__note" },
            "CSAT simulado: el sistema aún no pregunta al cliente. Cada conversación cerrada recibe una nota con una regla fija (cómo terminó, cuánto tardó y una variación determinista); los mismos datos dan siempre el mismo resultado."
          )
        )
      )
    );
  }
}

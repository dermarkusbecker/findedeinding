import {
  TASK_METHODS,
  moveProgramTask,
  validateProgramDefinition,
} from "./lib/program-builder.js";

const root = document.querySelector("#programBuilder");
let savedDefinition = null;
let definition = null,
  revision = 0,
  selectedWeek = 0,
  dirty = false,
  busy = false;
const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const api = async (options = {}) => {
  const r = await fetch("/api/clarity?action=builder", {
    cache: "no-store",
    ...options,
    headers: { "Content-Type": "application/json" },
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      data.error || "Der Prozess konnte nicht gespeichert werden.",
    );
  return data;
};
function message(text, error = false) {
  const node = root.querySelector("[data-builder-status]");
  node.textContent = text;
  node.classList.toggle("error", error);
}
function markDirty() {
  dirty = true;
  message(
    "Ungespeicherte Änderungen · Kunden sehen weiterhin ihre veröffentlichte Version.",
  );
}
function methodFields(step, index) {
  if (["priority_selection", "selection"].includes(step.kind))
    return `<label class="builder-wide">Auswahlbegriffe · eine Zeile pro Begriff<textarea data-step="${index}" data-field="options" rows="5">${esc((step.options || []).join("\n"))}</textarea></label><label>Mindestauswahl<input type="number" min="1" max="60" data-step="${index}" data-field="minItems" value="${step.minItems || 1}"></label><label>Höchstauswahl<input type="number" min="1" max="60" data-step="${index}" data-field="maxItems" value="${step.maxItems || 1}"></label>`;
  if (step.kind === "scale")
    return `<label>Skala von<input type="number" min="0" max="9" data-step="${index}" data-field="min" value="${step.min ?? 1}"></label><label>Skala bis<input type="number" min="1" max="10" data-step="${index}" data-field="max" value="${step.max ?? 10}"></label>`;
  if (step.kind === "confirmation")
    return `<label class="builder-wide">Beschriftung der Bestätigung<input maxlength="100" data-step="${index}" data-field="expected" value="${esc(step.expected || "Bestätigen")}"></label>`;
  if (step.kind === "external")
    return '<p class="builder-wide builder-help">Die bestehende technische Prüfung bleibt erhalten. Kunden können dieses Ergebnis nicht selbst als erledigt markieren.</p>';
  if (["dialog", "structured"].includes(step.kind))
    return `<label>Mindestanzahl an Punkten (optional)<input type="number" min="1" max="30" data-step="${index}" data-field="minItems" value="${step.minItems || ""}"></label><label>Höchstanzahl an Punkten (optional)<input type="number" min="1" max="30" data-step="${index}" data-field="maxItems" value="${step.maxItems || ""}"></label>`;
  return "";
}
function render() {
  if (!definition) return;
  const week = definition.weeks[selectedWeek];
  root.innerHTML = `<div class="builder-toolbar"><div><p class="eyebrow">VERSIONIERTER PROZESSBAUKASTEN</p><h2>Deinen Prozess gestalten</h2><p>Acht Wochen, frei gestaltbare Aufgaben. Entwurf bearbeiten, Vorschau prüfen, dann veröffentlichen.</p></div><div><button type="button" class="secondary" data-builder-action="reset">Gespeicherten Entwurf laden</button><button type="button" class="secondary" data-builder-action="preview">Kundenvorschau</button><button type="button" class="secondary" data-builder-action="save">Entwurf speichern</button><button type="button" class="primary" data-builder-action="publish">Veröffentlichen…</button></div></div><p role="status" data-builder-status>${dirty ? "Ungespeicherte Änderungen" : "Entwurf geladen · Revision " + revision}</p><label class="builder-process-name">Prozessname<input data-process-name maxlength="160" value="${esc(definition.name)}"></label><nav class="builder-week-tabs" aria-label="Woche bearbeiten">${definition.weeks.map((w, i) => `<button type="button" data-builder-week="${i}" aria-pressed="${i === selectedWeek}"><small>Woche ${i + 1}</small><strong>${esc(w.title)}</strong><span>${w.steps.length} Aufgaben</span></button>`).join("")}</nav><section class="builder-week-editor"><div class="builder-week-heading"><h3>Woche ${selectedWeek + 1}</h3>${selectedWeek > 0 ? `<div><button type="button" class="secondary" data-builder-action="week-up" ${selectedWeek === 1 ? "disabled" : ""}>← Woche vorziehen</button><button type="button" class="secondary" data-builder-action="week-down" ${selectedWeek === 7 ? "disabled" : ""}>Woche nach hinten →</button></div>` : "<small>Die verknüpfte Bestandsaufnahme bleibt als Startwoche erhalten. Alle Texte sind editierbar.</small>"}</div><div class="builder-fields"><label>Wochenüberschrift<input data-week-field="title" maxlength="160" value="${esc(week.title)}"></label><label>Phase / Untertitel<input data-week-field="mode" maxlength="160" value="${esc(week.mode)}"></label><label class="builder-wide">Einleitung<textarea data-week-field="intro" rows="2" maxlength="4000">${esc(week.intro)}</textarea></label></div><div class="builder-tasks">${week.steps
    .map(
      (step, index) =>
        `<details class="builder-task"><summary><span>${String(index + 1).padStart(2, "0")}</span><strong>${esc(step.title)}</strong><i>${esc(TASK_METHODS[step.kind] || "Verknüpfter Startschritt")}</i></summary><div class="builder-fields"><label>Titel<input data-step="${index}" data-field="title" maxlength="160" value="${esc(step.title)}"></label><label>Methode<select data-step="${index}" data-field="kind" ${["external", "system"].includes(step.kind) ? "disabled" : ""}>${(step.kind === "system" ? ["system"] : step.kind === "external" ? ["external"] : Object.keys(TASK_METHODS).filter((k) => k !== "external")).map((kind) => `<option value="${kind}" ${step.kind === kind ? "selected" : ""}>${esc(TASK_METHODS[kind] || "Verknüpfter Startschritt")}</option>`).join("")}</select></label><label class="builder-wide">Frage / Aufgabenbeschreibung<textarea data-step="${index}" data-field="question" rows="3" maxlength="4000">${esc(step.question)}</textarea></label>${methodFields(step, index)}<label>Hinweise für Clara<textarea data-step="${index}" data-field="guidance" rows="3" maxlength="4000">${esc(step.guidance || "")}</textarea></label><label>Abschlusskriterien<textarea data-step="${index}" data-field="completionCriteria" rows="3" maxlength="4000">${esc(step.completionCriteria || "")}</textarea></label></div>${
          selectedWeek > 0
            ? `<div class="builder-task-actions"><button type="button" class="secondary" data-task-up="${index}" ${index === 0 ? "disabled" : ""}>↑ Nach oben</button><button type="button" class="secondary" data-task-down="${index}" ${index === week.steps.length - 1 ? "disabled" : ""}>↓ Nach unten</button><label>In Woche verschieben<select data-task-move="${index}">${definition.weeks
                .slice(1)
                .map(
                  (w, i) =>
                    `<option value="${i + 1}" ${selectedWeek === i + 1 ? "selected" : ""}>${i + 2} · ${esc(w.title)}</option>`,
                )
                .join(
                  "",
                )}</select></label>${step.kind !== "external" ? `<button type="button" class="secondary" data-task-remove="${index}">Entfernen</button>` : ""}</div>`
            : ""
        }</details>`,
    )
    .join("")}</div>${
    selectedWeek > 0
      ? `<div class="builder-add"><label>Neue Aufgabe<select id="builderNewMethod">${Object.entries(
          TASK_METHODS,
        )
          .filter(([key]) => key !== "external")
          .map(([key, label]) => `<option value="${key}">${label}</option>`)
          .join(
            "",
          )}</select></label><button type="button" class="primary" data-builder-action="add">+ Aufgabe hinzufügen</button></div>`
      : ""
  }</section><p class="builder-release-note">Veröffentlichte Versionen bleiben für zugeordnete Kunden unverändert. Neue Kunden erhalten die zuletzt veröffentlichte Version. Bestehende Kunden behalten ihren bisherigen Prozess.</p>`;
}
function setMethod(step, kind) {
  step.kind = kind;
  for (const key of [
    "options",
    "minItems",
    "maxItems",
    "min",
    "max",
    "expected",
    "external",
  ])
    delete step[key];
  if (["selection", "priority_selection"].includes(kind))
    Object.assign(step, {
      options: ["Möglichkeit A", "Möglichkeit B", "Möglichkeit C"],
      minItems: kind === "selection" ? 1 : 3,
      maxItems: 3,
    });
  if (kind === "scale") Object.assign(step, { min: 1, max: 10 });
  if (kind === "confirmation") step.expected = "Bestätigen";
}
async function save(publish = false) {
  const errors = validateProgramDefinition(definition);
  if (errors.length) {
    message(errors.join("\n"), true);
    return;
  }
  busy = true;
  root.inert = true;
  try {
    const result = await api({
      method: "PATCH",
      body: JSON.stringify({
        definition,
        revision,
        action: publish ? "publish" : "save",
      }),
    });
    revision = result.revision;
    savedDefinition = structuredClone(definition);
    dirty = false;
    message(
      publish
        ? `Version ${result.version} veröffentlicht. Neue Kunden erhalten diesen Prozess.`
        : "Entwurf gespeichert.",
    );
  } catch (error) {
    message(error.message, true);
  } finally {
    busy = false;
    root.inert = false;
  }
}
function preview() {
  const dialog = document.querySelector("#builderPreview");
  dialog.innerHTML = `<div class="builder-preview-shell"><button type="button" class="secondary" data-close-preview>Schließen</button><p class="eyebrow">KUNDENVORSCHAU · ENTWURF</p><h2>${esc(definition.name)}</h2>${definition.weeks.map((week, index) => `<section><h3>Woche ${index + 1} · ${esc(week.title)}</h3><p>${esc(week.intro)}</p>${week.steps.map((step) => `<article><small>${esc(TASK_METHODS[step.kind] || "Startschritt")}</small><h4>${esc(step.title)}</h4><p>${esc(step.question)}</p>${step.options ? `<div class="builder-preview-options">${step.options.map((option) => `<span>${esc(option)}</span>`).join("")}</div>` : ""}${step.kind === "scale" ? `<div class="builder-preview-options">${Array.from({ length: Math.max(0, Math.min(11, step.max - step.min + 1)) }, (_, i) => `<span>${step.min + i}</span>`).join("")}</div>` : ""}</article>`).join("")}</section>`).join("")}</div>`;
  dialog.querySelector("[data-close-preview]").onclick = () => dialog.close();
  dialog.showModal();
}
root?.addEventListener("input", (event) => {
  const el = event.target;
  const week = definition?.weeks[selectedWeek];
  if (!week) return;
  if (el.hasAttribute("data-process-name")) definition.name = el.value;
  else if (el.dataset.weekField) week[el.dataset.weekField] = el.value;
  else if (el.dataset.field && el.dataset.field !== "kind") {
    const step = week.steps[Number(el.dataset.step)];
    step[el.dataset.field] =
      el.dataset.field === "options"
        ? el.value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
        : ["min", "max", "minItems", "maxItems"].includes(el.dataset.field)
          ? el.value === ""
            ? undefined
            : Number(el.value)
          : el.value;
  } else return;
  markDirty();
});
root?.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.field === "kind") {
    setMethod(
      definition.weeks[selectedWeek].steps[Number(el.dataset.step)],
      el.value,
    );
    markDirty();
    render();
  }
  if (el.hasAttribute("data-task-move")) {
    definition = moveProgramTask(
      definition,
      selectedWeek,
      Number(el.dataset.taskMove),
      Number(el.value),
      definition.weeks[Number(el.value)].steps.length,
    );
    markDirty();
    render();
  }
});
root?.addEventListener("click", async (event) => {
  const el = event.target.closest("button");
  if (!el || busy) return;
  if (el.hasAttribute("data-builder-week")) {
    selectedWeek = Number(el.dataset.builderWeek);
    render();
    return;
  }
  const week = definition?.weeks[selectedWeek];
  for (const [key, delta] of [
    ["taskUp", -1],
    ["taskDown", 1],
  ])
    if (el.dataset[key] !== undefined) {
      const index = Number(el.dataset[key]);
      definition = moveProgramTask(
        definition,
        selectedWeek,
        index,
        selectedWeek,
        index + delta,
      );
      markDirty();
      render();
      return;
    }
  if (el.dataset.taskRemove !== undefined) {
    week.steps.splice(Number(el.dataset.taskRemove), 1);
    markDirty();
    render();
    return;
  }
  const action = el.dataset.builderAction;
  if (action === "reset") {
    definition = structuredClone(savedDefinition);
    dirty = false;
    render();
    return;
  }
  if (action === "preview") {
    preview();
    return;
  }
  if (action === "save") {
    await save();
    return;
  }
  if (action === "publish") {
    const dialog = document.querySelector("#builderPublish");
    dialog.showModal();
    return;
  }
  if (action === "add") {
    const step = {
      id: `task_${crypto.randomUUID().replaceAll("-", "")}`,
      title: "Neue Aufgabe",
      question: "Was möchtest du für dich herausfinden?",
      gateKey: "",
    };
    step.gateKey = step.id;
    setMethod(step, document.querySelector("#builderNewMethod").value);
    week.steps.push(step);
    markDirty();
    render();
    return;
  }
  if (["week-up", "week-down"].includes(action)) {
    const target = selectedWeek + (action === "week-up" ? -1 : 1);
    if (target < 1 || target > 7) return;
    [definition.weeks[selectedWeek], definition.weeks[target]] = [
      definition.weeks[target],
      definition.weeks[selectedWeek],
    ];
    selectedWeek = target;
    markDirty();
    render();
  }
});
document
  .querySelector("#builderPublishCancel")
  ?.addEventListener("click", () =>
    document.querySelector("#builderPublish").close(),
  );
document
  .querySelector("#builderPublishConfirm")
  ?.addEventListener("click", async () => {
    document.querySelector("#builderPublish").close();
    await save(true);
  });
window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
async function load() {
  if (definition) return;
  root.textContent = "Prozessbaukasten wird geladen …";
  try {
    const data = await api();
    definition = data.definition;
    savedDefinition = structuredClone(definition);
    revision = data.revision;
    render();
  } catch (error) {
    root.innerHTML = `<p>${esc(error.message)}</p><button type="button" class="secondary" data-builder-retry>Erneut laden</button>`;
    root.querySelector("[data-builder-retry]").onclick = load;
  }
}
if (root) {
  const panel = root.closest("[data-settings-panel]");
  const observer = new MutationObserver(() => {
    if (panel.classList.contains("active")) void load();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
  if (panel.classList.contains("active")) void load();
}

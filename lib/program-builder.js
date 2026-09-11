import { GUIDED_WEEK_DEFINITIONS } from "./guided-weeks.js";
import { WEEK_ONE_STEPS } from "./week-one.js";

export const TASK_METHODS = Object.freeze({
  dialog: "Textfrage mit Clara",
  structured: "Strukturierte Reflexion",
  priority_selection: "Auswahl mit Rangfolge",
  selection: "Mehrfachauswahl",
  scale: "Bewertungsskala",
  confirmation: "Bestätigung",
  upload: "Dokument-Upload",
  external: "Persönlich bestätigtes Ergebnis",
});
const firstSteps = [
  [
    WEEK_ONE_STEPS.WISHES,
    "Deine drei Wünsche",
    "Welche drei Dinge wünschst du dir aktuell für dein Leben?",
  ],
  [
    WEEK_ONE_STEPS.WISH_1,
    "Ersten Wunsch vertiefen",
    "Was würde sich konkret verändern, wenn dieser Wunsch erfüllt wäre?",
  ],
  [
    WEEK_ONE_STEPS.WISH_2,
    "Zweiten Wunsch vertiefen",
    "Was würde sich konkret verändern, wenn dieser Wunsch erfüllt wäre?",
  ],
  [
    WEEK_ONE_STEPS.WISH_3,
    "Dritten Wunsch vertiefen",
    "Was würde sich konkret verändern, wenn dieser Wunsch erfüllt wäre?",
  ],
  [
    WEEK_ONE_STEPS.TARGET,
    "Dein Zielbild",
    "Was müsste sich nach acht Wochen verändert haben, damit sich dieser Prozess gelohnt hat?",
  ],
  [
    WEEK_ONE_STEPS.TARGET_CLARIFY,
    "Zielbild konkretisieren",
    "Woran würdest du konkret merken, dass du Klarheit gewonnen hast?",
  ],
  [
    WEEK_ONE_STEPS.CLARITY,
    "Deine Ausgangsbasis",
    "Wie klar ist dir heute auf einer Skala von 1 bis 10, was dein Ding ist?",
  ],
  [
    WEEK_ONE_STEPS.CAREER_CHOICE,
    "Dein Lebenslauf",
    "Lade bitte deinen aktuellen Lebenslauf hoch.",
  ],
  [
    WEEK_ONE_STEPS.CAREER_DIALOG,
    "Berufliche Stationen",
    "Was waren bisher die wichtigsten beruflichen Stationen in deinem Leben?",
  ],
  [
    WEEK_ONE_STEPS.CAREER_CONFIRM,
    "Beruflichen Weg bestätigen",
    "Ist dein bisheriger beruflicher Weg damit im Wesentlichen vollständig?",
  ],
];
export function defaultProgramDefinition(overrides = []) {
  const first = {
    id: "foundation",
    title: "Jetzt geht es los",
    mode: "Ist-Aufnahme",
    intro: "Deine Wünsche, deine Richtung und dein bisheriger Weg.",
    steps: firstSteps.map(([id, title, question]) => ({
      id,
      title,
      question,
      kind: "system",
      gateKey: id,
    })),
  };
  const weeks = [
    first,
    ...Object.entries(GUIDED_WEEK_DEFINITIONS).map(([week, definition]) => ({
      ...structuredClone(definition),
      id: `week_${week}`,
    })),
  ];
  weeks.forEach((week, index) =>
    week.steps.forEach((step) => {
      const override = overrides.find(
        (item) => item.week === index + 1 && item.step_id === step.id,
      );
      if (override) {
        step.title = override.title || step.title;
        step.question = override.prompt_text || step.question;
        step.guidance = override.guidance_text || "";
        step.completionCriteria = override.completion_criteria || "";
      }
    }),
  );
  return { schemaVersion: 1, name: "Finde d(AI)n Ding · 8 Wochen", weeks };
}

export function validateProgramDefinition(input) {
  const errors = [];
  if (
    !input ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.weeks) ||
    input.weeks.length !== 8
  )
    return ["Der Prozess benötigt genau acht Wochen."];
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 160
  )
    errors.push("Ein Prozessname mit maximal 160 Zeichen ist erforderlich.");
  const ids = new Set(),
    weekIds = new Set();
  input.weeks.forEach((week, index) => {
    const prefix = `Woche ${index + 1}`;
    if (!week || typeof week !== "object") {
      errors.push(`${prefix}: Ungültige Woche.`);
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(week.id || "") || weekIds.has(week.id))
      errors.push(`${prefix}: Die Wochen-ID ist ungültig oder doppelt.`);
    weekIds.add(week.id);
    if (
      typeof week.title !== "string" ||
      !week.title.trim() ||
      week.title.length > 160
    )
      errors.push(
        `${prefix}: Bitte eine Überschrift mit maximal 160 Zeichen eintragen.`,
      );
    if (
      typeof week.intro !== "string" ||
      week.intro.length > 4000 ||
      typeof week.mode !== "string" ||
      week.mode.length > 160
    )
      errors.push(`${prefix}: Einleitung oder Phasenbezeichnung ungültig.`);
    if (
      !Array.isArray(week.steps) ||
      !week.steps.length ||
      week.steps.length > 50
    ) {
      errors.push(`${prefix}: Bitte 1 bis 50 Aufgaben verwenden.`);
      return;
    }
    week.steps.forEach((step) => {
      if (!step || typeof step !== "object") {
        errors.push(`${prefix}: Ungültige Aufgabe.`);
        return;
      }
      const label = `${prefix} · ${step.title || "Aufgabe"}`;
      if (
        !/^[a-zA-Z0-9_-]{1,100}$/.test(step.id || "") ||
        ids.has(step.id) ||
        step.id === "weekly_clarity"
      )
        errors.push(`${label}: Aufgaben-IDs müssen eindeutig bleiben.`);
      ids.add(step.id);
      if (
        typeof step.title !== "string" ||
        !step.title.trim() ||
        step.title.length > 160 ||
        typeof step.question !== "string" ||
        step.question.trim().length < 5 ||
        step.question.length > 4000
      )
        errors.push(
          `${label}: Titel und eine vollständige Frage sind erforderlich.`,
        );
      if (
        ![...Object.keys(TASK_METHODS), "system"].includes(step.kind) ||
        (index > 0 && step.kind === "system")
      )
        errors.push(`${label}: Unbekannte Aufgabenmethode.`);
      for (const field of ["guidance", "completionCriteria"])
        if (
          step[field] !== undefined &&
          (typeof step[field] !== "string" || step[field].length > 4000)
        )
          errors.push(`${label}: ${field} ist zu lang.`);
      if (["priority_selection", "selection"].includes(step.kind)) {
        const options = step.options;
        if (
          !Array.isArray(options) ||
          options.length < 2 ||
          options.length > 60 ||
          options.some(
            (value) =>
              typeof value !== "string" || !value.trim() || value.length > 100,
          ) ||
          new Set(options).size !== options.length
        )
          errors.push(
            `${label}: Bitte 2 bis 60 unterschiedliche Auswahlbegriffe eintragen.`,
          );
        if (
          !Number.isInteger(step.minItems) ||
          !Number.isInteger(step.maxItems) ||
          step.minItems < 1 ||
          step.maxItems < step.minItems ||
          step.maxItems > (options?.length || 0) ||
          (step.kind === "priority_selection" &&
            step.minItems !== step.maxItems)
        )
          errors.push(
            `${label}: Die Auswahlanzahl passt nicht zu den Begriffen.`,
          );
      }
      if (
        ["dialog", "structured"].includes(step.kind) &&
        ((step.minItems !== undefined &&
          (!Number.isInteger(step.minItems) ||
            step.minItems < 1 ||
            step.minItems > 30)) ||
          (step.maxItems !== undefined &&
            (!Number.isInteger(step.maxItems) ||
              step.maxItems < (step.minItems || 1) ||
              step.maxItems > 30)))
      )
        errors.push(`${label}: Die Anzahl der Antwortpunkte ist ungültig.`);
      if (
        step.kind === "scale" &&
        (!Number.isInteger(step.min) ||
          !Number.isInteger(step.max) ||
          step.min < 0 ||
          step.max > 10 ||
          step.min >= step.max)
      )
        errors.push(`${label}: Die Skala muss zwischen 0 und 10 liegen.`);
      if (
        step.kind === "confirmation" &&
        (typeof step.expected !== "string" ||
          !step.expected.trim() ||
          step.expected.length > 100)
      )
        errors.push(`${label}: Ein Bestätigungstext fehlt.`);
      if (
        step.kind === "external" &&
        !Object.values(GUIDED_WEEK_DEFINITIONS)
          .flatMap((item) => item.steps)
          .some(
            (item) =>
              item.kind === "external" &&
              item.id === step.id &&
              item.external === step.external,
          )
      )
        errors.push(
          `${label}: Technische Ergebnisprüfung kann nicht erfunden werden.`,
        );
    });
  });
  if (errors.length) return [...new Set(errors)];
  const firstIds = firstSteps.map(([id]) => id);
  if (
    input.weeks[0].id !== "foundation" ||
    (input.weeks[0].steps || []).map((step) => step.id).join("|") !==
      firstIds.join("|") ||
    (input.weeks[0].steps || []).some((step) => step.kind !== "system")
  )
    errors.push(
      "Die verknüpfte Bestandsaufnahme in Woche 1 bleibt in ihrer Reihenfolge erhalten. Texte und Überschriften sind editierbar.",
    );
  const all = input.weeks.flatMap((week) => week.steps || []);
  // These linked activities require earlier participant inputs. Keep their
  // relative order even when the surrounding weeks are reorganized.
  const originals = Object.values(GUIDED_WEEK_DEFINITIONS).flatMap(
    (week) => week.steps,
  );
  const protectedSteps = originals.filter((step) => step.kind === "external");
  let previous = -1;
  for (const original of protectedSteps) {
    const index = all.findIndex((step) => step?.id === original.id);
    if (
      index < 0 ||
      index < previous ||
      all[index]?.kind !== "external" ||
      all[index]?.external !== original.external
    )
      errors.push(
        "Verknüpfte Auswertungen müssen mit ihrer technischen Prüfung und fachlichen Reihenfolge erhalten bleiben.",
      );
    previous = index;
  }
  const dependencies = {
    human_design: ["birth_data"],
    midpoint_report: ["puzzle_assignment"],
    lila: ["lila_ready"],
    ding_map: [
      "enthusiasm",
      "strength_potential",
      "difference",
      "value_creation",
      "perfect_day",
      "exclusions",
      "counterparts",
    ],
    decision_resolution: ["final_two", "future_timelines", "decision"],
    final_dossier: ["final_commitment", "clarity_end"],
  };
  for (const [target, sources] of Object.entries(dependencies))
    for (const source of sources) {
      const sourceIndex = all.findIndex((step) => step?.id === source);
      if (
        sourceIndex < 0 ||
        sourceIndex >= all.findIndex((step) => step?.id === target)
      )
        errors.push(
          `„${originals.find((step) => step.id === source)?.title}“ muss vor „${originals.find((step) => step.id === target)?.title}“ stehen.`,
        );
    }
  return [...new Set(errors)];
}

export function definitionForWeek(definition, week) {
  const item = definition?.weeks?.[Number(week) - 1];
  return item
    ? {
        ...item,
        steps: item.steps.map((step) => ({
          ...step,
          gateKey: step.gateKey || step.id,
          ...(step.kind === "confirmation" ? { expected: step.expected } : {}),
        })),
      }
    : null;
}
export function moveProgramTask(
  definition,
  fromWeek,
  fromIndex,
  toWeek,
  toIndex,
) {
  const copy = structuredClone(definition);
  if (
    fromWeek < 1 ||
    toWeek < 1 ||
    !copy.weeks[fromWeek]?.steps[fromIndex] ||
    !copy.weeks[toWeek]
  )
    return copy;
  const [step] = copy.weeks[fromWeek].steps.splice(fromIndex, 1);
  copy.weeks[toWeek].steps.splice(toIndex, 0, step);
  return copy;
}

import {
  defaultProgramDefinition,
  validateProgramDefinition,
  definitionForWeek,
  TASK_METHODS,
} from "./program-builder.js";
const headers = (service) => ({
  apikey: service.key,
  Authorization: `Bearer ${service.key}`,
  "Content-Type": "application/json",
});
async function query(service, path, options = {}) {
  const response = await fetch(`${service.url}/rest/v1/${path}`, {
    ...options,
    headers: headers(service),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(
      new Error(
        data?.message || "Der Prozessbaukasten konnte nicht geladen werden.",
      ),
      { status: response.status, code: data?.code },
    );
  return data;
}
export async function participantProcessVersion(service, participantId) {
  try {
    return await query(service, "rpc/assign_program_version", {
      method: "POST",
      body: JSON.stringify({ p_participant: participantId }),
    });
  } catch (error) {
    if (["PGRST202", "42P01"].includes(error.code)) return null;
    throw error;
  }
}
export function configuredWeekState(week, state, processVersion) {
  const definition = definitionForWeek(processVersion?.definition, week);
  if (!definition || Number(week) === 1) return state;
  return {
    ...state,
    ...(!state?.updated_at && !state?.completed_steps?.length
      ? { current_step: definition.steps[0].id }
      : {}),
    definition,
    processVersion: processVersion.version,
  };
}
export function processQuestionOverrides(processVersion, legacy = []) {
  if (!processVersion?.definition) return legacy;
  return processVersion.definition.weeks.flatMap((week, index) =>
    week.steps.map((step) => ({
      question_key: `${index + 1}.${step.id}`,
      week: index + 1,
      step_id: step.id,
      title: step.title,
      prompt_text: step.question,
      guidance_text:
        step.guidance ||
        "Bleibe bei der aktuellen Frage. Beachte die vorgegebenen Regeln und erfinde keine Angaben.",
      completion_criteria:
        step.completionCriteria ||
        `Die Aufgabe muss vollständig beantwortet sein. Methode: ${step.kind}. ${step.minItems ? `Mindestens ${step.minItems} Punkte.` : ""} ${step.maxItems ? `Höchstens ${step.maxItems} Punkte.` : ""} ${step.kind === "scale" ? `Ein ganzzahliger Wert von ${step.min} bis ${step.max}.` : ""} ${["external", "upload"].includes(step.kind) ? "Eine technische Bestätigung ist erforderlich." : ""}`,
      enabled: true,
    })),
  );
}
export async function handleProgramBuilder(
  request,
  response,
  admin,
  service,
  overrides = [],
) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method === "GET") {
    const [draft, versions] = await Promise.all([
      query(service, "program_builder_draft?id=eq.1&select=*"),
      query(
        service,
        "program_versions?select=id,version,published_at,definition&order=version.desc&limit=20",
      ),
    ]);
    return response
      .status(200)
      .json({
        definition: draft[0]?.definition || defaultProgramDefinition(overrides),
        revision: draft[0]?.revision || 0,
        versions,
        methods: TASK_METHODS,
      });
  }
  if (request.method !== "PATCH")
    return response.status(405).json({ error: "Methode nicht erlaubt." });
  const { definition, revision, action } = request.body || {};
  if (!["save", "publish"].includes(action) || !Number.isInteger(revision))
    return response.status(400).json({ error: "Ungültige Entwurfsaktion." });
  const errors = validateProgramDefinition(definition);
  if (errors.length)
    return response.status(400).json({ error: errors.join("\n"), errors });
  const result = await query(service, "rpc/save_program_builder", {
    method: "POST",
    body: JSON.stringify({
      p_definition: definition,
      p_revision: revision,
      p_publish: action === "publish",
      p_admin: admin.profile.id,
    }),
  });
  return response.status(200).json({ ok: true, ...result });
}

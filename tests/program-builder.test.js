import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultProgramDefinition,
  validateProgramDefinition,
  moveProgramTask,
  definitionForWeek,
} from "../lib/program-builder.js";
import {
  configuredWeekState,
  processQuestionOverrides,
  handleProgramBuilder,
} from "../lib/program-builder-service.js";
import {
  normalizeGuidedWeekState,
  createGuidedWeekState,
  currentGuidedStep,
  applyGuidedWeekAction,
  guidedWeekComplete,
} from "../lib/guided-weeks.js";
import { buildClaraContext } from "../lib/clara/context-builder.js";

test("default process validates; malformed input and broken dependencies do not", () => {
  assert.deepEqual(validateProgramDefinition(defaultProgramDefinition()), []);
  for (const bad of [
    null,
    {},
    { schemaVersion: 1, name: "x", weeks: Array(8).fill(null) },
  ])
    assert.ok(validateProgramDefinition(bad).length);
  const def = defaultProgramDefinition();
  def.weeks[3].steps.find((s) => s.id === "human_design").kind = "confirmation";
  assert.ok(validateProgramDefinition(def).length);
  const removed = defaultProgramDefinition();
  removed.weeks[7].steps = removed.weeks[7].steps.filter(
    (s) => s.id !== "final_call",
  );
  assert.ok(validateProgramDefinition(removed).length);
});
test("moving tasks preserves ids, compacts source and follows configured first task", () => {
  const original = defaultProgramDefinition();
  const moved = moveProgramTask(original, 2, 0, 1, 0);
  assert.equal(moved.weeks[1].steps[0].id, "motivators");
  assert.equal(moved.weeks[2].steps[0].id, "undersupplied");
  assert.equal(original.weeks[2].steps[0].id, "motivators");
  assert.deepEqual(validateProgramDefinition(moved), []);
  const state = normalizeGuidedWeekState(
    2,
    configuredWeekState(2, createGuidedWeekState(2), {
      version: 1,
      definition: moved,
    }),
  );
  assert.equal(currentGuidedStep(state).id, "motivators");
  assert.equal(currentGuidedStep(createGuidedWeekState(2)).id, "education");
  const resumed = normalizeGuidedWeekState(
    2,
    structuredClone({
      ...state,
      updated_at: "2026-09-12",
      current_step: "education",
      completed_steps: ["motivators"],
    }),
  );
  assert.equal(currentGuidedStep(resumed).id, "education");
});
test("custom task methods validate answers, preserve corrections, and finish configured week", () => {
  const definition = {
    title: "Eigene Woche",
    steps: [
      {
        id: "choose",
        kind: "selection",
        options: ["A", "B", "C"],
        minItems: 1,
        maxItems: 2,
      },
      {
        id: "rank",
        kind: "priority_selection",
        options: ["X", "Y", "Z"],
        minItems: 2,
        maxItems: 2,
      },
      { id: "scale", kind: "scale", min: 0, max: 4 },
      { id: "confirm", kind: "confirmation", expected: "Ich bin bereit" },
      { id: "text", kind: "dialog", minItems: 2 },
    ].map((s) => ({
      ...s,
      title: s.id,
      question: "Deine eigene Frage?",
      gateKey: s.id,
    })),
  };
  let state = createGuidedWeekState(2, definition);
  assert.equal(
    applyGuidedWeekAction(state, { type: "save_answer", items: ["A"] }).ok,
    false,
  );
  state = applyGuidedWeekAction(state, {
    type: "save_clarity_checkin",
    score: 3,
    changed: false,
  }).state;
  assert.equal(
    applyGuidedWeekAction(state, { type: "save_answer", items: ["A", "A"] }).ok,
    false,
  );
  state = applyGuidedWeekAction(state, {
    type: "save_answer",
    items: ["A"],
  }).state;
  state = applyGuidedWeekAction(state, {
    type: "save_answer",
    items: ["Z", "X"],
  }).state;
  assert.equal(
    applyGuidedWeekAction(state, { type: "save_answer", score: 2.5 }).ok,
    false,
  );
  state = applyGuidedWeekAction(state, { type: "save_answer", score: 0 }).state;
  assert.equal(
    applyGuidedWeekAction(state, { type: "save_answer", answer: "Nein" }).ok,
    false,
  );
  state = applyGuidedWeekAction(state, {
    type: "save_answer",
    answer: "Ich bin bereit",
  }).state;
  state = applyGuidedWeekAction(state, {
    type: "save_answer",
    answer: "Erster Punkt;Zweiter Punkt",
  }).state;
  assert.equal(guidedWeekComplete(state), true);
  const corrected = applyGuidedWeekAction(state, {
    type: "correct_answer",
    stepId: "rank",
    items: ["Y", "Z"],
  });
  assert.equal(corrected.ok, true);
  assert.equal(
    applyGuidedWeekAction(
      { ...corrected.state, status: "completed", completed_at: "2026-09-12" },
      { type: "correct_answer", stepId: "rank", items: ["X", "Y"] },
    ).ok,
    false,
  );
});
test("Clara receives edited prompts and rules after moving a task", () => {
  const def = moveProgramTask(defaultProgramDefinition(), 2, 0, 1, 0);
  def.weeks[1].steps[0].question = "Welche zwei Dinge bewegen dich?";
  def.weeks[1].steps[0].minItems = 2;
  def.weeks[1].steps[0].maxItems = 2;
  const version = { version: 2, definition: def };
  const state = createGuidedWeekState(2, definitionForWeek(def, 2));
  const context = buildClaraContext({
    week: 2,
    state,
    questionOverrides: processQuestionOverrides(version),
  });
  assert.equal(
    context.openTask.prompt.question,
    "Welche zwei Dinge bewegen dich?",
  );
  assert.match(context.openTask.prompt.completionCriteria, /Mindestens 2/);
});
test("invalid publication cannot call persistence", async () => {
  let status;
  const response = {
    setHeader() {},
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      return value;
    },
  };
  const result = await handleProgramBuilder(
    {
      method: "PATCH",
      body: { action: "publish", revision: 0, definition: {} },
    },
    response,
    { profile: { id: "admin" } },
    { url: "https://invalid.test", key: "test" },
  );
  assert.equal(status, 400);
  assert.ok(result.errors.length);
});

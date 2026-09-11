// Run from the project root with PLAYWRIGHT_MODULE pointing to playwright/index.mjs.
// Browser interactions use simulated API responses and never write customer data.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = process.cwd();
const { defaultProgramDefinition } = await import(
  pathToFileURL(path.join(root, "lib/program-builder.js"))
);
let draft = defaultProgramDefinition(),
  revision = 0,
  published = 0;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/clarity") {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        assert.equal(body.revision, revision);
        draft = body.definition;
        revision++;
        if (body.action === "publish") published++;
        await route.fulfill({ json: { revision, version: published } });
      } else
        await route.fulfill({
          json: { definition: draft, revision, versions: [] },
        });
      return;
    }
    if (url.pathname === "/admin.js") {
      await route.fulfill({ body: "", contentType: "text/javascript" });
      return;
    }
    if (url.hostname !== "builder.test") {
      await route.abort();
      return;
    }
    try {
      const file = path.join(root, url.pathname);
      await route.fulfill({
        body: await readFile(file),
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".html")
              ? "text/html"
              : undefined,
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await page.goto("https://builder.test/admin.html");
  await page.evaluate(() => {
    document
      .querySelectorAll(".view,.settings-panel")
      .forEach((n) =>
        n.classList.toggle(
          "active",
          n.contains(document.querySelector("#programBuilder")),
        ),
      );
  });
  const builder = page.locator("#programBuilder");
  await builder.locator('[data-builder-week="2"]').waitFor();
  await builder.locator('[data-builder-week="2"]').click();
  await builder.locator("details").first().locator("summary").click();
  await builder
    .locator('[data-step="0"][data-field="title"]')
    .fill("Meine persönliche Rangfolge");
  await builder.locator('[data-task-move="0"]').selectOption("1");
  await builder.locator('[data-builder-week="1"]').click();
  assert.equal(
    await builder
      .locator("details")
      .last()
      .locator("summary strong")
      .textContent(),
    "Meine persönliche Rangfolge",
  );
  await builder.locator("#builderNewMethod").selectOption("selection");
  await builder.locator('[data-builder-action="add"]').click();
  await builder.locator('[data-builder-action="save"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-builder-status]").textContent ===
      "Entwurf gespeichert.",
  );
  assert.equal(draft.weeks[1].steps.at(-1).kind, "selection");
  await builder.locator('[data-builder-action="preview"]').click();
  assert.equal(await page.locator("#builderPreview").isVisible(), true);
  await page.locator("[data-close-preview]").click();
  await builder.locator('[data-builder-action="publish"]').click();
  await page.locator("#builderPublishConfirm").click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-builder-status]")
      .textContent.includes("Version 1 veröffentlicht"),
  );
  assert.equal(published, 1);
  assert.deepEqual(errors, []);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await builder.locator('[data-builder-action="publish"]').isVisible(),
    true,
  );
  console.log(
    "PASS: browser editor load, title edit, task move, new method, draft save, preview and publication; no JS errors.",
  );
} finally {
  await browser.close();
}

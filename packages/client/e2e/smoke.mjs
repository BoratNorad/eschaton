// Browser smoke test: build is served with `vite preview`, then a headless
// browser plays three hotseat turns. Fails on any console error, page error,
// fog leak, or broken step. Screenshots go to $SCREENSHOT_DIR (default e2e/out).
//
// Usage: npm run e2e  (from the repo root or packages/client)

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.SCREENSHOT_DIR ?? join(root, "e2e/out");
mkdirSync(outDir, { recursive: true });

const server = await preview({ root, preview: { port: 4173, strictPort: false }, logLevel: "error" });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });

const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));

const fail = (msg) => {
  throw new Error(msg);
};
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });

try {
  await page.goto(url);
  await page.getByLabel("Seed").fill("42");
  await page.getByTestId("new-game").click();

  for (let turn = 1; turn <= 3; turn++) {
    for (const nation of ["India", "Pakistan"]) {
      await page.getByTestId("cover").waitFor();
      const coverText = await page.getByTestId("cover").innerText();
      if (!coverText.includes(`Pass the device to ${nation}`)) fail(`turn ${turn}: expected cover for ${nation}, got: ${coverText}`);
      if (/Pervez|Atal|Musharraf|Vajpayee/.test(coverText)) fail("historical names shown while the setting is off");
      await page.getByTestId("take-seat").click();
      await page.getByTestId("map").locator("canvas").waitFor();
      await page.getByTestId("turn").filter({ hasText: `Turn ${turn} of` }).waitFor();

      // Fog: Pakistan must not see India's covert depot by name.
      if (nation === "Pakistan" && (await page.content()).includes("Undisclosed chemical depot")) fail("covert site leaked to Pakistan");

      // Stage two orders through the real pickers, then one that will be dropped by the budget.
      await page.getByLabel("Posture", { exact: true }).selectOption({ label: `Set alert level ${5 - turn}` });
      await page.getByRole("button", { name: "Add" }).first().click();
      const invest = page.getByLabel("Invest", { exact: true });
      await invest.selectOption({ label: "Invest 10 in domestic stability" });
      await invest.locator("xpath=following-sibling::button").click();
      await invest.selectOption({ label: "Invest 1 in missile defense" });
      await invest.locator("xpath=following-sibling::button").click();
      await page.getByTestId("staged").getByText("Will be dropped").waitFor();

      // Click a region and check the detail panel.
      const canvas = page.getByTestId("map").locator("canvas");
      const box = await canvas.boundingBox();
      await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });

      if (turn === 1) await shot(`turn1-${nation.toLowerCase()}`);
      await page.getByTestId("submit").click();
    }
  }
  await page.getByTestId("cover").waitFor();
  const cover4 = await page.getByTestId("cover").innerText();
  if (!cover4.includes("Turn 4 begins")) fail(`turn 4 did not begin: ${cover4}`);
  if (/Prime Minister Prime Minister/.test(cover4)) fail("leader title doubled");

  // The historical-names setting switches the leader shown on the cover.
  await page.getByLabel("Historical names").check();
  if (!(await page.getByTestId("cover").innerText()).includes("Atal Bihari Vajpayee")) fail("historical names toggle had no effect");
  await shot("turn4-cover");

  if (problems.length > 0) fail(problems.join("\n"));
  console.log(`e2e OK: 3 hotseat turns played. Screenshots in ${outDir}`);
} catch (e) {
  await shot("failure").catch(() => {});
  console.error(e instanceof Error ? e.message : e);
  if (problems.length > 0) console.error(problems.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.httpServer.close();
}

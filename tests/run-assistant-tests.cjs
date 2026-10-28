#!/usr/bin/env node
/*
 * Regression suite for the assistant.
 *
 * Every case in tests/assistant-cases.json is a short conversation typed
 * into the real page, in a headless browser, with "today" pinned so
 * relative dates read the same on any day. Each step checks the
 * assistant's last answer. This is what keeps an improvement from
 * breaking something that already worked: the nightly review adds a case
 * for every failure it fixes, and nothing is proposed unless all pass.
 *
 * Without an API key /api/chat answers 404 here, so the local
 * interpreter is what's tested. A step with "intent" stands in for Claude:
 * /api/chat returns that {funcao, argumentos, texto} once, which tests how
 * the page acts on a decision Claude could make. "expectContext" checks what
 * the page told Claude with that message, e.g. {"projetos[].codigo": [...]}.
 *
 * Run:   node tests/run-assistant-tests.cjs            all cases
 *        node tests/run-assistant-tests.cjs leave-en   cases whose id contains "leave-en"
 * Needs Playwright with Chromium (preinstalled in Claude Code cloud sessions).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { console.error("Playwright is required: npm i -D playwright && npx playwright install chromium"); process.exit(2); }

const ROOT = path.resolve(__dirname, "..");
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "assistant-cases.json"), "utf8"));
const TODAY = SPEC.today || "20261028";
const filter = process.argv[2] || "";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let u = decodeURIComponent(req.url.split("?")[0]);
      if (u === "/") u = "/index.html";
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const BOT = "#jlog .jmsg.bot:not(#jtypingBubble)";
async function lastBot(page) {
  return page.$$eval(BOT, (els) => (els.length ? els[els.length - 1].innerText.replace(/\s+/g, " ").trim() : ""));
}
async function waitReply(page, before) {
  await page.waitForFunction(
    ([sel, n]) => document.querySelectorAll(sel).length > n && !document.getElementById("jtypingBubble"),
    [BOT, before], { timeout: 8000 });
  await page.waitForTimeout(120);
}
/* "projetos[].codigo" reads one field from every item of a list; anything
   else is a dotted path into the context the page sent with the message. */
function pick(obj, p) {
  const m = p.match(/^(\w+)\[\]\.(\w+)$/);
  if (m) return ((obj || {})[m[1]] || []).map((x) => x[m[2]]);
  return p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
function check(text, step, context) {
  const low = text.toLowerCase();
  const missing = (step.expect || []).filter((s) => !low.includes(String(s).toLowerCase()));
  const present = (step.absent || []).filter((s) => low.includes(String(s).toLowerCase()));
  Object.keys(step.expectContext || {}).forEach((k) => {
    const got = JSON.stringify(pick(context, k)), want = JSON.stringify(step.expectContext[k]);
    if (got !== want) missing.push("context " + k + " = " + want + " (got " + got + ")");
  });
  return { ok: !missing.length && !present.length, missing, present };
}

async function runCase(browser, base, c) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript((lang) => { try { localStorage.setItem("vesiLang", lang); } catch (e) {} }, c.lang || "en");
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let pendingIntent = null, lastContext = null;
  await page.route("**/api/chat", (route) => {
    try { lastContext = JSON.parse(route.request().postData() || "{}").contexto || null; } catch (e) { lastContext = null; }
    if (!pendingIntent) return route.fulfill({ status: 404, body: "" });
    const body = JSON.stringify(pendingIntent);
    pendingIntent = null;
    return route.fulfill({ status: 200, contentType: "application/json", body });
  });
  /* company, profile and project manager go in the address, which skips
     the test setup window: role is "employee" (default), "pm" or "manager" */
  const setup = "&company=" + (c.company || "PT01") + "&profile=" + (c.role || "employee") + (c.leader ? "&leader=" + c.leader : "");
  await page.goto(base + "/index.html?today=" + TODAY + setup);
  await page.waitForSelector(BOT);

  const results = [];
  for (const step of c.steps) {
    let text;
    const before = await page.$$eval(BOT, (els) => els.length);
    if (step.confirm) {
      const btns = await page.$$("#jlog .jcard .acts button.primary");
      if (!btns.length) { results.push({ step: "confirm", ok: false, missing: ["a card to confirm"], present: [], text: await lastBot(page) }); break; }
      await btns[btns.length - 1].click();
      await waitReply(page, before);
      text = await lastBot(page);
      results.push(Object.assign({ step: "confirm", text }, check(text, step)));
      continue;
    }
    pendingIntent = step.intent || null;
    await page.fill("#jinput", step.say);
    await page.click("#jsend");
    try { await waitReply(page, before); }
    catch (e) { results.push({ step: step.say, ok: false, missing: ["a reply within 8 s"], present: [], text: await lastBot(page) }); break; }
    text = await lastBot(page);
    results.push(Object.assign({ step: step.say, text }, check(text, step, lastContext)));
  }
  await ctx.close();
  if (errors.length) results.push({ step: "page errors", ok: false, missing: [], present: errors, text: "" });
  return results;
}

(async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch();
  const cases = SPEC.cases.filter((c) => !filter || c.id.includes(filter));
  let failed = 0;
  for (const c of cases) {
    const res = await runCase(browser, base, c);
    const ok = res.every((r) => r.ok);
    if (!ok) failed++;
    console.log((ok ? "PASS " : "FAIL ") + c.id + (c.why ? "  (" + c.why + ")" : ""));
    if (!ok) res.filter((r) => !r.ok).forEach((r) => {
      console.log("     step:    " + r.step);
      if (r.missing.length) console.log("     missing: " + JSON.stringify(r.missing));
      if (r.present.length) console.log("     unwanted: " + JSON.stringify(r.present));
      console.log("     got:     " + r.text.slice(0, 400));
    });
  }
  await browser.close();
  srv.close();
  console.log("\n" + (cases.length - failed) + "/" + cases.length + " passed");
  process.exit(failed ? 1 : 0);
})();

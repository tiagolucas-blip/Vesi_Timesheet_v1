#!/usr/bin/env node
/*
 * Interface suite: every feature of the prototype, driven through the
 * screens in a headless browser.
 *
 * Same setup as the assistant's suite: a local server, Chromium through
 * Playwright, "today" pinned to 28/10/2026, and the company and profile in
 * the address so the test setup window is skipped (except in the cases
 * that test that window). Each case opens a fresh page, so nothing one
 * case does reaches another, and fails on any page or console error. The
 * last group visits every screen of every profile, in the three languages
 * and at desktop and phone width, and checks the page never scrolls
 * sideways.
 *
 * Run:   node tests/run-ui-tests.cjs              all cases
 *        node tests/run-ui-tests.cjs leave        cases whose id contains "leave"
 * Needs Playwright with Chromium (preinstalled in Claude Code cloud sessions).
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { console.error("Playwright is required: npm i -D playwright && npx playwright install chromium"); process.exit(2); }

const ROOT = path.resolve(__dirname, "..");
const TODAY = "20261028";
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

/* ---------- opening a page ---------- */
let browser, base;
/* every page a case opened, closed (and checked for errors) when it ends */
let LIVE = [];
/* company, profile and project manager in the address skip the setup
   window; profile null leaves it open. The web font is answered locally
   (empty) so nothing leaves the machine and a missing network never
   shows up as a console error. /api/chat answers 404 (local interpreter)
   unless a case hands it an intent, standing in for Claude. */
async function open(o) {
  o = Object.assign({ company: "PT01", profile: "employee", lang: "en", width: 1400 }, o || {});
  const ctx = await browser.newContext({ viewport: { width: o.width, height: 900 } });
  await ctx.addInitScript((lang) => { try { localStorage.setItem("vesiLang", lang); } catch (e) {} }, o.lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console error: " + m.text()); });
  page.intents = [];
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await ctx.route("**/api/chat", (r) => {
    const next = page.intents.shift();
    if (!next) return r.fulfill({ status: 404, body: "" });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(next) });
  });
  let q = "?today=" + TODAY + "&engine=local";
  if (o.profile) q += "&company=" + o.company + "&profile=" + o.profile + (o.leader ? "&leader=" + o.leader : "");
  await page.goto(base + "/index.html" + q);
  await page.waitForSelector(o.profile ? "#jlog .jmsg.bot" : "#dlgSetup[open]");
  page.errors = errors;
  page.close2 = () => ctx.close();
  LIVE.push(page);
  return page;
}
/* the project manager each company's cases use */
const PM = { PT01: "RN", PT02: "CP" };
function pmOpts(company, extra) { return Object.assign({ company, profile: "pm", leader: PM[company] }, extra || {}); }

/* ---------- small helpers ---------- */
class Fail extends Error {}
function ok(cond, msg) { if (!cond) throw new Fail(msg); }
function eq(got, want, msg) { if (got !== want) throw new Fail(msg + ": expected " + JSON.stringify(want) + ", got " + JSON.stringify(got)); }
function has(text, part, msg) { if (!String(text).includes(part)) throw new Fail(msg + ": expected to contain " + JSON.stringify(part) + ", got " + JSON.stringify(String(text).slice(0, 300))); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const txt = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, " ").trim());
const isHidden = (page, sel) => page.$eval(sel, (e) => e.hidden || e.offsetParent === null);
const isOpen = (page, id) => page.$eval("#" + id, (d) => d.open);
/* a text field that the app reads on "change" */
async function setVal(page, sel, v) {
  await page.fill(sel, v);
  await page.$eval(sel, (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(30);
}
/* the toasts shown since a mark, joined */
const toastMark = (page) => page.$$eval("#toasts .toast", (t) => t.length);
async function toastsSince(page, mark) {
  return page.$$eval("#toasts .toast", (t, n) => t.slice(n).map((x) => x.innerText.replace(/\s+/g, " ").trim()).join(" | "), mark);
}
/* clicks a toast's action button (Undo, Reopen) */
async function toastAction(page, label) {
  const b = page.locator("#toasts .toast button", { hasText: label }).last();
  await b.click();
  await sleep(50);
}
/* any screen, the way a person gets there: the area on top, then its tab */
const AREA = { semana: "ts", team: "ts", aprov: "ts", leave: "lv", teamcal: "lv", lvaprov: "lv" };
async function go(page, screen) {
  if (screen === "home") { await page.click("#tab-home"); await sleep(60); return; }
  if (screen === "cats") { await page.click("#settingsBtn"); await page.click("#openMapping"); await sleep(80); return; }
  await page.click("#area-" + AREA[screen]);
  if (!(await isHidden(page, "#navg-" + AREA[screen]))) await page.click("#tab-" + screen);
  await sleep(80);
  ok(!(await isHidden(page, "#screen-" + screen)), "screen " + screen + " should be showing");
}
const visibleScreen = (page) => page.$eval(".wrap", (w) => { const s = [...w.querySelectorAll(":scope > section")].filter((x) => !x.hidden)[0]; return s ? s.id.replace("screen-", "") : ""; });
/* the rows of the timesheet grid, each with its inputs' ids */
async function gridRows(page) {
  return page.$$eval("#tsgrid .row:not(.head):not(.totals):not(.monthsub)", (rows) => rows.map((r) => ({
    text: r.innerText.replace(/\s+/g, " ").trim(),
    name: (r.querySelector(".rowmeta .p span") || {}).textContent || "",
    tot: (r.querySelector(".rowtot") || {}).textContent || "",
    ids: [...r.querySelectorAll("input")].map((i) => i.id)
  })));
}
const dayTotals = (page) => page.$$eval("#tsgrid .row.totals .t", (c) => c.map((x) => x.textContent.trim()));
/* a duration cell of the monthly grid, by project name and day label ("Wed 28") */
const monthCell = (proj, day) => '#tsgrid input.cell[aria-label="Duration in hours, ' + proj + ", " + day + '"]';
const msgsText = (page) => page.$eval("#msgs", (e) => e.innerText.replace(/\s+/g, " "));
const lastBot = (page) => page.$$eval("#jlog .jmsg.bot:not(#jtypingBubble)", (els) => (els.length ? els[els.length - 1].innerText.replace(/\s+/g, " ").trim() : ""));
/* says something to the assistant and waits for the answer */
async function say(page, text, intent) {
  if (intent) page.intents.push(intent);
  const before = await page.$$eval("#jlog .jmsg.bot", (e) => e.length);
  await page.fill("#jinput", text);
  await page.click("#jsend");
  await page.waitForFunction((n) => !document.getElementById("jtypingBubble") && document.querySelectorAll("#jlog .jmsg.bot").length > n, before, { timeout: 8000 });
  await sleep(100);
  return lastBot(page);
}
async function confirmCard(page) {
  const btns = await page.$$("#jlog .jcard .acts button.primary");
  ok(btns.length, "a card to confirm");
  ok(!(await btns[btns.length - 1].isDisabled()), "an enabled confirm button");
  const before = await page.$$eval("#jlog .jmsg.bot", (e) => e.length);
  await btns[btns.length - 1].click();
  await page.waitForFunction((n) => document.querySelectorAll("#jlog .jmsg.bot").length > n, before, { timeout: 8000 });
  await sleep(100);
  return lastBot(page);
}

/* ---------- the cases ---------- */
const CASES = [];
function test(id, fn) { CASES.push({ id, fn }); }
/* the same case for each company */
function each(companies, id, fn) { companies.forEach((co) => test(id + "-" + co.toLowerCase(), (p) => fn(co, p))); }
const BOTH = ["PT01", "PT02"];

/* ============ 1. the test setup window, the Test button and the tabs ============ */

test("setup-window-opens-first", async () => {
  const page = await open({ profile: null });
  ok(await isOpen(page, "dlgSetup"), "the setup window is the first thing on screen");
    await page.click('#setupCo button[data-co="PT02"]');
    await page.click('#setupRoles .setupcard[data-role="pm"]');
    ok(!(await isHidden(page, "#setupLeaderWrap")), "picking project manager shows the project picker");
    const leaders = await page.$$eval("#setupLeader option", (o) => o.map((x) => x.value));
    eq(JSON.stringify(leaders), JSON.stringify(["CP", "MS"]), "PT02's project managers");
    await page.selectOption("#setupLeader", "MS");
    eq(await txt(page, "#setupWhoPm"), "Marco Silva", "the card names the project manager picked");
    await page.click("#setupGo");
    await sleep(100);
    ok(!(await isOpen(page, "dlgSetup")), "Start closes the window");
    eq(await txt(page, "#ctxTxt"), "PT02 · Project manager · Marco Silva", "the Test button says what is being tested");
});

test("setup-test-button-switches-profile", async () => {
  const page = await open({ company: "PT01", profile: "employee" });
  eq(await txt(page, "#ctxTxt"), "PT01 · Employee · Tiago Leal", "opened from the address");
  await page.click("#ctxBtn");
  ok(await isOpen(page, "dlgSetup"), "the Test button reopens the window");
  eq(await page.$eval('#setupRoles .setupcard[data-role="employee"]', (b) => b.getAttribute("aria-checked")), "true", "prefilled with the current test");
  await page.click('#setupRoles .setupcard[data-role="manager"]');
  await page.click("#setupGo");
  await sleep(100);
  eq(await txt(page, "#ctxTxt"), "PT01 · Line manager · Sofia Almeida", "now testing the line manager");
  ok(!(await isHidden(page, "#area-lv")), "the Leave Request area is there");
  await go(page, "lvaprov");
  /* back to the employee: their own conversation comes back */
  await page.click("#ctxBtn");
  await page.click('#setupRoles .setupcard[data-role="employee"]');
  await page.click("#setupGo");
  await sleep(100);
  eq(await txt(page, "#ctxTxt"), "PT01 · Employee · Tiago Leal", "back to the employee");
  eq(await visibleScreen(page), "home", "a screen the employee doesn't have sends them to the assistant");
});

test("setup-escape-keeps-defaults", async () => {
  const page = await open({ profile: null });
  await page.keyboard.press("Escape");
  await sleep(150);
  ok(!(await isOpen(page, "dlgSetup")), "Escape closes the window");
  has(await txt(page, "#ctxTxt"), "Tiago Leal", "and carries on with what's on screen");
});

const TABS = {
  employee: { ts: ["semana"], lv: ["leave", "teamcal"] },
  pm: { ts: ["semana", "team", "aprov"], lv: ["leave", "teamcal"] },
  manager: { ts: ["semana"], lv: ["leave", "teamcal", "lvaprov"] }
};
BOTH.forEach((co) => Object.keys(TABS).forEach((role) => {
  test("nav-two-levels-" + role + "-" + co.toLowerCase(), async () => {
    const page = await open(role === "pm" ? pmOpts(co) : { company: co, profile: role });
    for (const area of ["ts", "lv"]) {
      const tabs = await page.$$eval("#navg-" + area + " button[data-screen]", (b) => b.filter((x) => !x.hidden).map((x) => x.dataset.screen));
      eq(JSON.stringify(tabs), JSON.stringify(TABS[role][area]), role + " tabs in " + area);
      await page.click("#area-" + area);
      await sleep(60);
      eq(await isHidden(page, "#navg-" + area), tabs.length < 2, "second row of " + area + " shows only with more than one tab");
      eq(await page.$eval("#area-" + area, (b) => b.getAttribute("aria-current")), "true", "the area tab is current");
      const other = area === "ts" ? "lv" : "ts";
      ok(await isHidden(page, "#navg-" + other), "the other area's row is hidden");
    }
    /* each area opens on the tab last used in it */
    const lastTs = TABS[role].ts[TABS[role].ts.length - 1], lastLv = TABS[role].lv[TABS[role].lv.length - 1];
    await go(page, lastTs);
    await go(page, lastLv);
    await go(page, "home");
    await page.click("#area-ts"); await sleep(60);
    eq(await visibleScreen(page), lastTs, "Timesheet reopens on its last tab");
    await page.click("#area-lv"); await sleep(60);
    eq(await visibleScreen(page), lastLv, "Leave Request reopens on its last tab");
    /* the approval counters */
    const badge = (sel) => page.$eval(sel, (b) => { const n = b.querySelector(".navbadge"); return n && !n.hidden ? n.textContent : ""; });
    if (role === "pm") {
      const n = await badge("#tab-aprov");
      ok(+n > 0, "the Approval tab carries the count of timesheets to approve");
      eq(await badge("#area-ts"), n, "the Timesheet area repeats it");
      await go(page, "aprov");
      eq(await txt(page, "#apPend"), n, "the count matches the console");
    } else if (role === "manager") {
      const n = await badge("#tab-lvaprov");
      ok(+n > 0, "the Approval tab carries the count of leave requests");
      eq(await badge("#area-lv"), n, "the Leave Request area repeats it");
      await go(page, "lvaprov");
      eq(await txt(page, "#laPend"), n, "the count matches the console");
    } else {
      eq(await badge("#area-ts") + await badge("#area-lv"), "", "the employee has no counters");
    }
  });
}));

/* ============ 2. My entries ============ */

test("ts-week-navigation-pt02", async () => {
  const page = await open({ company: "PT02" });
  await go(page, "semana");
  eq(await txt(page, "#weekLabel"), "Week 44, 26 Oct to 1 Nov 2026", "opens on today's week");
  eq(await txt(page, "#submitBtn"), "Submit week", "PT02 submits by week");
  await page.click("#prevW"); await sleep(60);
  has(await txt(page, "#weekLabel"), "Week 43", "previous week");
  await page.click("#nextW"); await page.click("#nextW"); await sleep(60);
  has(await txt(page, "#weekLabel"), "Week 45", "next week");
  ok((await gridRows(page)).length === 0, "an upcoming week has an empty grid");
  /* the arrow keys move too */
  await page.click("#weekLabel");
  await page.keyboard.press("ArrowLeft"); await sleep(60);
  has(await txt(page, "#weekLabel"), "Week 44", "the left arrow goes back");
});

test("ts-month-navigation-pt01", async () => {
  const page = await open({ company: "PT01" });
  await go(page, "semana");
  eq(await txt(page, "#weekLabel"), "October 2026", "PT01 shows the month");
  eq(await txt(page, "#submitBtn"), "Submit month", "PT01 submits by month");
  ok(await isHidden(page, "#copyWeek"), "no copy previous week in the monthly view");
  const head = await page.$$eval("#tsgrid .row.head .dnum", (d) => d.map((x) => x.textContent));
  eq(head.length, 31, "every day of October");
  await page.click("#prevW"); await sleep(60);
  eq(await txt(page, "#weekLabel"), "September 2026", "previous month");
  eq(await page.$$eval("#tsgrid .row.head .dnum", (d) => d.length), 30, "every day of September");
  await page.click("#nextW"); await page.click("#nextW"); await sleep(60);
  eq(await txt(page, "#weekLabel"), "November 2026", "next month");
});

/* adds a row through the dialog and returns it */
async function addRowWith(page, desc) {
  const before = (await gridRows(page)).length;
  await page.click("#addRow");
  ok(await isOpen(page, "dlgDetail"), "Add row opens the entry dialog");
  const proj = await page.$eval("#dtProj", (s) => s.options[s.selectedIndex].textContent);
  await page.fill("#dtDesc", desc);
  await page.click("#dtSave");
  await sleep(80);
  ok(!(await isOpen(page, "dlgDetail")), "saving closes the dialog");
  const rows = await gridRows(page);
  eq(rows.length, before + 1, "one more row");
  const name = proj.split(" · ")[1];
  const row = rows.filter((r) => r.name === name)[0];
  ok(row, "the new row is for the project picked (" + name + ")");
  return row;
}

test("ts-add-row-hours-limit-pt02", async () => {
  const page = await open({ company: "PT02" });
  await go(page, "semana");
  const row = await addRowWith(page, "Chiller inspection on the roof");
  const id = row.ids[0].replace(/^c-(\d+)-.*$/, "$1");
  /* start and end, the duration is computed with the lunch hour out */
  await setVal(page, "#c-" + id + "-2", "09:00");
  await setVal(page, "#c-" + id + "-2-e", "13:00");
  const r1 = (await gridRows(page)).filter((r) => r.name === row.name)[0];
  has(r1.text, "3.0 h", "09:00 to 13:00 is 3 hours");
  eq((await dayTotals(page))[2], "3.0", "Wednesday's total");
  /* never past 8 hours a day */
  const m = await toastMark(page);
  await setVal(page, "#c-" + id + "-3", "07:00");
  await setVal(page, "#c-" + id + "-3-e", "18:00");
  has(await toastsSince(page, m), "8.0", "the toast names the daily limit");
  eq((await dayTotals(page))[3], "0.0", "Thursday stays empty");
  eq(await page.$eval("#c-" + id + "-3-e", (i) => i.value), "", "the end time that broke the limit isn't kept");
});

test("ts-add-row-hours-limit-pt01", async () => {
  const page = await open({ company: "PT01" });
  await go(page, "semana");
  const row = await addRowWith(page, "Internal training on SAP CATS");
  const cell = monthCell(row.name, "Wed 28");
  await setVal(page, cell, "1:30");
  eq(await page.$eval(cell, (i) => i.value), "1.5", "1:30 is read as 1.5 h");
  await setVal(page, cell, "90m");
  eq(await page.$eval(cell, (i) => i.value), "1.5", "90m is read as 1.5 h");
  /* Wednesday 28 has room for 8 h: 9 is refused */
  const m = await toastMark(page);
  await setVal(page, monthCell(row.name, "Thu 29"), "9");
  has(await toastsSince(page, m), "8.0", "the toast names the daily limit");
  eq(await page.$eval(monthCell(row.name, "Thu 29"), (i) => i.value), "", "the value that broke the limit isn't kept");
  /* a day already at 8 h takes nothing more */
  const m2 = await toastMark(page);
  await setVal(page, monthCell(row.name, "Mon 19"), "1");
  ok((await toastsSince(page, m2)).length > 0, "a full day refuses more hours");
  eq(await page.$eval(monthCell(row.name, "Mon 19"), (i) => i.value), "", "and keeps the cell empty");
});

each(BOTH, "ts-remove-row-and-undo", async (co) => {
  const page = await open({ company: co });
  await go(page, "semana");
  const rows0 = await gridRows(page);
  const name = rows0[0].name;
  await page.locator("#tsgrid .row", { hasText: name }).locator(".rowact button").click();
  await sleep(60);
  ok(!(await gridRows(page)).some((r) => r.name === name), "the line is removed");
  await toastAction(page, "Undo");
  ok((await gridRows(page)).some((r) => r.name === name), "Undo brings it back");
  await page.locator("#tsgrid .row", { hasText: name }).locator(".rowact button").click();
  await sleep(60);
  /* away and back: the removal holds */
  await page.click("#nextW"); await sleep(60);
  await page.click("#prevW"); await sleep(60);
  ok(!(await gridRows(page)).some((r) => r.name === name), "still removed after moving away and back");
});

each(BOTH, "ts-description-required", async (co) => {
  const page = await open({ company: co });
  await go(page, "semana");
  ok(!(await page.$eval("#submitBtn", (b) => b.disabled)), "the sample can be submitted");
  const row = await addRowWith(page, "short");
  if (co === "PT01") await setVal(page, monthCell(row.name, "Wed 28"), "2");
  else {
    const id = row.ids[0].replace(/^c-(\d+)-.*$/, "$1");
    await setVal(page, "#c-" + id + "-2", "09:00");
    await setVal(page, "#c-" + id + "-2-e", "12:00");
  }
  has(await msgsText(page), "description", "a line with hours and a short description is an error");
  ok(await page.$eval("#submitBtn", (b) => b.disabled), "and blocks submission");
  /* a description of 10 characters clears it */
  if (co === "PT01") await setVal(page, '#tsgrid input.monthdesc[aria-label="Description, ' + row.name + '"]', "Ten chars!");
  else {
    await page.locator("#tsgrid .row .rowmeta", { hasText: row.name }).click();
    ok(await isOpen(page, "dlgDetail"), "the line opens its details");
    await page.fill("#dtDesc", "Ten chars!");
    await page.click("#dtSave");
    await sleep(80);
  }
  ok(!(await msgsText(page)).includes("needs a description"), "the error is gone");
  ok(!(await page.$eval("#submitBtn", (b) => b.disabled)), "submission is possible again");
});

each(BOTH, "ts-quick-add", async (co) => {
  const page = await open({ company: co });
  await go(page, "semana");
  const code = co === "PT01" ? "BNK" : "HSP";
  const totalsBefore = await page.$eval(co === "PT01" ? "#kTot" : "#kTot", (e) => e.textContent);
  await page.click("#quickBtn");
  ok(await isOpen(page, "dlgQuick"), "Quick add opens");
  await page.fill("#nlq", "2h " + code + " regression testing of the interface");
  await sleep(50);
  const chips = await txt(page, "#nlChips");
  has(chips, "2.0 h", "the duration is read");
  ok(!(await page.$eval("#nlSave", (b) => b.disabled)), "a complete sentence can be saved");
  const m = await toastMark(page);
  await page.click("#nlSave");
  await sleep(80);
  has(await toastsSince(page, m), "2.0", "the toast confirms the hours");
  ok((await page.$eval("#kTot", (e) => e.textContent)) !== totalsBefore, "the total moved");
  /* a project with no line yet needs a description first */
  await page.click("#quickBtn");
  await page.fill("#nlq", co === "PT01" ? "1h AXI" : "1h AER");
  await sleep(50);
  ok(await page.$eval("#nlSave", (b) => b.disabled), "no description, no save");
  /* and never past the daily limit: Wednesday has 2 h, 7 more is too many */
  await page.fill("#nlq", "7h " + code + " regression testing of the interface");
  await sleep(50);
  const m2 = await toastMark(page);
  await page.click("#nlSave");
  await sleep(80);
  ok(await isOpen(page, "dlgQuick"), "the dialog stays open when the hours don't fit");
  has(await toastsSince(page, m2), "8.0", "the toast names the daily limit");
});

each(BOTH, "ts-allowances-and-km", async (co) => {
  const page = await open({ company: co });
  await go(page, "semana");
  const count0 = await txt(page, "#allowCount");
  /* the panel starts collapsed when the week has no allowances */
  if (await isHidden(page, "#allowAdd")) await page.click("#allowHead");
  /* domestic per diem on Tuesday */
  await page.click("#allowAdd");
  ok(await isOpen(page, "dlgAllow"), "Add allowance opens");
  await page.selectOption("#alCode", "AJC_NAC");
  await page.selectOption("#alDay", "1");
  await page.fill("#alQty", "1");
  await page.click("#alSave");
  await sleep(80);
  has(await txt(page, "#allowList"), "Domestic per diem", "the per diem is listed");
  ok((await txt(page, "#allowCount")) !== count0, "the count moved");
  /* kilometres need the destination: the dialog stays open without it */
  await page.click("#allowAdd");
  await page.selectOption("#alCode", "KMS");
  await sleep(30);
  ok(!(await isHidden(page, "#alRouteWrap")), "kilometres ask for the route");
  ok((await page.$eval("#alFrom", (i) => i.value)).length > 0, "the trip starts at the office");
  const m = await toastMark(page);
  await page.click("#alSave");
  await sleep(80);
  ok((await toastsSince(page, m)).length > 0, "a toast says the route is missing");
  ok(await isOpen(page, "dlgAllow"), "the dialog stays open to fill it in");
  await page.fill("#alTo", co === "PT01" ? "Porto" : "Braga");
  await page.$eval("#alTo", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(30);
  has(await txt(page, "#alRouteInfo"), "km", "the road distance is worked out");
  const km = await page.$eval("#alQty", (i) => i.value);
  ok(+km > 0, "and goes into the quantity");
  await page.check("#alRound");
  await sleep(30);
  eq(await page.$eval("#alQty", (i) => i.value), String(+km * 2), "round trip doubles it");
  await page.click("#alSave");
  await sleep(80);
  ok(!(await isOpen(page, "dlgAllow")), "recorded");
  has(await txt(page, "#allowList"), "Own-car kilometres", "the kilometres are listed");
  has(await txt(page, "#allowList"), String(+km * 2), "with the distance");
  /* foreign per diem without the country blocks submission */
  await page.click("#allowAdd");
  await page.selectOption("#alCode", "AJC_INT");
  await page.fill("#alNote", "");
  await page.click("#alSave");
  await sleep(80);
  has(await msgsText(page), "Foreign per diem", "the missing country is an error");
  ok(await page.$eval("#submitBtn", (b) => b.disabled), "and blocks submission");
  /* removing it gives submission back */
  await page.locator("#allowList .abscard", { hasText: "Foreign per diem" }).locator("button").click();
  await sleep(60);
  ok(!(await page.$eval("#submitBtn", (b) => b.disabled)), "removing it unblocks submission");
});

each(BOTH, "ts-suggestions-within-limit", async (co) => {
  const page = await open({ company: co });
  await go(page, "semana");
  const sugs0 = await page.$$eval("#sugs .sug, #sugs > div", (s) => s.length);
  ok(sugs0 > 0, "there are suggestions to review");
  /* fill Wednesday to 7 h first, then accept the 2.5 h suggestion for it */
  if (co === "PT01") await setVal(page, monthCell("Banking, Payroll and ECP", "Wed 28"), "7");
  else {
    const row = (await gridRows(page))[0];
    const id = row.ids[0].replace(/^c-(\d+)-.*$/, "$1");
    await setVal(page, "#c-" + id + "-2", "08:00");
    await setVal(page, "#c-" + id + "-2-e", "16:00");
  }
  eq((await dayTotals(page))[co === "PT01" ? 27 : 2], "7.0", "Wednesday at 7 h");
  const m = await toastMark(page);
  await page.locator("#sugs > *", { hasText: "Wed 28" }).locator("button", { hasText: "Accept" }).click();
  await sleep(80);
  has(await toastsSince(page, m), "1.0", "the suggestion is trimmed to what fits");
  eq((await dayTotals(page))[co === "PT01" ? 27 : 2], "8.0", "Wednesday stops at 8 h");
  ok(!(await txt(page, "#sugs")).includes("Wed 28"), "the accepted suggestion leaves the list");
  has(await msgsText(page), "1 suggestion still to review", "and the validation messages count one left");
});

each(BOTH, "ts-accept-high-confidence", async (co) => {
  const page = await open({ company: co });
  await go(page, "semana");
  const before = await txt(page, "#kTot");
  ok(!(await page.$eval("#acceptHi", (b) => b.disabled)), "there are high confidence suggestions");
  const m = await toastMark(page);
  await page.click("#acceptHi");
  await sleep(60);
  ok((await toastsSince(page, m)).length > 0, "the toast sums up what was applied");
  ok((await txt(page, "#kTot")) !== before, "the hours went in");
  ok(await page.$eval("#acceptHi", (b) => b.disabled), "none left to accept");
  const totals = (await dayTotals(page)).slice(0, -1);
  ok(totals.every((v) => v === "–" || parseFloat(v) <= 8), "no day past 8 hours: " + totals.join(" "));
});

test("ts-copy-previous-week-pt02", async () => {
  const page = await open({ company: "PT02" });
  await go(page, "semana");
  await page.click("#nextW"); await sleep(60);
  ok((await gridRows(page)).length === 0, "next week starts empty");
  const m = await toastMark(page);
  await page.click("#copyWeek");
  await sleep(80);
  ok((await gridRows(page)).length > 0, "copy brings the previous week's lines");
  ok((await toastsSince(page, m)).length > 0, "and says how many");
  const rows = await gridRows(page);
  eq(rows.map((r) => r.tot).join(","), rows.map(() => "–").join(","), "the lines come without hours");
});

test("ts-submit-week-and-reopen-pt02", async () => {
  const page = await open({ company: "PT02" });
  await go(page, "semana");
  await page.click("#submitBtn");
  ok(await isOpen(page, "dlgSubmit"), "Submit opens the summary");
  has(await txt(page, "#subTitle"), "44", "for week 44");
  has(await txt(page, "#subBody"), "Hospital campus", "with the project lines");
  await page.click("#subOk");
  await sleep(80);
  eq(await txt(page, "#submitBtn"), "Week submitted", "the week is submitted");
  ok(await page.$eval("#addRow", (b) => b.disabled) || (await page.$$eval("#tsgrid input", (i) => i.every((x) => x.disabled))), "and locked");
  await toastAction(page, "Reopen");
  eq(await txt(page, "#submitBtn"), "Submit week", "Reopen gives the week back");
  ok(await page.$$eval("#tsgrid input", (i) => i.some((x) => !x.disabled)), "editable again");
});

test("ts-submit-month-and-reopen-pt01", async () => {
  const page = await open({ company: "PT01" });
  await go(page, "semana");
  await page.click("#submitBtn");
  ok(await isOpen(page, "dlgSubmit"), "Submit opens the summary");
  has(await txt(page, "#subTitle"), "October", "for the month");
  has(await txt(page, "#subBody"), "Banking, Payroll and ECP", "with the project lines");
  const m = await toastMark(page);
  await page.click("#subOk");
  await sleep(80);
  has(await toastsSince(page, m), "weeks submitted", "every open week of the month goes");
  eq(await txt(page, "#submitBtn"), "Month submitted", "the month is submitted");
  ok(await page.$$eval("#tsgrid input.cell", (i) => i.every((x) => x.disabled)), "every cell is locked");
  await toastAction(page, "Reopen");
  eq(await txt(page, "#submitBtn"), "Submit month", "Reopen gives the month back");
  ok(await page.$$eval("#tsgrid input.cell", (i) => i.some((x) => !x.disabled)), "editable again");
});

test("ts-save-button", async () => {
  const page = await open({ company: "PT02" });
  await go(page, "semana");
  const m = await toastMark(page);
  await page.click("#saveBtn");
  await sleep(60);
  ok((await toastsSince(page, m)).length > 0, "Save confirms");
});

test("ts-calendar-view-pt02", async () => {
  const page = await open({ company: "PT02" });
  await go(page, "semana");
  await page.click("#vCal");
  await sleep(60);
  ok(!(await isHidden(page, "#viewCal")), "the calendar view shows");
  ok(await isHidden(page, "#viewGrid"), "instead of the grid");
  has(await txt(page, "#cal"), "HSP-FAC", "with the week's blocks");
  await page.click("#vGrid");
  ok(!(await isHidden(page, "#viewGrid")), "and back to the grid");
});

/* ============ 3. Team entry, the project manager ============ */

each(BOTH, "team-entry-hours-and-save", async (co) => {
  const page = await open(pmOpts(co));
  await go(page, "team");
  const people = await page.$$eval("#teamGrid .row:not(.head)", (r) => r.map((x) => x.querySelector(".rowmeta .p span").textContent));
  ok(people.length >= 5, "the project team is listed");
  /* the first person on the list, Thursday, which has room for 2 more hours */
  if (co === "PT01") await page.fill("#mDur", "2");
  else { await page.fill("#mBeg", "09:00"); await page.fill("#mEnd", "12:00"); }
  for (const d of [0, 1, 2, 4, 5, 6]) await page.uncheck('.mHoursDays input[value="' + d + '"]');
  await page.check('.mHoursDays input[value="3"]');
  await page.locator("#teamGrid .row:not(.head) input[type=checkbox]:not(:disabled)").first().check();
  await sleep(40);
  has(await txt(page, "#mSel"), "1", "one person selected");
  const m = await toastMark(page);
  await page.click("#mApply");
  await sleep(80);
  ok((await toastsSince(page, m)).length > 0, "Apply says what it filled");
  const staged = await txt(page, "#mStaged");
  ok(/[1-9]/.test(staged), "hours are staged: " + staged);
  ok(!(await page.$eval("#mSave", (b) => b.disabled)), "and can be saved");
  /* a manual cell over the person's capacity is refused */
  if (co === "PT01") {
    const cell = (await page.$$("#teamGrid .row:not(.head) input.cell:not(:disabled)"))[0];
    const m2 = await toastMark(page);
    await cell.fill("12");
    await cell.dispatchEvent("change");
    await sleep(60);
    ok((await toastsSince(page, m2)).length > 0, "more than the day's capacity is refused");
  }
  const logBefore = await txt(page, "#massLogCount");
  await page.click("#mSave");
  await sleep(80);
  ok((await txt(page, "#massLogCount")) !== logBefore, "the save lands in the log");
  eq(await txt(page, "#teamStateChip"), "Save to finish", "and asks for the final save");
  await page.click("#teamSaveAll");
  await sleep(80);
  eq(await txt(page, "#teamStateChip"), "Up to date", "the header Save writes it");
});

each(BOTH, "team-entry-week-navigation", async (co) => {
  const page = await open(pmOpts(co));
  await go(page, "team");
  has(await txt(page, "#weekLabel2"), "Week 44", "Team opens on this week");
  await page.click("#prevW2"); await sleep(60);
  has(await txt(page, "#weekLabel2"), "Week 43", "its own arrows go back a week");
  await page.click("#nextW2"); await page.click("#nextW2"); await sleep(60);
  has(await txt(page, "#weekLabel2"), "Week 45", "and forward");
  ok(await page.$$eval("#teamGrid .row:not(.head)", (r) => r.length >= 5), "the team stays on screen");
});

each(BOTH, "team-entry-allowances", async (co) => {
  const page = await open(pmOpts(co));
  await go(page, "team");
  await page.click("#ttAllow");
  await sleep(40);
  ok(!(await isHidden(page, "#teamAllowPanel")), "the allowances tab");
  await page.locator("#teamGrid .row:not(.head) input[type=checkbox]:not(:disabled)").first().check();
  await page.selectOption("#mAllowCode", "AJC_NAC");
  await page.fill("#mAllowQty", "1");
  await page.check('.mAllowDays input[value="1"]');
  await page.click("#mAllowApply");
  await sleep(60);
  ok(!(await page.$eval("#mAllowSave", (b) => b.disabled)), "a staged allowance can be saved");
  has(await txt(page, "#mAllowList"), "wage type 1200", "and is listed");
  const m = await toastMark(page);
  await page.click("#mAllowSave");
  await sleep(80);
  ok((await toastsSince(page, m)).length > 0, "saved");
  /* the bonus belongs to the project owner */
  await page.click("#ttBonus");
  await sleep(40);
  ok(!(await isHidden(page, "#bonusPanel")), "the bonus tab");
});

each(BOTH, "team-fill-missing-from-assistant", async (co) => {
  const page = await open(pmOpts(co));
  const answer = await say(page, "fill in the team's missing hours", { funcao: "preencher_horas_em_falta_equipa", argumentos: {}, texto: "" });
  ok(/\+\d/.test(answer), "the assistant proposes the gaps per person: " + answer.slice(0, 200));
  await confirmCard(page);
  await go(page, "team");
  ok((await txt(page, "#massLog")).length > 0, "the entries are in the team's log");
  eq(await txt(page, "#teamStateChip"), "Up to date", "what the assistant records is saved when confirmed");
});

each(BOTH, "team-entry-bonus", async (co) => {
  const page = await open(pmOpts(co));
  await go(page, "team");
  await page.click("#ttBonus");
  await page.fill("#bAmount", "150");
  await page.fill("#bNote", "Go-live weekend support");
  const m = await toastMark(page);
  await page.click("#bSave");
  await sleep(60);
  ok((await toastsSince(page, m)).length > 0, "without anyone selected it says so");
  ok(!(await txt(page, "#bonusList")).includes("150.0 EUR"), "and records nothing");
  await page.locator("#teamGrid .row:not(.head) input[type=checkbox]:not(:disabled)").first().check();
  await page.fill("#bAmount", "150");
  await page.fill("#bNote", "Go-live weekend support");
  const m2 = await toastMark(page);
  await page.click("#bSave");
  await sleep(60);
  has(await toastsSince(page, m2), "150.0 EUR", "the bonus is recorded and approved in the same act");
  has(await txt(page, "#bonusList"), "150.0 EUR", "and listed with its amount");
});

/* ============ 4. timesheet approval console ============ */

each(BOTH, "ts-approval-console", async (co) => {
  const page = await open(pmOpts(co));
  await go(page, "aprov");
  has((await txt(page, "#apWeekLabel")).toLowerCase(), co === "PT01" ? "october 2026" : "week 43", co === "PT01" ? "PT01 approves by month" : "PT02 approves by week");
  const pend = +(await txt(page, "#apPend"));
  const warn = +(await txt(page, "#apWarn"));
  ok(pend > 0, "there are timesheets to approve");
  const groups = await page.$$eval("#apBody tr.grouphead", (g) => g.map((x) => x.textContent));
  ok(groups.length >= 1, "grouped into no warnings and exceptions");
  /* exceptions can't be ticked */
  if (warn) ok(await page.$$eval("#apBody tr", (rows) => rows.some((r) => r.querySelector(".chip.amber") && r.querySelector("input:disabled"))), "an exception can't be selected for bulk approval");
  /* a line opens its detail: weeks of the month in PT01, days in PT02 */
  await page.locator("#apBody .apwho").first().click();
  await sleep(40);
  const detail = await txt(page, "#apBody tr.apdetail");
  if (co === "PT01") ok(/\d+\/\d+/.test(detail), "PT01's detail lists the weeks of the month: " + detail);
  else ok(/Mon|Tue|Wed/.test(detail), "PT02's detail lists the days: " + detail);
  /* select the clean ones and approve */
  await page.click("#apSelClean");
  await sleep(40);
  const sel = await txt(page, "#apSel");
  ok(/[1-9]/.test(sel), "the clean ones are selected: " + sel);
  const m = await toastMark(page);
  await page.click("#apApprove");
  await sleep(60);
  ok((await toastsSince(page, m)).length > 0, "approved");
  eq(+(await txt(page, "#apPend")), warn, "only the exceptions are left");
  /* "All" brings back the approved ones */
  await page.click('#apFilter button[data-f="all"]');
  await sleep(40);
  ok(await page.$$eval("#apBody .chip.green", (c) => c.length > 0), "All shows the approved ones");
  await page.click('#apFilter button[data-f="pending"]');
  await sleep(40);
  eq(await page.$$eval("#apBody .chip.green", (c) => c.length), 0, "To approve hides them again");
});

/* ============ 5. Leave Request ============ */

const ABS = [
  { code: "0100", name: "Vacation", attach: false, partial: true },
  { code: "0210", name: "Medical appointment", attach: true, partial: true },
  { code: "0200", name: "Sick leave", attach: true, partial: false },
  { code: "0300", name: "Training", attach: false, partial: true },
  { code: "0400", name: "Justified absence", attach: true, partial: true }
];
/* sends a request from the dialog; dates as DD/MM/YYYY */
async function newLeave(page, o) {
  await page.click("#lvNew");
  ok(await isOpen(page, "dlgLeave"), "New request opens the dialog");
  await page.selectOption("#lvType", o.code);
  await page.$eval("#lvType", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await page.fill("#lvStart", o.start);
  await page.$eval("#lvStart", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await page.fill("#lvEnd", o.end || o.start);
  await page.$eval("#lvEnd", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  if (o.partial) {
    await page.check("#lvPartial");
    await sleep(30);
  }
  if (o.file) await page.setInputFiles("#lvAtt", { name: o.file, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await sleep(40);
}
async function leaveRows(page) {
  return page.$$eval("#lvMineBody tr", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
}

each(BOTH, "leave-new-request-every-type", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  /* one week each in November and December, away from the sample's own requests */
  const days = ["16/11/2026", "17/11/2026", "18/11/2026", "19/11/2026", "20/11/2026"];
  for (let i = 0; i < ABS.length; i++) {
    const a = ABS[i];
    await newLeave(page, { code: a.code, start: days[i] });
    eq(await isHidden(page, "#lvAttWrap"), !a.attach, a.name + ": the attachment field shows only where the type has it");
    eq(await page.$eval("#lvPartial", (c) => c.disabled), !a.partial, a.name + ": part of a day only where the type allows it");
    if (a.attach) {
      ok(await page.$eval("#lvSubmit", (b) => b.disabled), a.name + ": without the attachment it can't be sent");
      has(await txt(page, "#lvMsgs"), "ttach", a.name + ": the message asks for the attachment");
      await page.setInputFiles("#lvAtt", { name: "proof-" + a.code + ".pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
      await sleep(40);
    }
    ok(!(await page.$eval("#lvSubmit", (b) => b.disabled)), a.name + ": can be sent");
    has(await txt(page, "#lvSummary"), "1 working day", a.name + ": the summary counts the day");
    const m = await toastMark(page);
    await page.click("#lvSubmit");
    await sleep(80);
    ok(!(await isOpen(page, "dlgLeave")), a.name + ": sent");
    has(await toastsSince(page, m), co === "PT01" ? "Sofia Almeida" : "Patrícia Gomes", a.name + ": the toast names the approver");
    const rows = await leaveRows(page);
    ok(rows.some((r) => r.includes(a.name) && r.includes(days[i].slice(0, 2) + " Nov")), a.name + ": listed under upcoming");
  }
});

/* who approves: the line manager for the employee and the project
   manager, one level up for the line manager's own leave */
const UP = { PT01: ["Sofia Almeida", "Henrique Vaz"], PT02: ["Patrícia Gomes", "Teresa Moura"] };
each(BOTH, "leave-approver-per-profile", async (co) => {
  for (const role of ["pm", "manager"]) {
    const page = await open(role === "pm" ? pmOpts(co) : { company: co, profile: role });
    await go(page, "leave");
    await newLeave(page, { code: "0300", start: "25/11/2026" });
    has(await txt(page, "#lvSummary"), UP[co][role === "pm" ? 0 : 1], role + ": the summary names the approver");
    const m = await toastMark(page);
    await page.click("#lvSubmit");
    await sleep(60);
    has(await toastsSince(page, m), UP[co][role === "pm" ? 0 : 1], role + ": sent to the approver");
  }
});

/* each profile's own timesheet carries its own absences, and only its own */
each(BOTH, "leave-own-timesheet-per-profile", async (co) => {
  const page = await open(pmOpts(co));
  await go(page, "leave");
  await newLeave(page, { code: "0300", start: "30/10/2026" });
  await page.click("#lvSubmit");
  await sleep(60);
  await go(page, "semana");
  const head = () => page.$eval("#tsgrid .row.head", (e) => e.textContent.toLowerCase());
  ok(/fri\s*30\s*pending/.test(await head()), "the project manager's request shows on their own timesheet");
  await switchTo(page, "employee");
  await go(page, "semana");
  ok(!/fri\s*30\s*pending/.test(await head()), "and not on the employee's");
  await switchTo(page, "manager");
  await go(page, "semana");
  ok(!/fri\s*30\s*pending/.test(await head()), "nor on the line manager's");
  await go(page, "lvaprov");
  has(await txt(page, "#laBody"), "30 Oct 2026", "but it waits in the line manager's approval");
});

each(BOTH, "leave-overlap-and-balance-errors", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  /* 3 December already has a pending vacation */
  await newLeave(page, { code: "0300", start: "03/12/2026" });
  has(await txt(page, "#lvMsgs"), "Overlaps your request", "an overlap with another request is an error");
  ok(await page.$eval("#lvSubmit", (b) => b.disabled), "and can't be sent");
  /* more vacation than the balance */
  await page.selectOption("#lvType", "0100");
  await page.fill("#lvStart", "04/01/2027");
  await page.fill("#lvEnd", "26/02/2027");
  await page.$eval("#lvEnd", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(40);
  has(await txt(page, "#lvMsgs"), "Not enough vacation balance", "more vacation than the balance is an error");
  ok(await page.$eval("#lvSubmit", (b) => b.disabled), "and can't be sent");
});

each(BOTH, "leave-manager-records-on-behalf", async (co) => {
  const page = await open({ company: co, profile: "manager" });
  await go(page, "leave");
  ok(!(await isHidden(page, "#lvBalPanel")), "the team's balances show for the line manager");
  const first = await page.$eval("#lvBalBody tr .who", (e) => e.textContent);
  await page.locator("#lvBalBody tr").first().locator("button").click();
  ok(await isOpen(page, "dlgLeave"), "Record absence opens the dialog");
  has(await txt(page, "#lvDlgTitle"), first, "for that report");
  await page.selectOption("#lvType", "0300");
  await page.fill("#lvStart", "02/12/2026");
  await page.fill("#lvEnd", "02/12/2026");
  await page.$eval("#lvEnd", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(30);
  has(await txt(page, "#lvSummary"), "Approved as it's recorded", "approved as it's recorded");
  const m = await toastMark(page);
  await page.click("#lvSubmit");
  await sleep(60);
  has(await toastsSince(page, m), first, "recorded for the report");
  /* it doesn't wait in the approval console */
  await go(page, "lvaprov");
  ok(!(await txt(page, "#laBody")).includes("2 Dec 2026"), "and doesn't wait for approval");
});

each(BOTH, "leave-dates-ddmmyyyy-and-part-day", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  await page.click("#lvNew");
  /* the dialog's dates are DD/MM/YYYY */
  ok(/^\d{2}\/\d{2}\/\d{4}$/.test(await page.$eval("#lvStart", (i) => i.value)), "the start date is DD/MM/YYYY");
  /* typed digits get their slashes */
  await page.fill("#lvStart", "");
  await page.type("#lvStart", "23112026");
  eq(await page.$eval("#lvStart", (i) => i.value), "23/11/2026", "slashes go in as the digits are typed");
  /* the end before the start is an error */
  await page.fill("#lvEnd", "20/11/2026");
  await page.$eval("#lvEnd", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(30);
  ok(await page.$eval("#lvSubmit", (b) => b.disabled), "the end before the start can't be sent");
  /* an impossible date isn't read */
  await page.fill("#lvEnd", "31/11/2026");
  await page.$eval("#lvEnd", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(30);
  ok(await page.$eval("#lvSubmit", (b) => b.disabled), "31/11 is not a date");
  /* part of a day follows the company: hours in PT01, start and end in PT02 */
  await page.fill("#lvEnd", "23/11/2026");
  await page.check("#lvPartial");
  await sleep(30);
  if (co === "PT01") {
    ok(!(await isHidden(page, "#lvHoursWrap")) && (await isHidden(page, "#lvClockWrap")), "PT01 asks for the hours");
    await page.fill("#lvHours", "3");
    await page.$eval("#lvHours", (e) => e.dispatchEvent(new Event("input", { bubbles: true })));
    await sleep(30);
    has(await txt(page, "#lvSummary"), "3.0 h", "3 hours");
  } else {
    ok(!(await isHidden(page, "#lvClockWrap")) && (await isHidden(page, "#lvHoursWrap")), "PT02 asks for start and end");
    await page.fill("#lvBeg", "14:00");
    await page.fill("#lvFin", "17:00");
    await page.$eval("#lvFin", (e) => e.dispatchEvent(new Event("input", { bubbles: true })));
    await sleep(30);
    has(await txt(page, "#lvSummary"), "3.0 h", "14:00 to 17:00 is 3 hours");
  }
  ok(await page.$eval("#lvEnd", (i) => i.disabled), "part of a day is one day");
  await page.click("#lvSubmit");
  await sleep(80);
  const rows = await leaveRows(page);
  ok(rows.some((r) => r.includes("23/11/2026") || r.includes("23 Nov")), "the part-day request is listed: " + rows.join(" / "));
});

each(BOTH, "leave-balance-and-movements", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  const big = await txt(page, "#lvAccBody .accbig");
  ok(/\d/.test(big), "the vacation balance shows");
  eq(await page.$eval("#lvAsOf", (i) => i.value), "28/10/2026", "as of today, DD/MM/YYYY");
  /* balance on a date: after the pending vacation it's lower */
  await page.fill("#lvAsOf", "31/12/2026");
  await page.$eval("#lvAsOf", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(40);
  eq(await page.$eval("#lvAsOf", (i) => i.value), "31/12/2026", "the date sticks");
  has(await txt(page, "#lvAccBody"), "31", "the line says which date");
  const atEnd = parseFloat(await txt(page, "#lvAccBody .accbig"));
  ok(atEnd <= parseFloat(big), "the balance at the end of the year is not above today's (" + atEnd + " vs " + big + ")");
  /* the movements */
  await page.click("#lvMovements");
  ok(await isOpen(page, "dlgAccount"), "the movements open");
  const mv = await txt(page, "#acBody");
  has(mv.toLowerCase(), "entitlement", "starting with the entitlement");
  ok(/Vacation/.test(mv), "with the vacation requests");
  await page.keyboard.press("Escape");
});

each(BOTH, "leave-calendar-two-clicks", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  eq(await txt(page, "#lvCalLabel"), "October 2026", "opens on the current month");
  await page.click("#lvCalNext");
  eq(await txt(page, "#lvCalLabel"), "November 2026", "next month");
  /* public holidays are marked */
  ok(await page.$$eval("#lvCal .lvday.hol", (d) => d.length > 0), "November has a public holiday");
  /* first and last day open a request for that period */
  const cell = (n) => page.locator("#lvCal .lvday:not(.out):not(.we):not(.hol)", { has: page.locator(".dn", { hasText: new RegExp("^" + n + "$") }) }).first();
  await cell(24).click();
  has(await txt(page, "#lvCalHint"), "24", "the first click picks the first day");
  await cell(26).click();
  ok(await isOpen(page, "dlgLeave"), "the second click opens the request");
  eq(await page.$eval("#lvStart", (i) => i.value), "24/11/2026", "from the first day");
  eq(await page.$eval("#lvEnd", (i) => i.value), "26/11/2026", "to the last");
  has(await txt(page, "#lvSummary"), "3 working days", "three working days");
  await page.click("#lvSubmit");
  await sleep(80);
  ok(await page.$$eval("#lvCal .lvbar.pending", (b) => b.length >= 3), "the request shows on the calendar as pending");
  /* the team's absences on demand */
  await page.click("#lvCalToday");
  await page.check("#lvShowTeam");
  await sleep(40);
  ok(await page.$$eval("#lvCal .lvteam", (t) => t.length > 0), "the team's absences show on the calendar");
});

/* changes the test from the Test button, as a person would */
async function switchTo(page, role) {
  await page.click("#ctxBtn");
  await page.click('#setupRoles .setupcard[data-role="' + role + '"]');
  await page.click("#setupGo");
  await sleep(100);
}
/* the line manager approves (or rejects) the employee's request for a period */
async function decideAsManager(page, when, approve, reason) {
  await switchTo(page, "manager");
  await go(page, "lvaprov");
  const who = page.locator("#laBody tr", { hasText: "Tiago Leal" }).filter({ hasText: when }).locator(".apwho").first();
  if ((await who.getAttribute("aria-expanded")) !== "true") await who.click();
  await sleep(40);
  await page.locator("#laBody tr.apdetail button", { hasText: approve ? "Approve" : "Reject" }).first().click();
  if (!approve) {
    await page.fill("#rjReason", reason);
    await page.$eval("#rjReason", (e) => e.dispatchEvent(new Event("input", { bubbles: true })));
    await page.click("#rjOk");
  }
  await sleep(60);
  await switchTo(page, "employee");
}

each(BOTH, "leave-withdraw-and-cancel", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  /* a pending request is withdrawn at once */
  await newLeave(page, { code: "0300", start: "09/12/2026" });
  await page.click("#lvSubmit");
  await sleep(60);
  await page.locator("#lvMineBody tr", { hasText: "9 Dec 2026" }).locator("button", { hasText: "Withdraw" }).click();
  await sleep(60);
  ok(!(await leaveRows(page)).some((r) => r.includes("9 Dec 2026")), "withdrawn, it leaves the upcoming list");
  await page.click('#lvFilter button[data-f="history"]');
  ok((await leaveRows(page)).some((r) => r.includes("9 Dec 2026") && r.includes("Withdrawn")), "and shows in the history as withdrawn");
  await page.click('#lvFilter button[data-f="upcoming"]');
  /* an approved one: cancelling it is a request back to the manager */
  await newLeave(page, { code: "0300", start: "10/12/2026" });
  await page.click("#lvSubmit");
  await sleep(60);
  await decideAsManager(page, "10 Dec 2026", true);
  await go(page, "leave");
  const row = () => page.locator("#lvMineBody tr", { hasText: "10 Dec 2026" });
  has(await row().innerText(), "Approved", "the manager's approval reached the employee");
  await row().locator("button", { hasText: "Request cancellation" }).click();
  await sleep(60);
  has(await row().innerText(), "Cancellation pending", "the cancellation waits for the manager");
  await decideAsManager(page, "10 Dec 2026", true);
  await go(page, "leave");
  ok(!(await leaveRows(page)).some((r) => r.includes("10 Dec 2026")), "the approved cancellation takes it off the upcoming list");
  await page.click('#lvFilter button[data-f="history"]');
  ok((await leaveRows(page)).some((r) => r.includes("10 Dec 2026") && r.includes("Withdrawn")), "and leaves it in the history");
});

each(BOTH, "leave-edit-pending-request", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  await newLeave(page, { code: "0100", start: "14/12/2026", end: "15/12/2026" });
  await page.click("#lvSubmit");
  await sleep(60);
  const row = page.locator("#lvMineBody tr", { hasText: "Dec" }).filter({ hasText: "Vacation" }).last();
  await row.locator("button", { hasText: "Edit" }).click();
  ok(await isOpen(page, "dlgLeave"), "Edit opens the request");
  eq(await page.$eval("#lvStart", (i) => i.value), "14/12/2026", "with its dates");
  await page.fill("#lvEnd", "16/12/2026");
  await page.$eval("#lvEnd", (e) => e.dispatchEvent(new Event("change", { bubbles: true })));
  await sleep(30);
  has(await txt(page, "#lvSummary"), "3 working days", "the change is counted");
  await page.click("#lvSubmit");
  await sleep(60);
  ok((await leaveRows(page)).some((r) => r.includes("16 Dec") || r.includes("16/12")), "the request carries the new end");
});

each(BOTH, "leave-team-calendar", async (co) => {
  for (const role of ["employee", "manager"]) {
    const page = await open({ company: co, profile: role });
    try {
      await go(page, "teamcal");
      ok(await page.$$eval("#lvTcList > *", (l) => l.length > 0), role + ": people are listed");
      for (const v of ["day", "week", "month"]) {
        await page.click('#lvTcView button[data-v="' + v + '"]');
        await sleep(40);
        eq(await page.$eval('#lvTcView button[data-v="' + v + '"]', (b) => b.getAttribute("aria-pressed")), "true", role + ": " + v + " view");
      }
      const label = await txt(page, "#lvTcLabel");
      await page.click("#lvTcNext");
      ok((await txt(page, "#lvTcLabel")) !== label, role + ": the arrows move the period");
      await page.click("#lvTcToday");
      /* only who's absent */
      const all = await page.$$eval("#lvTcList > *", (l) => l.length);
      await page.check("#lvTcAbsent");
      await sleep(40);
      ok((await page.$$eval("#lvTcList > *", (l) => l.length)) <= all, role + ": Absent keeps only who's off");
      await page.uncheck("#lvTcAbsent");
      /* a colleague's health related absence shows only as Absent, except to the manager */
      if (role === "employee") ok(!(await txt(page, "#lvTcGrid")).includes("Sick leave"), "the employee doesn't see a colleague's sick leave");
      await page.click("#lvTcFull");
      await sleep(40);
      await page.keyboard.press("Escape");
    } finally {
      if (page.errors.length) throw new Fail(role + ": " + page.errors.join(" | "));
    }
  }
});

each(BOTH, "leave-approval-console", async (co) => {
  const page = await open({ company: co, profile: "manager" });
  await go(page, "lvaprov");
  const pend = +(await txt(page, "#laPend"));
  const warn = +(await txt(page, "#laWarn"));
  ok(pend > 0, "requests are waiting");
  ok(warn > 0, "some with warnings");
  if (warn) ok(await page.$$eval("#laBody tr", (rows) => rows.some((r) => r.querySelector(".chip.amber") && r.querySelector("input:disabled"))), "an exception can't be bulk approved");
  /* reject one with a reason: the reason is required */
  await page.locator("#laBody .apwho").first().click();
  await sleep(40);
  await page.locator("#laBody tr.apdetail button", { hasText: "Reject" }).first().click();
  ok(await isOpen(page, "dlgReject"), "Reject asks for the reason");
  ok(await page.$eval("#rjOk", (b) => b.disabled), "not without a reason");
  await page.fill("#rjReason", "The team is short that week");
  await page.$eval("#rjReason", (e) => e.dispatchEvent(new Event("input", { bubbles: true })));
  const m = await toastMark(page);
  await page.click("#rjOk");
  await sleep(60);
  has(await toastsSince(page, m), "rejected", "rejected");
  eq(+(await txt(page, "#laPend")), pend - 1, "one less waiting");
  /* approve the clean ones together */
  const clean = pend - 1 - warn;
  if (clean > 0) {
    await page.click("#laSelClean");
    await sleep(30);
    await page.click("#laApprove");
    await sleep(60);
    eq(+(await txt(page, "#laPend")), warn, "only the exceptions are left");
  }
  /* approve an exception one by one */
  await page.locator("#laBody .apwho").first().click();
  await sleep(40);
  await page.locator("#laBody tr.apdetail button", { hasText: "Approve" }).first().click();
  await sleep(60);
  ok(+(await txt(page, "#laPend")) < warn || warn === 0, "an exception approved on its own");
  /* "All" brings back what was decided */
  await page.click('#laFilter button[data-f="all"]');
  await sleep(40);
  const all = await txt(page, "#laBody");
  has(all, "Approved", "All shows the approved ones");
  has(all, "Rejected", "and the rejected one");
});

/* what the employee sends reaches the line manager, the decision comes
   back, and the timesheet follows: pending, then approved */
each(BOTH, "leave-flow-reaches-timesheet", async (co) => {
  const page = await open({ company: co });
  await go(page, "leave");
  /* Friday 30 October, this week: a vacation day, then a training day the manager rejects */
  await newLeave(page, { code: "0100", start: "30/10/2026" });
  await page.click("#lvSubmit");
  await sleep(60);
  await newLeave(page, { code: "0300", start: "29/10/2026" });
  await page.click("#lvSubmit");
  await sleep(60);
  await go(page, "semana");
  const head = () => page.$eval("#tsgrid .row.head", (e) => e.textContent.toLowerCase());
  ok(/fri\s*30\s*pending/.test(await head()), "the timesheet shows the pending request on Friday");
  ok(/thu\s*29\s*pending/.test(await head()), "and on Thursday");
  await decideAsManager(page, "30 Oct 2026", true);
  await decideAsManager(page, "29 Oct 2026", false, "Training moved to next month");
  await go(page, "semana");
  ok(/fri\s*30\s*vacation/.test(await head()), "the approved vacation closes Friday");
  ok(!/thu\s*29\s*pending/.test(await head()), "the rejected request leaves Thursday");
  if (co === "PT01") {
    ok(await page.$eval(monthCell("Banking, Payroll and ECP", "Fri 30"), (i) => i.disabled), "Friday's cells are closed to time entry");
    ok(!(await page.$eval(monthCell("Banking, Payroll and ECP", "Thu 29"), (i) => i.disabled)), "Thursday stays open");
  } else {
    const row = (await gridRows(page))[0];
    const id = row.ids[0].replace(/^c-(\d+)-.*$/, "$1");
    ok(await page.$eval("#c-" + id + "-4", (i) => i.disabled), "Friday's cells are closed to time entry");
    ok(!(await page.$eval("#c-" + id + "-3", (i) => i.disabled)), "Thursday stays open");
  }
  await go(page, "leave");
  await page.click('#lvFilter button[data-f="all"]');
  const rows = await leaveRows(page);
  ok(rows.some((r) => r.includes("30 Oct 2026") && r.includes("Approved")), "the vacation reads approved");
  ok(rows.some((r) => r.includes("29 Oct 2026") && r.includes("Rejected") && r.includes("Training moved")), "the training reads rejected, with the reason");
});

/* ============ 6. Settings ============ */

test("settings-language-and-mapping", async () => {
  const page = await open({ company: "PT01" });
  await go(page, "leave");
  await page.click("#settingsBtn");
  ok(await isOpen(page, "dlgSettings"), "Settings opens");
  await page.click("#langPT");
  await sleep(80);
  eq(await page.$eval("#area-lv span[data-i18n]", (e) => e.textContent), "Ausências", "the screens switch to Portuguese");
  eq(await page.$eval("html", (e) => e.lang), "pt", "and the page says so");
  await page.click("#settingsBtn");
  await page.click("#langFR");
  await sleep(80);
  eq(await page.$eval("#area-ts span[data-i18n]", (e) => e.textContent), "Feuille de temps", "and to French");
  await page.click("#settingsBtn");
  await page.click("#langEN");
  await sleep(80);
  eq(await page.$eval("#area-lv span[data-i18n]", (e) => e.textContent), "Leave Request", "and back to English");
  /* the SAP mapping, from Settings, with Back to where the person was */
  await go(page, "cats");
  ok(!(await isHidden(page, "#screen-cats")), "the SAP mapping opens");
  ok(await page.$$eval("#mapBody tr", (r) => r.length > 10), "with the field mapping");
  ok(await page.$$eval("#lrMapBody tr", (r) => r.length > 10), "and the Leave Request mapping");
  await page.click("#fPay");
  ok(!(await isHidden(page, "#catsPayload")), "the payload view");
  await page.click("#catsBack");
  await sleep(60);
  eq(await visibleScreen(page), "leave", "Back returns to where the person was");
});

test("settings-language-remembered", async () => {
  const page = await open({ company: "PT02", lang: "fr" });
  eq(await page.evaluate(() => localStorage.getItem("vesiLang")), "fr", "the language is kept");
  await page.click("#settingsBtn");
  eq(await page.$eval("#langFR", (b) => b.getAttribute("aria-pressed")), "true", "French is the one pressed");
});

/* ============ 7. every screen, three languages, two widths ============ */

/* English the screens used to show whatever the language: visible text,
   placeholders and tooltips of the screen on show */
const ENGLISH_ONLY = /^(Week \d+|start|end|Review \d+ suggestions?|duration to set|project to choose|activity to set)$|week already approved|\(period closed\)|staged, not saved|Read-only overview|Click an empty slot/;
async function untranslated(page) {
  return page.evaluate((src) => {
    const re = new RegExp(src), out = [];
    const shown = (e) => e && e.offsetParent !== null && !e.closest("#jlog, #screen-cats");
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) { const t = n.textContent.trim(); if (t && shown(n.parentElement) && re.test(t)) out.push(t); }
    document.querySelectorAll("[placeholder], [title]").forEach((e) => {
      if (!shown(e)) return;
      [e.getAttribute("placeholder"), e.getAttribute("title")].forEach((t) => { if (t && re.test(t)) out.push(t); });
    });
    return out;
  }, ENGLISH_ONLY.source);
}
const DIALOGS = [
  { screen: "semana", open: "#quickBtn" }, { screen: "semana", open: "#submitBtn" },
  { screen: "leave", open: "#lvNew" }, { screen: "leave", open: "#lvMovements" },
  { screen: "home", open: "#settingsBtn" }, { screen: "home", open: "#ctxBtn" }, { screen: "home", open: "#helpBtn" }
];
const SCREENS = {
  employee: ["home", "semana", "leave", "teamcal", "cats"],
  pm: ["home", "semana", "team", "aprov", "leave", "teamcal", "cats"],
  manager: ["home", "semana", "leave", "teamcal", "lvaprov", "cats"]
};
BOTH.forEach((co) => Object.keys(SCREENS).forEach((role) => ["en", "pt", "fr"].forEach((lang) => {
  test("layout-" + co.toLowerCase() + "-" + role + "-" + lang, async () => {
    const bad = [];
    for (const width of [1400, 390]) {
      const page = await open(role === "pm" ? pmOpts(co, { lang, width }) : { company: co, profile: role, lang, width });
      try {
        for (const s of SCREENS[role]) {
          await go(page, s);
          const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
          if (o.sw > o.cw) bad.push(s + " at " + width + " scrolls sideways (" + o.sw + " > " + o.cw + ")");
          if (lang !== "en" && width === 1400) {
            const english = await untranslated(page);
            if (english.length) bad.push(s + " shows English in " + lang + ": " + english.slice(0, 5).join(", "));
          }
          if (s === "cats") await page.click("#catsBack");
        }
        /* the dialogs fit the screen too */
        for (const d of DIALOGS) {
          await go(page, d.screen);
          if (await page.$eval(d.open, (b) => b.disabled)) continue;
          await page.click(d.open);
          await sleep(60);
          const r = await page.evaluate(() => { const x = [...document.querySelectorAll("dialog[open]")].pop(); if (!x) return null; const b = x.getBoundingClientRect(); return { l: b.left, r: b.right, sw: x.scrollWidth, cw: x.clientWidth, vw: window.innerWidth }; });
          if (!r) bad.push(d.open + " opens no dialog");
          else if (r.l < 0 || r.r > r.vw + 0.5 || r.sw > r.cw + 1) bad.push("the dialog from " + d.open + " doesn't fit at " + width);
          await page.keyboard.press("Escape");
          await sleep(60);
        }
        if (page.errors.length) bad.push("at " + width + ": " + page.errors.join(" | "));
      } finally { await page.close2(); }
    }
    ok(!bad.length, bad.join("; "));
  });
})));

/* ---------- running ---------- */
(async () => {
  const srv = await serve();
  base = "http://127.0.0.1:" + srv.address().port;
  browser = await chromium.launch();
  const cases = CASES.filter((c) => !filter || c.id.includes(filter));
  let failed = 0;
  const t0 = Date.now();
  for (const c of cases) {
    let err = null;
    LIVE = [];
    try { await c.fn(); }
    catch (e) { err = e instanceof Fail ? e.message : (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : String(e)); }
    const pageErrors = [].concat(...LIVE.map((p) => p.errors));
    if (!err && pageErrors.length) err = pageErrors.join(" | ");
    for (const p of LIVE) await p.close2().catch(() => {});
    if (err) failed++;
    console.log((err ? "FAIL " : "PASS ") + c.id);
    if (err) console.log("     " + err.slice(0, 600));
  }
  await browser.close();
  srv.close();
  console.log("\n" + (cases.length - failed) + "/" + cases.length + " passed in " + Math.round((Date.now() - t0) / 1000) + " s");
  process.exit(failed ? 1 : 0);
})();

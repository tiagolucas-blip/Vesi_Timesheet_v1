# Timesheet Fiori Prototype

Clickable prototype of project time recording, designed as a Fiori extension on SAP BTP, with recording read into CATS. Serves as a visual and functional reference for development and for client conversations.

Documents that accompany this repository:

- UX/UI Specification, 23 sections, from principles to acceptance criteria
- Annex A, mapping the interface to SAP concepts and CATSDB fields

## What the prototype does

Everything below works, with no server and no real data.

**The test setup comes first**
- A window opens before anything else: the company (PT01 Consulting, durations by month; PT02 Building Solutions, start and end by week) and the profile under test
- **Employee** (Tiago Leal) records their own time and requests absences: Assistant, My Timesheet, Leave Request
- **Project manager** (one of the company's project owners, picked in the same window) records for the project team and approves its timesheets, never their own: Assistant, Team, Approval
- **Line manager** (Sofia Almeida for PT01, Patrícia Gomes for PT02, from the org structure) approves absences: Assistant, Leave Request
- Each profile only sees its screens, and the assistant follows the same split: alerts, greeting and permissions (an employee asking to approve a timesheet is told who does it)
- The Test button in the header reopens the window at any time. Data stays across changes, so a request sent as the employee can be approved as the line manager in the same session
- `?company=PT02&profile=pm&leader=CP` in the address skips the window (profile `employee`, `pm` or `manager`), which is how the test suite opens each case

**The assistant is the way in**
- The app opens on the assistant: the conversation is the main area, and the week and the absences sit in a secondary column on the same screen, updated after every action
- From that column, the full timesheet and the Leave Request screen are one click away, for anyone who prefers to check or edit directly
- On every other screen the assistant goes back to being the floating panel (button or `J`), with the same conversation

**Leave Request, a mask over the standard**
- Request an absence from the assistant (`vacation 3 to 6 November`, `doctor tomorrow 14h to 17h`) or from the Leave Request screen: vacation, medical appointment, sick leave, training, justified absence, whole days or part of a day
- Part of a day follows the company's profile: hours for `Z_CONS`, start and end for `Z_BSRV`
- Checked while it's filled, not only on submit: overlap with another request, vacation balance, closed period, part-day rules
- The direct manager approves or rejects, one level, from the assistant or the screen, with the team's overlaps in view. A rejection needs a reason
- The manager gets the alerts: the assistant's greeting says what's waiting (leave requests and timesheets), and the Leave Request tab carries a counter
- The employee hears about the decision the next time they use the app
- Withdrawing a pending request is immediate; cancelling an approved one is itself a request, back to the manager
- The data follows the standard service's model (`HCMFAB_LEAVE_REQUEST_CR_SRV`, workflow `WS12300111`, `TASKPROCESSING`, `RPTARQPOST` to `IT2001`), and the mapping screen shows the field-by-field mapping and the payload of the last request sent

**Recording**
- Weekly grid with inline editing, accepts `1.5`, `1:30` and `90m`, rounded to 15 minutes
- Calendar view (7 days) with project blocks and external events to convert
- Quick add with natural language interpretation and correctable chips
- Copy previous week (pulls the real previous week's rows once one exists in the sample), apply template, favorites per project
- Week navigation (arrows or `←`/`→`) across a multi-week sample per company: PT01 (`Z_CONS`) spans weeks 32–44, PT02 (`Z_BSRV`) spans weeks 36–41, each range mixing posted weeks, one submitted and in approval, the current draft, and upcoming ones with an empty grid

**Absences, read from the leave request**
- Every request shows in the timesheet the moment it's sent, as pending; once approved it closes the day or reduces its capacity; rejected or withdrawn, it disappears. Nothing is entered twice
- An approved full-day absence closes that day to time entry, in both the grid and the calendar
- A partial absence reduces day capacity and the week's expected total
- A pending request raises a warning, doesn't block
- The `Simulate approval` button on a pending day approves the underlying request, and shows the conflict that arises when a request is approved after hours were already recorded, with assisted resolution
- Suggestions that fall on days with an approved absence aren't proposed

**Allowances against a project**
- Catalogue of wage types with unit and mandatory fields: domestic and foreign per diem, own-car kilometres, shift allowance, project bonus
- Recorded as quantity and unit, never as a value. Payroll does the valuation
- An allowance can exist on a day with no hours, for example kilometres for a Saturday trip
- Kilometres and foreign per diem block submission until origin and destination, or the country, is filled in
- The bonus is the exception: it carries an amount, it is not on the employee's screen, and only the project owner records it

**Entry mode by company, profile Z_CONS or Z_BSRV**
- The company comes from the employee's IT0001 and `ZTIME_COMPANY_CFG` maps it to a CATS data entry profile, read at the date of the entry
- `Z_CONS` records duration only. `Z_BSRV` records start and end, `BEGUZ` and `ENDUZ`, with the duration computed and never editable
- Overnight windows are allowed in `Z_BSRV` and the entry stays on the starting day
- Overlapping windows on the same day block submission
- The switch in the shellbar changes IT0001, which is the same as opening the sheet as someone assigned to the other company

**Team leader mass entry**
- Scope is by project ownership only, never by line hierarchy: each project has one owner, and mass entry shows everyone allocated to that project regardless of who they report to in IT0001/OM. Rui Tavares is the example, he works on both Pedro Alves's project (AER-WFM) and Ana Ferreira's (BNK-2026)
- Has its own week navigator (same arrows and `←`/`→`), so switching weeks doesn't mean leaving the screen
- A read-only grid shows what each person already has recorded this week, live as new hours are staged, so a day already at or past capacity is visible before saving anything on top of it
- Fill a project, a duration or a start and end time, and the days, select people, apply. Duration fills people on a duration profile (`Z_CONS`), start/end fills people on `Z_BSRV`, in the same click, since a team can mix both companies. Nothing is saved until the leader reviews the grid
- The save is partial on purpose: lines that fail keep their reason on screen, the rest are written
- Every line keeps `CREATED_BY` and `ON_BEHALF_OF`. There is no self-confirmation step
- Allowances can be mass entered too, staged as a list rather than a grid since each one is a single occurrence, not a per-day cell
- The project owner records and approves the bonus in the same act, on the same screen

**Period control**
- Monthly, per company. A closed period rejects entries and changes, in the personal sheet and in mass entry

**Conversational assistant, Joule pattern**
- Recording by conversation, checking the week's status, checking absences, copying the week, applying suggestions, submitting
- Requesting, checking and cancelling absences, and for the manager, seeing what's waiting and approving or rejecting leave requests
- The local interpreter reads leave requests in Portuguese, English and French: absence type, date ranges (`3 to 7 November`, `de 3 a 7 de novembro`, `du 3 au 7 novembre`, `03/11`), relative days, part-day windows
- Interpreted by Claude (`api/chat.js`, function calling), with the browser's regex interpreter as an automatic fallback when the key isn't configured or the call fails
- Never saves without explicit confirmation, and always shows the receiver object and activity type before saving
- Refuses days with an approved absence and proposes the next free day
- Entries created by the assistant are marked with origin `Joule`

**Validation and approval**
- Three severities: error blocks, warning doesn't block, info guides
- Summary per project and receiver object before submission
- Approval screen with bulk approval and exceptions singled out

**SAP mapping, in Settings**
- A technical reference rather than a working screen, so it has no tab: Settings opens it for any profile, and Back returns to where you were
- Field-by-field table, state chain through to transfer
- Live generation of CATS records from the filled week, as a table or as a payload
- Hours and allowances in the same record set: `CATSHOURS` with `BEGUZ` and `ENDUZ`, or `LGART` with `ANZHL`
- The bonus amount goes to `CATSAMOUNT`, a native CATSDB field (CURR 13,2), not a customer-field workaround. Whether the standard `CAT6` transfer already maps it to `IT2010 BETRG` still needs confirming with the client

## Structure

```
body.html            page content, single source of truth for the markup
styles.css           color and typography tokens, light and dark theme
app.js               all the logic, no external dependencies
api/_prompt.js       the assistant's functions and instructions, one source for Vercel and the Artifact
api/chat.js          optional serverless function, off by default
index.html           the complete document, what Vercel serves  (generated)
artifact.html        the same page without the shell or the company logo, published as an Artifact  (generated)
assistant-prompt.js  api/_prompt.js for the browser  (generated)
tools/build.py       generates the three files above
tests/               the assistant's regression suite
vercel.json          static site configuration
```

After editing `body.html` or `api/_prompt.js`, run:

```bash
python3 tools/build.py
```

## Running locally

The page needs no build and no dependencies:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

`python3 -m http.server` only serves static files, it doesn't run `api/chat.js`. In that mode the assistant always falls back to the local regex interpreter, which is enough to review the rest of the application. To test the Claude connection locally, run `vercel dev` (needs `@anthropic-ai/sdk` installed with `npm install` and `ANTHROPIC_API_KEY` in the environment).

## Publishing to Vercel

The project is mostly static, with a serverless function at `api/chat.js`. Import the repository into Vercel and accept the defaults, no framework preset, no build command, with the root as the output directory. `vercel.json` already carries that configuration. Set `ANTHROPIC_API_KEY` in the project's environment variables to enable the Claude-powered assistant.

## Learning loop

The mockup improves from being used. It is published as a private Artifact on claude.ai (https://claude.ai/artifact/RQ12tJoHg9FkVy4pKn1xH5), where:

- **Claude answers from the page itself**, on the viewer's own Claude account, with the same functions and instructions as `api/chat.js` (both read `api/_prompt.js`). No API key is needed there. If Claude is unavailable or declined, the local interpreter answers, as on Vercel
- **Every conversation is kept** in the Artifact's database, one document per visit under `conversations/`: what was typed, which engine read it, the function and arguments chosen, the answers, whether the card was confirmed or cancelled. The header shows `Learning mode` while this is on
- **Each answer has 👍/👎.** 👎 asks what the assistant should have done, which is the most useful line for the review
- **Every night (22:37, Lisbon)** a scheduled task reads the conversations since the last run, finds what went wrong, adds a case to `tests/assistant-cases.json` for each failure it fixes, corrects `app.js` or `api/_prompt.js`, runs the whole suite and opens a pull request (or adds to the one already open). Nothing reaches `main` without a merge
- **After a merge**, the next run republishes the Artifact from `main`. Progress is kept in the Artifact's `meta/improve` document

On Vercel or a local copy none of this is active: nothing is recorded and the page behaves as before.

Run the regression suite (needs Playwright with Chromium):

```bash
node tests/run-assistant-tests.cjs
```

## Data

There's no real data. Employee, projects, WBS, cost centers and absences are made up and live as constants at the top of `app.js`. No request leaves the browser, except what the assistant sends to `api/chat.js` when Claude is enabled (the typed text and the week's context described above). No data is stored, there are no cookies, and local storage only keeps the interface language. The exception is the Artifact on claude.ai, which keeps the assistant conversations described under Learning loop, with the same fictitious data.

## Known limits, by design

- Week navigation covers a fixed sample range per company (PT01: weeks 32–53, PT02: weeks 36–53), mixing posted, submitted, current-draft and upcoming weeks; the weeks after 44 (PT01) and 41 (PT02) are empty, there so a leave request for November or December lands somewhere the timesheet can show it
- Leave requests live in memory: they're gone on reload, like the hours. Public holidays aren't modelled, so a request counts Monday to Friday; in the system the factory calendar removes them
- The two companies' sample histories reuse the same request numbers, since it's the same employee opened under either company; every lookup is scoped to the company IT0001 currently reads
- The OData entity and field names on the mapping screen follow the standard HCM Fiori apps bundle service; confirm them against the client system's `$metadata` before development
- Whether the standard `CAT6` transfer maps `CATSAMOUNT` to `IT2010 BETRG` automatically, or needs configuring, is flagged as an open question in the payload, not solved
- Without `ANTHROPIC_API_KEY` configured, the natural-language interpreter is deterministic, based on regular expressions. It recognizes duration, day and project prefix, and nothing else. See the next section to connect Claude
- Each request to the assistant is independent, with no memory of the previous turn
- There's no authentication or profiles, the user is fixed

## Connecting Claude to the assistant

`api/chat.js` already calls Claude (`claude-opus-5`, function calling) to interpret free text. To enable it:

1. Set the `ANTHROPIC_API_KEY` environment variable on the Vercel project (Settings → Environment Variables)
2. Redeploy

Without the key, the function returns 501 and the client automatically falls back to the browser's regex interpreter, without breaking the demo.

The engine picks one of a closed set of functions, for hours (`registar_horas`, `consultar_semana`, `listar_ausencias`, `copiar_semana`, `aplicar_sugestoes`, `submeter_semana` and the team ones) and for leave (`pedir_ausencia`, `consultar_ausencias`, `cancelar_ausencia`, `listar_pendentes_aprovacao`, `decidir_ausencia`, `ir_para_ausencias`, `ver_como`), based on the context the client sends with every question: the projects the person is allocated to, the week's absences and capacity per day, the person's leave requests and balance, and for the manager the requests waiting. It never writes to the timesheet nor sends a request, it only returns the function and its arguments; saving, sending and confirmation stay on the client side, exactly as in the local interpreter.

## What's missing for the assistant to be real in an SAP production setting

The prototype demonstrates the interaction pattern, which is the part that needs validation with users. Connected to Claude, it already covers free-text interpretation, closed function calling and per-user grounding. To operationalize it for real in an SAP scenario, three pieces are missing:

1. **Authentication and identity propagation.** XSUAA or IAS with principal propagation through to the S/4HANA API, so that the write happens on the person's behalf and the audit trail is correct
2. **Conversation state.** Short-retention session storage, to keep context across turns without storing history indefinitely. Each request to `api/chat.js` is currently independent, with no memory of the previous turn
3. **Evaluation.** A set of test cases with real consultant phrasing, including hard cases, to measure accuracy before opening it up to users

In the SAP scenario, the standard path is to expose these functions as a Joule capability, with Joule Studio on SAP Build, instead of building a bespoke chat inside the application. The advantage is that the user gets a single assistant on the launchpad instead of one per application. This prototype imitates the interaction pattern, not the product.

## Notice

This prototype's assistant is called Assistant and is labeled `Joule pattern`. It is not SAP's Joule, doesn't use SAP's brand or services, and only serves to demonstrate the interaction pattern. When connected to Claude, it's Anthropic that processes the text sent to `api/chat.js`, within the context described above.

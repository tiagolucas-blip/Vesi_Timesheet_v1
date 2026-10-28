#!/usr/bin/env python3
"""Gera index.html (Vercel) e artifact.html (Claude Artifact) a partir de body.html,
e assistant-prompt.js (browser) a partir de api/_prompt.js.

body.html tem apenas o conteudo da pagina. O index.html e um documento completo.
O artifact.html nao leva doctype, head nem body, porque a plataforma de Artifacts
acrescenta esse esqueleto no momento da publicacao. Tambem nao leva o logotipo
da empresa: o Artifact e publicado no claude.ai, fora do ambiente da empresa.

api/_prompt.js e a unica fonte das funcoes e das instrucoes do assistente. O
Vercel importa-o como modulo; o browser recebe uma copia sem os "export", que
deixa o mesmo objeto em window.VESI_PROMPT.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
body = (ROOT / "body.html").read_text(encoding="utf-8").strip()
artifact_body = re.sub(r'\s*<img class="orglogo"[^>]*>', "", body, count=1)

prompt_src = (ROOT / "api" / "_prompt.js").read_text(encoding="utf-8")
prompt_js = ("/* Gerado por tools/build.py a partir de api/_prompt.js. Nao editar. */\n"
             "(function(){\n"
             + re.sub(r"^export ", "", prompt_src, flags=re.M)
             + "\nwindow.VESI_PROMPT = {FUNCTIONS: FUNCTIONS, IDIOMA_LABELS: IDIOMA_LABELS, buildSystemPrompt: buildSystemPrompt};\n"
             "})();\n")
(ROOT / "assistant-prompt.js").write_text(prompt_js, encoding="utf-8")

TITLE = "Timesheet Fiori Prototype"
# Frutiger LT Std is the corporate brand font, with Arial as the mandatory
# system fallback (variables.css); neither is a Google Fonts webfont, so
# there is nothing to load for them. IBM Plex Mono stays, for the tabular
# numeric columns (hours, employee IDs) the brand sheet doesn't cover.
FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=IBM+Plex+Mono:wght@400;500&display=swap">')

index = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{TITLE}</title>
<meta name="description" content="Project time-recording prototype, Fiori extension, with absences and a conversational assistant.">
{FONTS}
<link rel="stylesheet" href="styles.css">
<style>
  :root{{padding-top:env(safe-area-inset-top,0px); padding-bottom:env(safe-area-inset-bottom,0px); color-scheme:light}}
  body{{margin:0; font:14px/1.5 system-ui, sans-serif}}
  img{{max-width:100%}}
  [hidden]{{display:none !important}}
</style>
</head>
<body>
{body}
<script src="assistant-prompt.js"></script>
<script src="app.js"></script>
</body>
</html>
"""

artifact = f"""<title>{TITLE}</title>
{FONTS}
<link rel="stylesheet" href="styles.css">
{artifact_body}
<script src="assistant-prompt.js"></script>
<script src="app.js"></script>
"""

(ROOT / "index.html").write_text(index, encoding="utf-8")
(ROOT / "artifact.html").write_text(artifact, encoding="utf-8")
print("index.html, artifact.html e assistant-prompt.js gerados")

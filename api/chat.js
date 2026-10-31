/**
 * Função serverless que liga o assistente do protótipo ao Claude, via function calling.
 *
 * Desligada por omissão: sem ANTHROPIC_API_KEY, devolve 501 e o cliente cai
 * automaticamente no interpretador determinístico do browser.
 *
 * Princípios que esta função tem de respeitar:
 *   - nunca escreve na timesheet, apenas devolve a função escolhida e os argumentos
 *   - a confirmação do utilizador acontece no cliente, antes de qualquer escrita
 *   - nunca inventa projetos fora da lista dada no contexto
 *   - nunca envia um pedido de ausência nem decide uma aprovação: devolve a
 *     função, e o cartão de confirmação no cliente é que envia
 *   - nenhum dado de cliente vai no prompt além do contexto necessário à tarefa
 */

import Anthropic from "@anthropic-ai/sdk";
import { FUNCTIONS, IDIOMA_LABELS, buildSystemPrompt } from "./_prompt.js";

function toClaudeTools() {
  return FUNCTIONS.map((f) => ({
    name: f.name,
    description: f.description,
    input_schema: {
      type: "object",
      properties: f.parameters.properties,
      required: f.parameters.required || [],
      additionalProperties: false
    },
    strict: true
  }));
}

/* Trusts nothing from the client: keeps only well-formed {role, content}
   pairs, role restricted to user/assistant, content capped in length, and
   the whole list capped in size, before it goes anywhere near the prompt. */
function sanitizeHistorico(historico) {
  if (!Array.isArray(historico)) return [];
  return historico
    .filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string")
    .slice(-12)
    .map((h) => ({ role: h.role, content: h.content.slice(0, 600) }));
}

const MAX_MENSAGEM_LEN = 1000;
const MAX_CONTEXTO_LEN = 20000;

/* Best-effort only: this is a per-instance counter, so it doesn't coordinate
   across the several serverless instances Vercel can run concurrently, and
   it resets on every cold start. It still stops the cheap case, a script
   hammering one warm connection, at zero extra infrastructure. A real limit
   needs a shared store (Vercel KV/Upstash) and is out of scope here. */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
let rateLimitHits = [];
function rateLimited() {
  const now = Date.now();
  rateLimitHits = rateLimitHits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (rateLimitHits.length >= RATE_LIMIT_MAX) return true;
  rateLimitHits.push(now);
  return false;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(501).json({
      error: "assistente_nao_configurado",
      detalhe: "Defina ANTHROPIC_API_KEY nas variáveis de ambiente do projeto Vercel para ativar o Claude. Sem isso, o protótipo usa o interpretador determinístico do browser.",
      funcoes_disponiveis: FUNCTIONS.map((f) => f.name)
    });
    return;
  }
  if (rateLimited()) {
    res.status(429).json({
      error: "demasiados_pedidos",
      detalhe: "Demasiados pedidos num curto período. Tenta novamente dentro de um minuto."
    });
    return;
  }

  const { mensagem, contexto, historico, idioma } = req.body || {};
  const idiomaValido = Object.prototype.hasOwnProperty.call(IDIOMA_LABELS, idioma) ? idioma : "en";
  if (!mensagem || typeof mensagem !== "string") {
    res.status(400).json({ error: "mensagem em falta" });
    return;
  }
  if (mensagem.length > MAX_MENSAGEM_LEN) {
    res.status(400).json({
      error: "mensagem_demasiado_longa",
      detalhe: `A mensagem excede o limite de ${MAX_MENSAGEM_LEN} caracteres.`
    });
    return;
  }
  let contextoLen = 0;
  try {
    contextoLen = JSON.stringify(contexto || {}).length;
  } catch (e) {
    res.status(400).json({ error: "contexto_invalido" });
    return;
  }
  if (contextoLen > MAX_CONTEXTO_LEN) {
    res.status(400).json({
      error: "contexto_demasiado_grande",
      detalhe: `O contexto excede o limite de ${MAX_CONTEXTO_LEN} caracteres.`
    });
    return;
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      system: buildSystemPrompt(contexto, idiomaValido),
      tools: toClaudeTools(),
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      messages: [...sanitizeHistorico(historico), { role: "user", content: mensagem }]
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    const texto = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    res.status(200).json({
      funcao: toolUse ? toolUse.name : null,
      argumentos: toolUse ? toolUse.input : null,
      texto: texto || null
    });
  } catch (err) {
    console.error("assistente_falha_claude", {
      name: err && err.name,
      status: err && err.status,
      message: err && err.message
    });
    res.status(502).json({
      error: "falha_motor_linguagem",
      detalhe: "O assistente não respondeu. Os detalhes ficaram no registo do servidor."
    });
  }
}

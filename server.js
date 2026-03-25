import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  normalizeText as sharedNormalizeText,
  normalizeTime as sharedNormalizeTime,
  todayLocalISO as sharedTodayLocalISO,
} from './shared-utils.js';
import {
  createInstance,
  startReminders,
  getStatus,
  setPhoneNumber,
  setRemindersEnabled,
} from './whatsapp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '').trim();
const allowedCorsOrigins = CORS_ORIGIN
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
app.use(cors(
  allowedCorsOrigins.length > 0
    ? {
      origin(origin, callback) {
        if (!origin || allowedCorsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origem não permitida pelo CORS: ${origin}`));
      },
      credentials: true,
    }
    : undefined
));
app.use(express.json());

const API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const CHAT_MODEL = process.env.OPENAI_MODEL_CHAT || DEFAULT_MODEL || 'gpt-4o-mini';
const PARSER_MODEL = process.env.OPENAI_MODEL_PARSER || DEFAULT_MODEL || 'gpt-4o-mini';
const WHATSAPP_MODEL = process.env.OPENAI_MODEL_WHATSAPP || DEFAULT_MODEL || 'gpt-4o-mini';
const CHAT_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS_CHAT || 700);
const PARSER_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS_PARSER || 650);
const WHATSAPP_AGENT_MAX_TOKENS = Number(process.env.OPENAI_MAX_TOKENS_WHATSAPP || 420);
const WHATSAPP_CONTEXT_TASK_LIMIT = Number(process.env.WHATSAPP_CONTEXT_TASK_LIMIT || 10);
const APP_CHAT_HISTORY_LIMIT = Number(process.env.APP_CHAT_HISTORY_LIMIT || 5);
const APP_CHAT_MAX_CHARS_PER_MESSAGE = Number(process.env.APP_CHAT_MAX_CHARS_PER_MESSAGE || 650);
const OPENAI_CACHE_TTL_MS = Math.max(0, Number(process.env.OPENAI_CACHE_TTL_MS || 300000));
const OPENAI_CACHE_MAX_ITEMS = Math.max(50, Number(process.env.OPENAI_CACHE_MAX_ITEMS || 600));
const WHATSAPP_LLM_HISTORY_TURNS = Math.max(0, Number(process.env.WHATSAPP_LLM_HISTORY_TURNS || 1));
const WHATSAPP_LLM_HISTORY_TTL_MS = Math.max(60000, Number(process.env.WHATSAPP_LLM_HISTORY_TTL_MS || 900000));
const TRANSCRIBE_MODEL = process.env.OPENAI_MODEL_TRANSCRIBE || 'gpt-4o-mini-transcribe';
const TRANSCRIBE_RESPONSE_FORMAT = String(
  process.env.OPENAI_TRANSCRIBE_RESPONSE_FORMAT || 'json'
).trim().toLowerCase();
const WHATSAPP_TASK_REMINDER_MINUTES = Number(process.env.WHATSAPP_TASK_REMINDER_MINUTES || 60);
const WHATSAPP_REMINDER_AT_TIME_ENABLED = process.env.WHATSAPP_REMINDER_AT_TIME_ENABLED !== 'false';
const WHATSAPP_END_REPORT_HOUR = Number(process.env.WHATSAPP_END_REPORT_HOUR || 20);
const WHATSAPP_END_REPORT_MINUTE = Number(process.env.WHATSAPP_END_REPORT_MINUTE || 0);
const WHATSAPP_WEEKLY_COST_REPORT_ENABLED = process.env.WHATSAPP_WEEKLY_COST_REPORT_ENABLED !== 'false';
const WHATSAPP_WEEKLY_COST_REPORT_DAY = Number(process.env.WHATSAPP_WEEKLY_COST_REPORT_DAY || 1);
const WHATSAPP_WEEKLY_COST_REPORT_HOUR = Number(process.env.WHATSAPP_WEEKLY_COST_REPORT_HOUR || 9);
const WHATSAPP_WEEKLY_COST_REPORT_MINUTE = Number(process.env.WHATSAPP_WEEKLY_COST_REPORT_MINUTE || 0);
const WHATSAPP_AUDIO_CONFIRM_TTL_MINUTES = Number(process.env.WHATSAPP_AUDIO_CONFIRM_TTL_MINUTES || 20);
const WHATSAPP_AUDIO_CONFIRM_TTL_MS = WHATSAPP_AUDIO_CONFIRM_TTL_MINUTES * 60 * 1000;
const WHATSAPP_AUDIO_REQUIRE_CONFIRM = process.env.WHATSAPP_AUDIO_REQUIRE_CONFIRM === 'true';
const WHATSAPP_AUDIO_MAX_MB = Number.parseFloat(process.env.WHATSAPP_AUDIO_MAX_MB || '25') || 25;
const WHATSAPP_AUDIO_MAX_BYTES = WHATSAPP_AUDIO_MAX_MB * 1024 * 1024;
const WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME =
  normalizeTime(process.env.WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME || '10:00') || '10:00';
const OPENAI_PRICE_GPT4O_MINI_INPUT_PER_1M = Number(process.env.OPENAI_PRICE_GPT4O_MINI_INPUT_PER_1M || 0.15);
const OPENAI_PRICE_GPT4O_MINI_OUTPUT_PER_1M = Number(process.env.OPENAI_PRICE_GPT4O_MINI_OUTPUT_PER_1M || 0.6);
const OPENAI_PRICE_DEFAULT_INPUT_PER_1M = Number(process.env.OPENAI_PRICE_DEFAULT_INPUT_PER_1M || OPENAI_PRICE_GPT4O_MINI_INPUT_PER_1M);
const OPENAI_PRICE_DEFAULT_OUTPUT_PER_1M = Number(process.env.OPENAI_PRICE_DEFAULT_OUTPUT_PER_1M || OPENAI_PRICE_GPT4O_MINI_OUTPUT_PER_1M);
const OPENAI_PRICE_TRANSCRIBE_PER_MIN = Number(process.env.OPENAI_PRICE_TRANSCRIBE_PER_MIN || 0.003);
const WHATSAPP_REMINDER_OFFSETS_MINUTES = [
  WHATSAPP_TASK_REMINDER_MINUTES,
  ...(WHATSAPP_REMINDER_AT_TIME_ENABLED ? [0] : []),
].filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => b - a);
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);
const PORT = Number(process.env.PORT || 3001);
const ADMIN_TOKEN = String(process.env.SER_ADMIN_TOKEN || '').trim();
const REQUIRE_AUTH_READ = process.env.SER_REQUIRE_AUTH_FOR_READ === 'true';
const STORAGE_MODE_RAW = String(process.env.SER_STORAGE_MODE || 'auto').trim().toLowerCase();
const STORAGE_MODE = ['auto', 'supabase', 'file'].includes(STORAGE_MODE_RAW) ? STORAGE_MODE_RAW : 'auto';
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_TASKS_TABLE = String(process.env.SUPABASE_TASKS_TABLE || 'ser_tasks').trim();
const SUPABASE_USAGE_TABLE = String(process.env.SUPABASE_USAGE_TABLE || 'ser_usage_events').trim();
const SUPABASE_USAGE_MAX_ROWS = Number(process.env.SUPABASE_USAGE_MAX_ROWS || 12000);
const RAW_DATA_DIR = String(process.env.SER_DATA_DIR || '').trim();
const DATA_DIR = RAW_DATA_DIR
  ? (path.isAbsolute(RAW_DATA_DIR) ? RAW_DATA_DIR : path.join(__dirname, RAW_DATA_DIR))
  : path.join(__dirname, 'data');
const USE_SUPABASE_STORAGE =
  STORAGE_MODE === 'supabase' ||
  (STORAGE_MODE === 'auto' && Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY));
const IS_SUPABASE_STRICT = STORAGE_MODE === 'supabase';
if (STORAGE_MODE === 'supabase' && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error('SER_STORAGE_MODE=supabase exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY configurados.');
}

const AGENDA_FILE = path.join(DATA_DIR, 'agenda.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage-log.json');
const ALLOWED_FRENTES = new Set(['taka', 'haldan', 'pessoal']);
const FRENTES = Object.freeze({
  taka: 'Estúdio Taka',
  haldan: 'Haldan',
  pessoal: 'Pessoal',
});
const FRENTE_EMOJIS = Object.freeze({
  taka: '🦅',
  haldan: '🦎',
  pessoal: '🏌️',
});
const SELECTOR_STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'para', 'pra', 'pro', 'por', 'com', 'sem', 'que', 'me', 'mim',
  'seu', 'sua', 'meu', 'minha', 'senhor', 'senhora',
]);
const SELECTOR_NOISE_PHRASES = new Set([
  'chat',
  'sergio',
  'senhor',
  'senhora',
  'confirma',
  'confirme',
  'confirma pra mim',
  'pode',
  'por favor',
  'ok',
  'okay',
]);
const SELECTOR_LOW_SIGNAL_TOKENS = new Set([
  'tarefa',
  'tarefas',
  'item',
  'itens',
  'lembrete',
  'lembretes',
  'compromisso',
  'compromissos',
  'agenda',
  'agendar',
  'cliente',
  'projeto',
  'dra',
  'dr',
  'doutora',
  'doutor',
]);
const TASK_TYPES = new Set([
  'Reunião',
  'SEO',
  'WordPress',
  'Conteúdo',
  'Follow-up',
  'Proposta',
  'Gestão equipe',
  'Alimentação',
  'Esporte',
  'Casa',
  'Outro',
]);
const WEEKDAY_TO_INDEX = new Map([
  ['domingo', 0],
  ['segunda', 1],
  ['segunda feira', 1],
  ['segunda-feira', 1],
  ['terca', 2],
  ['terça', 2],
  ['terca feira', 2],
  ['terça feira', 2],
  ['terca-feira', 2],
  ['terça-feira', 2],
  ['quarta', 3],
  ['quarta feira', 3],
  ['quarta-feira', 3],
  ['quinta', 4],
  ['quinta feira', 4],
  ['quinta-feira', 4],
  ['sexta', 5],
  ['sexta feira', 5],
  ['sexta-feira', 5],
  ['sabado', 6],
  ['sábado', 6],
  ['sabado feira', 6],
  ['sábado feira', 6],
  ['sabado-feira', 6],
  ['sábado-feira', 6],
]);

const pendingAudioConfirmations = new Map();
let pendingDailyFollowupQueue = [];
const openaiResponseCache = new Map();
const whatsappConversationCache = new Map();
const pendingTitleClarificationBySender = new Map();
const pendingReminderBySender = new Map();
const supabase = USE_SUPABASE_STORAGE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;
let runtimeStorageBackend = USE_SUPABASE_STORAGE ? 'supabase' : 'file';
let supabaseTablesChecked = false;
let agendaWriteQueue = Promise.resolve();

function extractBearerToken(value = '') {
  const raw = String(value || '').trim();
  const match = raw.match(/^bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

function readRequestAuthToken(req = {}) {
  const direct = String(req.headers?.['x-ser-admin-token'] || '').trim();
  if (direct) return direct;
  return extractBearerToken(req.headers?.authorization || '');
}

function hasValidAdminToken(req = {}) {
  if (!ADMIN_TOKEN) return true;
  const incoming = readRequestAuthToken(req);
  return Boolean(incoming) && incoming === ADMIN_TOKEN;
}

function requireAdmin(req, res, next) {
  if (hasValidAdminToken(req)) return next();
  return res.status(401).json({ error: 'Não autorizado.' });
}

function requireReadAccess(req, res, next) {
  if (!REQUIRE_AUTH_READ) return next();
  return requireAdmin(req, res, next);
}

function withAgendaWriteLock(workFn) {
  const run = agendaWriteQueue.then(
    () => workFn(),
    () => workFn()
  );
  agendaWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function todayLocalISO() {
  return sharedTodayLocalISO();
}

function addDaysISO(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return sharedTodayLocalISO(d);
}

function normalizeText(value = '') {
  return sharedNormalizeText(value);
}

function normalizeDate(value) {
  if (typeof value !== 'string') return todayLocalISO();
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return todayLocalISO();
}

function normalizeTime(value) {
  return sharedNormalizeTime(value);
}

function inferFrenteFromText(text = '') {
  const lower = normalizeText(text);
  if (
    lower.includes('haldan') ||
    lower.includes('equipe') ||
    lower.includes('alinhamento interno') ||
    lower.includes('gerencia')
  ) {
    return 'haldan';
  }
  if (
    lower.includes('dr ') ||
    lower.includes('dra ') ||
    lower.includes('seo') ||
    lower.includes('conteudo') ||
    lower.includes('wordpress') ||
    lower.includes('proposta') ||
    lower.includes('cliente')
  ) {
    return 'taka';
  }
  if (
    lower.includes('treino') ||
    lower.includes('saude') ||
    lower.includes('casa') ||
    lower.includes('mari') ||
    lower.includes('bebe')
  ) {
    return 'pessoal';
  }
  return 'pessoal';
}

function inferTypeFromText(text = '') {
  const lower = normalizeText(text);
  if (lower.includes('reuniao') || lower.includes('meeting') || lower.includes('call')) return 'Reunião';
  if (lower.includes('seo')) return 'SEO';
  if (lower.includes('wordpress') || lower.includes('site')) return 'WordPress';
  if (lower.includes('conteudo') || lower.includes('copy') || lower.includes('post')) return 'Conteúdo';
  if (lower.includes('follow') || lower.includes('retorno')) return 'Follow-up';
  if (lower.includes('proposta') || lower.includes('orcamento')) return 'Proposta';
  if (lower.includes('equipe') || lower.includes('delegar') || lower.includes('gestao')) return 'Gestão equipe';
  if (lower.includes('comida') || lower.includes('almoco') || lower.includes('jantar')) return 'Alimentação';
  if (lower.includes('treino') || lower.includes('academia') || lower.includes('corrida')) return 'Esporte';
  if (lower.includes('casa') || lower.includes('limpar') || lower.includes('mercado')) return 'Casa';
  return 'Outro';
}

function sanitizeSteps(stepsInput = []) {
  if (!Array.isArray(stepsInput)) return [];
  return stepsInput
    .map((step) => ({
      text: String(step?.text || '').trim(),
      time: Number.isFinite(Number(step?.time)) ? Number(step.time) : 0,
      done: Boolean(step?.done),
    }))
    .filter((step) => step.text);
}

function normalizeTaskInput(task = {}, fallback = {}, options = {}) {
  const touch = options.touch !== false;
  const title = String(task.title || fallback.title || '').trim() || 'Tarefa sem título';
  const detail = task.detail !== undefined ? String(task.detail || '').trim() || null : fallback.detail || null;
  const sourceText = `${title} ${detail || ''}`;

  const frenteFromTask = task.frente ?? fallback.frente ?? inferFrenteFromText(sourceText);
  const frente = ALLOWED_FRENTES.has(frenteFromTask) ? frenteFromTask : inferFrenteFromText(sourceText);

  const typeFromTask = task.type ?? fallback.type ?? inferTypeFromText(sourceText);
  const type = TASK_TYPES.has(typeFromTask) ? typeFromTask : inferTypeFromText(sourceText);

  const stepsInput = task.steps !== undefined ? task.steps : fallback.steps || [];
  const steps = sanitizeSteps(stepsInput);
  const estimatedFromSteps = steps.reduce((sum, step) => sum + (step.time || 0), 0);
  const estimatedTimeRaw = task.estimatedTime ?? fallback.estimatedTime ?? (estimatedFromSteps || 30);
  const estimatedTime = Number.isFinite(Number(estimatedTimeRaw)) ? Math.max(5, Number(estimatedTimeRaw)) : 30;

  const createdAt = task.createdAt || fallback.createdAt || nowISO();
  const updatedAt = touch ? nowISO() : (task.updatedAt || fallback.updatedAt || createdAt);
  const completedAt =
    task.completedAt !== undefined ? task.completedAt : (fallback.completedAt !== undefined ? fallback.completedAt : null);
  const followUpDaily = Boolean(task.followUpDaily ?? fallback.followUpDaily ?? false);
  const followUpTimeRaw =
    task.followUpTime ?? fallback.followUpTime ?? (followUpDaily ? (task.startTime ?? fallback.startTime) : null);
  const followUpTime = followUpDaily
    ? (normalizeTime(followUpTimeRaw) || WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME)
    : null;
  const followUpClient = String(task.followUpClient ?? fallback.followUpClient ?? '').trim() || null;
  const followUpSubject = String(task.followUpSubject ?? fallback.followUpSubject ?? '').trim() || null;

  return {
    id: task.id || fallback.id || crypto.randomUUID(),
    title,
    detail,
    frente,
    type,
    date: normalizeDate(task.date ?? fallback.date ?? todayLocalISO()),
    startTime: normalizeTime(task.startTime ?? fallback.startTime ?? null),
    estimatedTime,
    steps,
    createdAt,
    updatedAt,
    completedAt: completedAt || null,
    followUpDaily,
    followUpTime,
    followUpClient,
    followUpSubject,
    source: task.source || fallback.source || 'app',
  };
}

function sortAgendaTasks(tasks = []) {
  return [...tasks].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const ta = a.startTime || '99:99';
    const tb = b.startTime || '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
  });
}

function taskTimestamp(task) {
  return new Date(task.updatedAt || task.completedAt || task.createdAt || 0).getTime();
}

function mergeTaskLists(localTasks = [], remoteTasks = []) {
  const map = new Map();
  const all = [...localTasks, ...remoteTasks];

  for (const rawTask of all) {
    const normalized = normalizeTaskInput(rawTask, {}, { touch: false });
    const current = map.get(normalized.id);
    if (!current || taskTimestamp(normalized) >= taskTimestamp(current)) {
      map.set(normalized.id, normalized);
    }
  }

  return sortAgendaTasks([...map.values()]);
}

function formatTaskLine(task) {
  const shortId = String(task.id).slice(0, 6);
  const time = task.startTime || '--:--';
  const followTag = task.followUpDaily ? `|FU:${task.followUpTime || '--:--'}` : '';
  return `${shortId}|${task.date}|${time}|${task.frente}|${task.type}${followTag}|${String(task.title || '').trim()}`;
}

function formatTaskChoiceLine(task = {}, index = 0) {
  const shortId = String(task.id || '').slice(0, 6);
  const time = task.startTime || '--:--';
  const title = String(task.title || 'Tarefa sem título').trim();
  const emoji = FRENTE_EMOJIS[task.frente] || '📌';
  const frenteLabel = FRENTES[task.frente] || 'Pessoal';

  let dateLabel = String(task.date || '--/--');
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateLabel)) {
      dateLabel = new Date(`${dateLabel}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    }
  } catch {
    // Mantém dateLabel como veio.
  }

  return `${index + 1}. (${shortId}) ${emoji} ${time} ${title} — ${frenteLabel} — ${dateLabel}`;
}

function buildMissingSelectorMessage(actionType = '') {
  const verbByAction = {
    update: 'alterar',
    append_step: 'adicionar subtarefa em',
    delete: 'excluir',
    complete: 'concluir',
  };
  const verb = verbByAction[actionType] || 'alterar';
  return [
    `⚠️ Não consegui identificar qual tarefa o senhor quer ${verb}.`,
    'Me envie o nome exato da tarefa ou o código curto dela (entre parênteses).',
    'Não apliquei nenhuma alteração por segurança.',
  ].join('\n\n');
}

function buildAmbiguousSelectorMessage(candidates = [], actionType = '') {
  const verbByAction = {
    update: 'alterar',
    append_step: 'receber a subtarefa',
    delete: 'excluir',
    complete: 'concluir',
  };
  const verb = verbByAction[actionType] || 'alterar';
  const options = (Array.isArray(candidates) ? candidates : []).slice(0, 3).map(formatTaskChoiceLine).join('\n');
  return [
    `⚠️ Encontrei mais de uma tarefa para ${verb}.`,
    'Me responda apenas com o código da tarefa (entre parênteses):',
    options || '- (sem opções disponíveis)',
    'Não apliquei nenhuma alteração por segurança.',
  ].join('\n\n');
}

function selectorFromAction(action = {}) {
  const selector = action?.selector || {};
  const task = action?.task || {};
  return {
    id: selector.id || task.id || '',
    title: selector.title || task.title || '',
    date: selector.date || task.date || null,
    startTime: selector.startTime || task.startTime || null,
  };
}

function trimTextForModel(value = '', maxChars = 1200) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const safeLimit = Math.max(80, Number(maxChars) || 1200);
  if (text.length <= safeLimit) return text;
  return `${text.slice(0, safeLimit - 1).trim()}…`;
}

function sanitizeMessagesForModel(messages = [], options = {}) {
  const maxMessages = Math.max(1, Number(options.maxMessages || APP_CHAT_HISTORY_LIMIT));
  const maxCharsPerMessage = Math.max(80, Number(options.maxCharsPerMessage || 1200));
  const raw = Array.isArray(messages) ? messages : [];
  return raw
    .slice(-maxMessages)
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      content: trimTextForModel(message?.content || '', maxCharsPerMessage),
    }))
    .filter((message) => message.content.length > 0);
}

function isAcknowledgementIntent(text = '') {
  const n = normalizeText(text);
  if (!n) return false;

  const direct = new Set([
    'ok',
    'okay',
    'blz',
    'beleza',
    'valeu',
    'obrigado',
    'obrigada',
    'obg',
    'show',
    'perfeito',
    'fechado',
    'certo',
    'entendi',
    'ta bom',
    'tudo certo',
  ]);
  return direct.has(n);
}

function detectAgendaListIntent(text = '') {
  const n = normalizeText(text);
  if (!n) return null;
  if (hasMutatingIntentText(n)) return null;

  const asksAgenda = /(agenda|tarefas?|compromissos?|pendent|em aberto|o que (tenho|falta)|quais tarefas|me mostra|mostrar|lista)/.test(n);
  if (!asksAgenda) return null;

  const dateHint = inferDateFromText(text);
  const date = dateHint.explicitDate ? dateHint.date : todayLocalISO();
  return { date, explicitDate: dateHint.explicitDate };
}

function formatDatePtShort(dateStr = '') {
  const normalized = normalizeDate(dateStr || todayLocalISO());
  try {
    return new Date(`${normalized}T12:00:00`).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
  } catch {
    return normalized;
  }
}

function buildAgendaIntentMessage(tasks = [], date = todayLocalISO()) {
  const targetDate = normalizeDate(date || todayLocalISO());
  const active = sortAgendaTasks(
    (tasks || []).filter((task) => !task.completedAt && task.date === targetDate)
  );
  const completed = sortAgendaTasks(
    (tasks || []).filter((task) => task.completedAt && String(task.completedAt).slice(0, 10) === targetDate)
  );

  const lines = [
    `Resumo de ${formatDatePtShort(targetDate)}: ${active.length} em aberto${completed.length ? `, ${completed.length} concluída(s)` : ''}.`,
    buildAgendaResumo(tasks, targetDate),
  ];

  const nextFixed = active.find((task) => normalizeTime(task.startTime));
  if (nextFixed) {
    const nextEmoji = FRENTE_EMOJIS[nextFixed.frente] || '📌';
    lines.push(`Próximo horário fixo: ${nextEmoji} ${nextFixed.startTime} ${nextFixed.title}.`);
  }

  return ensureWhatsAppResponseStyle(lines.join('\n\n'), {
    question: 'Precisa de mais alguma coisa agora, senhor?',
  });
}

function formatAgendaForPrompt(tasks, options = {}) {
  const rawLimit = typeof options === 'number' ? options : options?.limit;
  const limit = Math.max(4, Number(rawLimit || WHATSAPP_CONTEXT_TASK_LIMIT));
  const userText = typeof options === 'object' ? String(options.userText || '') : '';
  const active = sortAgendaTasks(tasks.filter((task) => !task.completedAt));
  if (active.length === 0) return '- (sem tarefas ativas)';

  const today = todayLocalISO();
  const hasUserContext = Boolean(userText && userText.trim());
  const dateHint = hasUserContext ? inferDateFromText(userText) : { explicitDate: false, date: null };
  const explicitFrente = hasUserContext ? inferExplicitFrenteFromText(userText) : null;
  const selectorTokens = hasUserContext
    ? tokenizeSelectorTitle(userText).filter((token) => !SELECTOR_LOW_SIGNAL_TOKENS.has(token))
    : [];

  const scored = active.map((task) => {
    const taskText = normalizeText(`${task.title || ''} ${task.detail || ''}`);
    const tokenHits = selectorTokens.filter((token) => taskText.includes(token)).length;
    const daysFromToday = Math.round(
      (new Date(`${task.date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000
    );

    let score = 0;
    if (task.date === today) score += 6;
    if (normalizeTime(task.startTime) && task.date === today) score += 3;
    if (daysFromToday >= 0 && daysFromToday <= 2) score += 3;
    if (daysFromToday > 14) score -= 4;

    if (dateHint.explicitDate) {
      if (task.date === dateHint.date) score += 50;
      else score -= 8;
    }
    if (explicitFrente) {
      if (task.frente === explicitFrente) score += 20;
      else score -= 3;
    }
    if (selectorTokens.length > 0) {
      if (tokenHits > 0) score += tokenHits * 14;
      else score -= 5;
      if (tokenHits === selectorTokens.length) score += 12;
    }

    return { task, score };
  });

  const shouldApplyContextFilter = Boolean(
    dateHint.explicitDate || explicitFrente || selectorTokens.length > 0
  );

  const ranked = scored
    .filter((item) => !shouldApplyContextFilter || item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.task);

  const upcoming = active.filter((task) => task.date >= today);
  const fallback = (upcoming.length > 0 ? upcoming : active);
  const selected = (ranked.length > 0 ? ranked : fallback).slice(0, limit);
  return selected.map(formatTaskLine).join('\n');
}

function buildAgendaResumo(tasks, date) {
  const targetDate = normalizeDate(date || todayLocalISO());
  const dayTasks = sortAgendaTasks(tasks.filter((task) => !task.completedAt && task.date === targetDate));
  if (dayTasks.length === 0) {
    return `Agenda de ${targetDate}: sem tarefas ativas.`;
  }
  const lines = dayTasks.map((task, index) => {
    const emoji = FRENTE_EMOJIS[task.frente] || '📌';
    const time = task.startTime ? task.startTime : 'Sem horário';
    return `${index + 1}. ${emoji} ${time} — ${task.title}`;
  });
  return `Agenda de ${targetDate}:\n${lines.join('\n')}`;
}

function timeToMinutes(timeStr) {
  const value = normalizeTime(timeStr);
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(totalMinutes) {
  const minutes = Math.max(0, Number(totalMinutes) || 0);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isLikelyMeetingTask(task = {}) {
  const nTitle = normalizeText(task.title || '');
  const nType = normalizeText(task.type || '');
  return (
    nType === 'reuniao' ||
    nTitle.includes('reuniao') ||
    nTitle.includes('meeting') ||
    nTitle.includes('call') ||
    nTitle.includes('alinhamento')
  );
}

function hasPriorityIntent(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  const priorityHints = [
    'prioridade',
    'prioridades',
    'priorizar',
    'impacto',
    'urgencia',
    'urgente',
    'o que fazer primeiro',
    'ordem de prioridade',
    'ordem do dia',
    'foco de hoje',
    'o que faco primeiro',
  ];
  return priorityHints.some((hint) => n.includes(hint));
}

function parsePtNumberUnder60(value = '') {
  const n = normalizeText(value);
  if (!n) return null;
  if (/^\d{1,2}$/.test(n)) {
    const num = Number(n);
    return num >= 0 && num <= 59 ? num : null;
  }

  const units = {
    zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4,
    cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  };
  const teens = {
    dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
    quinze: 15, dezesseis: 16, dezasseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
  };
  const tens = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50 };

  if (Object.prototype.hasOwnProperty.call(units, n)) return units[n];
  if (Object.prototype.hasOwnProperty.call(teens, n)) return teens[n];
  if (Object.prototype.hasOwnProperty.call(tens, n)) return tens[n];

  const parts = n.split(' e ').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 2 && Object.prototype.hasOwnProperty.call(tens, parts[0])) {
    const unit = units[parts[1]];
    if (Number.isInteger(unit)) return tens[parts[0]] + unit;
  }
  return null;
}

function nextWeekdayDate(baseDate, weekdayIndex, forceNextWeek = false) {
  const base = new Date(baseDate);
  base.setHours(12, 0, 0, 0);
  const current = base.getDay();

  if (forceNextWeek) {
    const mondayDelta = (8 - current) % 7 || 7;
    base.setDate(base.getDate() + mondayDelta);
    const targetDelta = (weekdayIndex + 7 - 1) % 7;
    base.setDate(base.getDate() + targetDelta);
    return base.toISOString().slice(0, 10);
  }

  let delta = (weekdayIndex - current + 7) % 7;
  if (delta === 0) delta = 7;
  base.setDate(base.getDate() + delta);
  return base.toISOString().slice(0, 10);
}

function inferDateFromText(text = '') {
  const raw = String(text || '');
  const lower = normalizeText(raw);
  const today = todayLocalISO();
  const now = new Date(`${today}T12:00:00`);
  const candidates = [];
  const globalNextWeek =
    lower.includes('semana que vem') ||
    lower.includes('proxima semana') ||
    lower.includes('próxima semana');

  const addCandidate = (date, index, kind) => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (Number.isNaN(new Date(`${date}T12:00:00`).getTime())) return;
    candidates.push({ date, index: Number(index) || 0, kind });
  };

  for (const match of lower.matchAll(/\bdepois de amanha\b/g)) {
    addCandidate(addDaysISO(today, 2), match.index, 'depois_de_amanha');
  }
  for (const match of lower.matchAll(/\bamanha\b/g)) {
    addCandidate(addDaysISO(today, 1), match.index, 'amanha');
  }
  for (const match of lower.matchAll(/\bhoje\b/g)) {
    const idx = Number(match.index || 0);
    const negWindow = lower.slice(Math.max(0, idx - 26), idx + 5);
    // Ignora "hoje" quando for negação ("não ... hoje"), ex.: "não é pra hoje".
    if (/\bnao\b[^.]{0,24}\bhoje\b/.test(negWindow)) continue;
    addCandidate(today, idx, 'hoje');
  }

  for (const match of lower.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = match[3] ? Number(match[3]) : now.getFullYear();
    if (match[3] && String(match[3]).length === 2) year += 2000;
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    addCandidate(iso, match.index, 'dmy');
  }

  for (const match of lower.matchAll(/\bdia\s+(\d{1,2})\b/g)) {
    const wantedDay = Number(match[1]);
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (wantedDay < now.getDate()) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(wantedDay).padStart(2, '0')}`;
    addCandidate(iso, match.index, 'day_only');
  }

  for (const match of lower.matchAll(/\bdia\s+([a-zçãéêíóôú]+(?:\s+e\s+[a-zçãéêíóôú]+)?)\b/g)) {
    const wantedDay = parsePtNumberUnder60(match[1]);
    if (!Number.isInteger(wantedDay) || wantedDay < 1 || wantedDay > 31) continue;
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (wantedDay < now.getDate()) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(wantedDay).padStart(2, '0')}`;
    addCandidate(iso, match.index, 'day_words');
  }

  const weekdayPatterns = [
    { regex: /\bdomingo\b/g, idx: 0 },
    { regex: /\bsegunda(?:\s+feira)?\b/g, idx: 1 },
    { regex: /\bterca(?:\s+feira)?\b/g, idx: 2 },
    { regex: /\bquarta(?:\s+feira)?\b/g, idx: 3 },
    { regex: /\bquinta(?:\s+feira)?\b/g, idx: 4 },
    { regex: /\bsexta(?:\s+feira)?\b/g, idx: 5 },
    { regex: /\bsabado(?:\s+feira)?\b/g, idx: 6 },
  ];
  for (const pattern of weekdayPatterns) {
    for (const match of lower.matchAll(pattern.regex)) {
      const idx = Number(match.index || 0);
      const around = lower.slice(Math.max(0, idx - 24), idx + 40);
      const localNextWeek =
        /\b(semana que vem|proxima semana|que vem)\b/.test(around) ||
        globalNextWeek;
      addCandidate(nextWeekdayDate(new Date(), pattern.idx, localNextWeek), idx, 'weekday');
    }
  }

  if (candidates.length === 0) {
    return { date: null, explicitDate: false };
  }

  const hasNonToday = candidates.some((candidate) => candidate.date !== today);
  const scored = candidates.map((candidate) => {
    const before = lower.slice(Math.max(0, candidate.index - 20), candidate.index);
    const hasTargetPrep = /\b(para|pra|pro|na|no)\s*$/.test(before);
    let score = candidate.index;
    if (hasTargetPrep) score += 10_000;
    if (hasNonToday && candidate.date === today) score -= 700;
    if (candidate.kind === 'weekday') score += 150;
    if (candidate.kind === 'dmy' || candidate.kind === 'day_only') score += 100;
    return { ...candidate, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return { date: scored[0].date, explicitDate: true };
}

function inferTimeFromText(text = '') {
  const raw = String(text || '');
  const lower = normalizeText(raw);
  const timeCandidates = [];
  const parseMinutePhrase = (value = '') => {
    const clean = String(value || '').trim();
    if (!clean) return null;
    if (/^\d{1,3}$/.test(clean)) {
      const num = Number(clean);
      return Number.isFinite(num) ? num : null;
    }
    const words = parsePtNumberUnder60(clean);
    return Number.isInteger(words) ? words : null;
  };
  const applyPeriodToHour = (hourRaw, periodRaw = '') => {
    let hour = Number(hourRaw);
    if (!Number.isFinite(hour)) return null;
    const period = normalizeText(periodRaw);
    if (period.includes('manha')) {
      if (hour === 12) hour = 0;
      return hour;
    }
    if (period.includes('tarde') || period.includes('noite')) {
      if (hour >= 1 && hour <= 11) hour += 12;
      return hour;
    }
    return hour;
  };
  const pushTimeCandidate = (hh, mm = 0, index = 0, period = '') => {
    const adjusted = applyPeriodToHour(hh, period);
    const hour = Number(adjusted);
    const minute = Number(mm);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return;
    timeCandidates.push({
      value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      index: Number(index) || 0,
    });
  };

  for (const match of raw.matchAll(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/gi)) {
    pushTimeCandidate(match[1], match[2], match.index || 0);
  }

  // Captura "15h" (sem minutos) sem conflitar com "15h30".
  for (const match of raw.matchAll(/\b(?:as|às|a|para as|pra as|para|pra)?\s*([01]?\d|2[0-3])\s*h\b(?!\d)/gi)) {
    pushTimeCandidate(match[1], 0, match.index || 0);
  }

  // Captura "às 15" / "para 15" quando o áudio não traz "h".
  for (const match of raw.matchAll(/\b(?:as|às|a|para as|pra as|para|pra)\s*([01]?\d|2[0-3])\b(?!\s*[:h]\d)/gi)) {
    pushTimeCandidate(match[1], 0, match.index || 0);
  }

  // Captura "às quinze horas".
  for (const match of lower.matchAll(/\b(?:as|a|para as|pra as|para|pra)\s+([a-zçãéêíóôú]+(?:\s+e\s+[a-zçãéêíóôú]+)?)\s+horas?\b/g)) {
    const hh = parsePtNumberUnder60(match[1]);
    if (Number.isInteger(hh) && hh >= 0 && hh <= 23) {
      pushTimeCandidate(hh, 0, match.index || 0);
    }
  }

  // Captura "3 horas da tarde" / "10 horas da manhã".
  for (const match of lower.matchAll(/\b([01]?\d)\s+horas?\s+(?:da|de)\s+(manha|tarde|noite)\b/g)) {
    pushTimeCandidate(match[1], 0, match.index || 0, match[2]);
  }

  // Captura "três horas da tarde".
  for (const match of lower.matchAll(/\b([a-zçãéêíóôú]+(?:\s+e\s+[a-zçãéêíóôú]+)?)\s+horas?\s+(?:da|de)\s+(manha|tarde|noite)\b/g)) {
    const hh = parsePtNumberUnder60(match[1]);
    if (Number.isInteger(hh) && hh >= 0 && hh <= 23) {
      pushTimeCandidate(hh, 0, match.index || 0, match[2]);
    }
  }

  if (timeCandidates.length > 0) {
    const enriched = timeCandidates.map((candidate) => {
      const around = lower.slice(Math.max(0, candidate.index - 12), candidate.index + 34);
      const [hStr, mStr] = String(candidate.value || '00:00').split(':');
      let hh = Number(hStr);
      const mm = Number(mStr);
      if (Number.isFinite(hh) && hh >= 0 && hh <= 23 && Number.isFinite(mm)) {
        if ((around.includes('tarde') || around.includes('noite')) && hh >= 1 && hh <= 11) {
          hh += 12;
        }
        if (around.includes('manha') && hh === 12) {
          hh = 0;
        }
      }
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    });
    const uniqueCandidates = [...new Set(enriched)];
    const isRescheduleIntent =
      /(reagend|remarc|muda|altera|adi|joga|passa|troca)/.test(lower) &&
      /(para|pra|de .* para)/.test(lower);
    const chosen = isRescheduleIntent
      ? uniqueCandidates[uniqueCandidates.length - 1]
      : uniqueCandidates[0];
    return { startTime: chosen, explicitTime: true };
  }

  const hhmm = raw.match(/\b([01]?\d|2[0-3])[:h]([0-5]\d)\b/i);
  if (hhmm) {
    const hh = Number(hhmm[1]);
    const mm = Number(hhmm[2]);
    return { startTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, explicitTime: true };
  }

  const hourOnly = raw.match(/\b(?:as|às|a|para as|pra as)?\s*([01]?\d|2[0-3])\s*h\b/i);
  if (hourOnly) {
    const hh = Number(hourOnly[1]);
    return { startTime: `${String(hh).padStart(2, '0')}:00`, explicitTime: true };
  }

  const noonMinute = raw.match(/meio[\s-]?dia(?:\s*e\s*([a-z0-9çãéêíóôú\s]+))?/i);
  if (noonMinute) {
    const minuteRaw = String(noonMinute[1] || '').trim();
    const mm = minuteRaw ? parsePtNumberUnder60(minuteRaw) : 0;
    if (Number.isInteger(mm)) {
      return { startTime: `12:${String(mm).padStart(2, '0')}`, explicitTime: true };
    }
  }

  const relMatch =
    lower.match(/\b(?:daqui\s+(?:a\s+)?)((?:\d{1,3}|[a-zçãéêíóôú]+(?:\s+e\s+[a-zçãéêíóôú]+)?))\s+min(?:uto)?s?\b/i) ||
    lower.match(/\bem\s+((?:\d{1,3}|[a-zçãéêíóôú]+(?:\s+e\s+[a-zçãéêíóôú]+)?))\s+min(?:uto)?s?\b/i);
  if (relMatch) {
    const relMin = parseMinutePhrase(relMatch[1]);
    if (Number.isInteger(relMin) && relMin > 0 && relMin <= 720) {
      const target = new Date();
      target.setSeconds(0, 0);
      target.setMinutes(target.getMinutes() + relMin);
      const hh = String(target.getHours()).padStart(2, '0');
      const mm = String(target.getMinutes()).padStart(2, '0');
      return { startTime: `${hh}:${mm}`, explicitTime: true, relativeMinutes: relMin };
    }
  }

  if (/\bde manha\b/.test(lower)) return { startTime: '08:00', explicitTime: true };
  if (/\ba tarde\b/.test(lower)) return { startTime: '14:00', explicitTime: true };
  if (/\ba noite\b/.test(lower)) return { startTime: '19:00', explicitTime: true };

  return { startTime: null, explicitTime: false };
}

function inferTemporalHintsFromText(text = '') {
  const dateHint = inferDateFromText(text);
  const timeHint = inferTimeFromText(text);
  const merged = {
    ...dateHint,
    ...timeHint,
    hasAnyHint: Boolean(dateHint.explicitDate || timeHint.explicitTime),
  };
  if (timeHint?.relativeMinutes && !dateHint.explicitDate) {
    const target = new Date();
    target.setSeconds(0, 0);
    target.setMinutes(target.getMinutes() + Number(timeHint.relativeMinutes || 0));
    merged.date = todayLocalISO(target);
    merged.explicitDate = true;
    merged.hasAnyHint = true;
  }
  return merged;
}

function applyTemporalHintsToActions(actions = [], hints = {}) {
  if (!Array.isArray(actions) || actions.length === 0 || !hints?.hasAnyHint) return actions;

  return actions.map((action) => {
    const type = String(action?.type || '').toLowerCase();
    if (!['create', 'update'].includes(type)) return action;

    if (type === 'create') {
      const task = { ...(action.task || {}) };
      if (hints.explicitDate) task.date = hints.date;
      if (hints.explicitTime) task.startTime = hints.startTime;
      return { ...action, task };
    }

    const updates = { ...(action.updates || {}) };
    if (hints.explicitDate) updates.date = hints.date;
    if (hints.explicitTime) updates.startTime = hints.startTime;
    return { ...action, updates };
  });
}

function inferExplicitFrenteFromText(text = '') {
  const n = normalizeText(text);
  if (!n) return null;

  const hitTaka = /\b(taka|taca|estudio|estudio taka|agencia)\b/.test(n);
  const hitHaldan = /\b(haldan|raldan|raudan|haldam|gerencia)\b/.test(n);
  const hitPessoal = /\b(pessoal|vida pessoal|casa|saude)\b/.test(n);

  const hits = [];
  if (hitTaka) hits.push('taka');
  if (hitHaldan) hits.push('haldan');
  if (hitPessoal) hits.push('pessoal');
  if (hits.length !== 1) return null;
  return hits[0];
}

function applyFrenteHintsToActions(actions = [], userText = '') {
  if (!Array.isArray(actions) || actions.length === 0) return actions;
  const explicitFrente = inferExplicitFrenteFromText(userText);
  if (!explicitFrente) return actions;

  return actions.map((action) => {
    const type = String(action?.type || '').toLowerCase();
    if (!['create', 'update'].includes(type)) return action;

    if (type === 'create') {
      const task = { ...(action.task || {}), frente: explicitFrente };
      return { ...action, task };
    }

    const updates = { ...(action.updates || {}), frente: explicitFrente };
    return { ...action, updates };
  });
}

function isGenericSelectorTitle(value = '') {
  const n = normalizeText(value);
  if (!n) return true;
  if (SELECTOR_NOISE_PHRASES.has(n)) return true;

  const generic = new Set([
    'tarefa', 'tarefas', 'item', 'itens', 'lembrete', 'lembretes',
    'compromisso', 'compromissos', 'isso', 'essa', 'esse',
  ]);
  if (generic.has(n)) return true;

  const tokens = n.split(' ').filter(Boolean);
  return tokens.length <= 1 && SELECTOR_LOW_SIGNAL_TOKENS.has(tokens[0] || '');
}

function stripSelectorLeadNoise(value = '') {
  let out = String(value || '').trim();
  if (!out) return '';

  const leadPatterns = [
    /^(?:chat|sergio|senhor|senhora)[:,\s-]*/i,
    /^(?:confirma(?:\s+pra\s+mim)?|confirme(?:\s+pra\s+mim)?|confirmar)\s*/i,
    /^(?:pode|por favor|consegue|quero|preciso)\s*/i,
    /^(?:me\s+ajuda\s+a|me\s+ajude\s+a|ajuda\s+a)\s+/i,
    /^(?:marcar\s+como\s+conclu[ií]d[ao])\s+/i,
    /^(?:concluir|conclui|conclua|finalizar|finaliza|finalize|dar baixa(?: em)?|reagend(?:ar|a)|remarc(?:ar|a)|mover|move|mudar|muda|alterar|altera|trocar|troca|passar|passa|jogar|joga|adiantar|adianta|antecipar|antecipa|adiar|adia|transferir|transfere)\s+/i,
    /^(?:a|o|as|os)?\s*(?:tarefa|tarefas|item|itens|lembrete|lembretes|compromisso|compromissos)\s*(?:de|do|da)?\s*/i,
  ];

  let previous = '';
  while (out && out !== previous) {
    previous = out;
    leadPatterns.forEach((pattern) => {
      out = out.replace(pattern, '').trim();
    });
  }

  return out;
}

function tokenizeSelectorTitle(value = '') {
  const n = normalizeText(value);
  if (!n) return [];
  return [...new Set(
    n.split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
      .filter((token) => !SELECTOR_STOPWORDS.has(token))
  )];
}

function cleanSelectorTitle(value = '') {
  let out = String(value || '').trim();
  if (!out) return '';

  out = stripSelectorLeadNoise(out);
  out = out
    .replace(/^[“"']+|[”"']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  out = out
    .replace(/\s+(?:para|pra|pro)\s+(?:taka|taca|estudio|haldan|raldan|pessoal)\b.*$/i, '')
    .replace(/\s+como\s+tarefa\s+(?:da|do|de)\s+(?:taka|taca|estudio|haldan|raldan|pessoal)\b.*$/i, '')
    .replace(/\s+(?:para|pra)\s+(?:hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b.*$/i, '')
    .replace(/\s+(?:as|às)\s*\d{1,2}(?::\d{2}|h(?:\d{2})?)\b.*$/i, '')
    .replace(/\btamb[eé]m\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (isGenericSelectorTitle(out)) return '';
  return out;
}

function inferSelectorFromCommand(text = '', options = {}) {
  const raw = String(text || '').trim();
  const includeTemporal = options.includeTemporal === true;
  if (!raw) return {};

  const selector = {};

  const idTokens = raw.match(/\b[a-z0-9]{6,12}\b/gi) || [];
  for (const token of idTokens) {
    if (/[a-z]/i.test(token) && /\d/.test(token)) {
      selector.id = token;
      break;
    }
  }

  const quoted = raw.match(/[“"]([^”"]{3,120})[”"]/);
  let title = quoted ? quoted[1] : '';

  if (!title) {
    const titlePattern = /(?:concluir|conclui|conclua|finalizar|finaliza|finalize|dar baixa(?: em)?|remarc(?:ar|a)|reagend(?:ar|a)|mover|move|muda|altera|troca|passa|joga|adianta|antecipa|adia|transfere|coloca(?:r)?|bota(?:r)?)\s+(?:a|o|as|os)?\s*(?:tarefa|item|lembrete|compromisso)?\s*(?:de|do|da)?\s*([^,.!?]+?)(?:\s+(?:para|pra|pro|no|na)\b|$)/i;
    const match = raw.match(titlePattern);
    if (match) title = match[1];
  }

  if (!title) {
    const nounPattern = /(?:tarefa|item|lembrete|compromisso)\s+(?:de|do|da)\s+([^,.!?]+)/i;
    const match = raw.match(nounPattern);
    if (match) title = match[1];
  }

  const cleanedTitle = cleanSelectorTitle(title);
  if (cleanedTitle) selector.title = cleanedTitle;

  if (includeTemporal) {
    const dateHint = inferDateFromText(raw);
    const timeHint = inferTimeFromText(raw);
    if (dateHint.explicitDate) selector.date = dateHint.date;
    if (timeHint.explicitTime) selector.startTime = timeHint.startTime;
  }

  return selector;
}

function buildSelectorFromFragment(fragment = '') {
  const raw = String(fragment || '').trim();
  if (!raw) return null;

  const cleanedFragment = stripSelectorLeadNoise(raw);
  const selector = {};
  const idMatch = cleanedFragment.match(/\b([a-z0-9]{6,12})\b/i);
  if (idMatch && /[a-z]/i.test(idMatch[1]) && /\d/.test(idMatch[1])) {
    selector.id = idMatch[1];
  }

  const cleaned = cleanSelectorTitle(
    cleanedFragment
      .replace(/^(?:a|o|as|os)\s+/i, '')
      .replace(/^(?:tarefa|item|lembrete|compromisso)\s*/i, '')
      .replace(/^(?:de|do|da)\s+/i, '')
  );
  if (cleaned) {
    const tokens = tokenizeSelectorTitle(cleaned);
    const onlyLowSignal =
      tokens.length > 0 &&
      tokens.every((token) => SELECTOR_LOW_SIGNAL_TOKENS.has(token));
    if (!onlyLowSignal) selector.title = cleaned;
  }

  if (!selector.id && !selector.title) return null;
  return selector;
}

function inferSelectorsFromListCommand(text = '', options = {}) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const splitOnConjunction = options.splitOnConjunction !== false;

  const actionStart = raw.search(/\b(concluir|conclui|conclua|finalizar|finaliza|finalize|dar baixa|marcar como conclu[ií]d|reagend|remarc|mover|move|mudar|muda|alterar|altera|trocar|troca|passar|passa|jogar|joga|adiantar|adianta|antecipar|antecipa|adiar|adia|transferir|transfere|coloca(?:r)?|bota(?:r)?)\b/i);
  const sourceChunk = actionStart >= 0 ? raw.slice(actionStart) : raw;

  let chunk = sourceChunk
    .replace(/^(?:senhor[:,\s-]*)?/i, '')
    .replace(/^(?:pode\s+)?(?:por favor\s+)?/i, '')
    .replace(/^(?:concluir|conclui|conclua|finalizar|finaliza|finalize|dar baixa(?: em)?|marcar como conclu[ií]da?|reagend(?:ar|a)|remarc(?:ar|a)|mover|move|mudar|muda|alterar|altera|trocar|troca|passar|passa|jogar|joga|adiantar|adianta|antecipar|antecipa|adiar|adia|transferir|transfere|coloca(?:r)?|bota(?:r)?)\b\s*/i, '')
    .replace(/\btamb[eé]m\b/gi, ' ')
    .trim();

  // Remove sufixo de destino (para amanhã/às 15h/para haldan) para preservar apenas alvos.
  chunk = chunk
    .replace(/\b(?:para|pra|pro)\s+(?:hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|[01]?\d(?::[0-5]\d)?h?|2[0-3](?::[0-5]\d)?h?|[01]?\d:[0-5]\d|2[0-3]:[0-5]\d|estudio|taka|taca|haldan|raldan|pessoal)\b[\s\S]*$/i, '')
    .replace(/\bcomo\s+tarefa\s+(?:da|do|de)\s+(?:estudio|taka|taca|haldan|raldan|pessoal)\b[\s\S]*$/i, '')
    .trim();

  const separatorRegex = splitOnConjunction ? /,|;|\s+e\s+/i : /,|;/i;
  const parts = chunk
    .split(separatorRegex)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return [];

  const selectors = [];
  const seen = new Set();
  parts.slice(0, 6).forEach((part) => {
    const selector = buildSelectorFromFragment(part);
    if (!selector) return;
    const key = `${selector.id || ''}|${normalizeText(selector.title || '')}`;
    if (seen.has(key)) return;
    seen.add(key);
    selectors.push(selector);
  });

  return selectors;
}

function inferQuickOperationalActions(text = '') {
  const raw = String(text || '').trim();
  const n = normalizeText(raw);
  if (!n) return null;

  const completeIntent = /(concluir|conclui|conclua|finalizar|finaliza|finalize|dar baixa|marcar como conclu)/.test(n);
  const updateIntent = /(reagend|remarc|mover|move|muda|altera|troca|passa|joga|adiant|antecip|adia|transfer|coloc|bota)/.test(n);
  const explicitFrente = inferExplicitFrenteFromText(raw);
  const temporalHints = inferTemporalHintsFromText(raw);

  if (completeIntent) {
    const listSelectors = inferSelectorsFromListCommand(raw, { splitOnConjunction: true });
    const fallbackSelector = inferSelectorFromCommand(raw, { includeTemporal: false });
    const selectors = listSelectors.length > 0
      ? listSelectors
      : (fallbackSelector.id || fallbackSelector.title ? [fallbackSelector] : []);

    if (selectors.length === 0) {
      return {
        reply: 'Entendi. O senhor quer concluir, mas preciso do nome exato da tarefa ou do código curto.',
        actions: [],
        ask: 'Se preferir, eu posso listar as tarefas de hoje para o senhor escolher.',
      };
    }

    return {
      reply: selectors.length > 1
        ? `Perfeito. Vou concluir ${selectors.length} tarefas agora.`
        : 'Perfeito. Vou concluir agora.',
      actions: selectors.map((selector) => ({ type: 'complete', selector })),
      ask: null,
    };
  }

  if (updateIntent) {
    const listSelectors = inferSelectorsFromListCommand(raw, { splitOnConjunction: false });
    const fallbackSelector = inferSelectorFromCommand(raw, { includeTemporal: false });
    const selectors = listSelectors.length > 0
      ? listSelectors
      : (fallbackSelector.id || fallbackSelector.title ? [fallbackSelector] : []);
    const updates = {};
    if (temporalHints.explicitDate) updates.date = temporalHints.date;
    if (temporalHints.explicitTime) updates.startTime = temporalHints.startTime;
    if (explicitFrente) updates.frente = explicitFrente;

    if (Object.keys(updates).length === 0) {
      return {
        reply: 'Entendi. Consigo alterar essa tarefa, mas preciso do novo horário/dia ou da nova frente.',
        actions: [],
        ask: 'Exemplo: "mover para amanhã às 15h" ou "mudar para Haldan".',
      };
    }
    if (selectors.length === 0) {
      return {
        reply: 'Entendi a alteração, senhor, mas preciso do nome da tarefa ou do código curto para aplicar.',
        actions: [],
        ask: 'Se o senhor quiser, eu listo as tarefas ativas e o senhor me responde com o código.',
      };
    }

    const hasDateOrTime = Boolean(updates.date || updates.startTime);
    const hasFrente = Boolean(updates.frente);
    const reply = hasDateOrTime && hasFrente
      ? 'Perfeito. Vou ajustar data/horário e frente da tarefa.'
      : hasDateOrTime
        ? (selectors.length > 1 ? `Perfeito. Vou reagendar ${selectors.length} tarefas.` : 'Perfeito. Vou reagendar essa tarefa.')
        : (selectors.length > 1
          ? `Perfeito. Vou mover ${selectors.length} tarefas para ${FRENTES[updates.frente]}.`
          : `Perfeito. Vou mover essa tarefa para ${FRENTES[updates.frente]}.`);

    return {
      reply,
      actions: selectors.map((selector) => ({ type: 'update', selector, updates })),
      ask: null,
    };
  }

  return null;
}

function extractReminderSubjectFromText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const patterns = [
    /\b(?:lembrando(?:\s+que)?|lembrar(?:\s+de)?|pra lembrar(?:\s+de)?)\s+(.+)$/i,
    /\b(?:me lembra(?:r)?(?:\s+de)?|me lembre(?:\s+de)?|me avisa(?:r)?(?:\s+de)?|me manda mensagem(?:\s+me lembrando(?:\s+que)?)?)\s+(.+)$/i,
    /\bque eu(?:\s+tenho(?:\s+que)?|\s+preciso(?:\s+de)?)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const candidate = String(match[1] || '')
      .replace(/[.?!]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (candidate) return candidate;
  }

  return '';
}

function inferDirectReminderCreateAction(text = '', options = {}) {
  const raw = String(text || '').trim();
  const n = normalizeText(raw);
  if (!n) return null;

  const reminderIntent = /(me lembra|me lembre|me avisa|me mande mensagem|me manda mensagem|lembrete|lembrar)/.test(n);
  if (!reminderIntent) return null;

  const temporal = inferTemporalHintsFromText(raw);
  if (!temporal.explicitTime) {
    return {
      needsTime: true,
      action: null,
    };
  }

  const subject = extractReminderSubjectFromText(raw);
  const titleHeuristic = inferCreateTitleHeuristic(raw, { detail: subject || null });
  const title = !isWeakTaskTitle(titleHeuristic)
    ? titleHeuristic
    : (subject ? `Lembrete: ${normalizeCreateTitle(subject)}` : 'Lembrete importante');

  const detailParts = [];
  if (subject) detailParts.push(`Lembrar de: ${normalizeCreateTitle(subject)}`);
  if (options.sourceType === 'audio') detailParts.push(`Origem (áudio): ${trimTextForModel(raw, 180)}`);
  const detail = detailParts.length > 0 ? detailParts.join(' | ') : null;

  return {
    needsTime: false,
    action: {
      type: 'create',
      task: {
        title,
        detail,
        frente: inferFrenteFromText(raw),
        type: inferTypeFromText(raw),
        date: temporal.explicitDate ? temporal.date : todayLocalISO(),
        startTime: temporal.startTime,
        source: 'whatsapp',
      },
    },
  };
}

function inferAppendStepAction(text = '') {
  const raw = String(text || '').trim();
  const pattern = /dentro da tarefa(?: de)?\s+([^,.\n]+)[,.\s]+(?:eu\s+)?(?:tenho que|preciso|nao me esquece que|não me esquece que)?\s*(.+)$/i;
  const match = raw.match(pattern);
  if (!match) return null;

  const targetTitle = String(match[1] || '').trim();
  const stepText = String(match[2] || '').trim().replace(/[.]+$/, '');
  if (!targetTitle || stepText.length < 3) return null;

  return {
    type: 'append_step',
    selector: { title: targetTitle },
    step: {
      text: stepText,
      time: 15,
      done: false,
    },
  };
}

function hasDailyFollowUpIntent(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  const dailyHint = n.includes('todo dia') || n.includes('todos os dias') || n.includes('diariamente');
  const remindHint = n.includes('lembra') || n.includes('lembrar') || n.includes('cobrar');
  return dailyHint && remindHint;
}

function extractClientNameFromText(text = '') {
  const raw = String(text || '');
  const normalized = normalizeText(raw);
  const drMatch = raw.match(/\b(doutora?|dra\.?)\s+([a-záàâãéêíóôõúç]+(?:\s+[a-záàâãéêíóôõúç]+){0,2})/i);
  if (drMatch) {
    return `${drMatch[1]} ${drMatch[2]}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  const deMatch = raw.match(/\b(?:do|da|de)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç-]*(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç-]*){0,2})\b/);
  if (deMatch) {
    return deMatch[1].trim();
  }

  if (normalized.includes('cliente')) {
    const clMatch = raw.match(/\bcliente\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç-]*(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÁÀÂÃÉÊÍÓÔÕÚÇáàâãéêíóôõúç-]*){0,2})\b/i);
    if (clMatch) return clMatch[1].trim();
  }
  return null;
}

function extractFollowUpSubject(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const normalized = normalizeText(cleaned);
  const removePatterns = [
    /\b(chat|sergio|sistema ser)\b/gi,
    /\b(todo dia|todos os dias|diariamente)\b/gi,
    /\b(me )?(lembra|lembrar|cobrar)\b/gi,
    /\b(da|de|do)\s+doutora?\s+[a-záàâãéêíóôõúç]+(?:\s+[a-záàâãéêíóôõúç]+){0,2}\b/gi,
  ];

  let subject = cleaned;
  removePatterns.forEach((pattern) => {
    subject = subject.replace(pattern, ' ');
  });
  subject = subject.replace(/\s+/g, ' ').trim();
  if (!subject) return null;
  if (normalized.includes('aprov') && !normalizeText(subject).includes('aprov')) {
    return `aprovação: ${subject}`;
  }
  return subject;
}

function applyDailyFollowUpHintsToActions(actions = [], userText = '', hints = {}) {
  if (!Array.isArray(actions) || actions.length === 0) return actions;
  if (!hasDailyFollowUpIntent(userText)) return actions;

  const inferredClient = extractClientNameFromText(userText);
  const inferredSubject = extractFollowUpSubject(userText);
  const chosenTime = hints?.explicitTime && hints?.startTime
    ? hints.startTime
    : WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME;

  return actions.map((action) => {
    const type = String(action?.type || '').toLowerCase();
    if (!['create', 'update'].includes(type)) return action;

    if (type === 'create') {
      const task = { ...(action.task || {}) };
      task.followUpDaily = true;
      task.followUpTime = normalizeTime(task.followUpTime || task.startTime || chosenTime) || WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME;
      task.startTime = task.startTime || task.followUpTime;
      if (!task.type || task.type === 'Outro') task.type = 'Follow-up';
      if (inferredClient && !task.followUpClient) task.followUpClient = inferredClient;
      if (inferredSubject && !task.followUpSubject) task.followUpSubject = inferredSubject;
      return { ...action, task };
    }

    const updates = { ...(action.updates || {}) };
    updates.followUpDaily = true;
    updates.followUpTime = normalizeTime(updates.followUpTime || updates.startTime || chosenTime) || WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME;
    if (inferredClient && !updates.followUpClient) updates.followUpClient = inferredClient;
    if (inferredSubject && !updates.followUpSubject) updates.followUpSubject = inferredSubject;
    return { ...action, updates };
  });
}

function isNegativeFollowUpAnswer(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  return (
    isNegativeConfirmation(text) ||
    n.includes('ainda nao') ||
    n.includes('nao aprovou') ||
    n.includes('nao confirmou') ||
    n.includes('sem retorno') ||
    n.includes('nao respondeu')
  );
}

function isAffirmativeFollowUpAnswer(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  return (
    isAffirmativeConfirmation(text) ||
    n.includes('ja aprovou') ||
    n.includes('ja confirmou') ||
    n.includes('aprovou') ||
    n.includes('confirmou') ||
    n.includes('respondeu')
  );
}

function cleanupPendingDailyFollowups() {
  const now = Date.now();
  pendingDailyFollowupQueue = pendingDailyFollowupQueue.filter((item) => now - item.createdAt < 48 * 60 * 60 * 1000);
}

function pushPendingDailyFollowupCheck(payload = {}) {
  cleanupPendingDailyFollowups();
  const taskId = String(payload.taskId || '').trim();
  const dayKey = String(payload.dayKey || todayLocalISO());
  if (!taskId) return;

  const exists = pendingDailyFollowupQueue.some((item) => item.taskId === taskId && item.dayKey === dayKey);
  if (exists) return;

  pendingDailyFollowupQueue.push({
    taskId,
    clientName: payload.clientName || null,
    subject: payload.subject || null,
    dayKey,
    createdAt: Date.now(),
  });
  if (pendingDailyFollowupQueue.length > 20) {
    pendingDailyFollowupQueue = pendingDailyFollowupQueue.slice(-20);
  }
}

function peekPendingDailyFollowupCheck() {
  cleanupPendingDailyFollowups();
  return pendingDailyFollowupQueue[0] || null;
}

function shiftPendingDailyFollowupCheck() {
  cleanupPendingDailyFollowups();
  if (pendingDailyFollowupQueue.length === 0) return null;
  return pendingDailyFollowupQueue.shift();
}

function extractClientAndSubjectFromTask(task = {}) {
  const clientName =
    String(task.followUpClient || '').trim() ||
    extractClientNameFromText(`${task.title || ''} ${task.detail || ''}`) ||
    'cliente';
  const subject =
    String(task.followUpSubject || '').trim() ||
    String(task.detail || '').trim() ||
    String(task.title || 'o item pendente').trim();
  return { clientName, subject };
}

function impactScore(task = {}) {
  const type = String(task.type || '');
  const typeWeights = {
    'Proposta': 95,
    'Reunião': 90,
    'Follow-up': 85,
    'Gestão equipe': 85,
    'SEO': 75,
    'WordPress': 70,
    'Conteúdo': 65,
    'Outro': 55,
    'Casa': 45,
    'Alimentação': 40,
    'Esporte': 35,
  };
  let score = typeWeights[type] || 50;

  const title = normalizeText(task.title || '');
  if (title.includes('prazo') || title.includes('entrega') || title.includes('cliente')) score += 8;
  if (title.includes('urgente') || title.includes('hoje')) score += 10;
  return score;
}

function urgencyScore(task = {}, today = todayLocalISO()) {
  const date = normalizeDate(task.date || today);
  if (date < today) return 120;
  if (date === today) return 80;
  return 40;
}

function estimateMinutes(task = {}) {
  const raw = Number(task.estimatedTime);
  if (Number.isFinite(raw) && raw > 0) return Math.max(10, Math.min(120, Math.round(raw)));
  return 30;
}

function agendaAwarePriorityMessage(tasks = []) {
  const now = new Date();
  const today = todayLocalISO();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const active = sortAgendaTasks((tasks || []).filter((task) => !task.completedAt));
  const fixedToday = active
    .filter((task) => task.date === today && normalizeTime(task.startTime))
    .map((task) => ({ ...task, __min: timeToMinutes(task.startTime) }))
    .filter((task) => Number.isFinite(task.__min))
    .sort((a, b) => a.__min - b.__min);

  const nextFixed = fixedToday.find((task) => task.__min >= nowMinutes) || null;
  const flexCandidates = active
    .filter((task) => !normalizeTime(task.startTime) && normalizeDate(task.date) <= today)
    .map((task) => ({
      ...task,
      __score: impactScore(task) + urgencyScore(task, today),
      __estimate: estimateMinutes(task),
    }))
    .sort((a, b) => b.__score - a.__score);

  const lines = [];
  lines.push(`Prioridade de hoje (considerando agenda real e horário atual ${nowText}):`);

  if (fixedToday.length > 0) {
    lines.push('Compromissos fixos (horário travado):');
    fixedToday.slice(0, 6).forEach((task) => {
      const status = task.__min < nowMinutes ? ' (já passou ou em andamento)' : '';
      const emoji = FRENTE_EMOJIS[task.frente] || '📌';
      lines.push(`- ${emoji} ${task.startTime} ${task.title}${status}`);
    });
  } else {
    lines.push('Hoje não há compromissos com horário fixo.');
  }

  if (nextFixed) {
    const minutesToNext = Math.max(0, nextFixed.__min - nowMinutes);
    const prepBuffer = isLikelyMeetingTask(nextFixed) ? 30 : 20;
    const prepStart = Math.max(0, nextFixed.__min - prepBuffer);
    const prepStartText = minutesToHHMM(prepStart);

    lines.push(`Próximo compromisso fixo: ${nextFixed.startTime} ${nextFixed.title}.`);

    if (minutesToNext <= 15) {
      lines.push('Agora: entrar no modo de preparação imediata para esse compromisso.');
    } else if (minutesToNext <= prepBuffer) {
      lines.push('Agora: foco total na preparação desse compromisso (sem puxar tarefa longa nova).');
    } else if (flexCandidates.length > 0) {
      const top = flexCandidates[0];
      const safeWindow = Math.max(10, minutesToNext - prepBuffer);
      const suggested = Math.min(top.__estimate, safeWindow);
      lines.push(
        `Agora até ${prepStartText}: priorizar "${top.title}" por ~${suggested} min (tarefa flexível de maior impacto/urgência).`
      );
      lines.push(`Depois: preparação para ${nextFixed.title} e participação às ${nextFixed.startTime}.`);
    } else {
      lines.push(`Agora até ${prepStartText}: organizar contexto e materiais para ${nextFixed.title}.`);
    }
  } else if (flexCandidates.length > 0) {
    lines.push('Sem próximo compromisso fixo pendente hoje.');
    lines.push(`Prioridade de execução agora: "${flexCandidates[0].title}".`);
  }

  if (flexCandidates.length > 0) {
    lines.push('Top tarefas flexíveis por impacto + urgência:');
    flexCandidates.slice(0, 3).forEach((task, index) => {
      const emoji = FRENTE_EMOJIS[task.frente] || '📌';
      lines.push(`${index + 1}. ${emoji} ${task.title} (${task.date})`);
    });
  }

  return ensureWhatsAppResponseStyle(lines.join('\n'), {
    question: 'O senhor quer que eu monte o próximo bloco de 60 minutos, já com ordem exata?',
    suggestions: [
      'montar seu bloco até o próximo compromisso',
      'reorganizar prioridades do resto do dia',
      'preparar checklist da próxima reunião',
    ],
  });
}

function parseJSONFromLLM(rawText = '') {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, '\'');

  const candidates = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = null;
  while ((match = fenceRegex.exec(normalized)) !== null) {
    const block = String(match[1] || '').trim();
    if (block) candidates.push(block);
  }

  const stripped = normalized.replace(/```/g, '').trim();
  if (stripped) candidates.push(stripped);

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(stripped.slice(firstBrace, lastBrace + 1).trim());
  }

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function resolveTaskSelector(tasks, selector = {}, options = {}) {
  const includeCompleted = options.includeCompleted === true;
  const id = String(selector.id || '').trim();
  const title = normalizeText(selector.title || '');
  const date = selector.date ? normalizeDate(selector.date) : null;
  const startTime = selector.startTime ? normalizeTime(selector.startTime) : null;
  if (!id && !title && !date && !startTime) return { error: 'missing_selector' };

  let candidates = includeCompleted
    ? tasks.filter(Boolean)
    : tasks.filter((task) => !task.completedAt);
  if (id) {
    const byId = candidates.find((task) => String(task.id).startsWith(id));
    if (byId) return { task: byId };
  }
  if (title) {
    const selectorTokens = tokenizeSelectorTitle(title);
    const distinctiveSelectorTokens = selectorTokens.filter((token) => !SELECTOR_LOW_SIGNAL_TOKENS.has(token));

    const scored = candidates
      .map((task) => {
        const taskTitle = normalizeText(task.title || '');
        if (!taskTitle) return null;
        const taskTokens = tokenizeSelectorTitle(taskTitle);
        const tokenSet = new Set(taskTokens);
        const tokenHits = selectorTokens.filter((token) => tokenSet.has(token)).length;
        const distinctiveHits = distinctiveSelectorTokens.filter((token) => tokenSet.has(token)).length;

        if (selectorTokens.length > 0 && tokenHits === 0) return null;
        if (distinctiveSelectorTokens.length > 0 && distinctiveHits === 0) return null;

        let score = 0;
        if (taskTitle === title) score += 120;
        if (taskTitle.includes(title)) score += 80;
        if (title.includes(taskTitle)) score += 35;
        score += tokenHits * 16;
        const selectorCoverage = selectorTokens.length > 0 ? tokenHits / selectorTokens.length : 0;
        const taskCoverage = taskTokens.length > 0 ? tokenHits / taskTokens.length : 0;
        score += Math.round(selectorCoverage * 50);
        score += Math.round(taskCoverage * 25);
        if (date && task.date === date) score += 12;
        if (startTime && task.startTime === startTime) score += 12;
        if (score <= 0) return null;
        return {
          task,
          score,
          tokenHits,
          distinctiveHits,
          selectorCoverage,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) return { error: 'not_found' };

    const viable = scored.filter((item) => (
      item.score >= 85
      || item.selectorCoverage >= 0.6
      || item.tokenHits >= 3
      || (item.tokenHits >= 2 && item.selectorCoverage >= 0.45 && item.distinctiveHits >= 1)
    ));

    const ranked = (viable.length > 0 ? viable : scored).sort((a, b) => b.score - a.score);
    const topCandidate = ranked[0];
    if (!topCandidate) return { error: 'not_found' };

    if (viable.length === 0) {
      const requiredDistinctiveHits = distinctiveSelectorTokens.length >= 2 ? 2 : 1;
      const weakMatch = (
        topCandidate.score < 60
        || topCandidate.selectorCoverage < 0.45
        || topCandidate.tokenHits < 2
        || topCandidate.distinctiveHits < requiredDistinctiveHits
      );
      if (weakMatch) return { error: 'not_found' };
    }
    if (ranked.length === 1) return { task: topCandidate.task };

    const secondCandidate = ranked[1];
    if (
      (topCandidate.score - secondCandidate.score) >= 18
      || (topCandidate.selectorCoverage - secondCandidate.selectorCoverage) >= 0.2
    ) {
      return { task: topCandidate.task };
    }

    candidates = ranked.map((item) => item.task);
  }
  if (date) {
    candidates = candidates.filter((task) => task.date === date);
  }
  if (startTime) {
    candidates = candidates.filter((task) => task.startTime === startTime);
  }

  if (candidates.length === 0) return { error: 'not_found' };
  if (candidates.length > 1) return { error: 'ambiguous', candidates: candidates.slice(0, 3) };
  return { task: candidates[0] };
}

function isUsingSupabaseStorage() {
  return runtimeStorageBackend === 'supabase' && Boolean(supabase);
}

function fallbackSupabaseToFile(err, context = '') {
  if (IS_SUPABASE_STRICT) {
    throw err;
  }
  if (runtimeStorageBackend === 'file') return;
  runtimeStorageBackend = 'file';
  console.error(`[Storage] Supabase indisponível${context ? ` (${context})` : ''}. Fallback para arquivo local: ${err.message}`);
}

function normalizeDbTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  if (match) return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  return normalizeTime(raw);
}

function toSupabaseTaskRow(task = {}) {
  const normalized = normalizeTaskInput(task, {}, { touch: false });
  return {
    id: normalized.id,
    title: normalized.title,
    detail: normalized.detail,
    frente: normalized.frente,
    type: normalized.type,
    date: normalized.date,
    start_time: normalized.startTime || null,
    estimated_time: normalized.estimatedTime || 0,
    steps: Array.isArray(normalized.steps) ? normalized.steps : [],
    created_at: normalized.createdAt || nowISO(),
    updated_at: normalized.updatedAt || nowISO(),
    completed_at: normalized.completedAt || null,
    follow_up_daily: Boolean(normalized.followUpDaily),
    follow_up_time: normalized.followUpTime || null,
    follow_up_client: normalized.followUpClient || null,
    follow_up_subject: normalized.followUpSubject || null,
    source: normalized.source || 'app',
  };
}

function fromSupabaseTaskRow(row = {}) {
  return normalizeTaskInput(
    {
      id: row.id,
      title: row.title,
      detail: row.detail,
      frente: row.frente,
      type: row.type,
      date: normalizeDate(row.date || todayLocalISO()),
      startTime: normalizeDbTime(row.start_time),
      estimatedTime: Number.isFinite(Number(row.estimated_time)) ? Number(row.estimated_time) : 30,
      steps: Array.isArray(row.steps) ? row.steps : [],
      createdAt: row.created_at || nowISO(),
      updatedAt: row.updated_at || row.created_at || nowISO(),
      completedAt: row.completed_at || null,
      followUpDaily: Boolean(row.follow_up_daily),
      followUpTime: normalizeDbTime(row.follow_up_time),
      followUpClient: row.follow_up_client || null,
      followUpSubject: row.follow_up_subject || null,
      source: row.source || 'app',
    },
    {},
    { touch: false }
  );
}

function toSupabaseUsageRow(event = {}) {
  const safeEvent = {
    id: event.id || crypto.randomUUID(),
    ts: event.ts || nowISO(),
    ...event,
  };

  const knownKeys = new Set([
    'id',
    'ts',
    'source',
    'endpoint',
    'usageKind',
    'model',
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'audioMinutes',
    'usd',
    'mimeType',
    'durationSeconds',
  ]);
  const metadata = {};
  Object.entries(safeEvent).forEach(([key, value]) => {
    if (knownKeys.has(key)) return;
    metadata[key] = value;
  });

  return {
    id: safeEvent.id,
    ts: safeEvent.ts,
    source: safeEvent.source || null,
    endpoint: safeEvent.endpoint || null,
    usage_kind: safeEvent.usageKind || null,
    model: safeEvent.model || null,
    input_tokens: Number(safeEvent.inputTokens || 0),
    output_tokens: Number(safeEvent.outputTokens || 0),
    total_tokens: Number(safeEvent.totalTokens || 0),
    audio_minutes: Number(safeEvent.audioMinutes || 0),
    usd: Number(safeEvent.usd || 0),
    mime_type: safeEvent.mimeType || null,
    duration_seconds: Number(safeEvent.durationSeconds || 0),
    metadata: Object.keys(metadata).length ? metadata : null,
  };
}

function fromSupabaseUsageRow(row = {}) {
  return {
    id: row.id || crypto.randomUUID(),
    ts: row.ts || nowISO(),
    source: row.source || null,
    endpoint: row.endpoint || null,
    usageKind: row.usage_kind || null,
    model: row.model || null,
    inputTokens: Number(row.input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    audioMinutes: Number(row.audio_minutes || 0),
    usd: Number(row.usd || 0),
    mimeType: row.mime_type || null,
    durationSeconds: Number(row.duration_seconds || 0),
    ...(row.metadata && typeof row.metadata === 'object' ? row.metadata : {}),
  };
}

async function ensureSupabaseTables() {
  if (!isUsingSupabaseStorage() || supabaseTablesChecked) return;

  const { error: tasksError } = await supabase
    .from(SUPABASE_TASKS_TABLE)
    .select('id')
    .limit(1);
  if (tasksError) {
    throw new Error(`Falha ao acessar tabela "${SUPABASE_TASKS_TABLE}" no Supabase: ${tasksError.message}`);
  }

  const { error: usageError } = await supabase
    .from(SUPABASE_USAGE_TABLE)
    .select('id')
    .limit(1);
  if (usageError) {
    throw new Error(`Falha ao acessar tabela "${SUPABASE_USAGE_TABLE}" no Supabase: ${usageError.message}`);
  }

  supabaseTablesChecked = true;
}

async function ensureAgendaStorageFile() {
  await fs.mkdir(path.dirname(AGENDA_FILE), { recursive: true });
  try {
    await fs.access(AGENDA_FILE);
  } catch {
    await fs.writeFile(
      AGENDA_FILE,
      JSON.stringify({ updatedAt: nowISO(), tasks: [] }, null, 2),
      'utf8'
    );
  }
}

async function readAgendaDataFile() {
  await ensureAgendaStorageFile();
  try {
    const raw = await fs.readFile(AGENDA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed.tasks)
      ? sortAgendaTasks(parsed.tasks.map((task) => normalizeTaskInput(task, {}, { touch: false })))
      : [];
    return { tasks, updatedAt: parsed.updatedAt || null };
  } catch {
    return { tasks: [], updatedAt: null };
  }
}

async function writeAgendaDataFile(tasks = []) {
  await ensureAgendaStorageFile();
  const normalizedTasks = sortAgendaTasks(
    tasks.map((task) => normalizeTaskInput(task, {}, { touch: false }))
  );
  await fs.writeFile(
    AGENDA_FILE,
    JSON.stringify({ updatedAt: nowISO(), tasks: normalizedTasks }, null, 2),
    'utf8'
  );
  return normalizedTasks;
}

async function ensureUsageStorageFile() {
  await fs.mkdir(path.dirname(USAGE_FILE), { recursive: true });
  try {
    await fs.access(USAGE_FILE);
  } catch {
    await fs.writeFile(
      USAGE_FILE,
      JSON.stringify({ updatedAt: nowISO(), events: [] }, null, 2),
      'utf8'
    );
  }
}

async function readUsageDataFile() {
  await ensureUsageStorageFile();
  try {
    const raw = await fs.readFile(USAGE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    return { updatedAt: parsed.updatedAt || null, events };
  } catch {
    return { updatedAt: null, events: [] };
  }
}

async function appendUsageEventFile(event = {}) {
  await ensureUsageStorageFile();
  const usage = await readUsageDataFile();
  const safeEvent = {
    id: crypto.randomUUID(),
    ts: nowISO(),
    ...event,
  };
  const events = [...usage.events, safeEvent].slice(-5000);
  await fs.writeFile(
    USAGE_FILE,
    JSON.stringify({ updatedAt: nowISO(), events }, null, 2),
    'utf8'
  );
}

async function ensureAgendaStorage() {
  if (!isUsingSupabaseStorage()) {
    await ensureAgendaStorageFile();
    return;
  }
  try {
    await ensureSupabaseTables();
  } catch (err) {
    fallbackSupabaseToFile(err, 'agenda');
    await ensureAgendaStorageFile();
  }
}

async function readAgendaData() {
  if (!isUsingSupabaseStorage()) {
    return readAgendaDataFile();
  }

  try {
    await ensureSupabaseTables();
    const { data, error } = await supabase
      .from(SUPABASE_TASKS_TABLE)
      .select('*')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false })
      .order('title', { ascending: true });
    if (error) throw new Error(error.message);
    const tasks = Array.isArray(data) ? sortAgendaTasks(data.map(fromSupabaseTaskRow)) : [];
    return { tasks, updatedAt: nowISO() };
  } catch (err) {
    fallbackSupabaseToFile(err, 'readAgendaData');
    return readAgendaDataFile();
  }
}

async function writeAgendaData(tasks = []) {
  return withAgendaWriteLock(async () => {
    if (!isUsingSupabaseStorage()) {
      return writeAgendaDataFile(tasks);
    }

    try {
      await ensureSupabaseTables();
      const normalizedTasks = sortAgendaTasks(
        tasks.map((task) => normalizeTaskInput(task, {}, { touch: false }))
      );
      const rows = normalizedTasks.map(toSupabaseTaskRow);
      const { data: existingRows, error: existingError } = await supabase
        .from(SUPABASE_TASKS_TABLE)
        .select('id');
      if (existingError) throw new Error(existingError.message);
      const existingIds = new Set((existingRows || []).map((row) => String(row.id)));
      const keepIds = new Set(rows.map((row) => String(row.id)));
      const removeIds = [...existingIds].filter((id) => !keepIds.has(id));

      if (rows.length > 0) {
        const { error: upsertError } = await supabase
          .from(SUPABASE_TASKS_TABLE)
          .upsert(rows, { onConflict: 'id' });
        if (upsertError) throw new Error(upsertError.message);
      }
      if (rows.length === 0 && existingIds.size > 0) {
        const { error: deleteAllError } = await supabase
          .from(SUPABASE_TASKS_TABLE)
          .delete()
          .neq('id', '__none__');
        if (deleteAllError) throw new Error(deleteAllError.message);
      } else if (removeIds.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < removeIds.length; i += chunkSize) {
          const chunk = removeIds.slice(i, i + chunkSize);
          const { error: deleteError } = await supabase
            .from(SUPABASE_TASKS_TABLE)
            .delete()
            .in('id', chunk);
          if (deleteError) throw new Error(deleteError.message);
        }
      }
      return normalizedTasks;
    } catch (err) {
      fallbackSupabaseToFile(err, 'writeAgendaData');
      return writeAgendaDataFile(tasks);
    }
  });
}

async function ensureUsageStorage() {
  if (!isUsingSupabaseStorage()) {
    await ensureUsageStorageFile();
    return;
  }
  try {
    await ensureSupabaseTables();
  } catch (err) {
    fallbackSupabaseToFile(err, 'usage');
    await ensureUsageStorageFile();
  }
}

async function readUsageData() {
  if (!isUsingSupabaseStorage()) {
    return readUsageDataFile();
  }

  try {
    await ensureSupabaseTables();
    const rowLimit = Math.max(1000, SUPABASE_USAGE_MAX_ROWS || 12000);
    const { data, error } = await supabase
      .from(SUPABASE_USAGE_TABLE)
      .select('*')
      .order('ts', { ascending: false })
      .limit(rowLimit);
    if (error) throw new Error(error.message);
    const events = Array.isArray(data)
      ? data.map(fromSupabaseUsageRow).sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      : [];
    return { updatedAt: nowISO(), events };
  } catch (err) {
    fallbackSupabaseToFile(err, 'readUsageData');
    return readUsageDataFile();
  }
}

async function appendUsageEvent(event = {}) {
  if (!isUsingSupabaseStorage()) {
    await appendUsageEventFile(event);
    return;
  }

  try {
    await ensureSupabaseTables();
    const safeEvent = {
      id: crypto.randomUUID(),
      ts: nowISO(),
      ...event,
    };
    const row = toSupabaseUsageRow(safeEvent);
    const { error } = await supabase
      .from(SUPABASE_USAGE_TABLE)
      .insert(row);
    if (error) throw new Error(error.message);
  } catch (err) {
    fallbackSupabaseToFile(err, 'appendUsageEvent');
    await appendUsageEventFile(event);
  }
}

function getModelTokenPrices(model = '') {
  const m = String(model || '').toLowerCase();
  if (m.includes('gpt-4o-mini')) {
    return {
      inputPer1M: OPENAI_PRICE_GPT4O_MINI_INPUT_PER_1M,
      outputPer1M: OPENAI_PRICE_GPT4O_MINI_OUTPUT_PER_1M,
    };
  }
  return {
    inputPer1M: OPENAI_PRICE_DEFAULT_INPUT_PER_1M,
    outputPer1M: OPENAI_PRICE_DEFAULT_OUTPUT_PER_1M,
  };
}

function estimateChatCostUSD({ model = '', inputTokens = 0, outputTokens = 0 } = {}) {
  const pricing = getModelTokenPrices(model);
  return ((inputTokens * pricing.inputPer1M) + (outputTokens * pricing.outputPer1M)) / 1_000_000;
}

function aggregateUsage(events = []) {
  const summary = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    audioMinutes: 0,
    usd: 0,
  };

  for (const event of events) {
    summary.calls += 1;
    summary.inputTokens += Number(event.inputTokens || 0);
    summary.outputTokens += Number(event.outputTokens || 0);
    summary.totalTokens += Number(event.totalTokens || 0);
    summary.audioMinutes += Number(event.audioMinutes || 0);
    summary.usd += Number(event.usd || 0);
  }

  return summary;
}

function localStartOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function monthRange(offsetFromCurrent = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetFromCurrent, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetFromCurrent + 1, 1, 0, 0, 0, 0);
  return { start, end };
}

function filterEventsByRange(events = [], start, end) {
  const startTs = start ? start.getTime() : -Infinity;
  const endTs = end ? end.getTime() : Infinity;
  return events.filter((event) => {
    const ts = new Date(event.ts || 0).getTime();
    return ts >= startTs && ts < endTs;
  });
}

async function getUsageSummary(period = 'today') {
  const usage = await readUsageData();
  const now = new Date();

  let start = null;
  let end = null;
  let label = 'até hoje';

  if (period === 'today') {
    start = localStartOfDay(now);
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    label = `hoje (${todayLocalISO()})`;
  } else if (period === 'last_7_days') {
    end = new Date(localStartOfDay(now).getTime() + 24 * 60 * 60 * 1000);
    start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    label = 'últimos 7 dias';
  } else if (period === 'month_current') {
    const range = monthRange(0);
    start = range.start;
    end = range.end;
    label = 'mês atual';
  } else if (period === 'month_last') {
    const range = monthRange(-1);
    start = range.start;
    end = range.end;
    label = 'último mês';
  } else if (period === 'month_prev') {
    const range = monthRange(-2);
    start = range.start;
    end = range.end;
    label = 'penúltimo mês';
  }

  const allEvents = filterEventsByRange(usage.events, start, end);
  const whatsappEvents = allEvents.filter((event) => String(event.usageKind || '').startsWith('whatsapp'));
  return {
    label,
    total: aggregateUsage(allEvents),
    whatsapp: aggregateUsage(whatsappEvents),
  };
}

function formatUsd(value = 0) {
  return Number(value || 0).toFixed(4);
}

function buildUsageSummaryMessage(summary = {}, options = {}) {
  const label = summary.label || 'período';
  const showQuestion = options.ask !== false;
  const prioritizeWhatsApp = options.prioritizeWhatsApp === true;

  const appLine = `App total: US$ ${formatUsd(summary.total?.usd)} | tokens ${summary.total?.totalTokens || 0} | áudio ${Number(summary.total?.audioMinutes || 0).toFixed(1)} min`;
  const whatsappLine = `WhatsApp: US$ ${formatUsd(summary.whatsapp?.usd)} | tokens ${summary.whatsapp?.totalTokens || 0} | áudio ${Number(summary.whatsapp?.audioMinutes || 0).toFixed(1)} min`;

  const lines = [
    `📊 Custo ${label}:`,
    ...(prioritizeWhatsApp ? [whatsappLine, appLine] : [appLine, whatsappLine]),
  ];
  return ensureWhatsAppResponseStyle(lines.join('\n'), {
    question: showQuestion ? 'Precisa de mais alguma coisa agora, senhor?' : '',
  });
}

function detectUsageSummaryPeriod(text = '') {
  const n = normalizeText(text);
  if (!/(gasto|gastamos|gastou|custo|custou|tokens?|consumo|uso de tokens|usage)/.test(n)) return null;
  if (n.includes('hoje') || n.includes('dia de hoje')) return 'today';
  if (n.includes('ultima semana') || n.includes('ultimos 7') || n.includes('semana passada')) return 'last_7_days';
  if (n.includes('penultimo mes') || n.includes('mes retrasado') || n.includes('2 meses atras') || n.includes('dois meses atras')) return 'month_prev';
  if (n.includes('ultimo mes') || n.includes('mes passado') || n.includes('mes anterior')) return 'month_last';
  if (n.includes('mes atual') || n.includes('esse mes') || n.includes('este mes')) return 'month_current';
  if (n.includes('ate hoje') || n.includes('total') || n.includes('desde o inicio') || n.includes('desde o comeco')) return 'all_time';
  return 'today';
}

function isUsageHelpIntent(text = '') {
  const n = normalizeText(text);
  const asksHow = /(como|qual).*?(pergunt|falo|peco|digo|consult)/.test(n);
  const talksAboutCost = /(gasto|custo|token|consumo|usage)/.test(n);
  return asksHow && talksAboutCost;
}

function buildUsageHelpMessage() {
  const lines = [
    'O senhor pode perguntar assim:',
    '- "Quanto gastamos hoje?"',
    '- "Quanto gastamos até hoje?"',
    '- "Quanto gastamos no último mês?"',
    '- "Quanto gastamos no penúltimo mês?"',
    '- "Quanto gastamos em tokens no WhatsApp hoje?"',
  ];
  return ensureWhatsAppResponseStyle(lines.join('\n'), {
    question: 'O senhor quer que eu mostre algum desses períodos agora?',
  });
}

function buildOpenAICacheKey({ model, systemPrompt, messages, maxTokens, temperature, expectJson }) {
  const raw = JSON.stringify({
    model,
    systemPrompt,
    messages,
    maxTokens,
    temperature,
    expectJson,
  });
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function getCachedOpenAIResponse(cacheKey) {
  if (!cacheKey || OPENAI_CACHE_TTL_MS <= 0) return null;
  const entry = openaiResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    openaiResponseCache.delete(cacheKey);
    return null;
  }
  return entry.text;
}

function setCachedOpenAIResponse(cacheKey, text, ttlMs = OPENAI_CACHE_TTL_MS) {
  if (!cacheKey || ttlMs <= 0) return;
  const safeText = String(text || '');
  openaiResponseCache.set(cacheKey, {
    text: safeText,
    expiresAt: Date.now() + ttlMs,
  });
  if (openaiResponseCache.size > OPENAI_CACHE_MAX_ITEMS) {
    const firstKey = openaiResponseCache.keys().next().value;
    if (firstKey) openaiResponseCache.delete(firstKey);
  }
}

function getWhatsAppConversationContext(senderNumber = '') {
  if (!senderNumber || WHATSAPP_LLM_HISTORY_TURNS <= 0) return [];
  const entry = whatsappConversationCache.get(senderNumber);
  if (!entry) return [];
  if (entry.expiresAt <= Date.now()) {
    whatsappConversationCache.delete(senderNumber);
    return [];
  }
  const limit = Math.max(1, WHATSAPP_LLM_HISTORY_TURNS) * 2;
  return (entry.messages || [])
    .slice(-limit)
    .map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: trimTextForModel(msg.content || '', 220),
    }))
    .filter((msg) => msg.content);
}

function saveWhatsAppConversationTurn(senderNumber = '', userText = '', assistantText = '') {
  if (!senderNumber || WHATSAPP_LLM_HISTORY_TURNS <= 0) return;
  const current = getWhatsAppConversationContext(senderNumber).map((msg) => ({ ...msg }));
  current.push({ role: 'user', content: trimTextForModel(userText || '', 220) });
  current.push({ role: 'assistant', content: trimTextForModel(assistantText || '', 220) });
  const limit = Math.max(1, WHATSAPP_LLM_HISTORY_TURNS) * 2;
  const sliced = current.slice(-limit);
  whatsappConversationCache.set(senderNumber, {
    messages: sliced,
    expiresAt: Date.now() + WHATSAPP_LLM_HISTORY_TTL_MS,
  });
}

async function callOpenAI(systemPrompt, messages, maxTokens = 1500, options = {}) {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada. Defina a chave no arquivo .env do projeto.');
  }

  const model = options.model || CHAT_MODEL;
  const temperature = typeof options.temperature === 'number' ? options.temperature : 0.3;
  const safeMaxTokens = Math.max(120, Math.min(2000, Number(maxTokens) || 900));
  const usageKind = String(options.usageKind || 'chat').trim() || 'chat';
  const useCache = options.cache !== false && OPENAI_CACHE_TTL_MS > 0;
  const cacheTtlMs = Number.isFinite(Number(options.cacheTtlMs))
    ? Math.max(1000, Number(options.cacheTtlMs))
    : OPENAI_CACHE_TTL_MS;

  const isGpt5Family = model.startsWith('gpt-5');
  const shouldForceJson = Boolean(options.expectJson) && !isGpt5Family;
  const cacheKey = useCache
    ? buildOpenAICacheKey({
      model,
      systemPrompt,
      messages,
      maxTokens: safeMaxTokens,
      temperature,
      expectJson: shouldForceJson,
    })
    : null;

  const cached = getCachedOpenAIResponse(cacheKey);
  if (cached !== null) {
    appendUsageEvent({
      source: 'cache',
      endpoint: 'openai.chat.cache',
      usageKind: `${usageKind}_cache_hit`,
      model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      audioMinutes: 0,
      usd: 0,
    }).catch(() => {});
    return cached;
  }

  const tokenField = isGpt5Family ? 'max_completion_tokens' : 'max_tokens';
  const payload = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    [tokenField]: safeMaxTokens,
  };

  // Alguns modelos GPT-5 aceitam apenas a temperatura padrão no chat/completions.
  if (!isGpt5Family) {
    payload.temperature = temperature;
  }
  if (shouldForceJson) {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Erro HTTP ${response.status} na OpenAI`;
    throw new Error(message);
  }

  const promptTokens = Number(data?.usage?.prompt_tokens || 0);
  const completionTokens = Number(data?.usage?.completion_tokens || 0);
  const totalTokens = Number(
    data?.usage?.total_tokens || (promptTokens + completionTokens)
  );
  const usd = estimateChatCostUSD({
    model,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
  });

  appendUsageEvent({
    source: 'openai',
    endpoint: 'chat.completions',
    usageKind,
    model,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    totalTokens,
    audioMinutes: 0,
    usd,
  }).catch((err) => {
    console.error('[Usage] Erro ao gravar consumo chat:', err.message);
  });

  const outputText = data?.choices?.[0]?.message?.content?.trim() || '';
  if (cacheKey) setCachedOpenAIResponse(cacheKey, outputText, cacheTtlMs);
  return outputText;
}

function splitLongWhatsAppLine(line = '', maxChars = 86) {
  const clean = String(line || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let rest = clean;
  while (rest.length > maxChars) {
    const priorityBreaks = [
      rest.lastIndexOf('. ', maxChars),
      rest.lastIndexOf('; ', maxChars),
      rest.lastIndexOf(': ', maxChars),
      rest.lastIndexOf(', ', maxChars),
      rest.lastIndexOf(' ', maxChars),
    ];
    let cut = Math.max(...priorityBreaks);
    if (cut < Math.floor(maxChars * 0.55)) {
      cut = rest.indexOf(' ', maxChars);
    }
    if (cut <= 0) cut = maxChars;

    const piece = rest.slice(0, cut + 1).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function formatWhatsAppCoreText(text = '') {
  const rawLines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim());

  const formatted = [];
  rawLines.forEach((line) => {
    if (!line) {
      if (formatted[formatted.length - 1] !== '') formatted.push('');
      return;
    }

    const isListItem = /^(\d+[\.\)]|[-•])\s+/.test(line);
    if (isListItem) {
      formatted.push(line);
      return;
    }

    const pieces = splitLongWhatsAppLine(line);
    pieces.forEach((piece) => formatted.push(piece));
  });

  const collapsed = [];
  formatted.forEach((line) => {
    if (!line && collapsed[collapsed.length - 1] === '') return;
    collapsed.push(line);
  });

  const trimmed = collapsed.join('\n').trim();
  return trimmed || 'Fechado.';
}

function enforceSirAddress(text = '') {
  let out = String(text || '');
  out = out.replace(/\b[Vv]oc[eê]\b/g, 'o senhor');
  out = out.replace(/\b[Vv]c\b/g, 'o senhor');
  out = out.replace(/\b[Pp]ara o senhor\b/g, 'para o senhor');
  out = out.replace(/\b[Pp]ra o senhor\b/g, 'para o senhor');
  out = out.replace(/\b[Ss]e o senhor\b/g, 'se o senhor');
  out = out.replace(/(^|\n)\s*o senhor/g, '$1O senhor');
  out = out.replace(/(^|\n)\s*Quer\b/g, '$1O senhor quer');
  out = out.replace(/(^|\n)\s*Pode\b/g, '$1O senhor pode');
  return out;
}

function ensureWhatsAppResponseStyle(text, options = {}) {
  const appendQuestion = options.appendQuestion !== false;
  const questionBase = String(options.question || 'Precisa de mais alguma coisa agora, senhor?').trim();
  const question = questionBase.endsWith('?') ? questionBase : `${questionBase}?`;

  let output = enforceSirAddress(formatWhatsAppCoreText(text || 'Fechado.'));
  const normalized = normalizeText(output);
  if (appendQuestion && !/(precisa de mais alguma coisa|precisa de alguma coisa|quer ajuda|posso te ajudar)/.test(normalized)) {
    output = `${output}\n\n${question}`;
  }
  output = enforceSirAddress(output);

  if (!/\p{Extended_Pictographic}/u.test(output)) {
    output = `✅ ${output}`;
  }

  return formatWhatsAppCoreText(output).slice(0, 2000);
}

function isMutatingActionType(type = '') {
  return ['create', 'update', 'append_step', 'delete', 'complete'].includes(String(type || '').toLowerCase());
}

function hasMutatingIntentText(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  return /(criar|crie|nova tarefa|novo lembrete|adicionar|adiciona|concluir|conclui|finalizar|finaliza|marcar como conclu|reagend|remarc|mover|move|muda|altera|troca|passa|joga|adiant|antecip|adia|transfer|excluir|exclui|apagar|remove|remover|coloc|bota)/.test(n);
}

function hasCreateIntentText(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  return /(criar|crie|nova tarefa|novo lembrete|adicionar|adiciona|agend|marc|lembrete|lembrar|lembra|coloc|bota)/.test(n);
}

function normalizeCreateTitle(title = '') {
  const clean = String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\-–—\s]+|[,.;:\-–—\s]+$/g, '')
    .trim();
  if (!clean) return '';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function isWeakTaskTitle(title = '') {
  const n = normalizeText(title);
  if (!n) return true;
  const weak = new Set([
    'tarefa',
    'nova tarefa',
    'tarefa nova',
    'lembrete',
    'novo lembrete',
    'compromisso',
    'item',
    'tarefa sem titulo',
    'tarefa sem título',
    'sem titulo',
    'sem título',
  ]);
  if (weak.has(n)) return true;
  return n.length < 4;
}

function inferCreateTitleHeuristic(userText = '', task = {}) {
  const directTitle = normalizeCreateTitle(task?.title || '');
  if (!isWeakTaskTitle(directTitle)) return directTitle;

  const detailAsTitle = normalizeCreateTitle(task?.detail || '');
  if (!isWeakTaskTitle(detailAsTitle)) return detailAsTitle;

  const fromCommand = normalizeCreateTitle(cleanSelectorTitle(userText));
  if (!isWeakTaskTitle(fromCommand)) return fromCommand;

  const raw = String(userText || '').trim();
  const meetingMatch = raw.match(/\breuni[aã]o\s+com\s+([^,.;\n]+)/i);
  if (meetingMatch) {
    const who = normalizeCreateTitle(meetingMatch[1]);
    if (who) return `Reunião com ${who}`;
  }

  const reminderMatch = raw.match(/\b(?:lembra(?:r)?(?:\s+de)?|lembrete(?:\s+de)?)\s+([^,.;\n]+)/i);
  if (reminderMatch) {
    const what = normalizeCreateTitle(reminderMatch[1]);
    if (what) return `Lembrete: ${what}`;
  }

  if (/reuni[aã]o|meeting|call/i.test(raw)) return 'Reunião';
  if (/lembrete|lembrar|lembra/i.test(raw)) return 'Lembrete importante';
  return '';
}

async function inferCreateTitleSmart(userText = '', task = {}) {
  const heuristic = inferCreateTitleHeuristic(userText, task);
  if (!isWeakTaskTitle(heuristic)) return heuristic;

  try {
    const titlePrompt = `Extraia um título curto e claro de tarefa a partir da mensagem do usuário.
Retorne APENAS JSON: {"title":"..."}
Regras:
- 3 a 10 palavras.
- Sem data/horário no título.
- Sem texto extra.`;

    const raw = await callOpenAI(
      titlePrompt,
      [{ role: 'user', content: trimTextForModel(userText, 500) }],
      90,
      {
        model: WHATSAPP_MODEL,
        expectJson: true,
        temperature: 0,
        usageKind: 'whatsapp_title_repair',
        cache: false,
      }
    );
    const parsed = parseJSONFromLLM(raw);
    const candidate = normalizeCreateTitle(parsed?.title || '');
    if (!isWeakTaskTitle(candidate)) return candidate;
  } catch {
    // fallback abaixo
  }

  return 'Compromisso agendado';
}

async function hardenWhatsAppActions(actions = [], options = {}) {
  const userText = String(options?.userText || '').trim();
  const sourceType = String(options?.sourceType || 'text');
  if (!Array.isArray(actions) || actions.length === 0) return [];

  const safe = [];
  for (const rawAction of actions.slice(0, 8)) {
    const type = String(rawAction?.type || '').toLowerCase();
    if (type !== 'create') {
      safe.push(rawAction);
      continue;
    }

    const task = { ...(rawAction?.task || {}) };
    let title = normalizeCreateTitle(task.title || '');
    if (isWeakTaskTitle(title)) {
      title = await inferCreateTitleSmart(userText, task);
    }
    task.title = normalizeCreateTitle(title);

    if (!task.detail && sourceType === 'audio' && userText) {
      task.detail = trimTextForModel(userText, 220);
    }
    if (!TASK_TYPES.has(String(task.type || ''))) {
      task.type = inferTypeFromText(`${task.title || ''} ${task.detail || ''} ${userText}`);
    }
    if (!ALLOWED_FRENTES.has(String(task.frente || ''))) {
      task.frente = inferFrenteFromText(`${task.title || ''} ${task.detail || ''} ${userText}`);
    }

    safe.push({ ...rawAction, type: 'create', task });
  }

  return safe;
}

function isAffirmativeConfirmation(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  const direct = new Set([
    'sim',
    's',
    'ok',
    'okay',
    'confirmar',
    'confirma',
    'confirmado',
    'pode',
    'pode sim',
    'isso',
    'isso mesmo',
    'fechado',
    'manda',
    'manda ver',
    'pode fazer',
    'pode aplicar',
  ]);
  if (direct.has(n)) return true;
  return (
    n.includes('confirm') ||
    n.includes('pode aplicar') ||
    n.includes('aplicar isso') ||
    n.includes('pode executar')
  );
}

function isNegativeConfirmation(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  const direct = new Set([
    'nao',
    'n',
    'cancelar',
    'cancela',
    'cancelado',
    'deixa',
    'deixa pra la',
    'esquece',
    'parar',
    'para',
    'nao aplica',
    'nao confirmar',
  ]);
  if (direct.has(n)) return true;
  return n.includes('cancel') || n.includes('nao aplica') || n.includes('nao quero');
}

function getPendingAudioConfirmation(senderNumber) {
  if (!senderNumber) return null;
  const entry = pendingAudioConfirmations.get(senderNumber);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > WHATSAPP_AUDIO_CONFIRM_TTL_MS) {
    pendingAudioConfirmations.delete(senderNumber);
    return null;
  }
  return entry;
}

function setPendingAudioConfirmation(senderNumber, payload) {
  if (!senderNumber) return;
  pendingAudioConfirmations.set(senderNumber, {
    ...payload,
    createdAt: Date.now(),
  });
}

function clearPendingAudioConfirmation(senderNumber) {
  if (!senderNumber) return;
  pendingAudioConfirmations.delete(senderNumber);
}

function getPendingTitleClarification(senderNumber = '') {
  if (!senderNumber) return null;
  const entry = pendingTitleClarificationBySender.get(senderNumber);
  if (!entry) return null;
  if (Date.now() - Number(entry.createdAt || 0) > 20 * 60 * 1000) {
    pendingTitleClarificationBySender.delete(senderNumber);
    return null;
  }
  return entry;
}

function setPendingTitleClarification(senderNumber = '', payload = {}) {
  if (!senderNumber) return;
  pendingTitleClarificationBySender.set(senderNumber, {
    ...payload,
    createdAt: Date.now(),
  });
}

function clearPendingTitleClarification(senderNumber = '') {
  if (!senderNumber) return;
  pendingTitleClarificationBySender.delete(senderNumber);
}

function getPendingReminder(senderNumber = '') {
  if (!senderNumber) return null;
  const entry = pendingReminderBySender.get(senderNumber);
  if (!entry) return null;
  if (Date.now() - Number(entry.createdAt || 0) > 20 * 60 * 1000) {
    pendingReminderBySender.delete(senderNumber);
    return null;
  }
  return entry;
}

function setPendingReminder(senderNumber = '', payload = {}) {
  if (!senderNumber) return;
  pendingReminderBySender.set(senderNumber, {
    ...payload,
    createdAt: Date.now(),
  });
}

function clearPendingReminder(senderNumber = '') {
  if (!senderNumber) return;
  pendingReminderBySender.delete(senderNumber);
}

async function executeWhatsAppActions({ actions = [], tasks = [], commit = false } = {}) {
  const safeActions = Array.isArray(actions) ? actions.slice(0, 8) : [];
  const workingTasks = [...tasks];
  const changes = [];
  const listOutputs = [];
  const remindableTasks = [];
  let hasMutation = false;
  let blockedBySelection = false;

  for (const action of safeActions) {
    const actionType = String(action?.type || '').toLowerCase();

    if (actionType === 'create') {
      let rawTitle = normalizeCreateTitle(action?.task?.title || '');
      if (isWeakTaskTitle(rawTitle)) {
        rawTitle = inferCreateTitleHeuristic(
          `${action?.task?.detail || ''} ${action?.task?.type || ''}`,
          action?.task || {}
        );
      }
      if (isWeakTaskTitle(rawTitle)) {
        rawTitle = 'Compromisso agendado';
      }

      const created = normalizeTaskInput(
        {
          ...(action.task || {}),
          title: rawTitle,
          source: 'whatsapp',
        },
        {},
        { touch: true }
      );
      workingTasks.push(created);
      hasMutation = true;
      if (!created.completedAt && created.startTime) {
        remindableTasks.push(created);
      }
      const when = `${created.date}${created.startTime ? ` ${created.startTime}` : ''}`;
      changes.push(`✅ Criei (${String(created.id).slice(0, 6)}) ${created.title} em ${when}.`);
      continue;
    }

    if (actionType === 'update') {
      const resolved = resolveTaskSelector(workingTasks, selectorFromAction(action));
      if (resolved.error === 'missing_selector') {
        changes.push(buildMissingSelectorMessage(actionType));
        blockedBySelection = true;
        break;
      }
      if (resolved.error === 'not_found') {
        changes.push('⚠️ Não achei a tarefa para editar.');
        continue;
      }
      if (resolved.error === 'ambiguous') {
        changes.push(buildAmbiguousSelectorMessage(resolved.candidates, actionType));
        blockedBySelection = true;
        break;
      }

      const target = resolved.task;
      const idx = workingTasks.findIndex((task) => task.id === target.id);
      const updated = normalizeTaskInput(
        {
          ...target,
          ...(action.updates || {}),
          id: target.id,
          createdAt: target.createdAt,
          source: 'whatsapp',
        },
        target,
        { touch: true }
      );
      workingTasks[idx] = updated;
      hasMutation = true;
      if (!updated.completedAt && updated.startTime) {
        remindableTasks.push(updated);
      }
      const when = `${updated.date}${updated.startTime ? ` ${updated.startTime}` : ''}`;
      changes.push(`✅ Atualizei (${String(updated.id).slice(0, 6)}) ${updated.title} para ${when}.`);
      continue;
    }

    if (actionType === 'append_step') {
      const resolved = resolveTaskSelector(workingTasks, selectorFromAction(action));
      if (resolved.error === 'missing_selector') {
        changes.push(buildMissingSelectorMessage(actionType));
        blockedBySelection = true;
        break;
      }
      if (resolved.error === 'not_found') {
        changes.push('⚠️ Não achei a tarefa para adicionar subtarefa.');
        continue;
      }
      if (resolved.error === 'ambiguous') {
        changes.push(buildAmbiguousSelectorMessage(resolved.candidates, actionType));
        blockedBySelection = true;
        break;
      }

      const target = resolved.task;
      const idx = workingTasks.findIndex((task) => task.id === target.id);
      if (idx < 0) continue;

      const newStep = {
        text: String(action?.step?.text || '').trim(),
        time: Number.isFinite(Number(action?.step?.time)) ? Number(action.step.time) : 15,
        done: false,
      };
      if (!newStep.text) {
        changes.push('⚠️ Não consegui identificar o texto da subtarefa.');
        continue;
      }

      const nextSteps = [...(Array.isArray(target.steps) ? target.steps : []), newStep];
      const updated = normalizeTaskInput(
        {
          ...target,
          steps: nextSteps,
          source: 'whatsapp',
        },
        target,
        { touch: true }
      );
      workingTasks[idx] = updated;
      hasMutation = true;
      changes.push(`✅ Adicionei a subtarefa em "${updated.title}": ${newStep.text}.`);
      continue;
    }

    if (actionType === 'delete') {
      const resolved = resolveTaskSelector(workingTasks, selectorFromAction(action));
      if (resolved.error === 'missing_selector') {
        changes.push(buildMissingSelectorMessage(actionType));
        blockedBySelection = true;
        break;
      }
      if (resolved.error === 'not_found') {
        changes.push('⚠️ Não achei a tarefa para excluir.');
        continue;
      }
      if (resolved.error === 'ambiguous') {
        changes.push(buildAmbiguousSelectorMessage(resolved.candidates, actionType));
        blockedBySelection = true;
        break;
      }
      const target = resolved.task;
      const idx = workingTasks.findIndex((task) => task.id === target.id);
      if (idx >= 0) {
        workingTasks.splice(idx, 1);
        hasMutation = true;
        changes.push(`🗑️ Excluí (${String(target.id).slice(0, 6)}) ${target.title}.`);
      }
      continue;
    }

    if (actionType === 'complete') {
      const resolved = resolveTaskSelector(workingTasks, selectorFromAction(action));
      if (resolved.error === 'missing_selector') {
        changes.push(buildMissingSelectorMessage(actionType));
        blockedBySelection = true;
        break;
      }
      if (resolved.error === 'not_found') {
        const resolvedIncludingCompleted = resolveTaskSelector(
          workingTasks,
          selectorFromAction(action),
          { includeCompleted: true }
        );
        if (resolvedIncludingCompleted?.task?.completedAt) {
          const doneTask = resolvedIncludingCompleted.task;
          changes.push(`ℹ️ Essa tarefa já estava concluída: (${String(doneTask.id).slice(0, 6)}) ${doneTask.title}.`);
          continue;
        }
        changes.push('⚠️ Não achei a tarefa para concluir.');
        continue;
      }
      if (resolved.error === 'ambiguous') {
        changes.push(buildAmbiguousSelectorMessage(resolved.candidates, actionType));
        blockedBySelection = true;
        break;
      }
      const target = resolved.task;
      const idx = workingTasks.findIndex((task) => task.id === target.id);
      if (idx >= 0) {
        workingTasks[idx] = normalizeTaskInput(
          {
            ...target,
            completedAt: nowISO(),
            source: 'whatsapp',
          },
          target,
          { touch: true }
        );
        hasMutation = true;
        changes.push(`🏁 Marquei como concluída: (${String(target.id).slice(0, 6)}) ${target.title}.`);
      }
      continue;
    }

    if (actionType === 'list') {
      listOutputs.push(buildAgendaResumo(workingTasks, action.date || todayLocalISO()));
    }
  }

  if (commit && hasMutation && !blockedBySelection) {
    await writeAgendaData(workingTasks);
  }

  return {
    workingTasks,
    changes,
    listOutputs,
    remindableTasks,
    hasMutation,
    blockedBySelection,
  };
}

function formatTaskHeadline(task = {}) {
  const time = task.startTime ? ` às ${task.startTime}` : '';
  return `${task.title || 'Tarefa sem título'}${time}`;
}

function buildTaskReminderMessage(task = {}, options = {}) {
  const minutesBefore = Number.isFinite(Number(options.minutesBefore))
    ? Number(options.minutesBefore)
    : WHATSAPP_TASK_REMINDER_MINUTES;
  const isNow = minutesBefore === 0;
  const base = isNow
    ? `⏰ Sergio, agora é hora de "${formatTaskHeadline(task)}" (${task.frente || 'pessoal'}).`
    : `Lembrete: em ${minutesBefore} minuto(s), o senhor tem "${formatTaskHeadline(task)}" (${task.frente || 'pessoal'}).`;
  return ensureWhatsAppResponseStyle(base, {
    question: isNow ? 'O senhor quer ajuda para começar agora?' : 'O senhor precisa de algo para essa tarefa?',
    suggestions: [
      'quebrar essa tarefa em passos rápidos',
      'revisar os materiais necessários',
      'ajustar o horário se o senhor estiver sem margem',
    ],
  });
}

function buildReminderAssuranceMessage(remindableTasks = []) {
  const unique = [];
  const seen = new Set();
  for (const task of remindableTasks) {
    const id = String(task?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(task);
  }

  if (unique.length === 0) return null;
  const now = new Date();
  const lines = ['Vou lembrar o senhor no WhatsApp também:'];
  unique.slice(0, 3).forEach((task) => {
    const atTime = task.followUpTime || task.startTime || '--:--';
    if (task.followUpDaily) {
      lines.push(`- ${task.title} todos os dias às ${atTime}`);
    } else {
      lines.push(`- ${task.title} às ${atTime}`);
    }
  });
  if (WHATSAPP_REMINDER_AT_TIME_ENABLED) {
    lines.push('- aviso no horário exato');
  }
  const hasLeadWindow = unique.some((task) => {
    if (!task?.date || !task?.startTime) return false;
    const due = new Date(`${task.date}T${task.startTime}:00`);
    if (Number.isNaN(due.getTime())) return false;
    const diffMinutes = (due.getTime() - now.getTime()) / 60000;
    return diffMinutes > WHATSAPP_TASK_REMINDER_MINUTES;
  });
  if (WHATSAPP_TASK_REMINDER_MINUTES > 0 && hasLeadWindow) {
    lines.push(`- aviso ${WHATSAPP_TASK_REMINDER_MINUTES} min antes`);
  }
  return lines.join('\n');
}

function buildDailyFollowupPromptMessage(task = {}) {
  const { clientName, subject } = extractClientAndSubjectFromTask(task);
  const lines = [
    `🔔 Senhor Sergio, sobre ${clientName}:`,
    `Já confirmou "${subject}"?`,
    'Me responda: "sim" ou "ainda não".',
  ];
  return ensureWhatsAppResponseStyle(lines.join('\n'), {
    question: 'Precisa de mais alguma coisa agora, senhor?',
  });
}

function buildCollectionSuggestedMessage(task = {}) {
  const { clientName, subject } = extractClientAndSubjectFromTask(task);
  const client = clientName || 'cliente';
  const topic = subject || 'esse item pendente';
  return `Boa tarde, ${client}. Sei que a rotina está corrida por aí.\n\nConsegue aprovar "${topic}" hoje para eu dar sequência no projeto?\n\nSe preferir, posso te explicar em 1 minuto o próximo passo.`;
}

function registerReminderDispatch(payload = {}) {
  const kind = String(payload?.kind || '');
  const task = payload?.task || null;
  if (kind !== 'daily_followup_check' || !task?.id) return;

  const { clientName, subject } = extractClientAndSubjectFromTask(task);
  pushPendingDailyFollowupCheck({
    taskId: task.id,
    clientName,
    subject,
    dayKey: payload?.dateKey || todayLocalISO(),
  });
}

async function completeTaskById(taskId = '') {
  const id = String(taskId || '').trim();
  if (!id) return null;

  const agenda = await readAgendaData();
  const idx = agenda.tasks.findIndex((task) => String(task.id) === id);
  if (idx < 0) return null;
  const target = agenda.tasks[idx];
  if (target.completedAt) return target;

  const completed = normalizeTaskInput(
    {
      ...target,
      completedAt: nowISO(),
      source: 'whatsapp',
    },
    target,
    { touch: true }
  );
  const next = [...agenda.tasks];
  next[idx] = completed;
  await writeAgendaData(next);
  return completed;
}

async function buildEndOfDayReportMessage() {
  return ensureWhatsAppResponseStyle(
    'Pode ir dormir e descansar tranquilo, senhor, que eu vou seguir trabalhando e cuidando da agenda por aqui.',
    { appendQuestion: false }
  );
}

async function buildWeeklyCostReportMessage() {
  const summary = await getUsageSummary('last_7_days');
  return buildUsageSummaryMessage(summary, {
    prioritizeWhatsApp: true,
    ask: true,
  });
}

async function transcribeAudioForWhatsApp({ base64Data, mimeType, fileName } = {}) {
  if (!API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada. Defina a chave no .env para transcrever áudio.');
  }
  if (!base64Data) {
    throw new Error('Áudio vazio para transcrição.');
  }

  const cleanMime = String(mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
  const safeMime = cleanMime.startsWith('audio/') ? cleanMime : 'audio/ogg';
  const extensionByMime = {
    'audio/ogg': 'ogg',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
  };
  const extension = extensionByMime[safeMime] || 'ogg';
  const safeFileName = String(fileName || `audio-whatsapp-${Date.now()}.${extension}`).trim();

  const binary = Buffer.from(base64Data, 'base64');
  if (!binary.length) {
    throw new Error('Não consegui ler o áudio recebido.');
  }
  if (binary.length > WHATSAPP_AUDIO_MAX_BYTES) {
    const sizeMb = (binary.length / (1024 * 1024)).toFixed(1);
    throw new Error(
      `Seu áudio tem ${sizeMb}MB e excede o limite de ${WHATSAPP_AUDIO_MAX_MB}MB para transcrição de uma vez.`
    );
  }

  const formData = new FormData();
  formData.append('model', TRANSCRIBE_MODEL);
  if (TRANSCRIBE_RESPONSE_FORMAT) {
    formData.append('response_format', TRANSCRIBE_RESPONSE_FORMAT);
  }
  formData.append('language', 'pt');
  formData.append(
    'prompt',
    'Transcrição em português brasileiro. Contexto: produtividade, agenda, tarefas, taka, haldan, pessoal, reunião, follow-up, SEO, WordPress, conteúdo. Corrija pontuação e mantenha nomes próprios.'
  );
  formData.append('file', new Blob([binary], { type: safeMime }), safeFileName);

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
    },
    body: formData,
  });

  const bodyText = await response.text();
  let data = null;
  try {
    data = JSON.parse(bodyText);
  } catch {
    data = null;
  }

  if (!response.ok || data?.error) {
    const message = data?.error?.message || bodyText || `Erro HTTP ${response.status} na transcrição de áudio`;
    throw new Error(message);
  }

  const transcriptText = String(data?.text || bodyText || '').trim();
  let durationSeconds = Number(data?.duration || 0);
  if (!(durationSeconds > 0) && Array.isArray(data?.segments)) {
    const maxSegmentEnd = data.segments.reduce((acc, segment) => {
      const end = Number(segment?.end || 0);
      return end > acc ? end : acc;
    }, 0);
    durationSeconds = maxSegmentEnd > 0 ? maxSegmentEnd : 0;
  }

  const audioMinutes = durationSeconds > 0 ? (durationSeconds / 60) : 0;
  const usd = audioMinutes * OPENAI_PRICE_TRANSCRIBE_PER_MIN;

  appendUsageEvent({
    source: 'openai',
    endpoint: 'audio.transcriptions',
    usageKind: 'whatsapp_transcribe',
    model: TRANSCRIBE_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    audioMinutes,
    usd,
    mimeType: safeMime,
    durationSeconds,
  }).catch((err) => {
    console.error('[Usage] Erro ao gravar consumo de transcrição:', err.message);
  });

  return transcriptText;
}

// ─── System Prompt compartilhado (SER Coach) ───
const SER_COACH_PROMPT = `Você é o SER Coach do senhor Sergio no Sistema SER.
Foco: produtividade sustentável + bem-estar.

Contexto fixo:
- 3 frentes: Estúdio Taka, Haldan, Pessoal.
- Usa Pomodoro (25/5), tende a sobrecarga.
- Família é prioridade (Mari e chegada do filho).

Diretrizes:
- Trate sempre como "senhor" (nunca "você").
- Respostas curtas (2-4 linhas), claras e práticas.
- Se travou: identifique se é energia, decisão ou informação e proponha 1 próximo passo.
- Se tarefa difícil: quebre em blocos de 10-15 min.
- Se agenda estiver pesada: priorize top 3 e adie o restante.
- Após 20h: sugerir encerramento e recuperação.
- No máximo 1 emoji por resposta.
- Se sair do escopo (produtividade/bem-estar), redirecione com educação.`;

const WHATSAPP_AGENT_PROMPT = `Você é o SER WhatsApp Agent (PT-BR). Objetivo: conversar com o senhor Sergio e operar agenda com precisão.

Retorne APENAS JSON:
{"reply":"texto","actions":[{"type":"create|update|append_step|delete|complete|list","task":{},"selector":{},"updates":{},"step":{"text":"string","time":15},"date":"YYYY-MM-DD"}],"ask":null}

Regras de execução:
- Use actions somente para agenda.
- concluir/finalizar => type:"complete".
- mover/reagendar => type:"update" com updates.date e/ou updates.startTime.
- mudar frente => type:"update" com updates.frente.
- cobrar todo dia => followUpDaily=true e followUpTime="HH:MM".
- Em create, task.title é obrigatório: gere um título curto e claro a partir da frase do usuário.
- Se faltar referência da tarefa, actions=[] e peça nome exato ou código curto.
- Se a frente não estiver clara ao criar, pergunte: "Taka, Haldan ou Pessoal?".
- Se CONTEXTO_AGENDA_DISPONIVEL=false, não assuma tarefa existente para update/delete/complete.
- Não invente IDs.
- Datas em YYYY-MM-DD e horário em HH:MM ou null.
- Texto curto, profissional e chamando o usuário de "senhor".

Frentes: taka|haldan|pessoal.
Tipos: Reunião|SEO|WordPress|Conteúdo|Follow-up|Proposta|Gestão equipe|Alimentação|Esporte|Casa|Outro.`;

function shouldSendAgendaContextToWhatsAppModel(text = '') {
  const n = normalizeText(text);
  if (!n) return false;
  if (hasMutatingIntentText(n)) return true;
  return /(agenda|tarefa|tarefas|compromisso|compromissos|lembrete|reuniao|horario|hora|dia|amanha|semana|segunda|terca|quarta|quinta|sexta|sabado|domingo|prioridad|planej)/.test(n);
}

async function processWhatsAppMessage({ text, sourceType = 'text', senderNumber = '' }) {
  const userText = String(text || '').trim();
  if (!userText) {
    return ensureWhatsAppResponseStyle('Não consegui entender essa mensagem. Tenta mandar em uma frase simples.');
  }

  const pendingReminder = getPendingReminder(senderNumber);
  if (pendingReminder) {
    if (isNegativeConfirmation(userText)) {
      clearPendingReminder(senderNumber);
      return ensureWhatsAppResponseStyle(
        'Perfeito, senhor. Cancelei esse lembrete pendente.',
        { question: 'Precisa de mais alguma coisa agora, senhor?' }
      );
    }

    const temporalReply = inferTemporalHintsFromText(userText);
    if (temporalReply.explicitTime) {
      const draftTask = {
        ...(pendingReminder.task || {}),
        date: temporalReply.explicitDate
          ? temporalReply.date
          : (pendingReminder.task?.date || todayLocalISO()),
        startTime: temporalReply.startTime,
        source: 'whatsapp',
      };
      const repairedActions = await hardenWhatsAppActions(
        [{ type: 'create', task: draftTask }],
        {
          userText: pendingReminder.rawUserText || userText,
          sourceType: pendingReminder.sourceType || sourceType,
        }
      );
      const agendaNow = await readAgendaData();
      const execReminder = await executeWhatsAppActions({
        actions: repairedActions,
        tasks: sortAgendaTasks(agendaNow.tasks),
        commit: true,
      });
      clearPendingReminder(senderNumber);
      const parts = ['Perfeito, senhor. Lembrete programado.'];
      if (execReminder.changes.length > 0) parts.push(execReminder.changes.join('\n'));
      const assurance = buildReminderAssuranceMessage(execReminder.remindableTasks);
      if (assurance) parts.push(assurance);
      return ensureWhatsAppResponseStyle(parts.join('\n\n'));
    }

    return ensureWhatsAppResponseStyle(
      'Perfeito, senhor. Ainda preciso do horário desse lembrete.',
      { question: 'Pode me enviar no formato 12:30 ou "daqui 5 minutos"?' }
    );
  }

  const simpleTimeReply = inferTimeFromText(userText);
  const looksLikeBareTime = Boolean(simpleTimeReply?.explicitTime) && (
    /^([01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)?$/i.test(String(userText).trim()) ||
    /^meio[\s-]?dia(?:\s*e\s*(?:\d{1,2}|[a-zçãéêíóôú\s]+))?$/i.test(normalizeText(userText))
  );

  const pendingTitle = getPendingTitleClarification(senderNumber);
  if (pendingTitle && !hasMutatingIntentText(userText) && !looksLikeBareTime) {
    const candidateTitle = normalizeCreateTitle(userText);
    if (!isWeakTaskTitle(candidateTitle)) {
      const draft = {
        ...(pendingTitle.task || {}),
        title: candidateTitle,
        source: 'whatsapp',
      };
      const agendaNow = await readAgendaData();
      const execPending = await executeWhatsAppActions({
        actions: [{ type: 'create', task: draft }],
        tasks: sortAgendaTasks(agendaNow.tasks),
        commit: true,
      });
      clearPendingTitleClarification(senderNumber);
      const parts = ['Perfeito, senhor. Criei com o título informado.'];
      if (execPending.changes.length > 0) parts.push(execPending.changes.join('\n'));
      const assurance = buildReminderAssuranceMessage(execPending.remindableTasks);
      if (assurance) parts.push(assurance);
      return ensureWhatsAppResponseStyle(parts.join('\n\n'));
    }
  }

  const waStatus = getStatus();
  if (senderNumber && !String(waStatus?.phoneNumber || '').trim()) {
    setPhoneNumber(senderNumber);
    if (waStatus?.remindersEnabled === false) {
      setRemindersEnabled(true);
    }
    startWhatsAppAgent();
  }

  const pending = getPendingAudioConfirmation(senderNumber);
  if (WHATSAPP_AUDIO_REQUIRE_CONFIRM && pending) {
    if (isAffirmativeConfirmation(userText)) {
      clearPendingAudioConfirmation(senderNumber);
      const agendaNow = await readAgendaData();
      const exec = await executeWhatsAppActions({
        actions: pending.actions,
        tasks: sortAgendaTasks(agendaNow.tasks),
        commit: true,
      });

      const applied = ['Perfeito, confirmado. Apliquei as alterações do áudio.'];
      if (exec.changes.length > 0) applied.push(exec.changes.join('\n'));
      const assurance = buildReminderAssuranceMessage(exec.remindableTasks);
      if (assurance) applied.push(assurance);
      if (exec.listOutputs.length > 0) applied.push(exec.listOutputs.join('\n\n'));
      return ensureWhatsAppResponseStyle(applied.join('\n\n'));
    }

    if (isNegativeConfirmation(userText)) {
      clearPendingAudioConfirmation(senderNumber);
      return ensureWhatsAppResponseStyle(
        'Beleza, cancelei as alterações daquele áudio. Nada foi alterado na agenda.',
        {
          question: 'O senhor quer tentar de novo com outro áudio ou texto?',
          suggestions: [
            'regravar o áudio com a instrução',
            'me mandar em texto para eu aplicar direto',
            'mostrar como está sua agenda agora',
          ],
        }
      );
    }

    return ensureWhatsAppResponseStyle(
      'Tenho uma alteração pendente do seu áudio. Responda "confirmar" para aplicar ou "cancelar" para descartar.',
      {
        question: 'O senhor quer confirmar ou cancelar essa alteração?',
        suggestions: [
          'confirmar',
          'cancelar',
          'mostrar um resumo da agenda antes de decidir',
        ],
      }
    );
  }
  if (!WHATSAPP_AUDIO_REQUIRE_CONFIRM && pending) {
    clearPendingAudioConfirmation(senderNumber);
  }

  const pendingDailyFollowup = peekPendingDailyFollowupCheck();
  if (pendingDailyFollowup) {
    if (isAffirmativeFollowUpAnswer(userText)) {
      const answered = shiftPendingDailyFollowupCheck();
      const completed = await completeTaskById(answered?.taskId || '');
      if (completed) {
        return ensureWhatsAppResponseStyle(
          `Perfeito. Marquei como concluída: ${completed.title}.`,
          { question: 'Precisa de mais alguma coisa agora, senhor?' }
        );
      }
      return ensureWhatsAppResponseStyle(
        'Perfeito. Registrei que já foi aprovado.',
        { question: 'Precisa de mais alguma coisa agora, senhor?' }
      );
    }

    if (isNegativeFollowUpAnswer(userText)) {
      const answered = shiftPendingDailyFollowupCheck();
      const agendaNow = await readAgendaData();
      const task = agendaNow.tasks.find((item) => String(item.id) === String(answered?.taskId || '')) || {};
      const suggested = buildCollectionSuggestedMessage(task);
      return ensureWhatsAppResponseStyle(
        `Entendi. Ainda está pendente.\n\n💬 Mensagem sugerida para cobrar:\n${suggested}`,
        { question: 'Precisa de mais alguma coisa agora, senhor?' }
      );
    }
  }

  let parsed = null;
  const agenda = await readAgendaData();
  const tasks = sortAgendaTasks(agenda.tasks);
  const includeAgendaContext = shouldSendAgendaContextToWhatsAppModel(userText);
  const agendaContext = includeAgendaContext
    ? formatAgendaForPrompt(tasks, {
      userText,
      limit: WHATSAPP_CONTEXT_TASK_LIMIT,
    })
    : '- (omitido para reduzir tokens)';
  const rawUserPayload = sourceType === 'audio'
    ? `Mensagem transcrita de áudio: ${userText}`
    : userText;
  const userPayload = trimTextForModel(rawUserPayload, 1000);
  const likelyMutatingIntent = hasMutatingIntentText(userText);

  if (hasPriorityIntent(userText)) {
    return agendaAwarePriorityMessage(tasks);
  }

  if (isUsageHelpIntent(userText)) {
    return buildUsageHelpMessage();
  }

  const usagePeriod = detectUsageSummaryPeriod(userText);
  if (usagePeriod) {
    const summary = await getUsageSummary(usagePeriod);
    const prioritizeWhatsApp = normalizeText(userText).includes('whatsapp');
    return buildUsageSummaryMessage(summary, { prioritizeWhatsApp });
  }

  const agendaListIntent = detectAgendaListIntent(userText);
  if (agendaListIntent) {
    return buildAgendaIntentMessage(tasks, agendaListIntent.date);
  }

  if (isAcknowledgementIntent(userText)) {
    return ensureWhatsAppResponseStyle('Perfeito, senhor.', {
      question: 'Precisa de mais alguma coisa agora, senhor?',
    });
  }

  const quickOperational = inferQuickOperationalActions(userText);
  if (quickOperational) {
    parsed = quickOperational;
  }

  const directReminder = !parsed
    ? inferDirectReminderCreateAction(userText, { sourceType })
    : null;
  if (!parsed && directReminder?.needsTime) {
    if (senderNumber) {
      const subject = extractReminderSubjectFromText(userText);
      const titleHeuristic = inferCreateTitleHeuristic(userText, { detail: subject || null });
      setPendingReminder(senderNumber, {
        rawUserText: userText,
        sourceType,
        task: {
          title: !isWeakTaskTitle(titleHeuristic) ? titleHeuristic : 'Lembrete importante',
          detail: subject ? `Lembrar de: ${normalizeCreateTitle(subject)}` : null,
          frente: inferFrenteFromText(userText),
          type: inferTypeFromText(userText),
          date: todayLocalISO(),
        },
      });
    }
    return ensureWhatsAppResponseStyle(
      'Perfeito, senhor. Eu programo esse lembrete, mas preciso do horário exato.',
      { question: 'Que horas o senhor quer que eu avise?' }
    );
  }
  if (!parsed && directReminder?.action) {
    parsed = {
      reply: 'Perfeito, senhor. Vou programar esse lembrete no WhatsApp.',
      actions: [directReminder.action],
      ask: null,
    };
  }

  const quickAppendAction = inferAppendStepAction(userText);
  if (!parsed && quickAppendAction) {
    parsed = {
      reply: 'Perfeito. Vou adicionar essa subtarefa na tarefa indicada.',
      actions: [quickAppendAction],
      ask: null,
    };
  }

  const prompt = `${WHATSAPP_AGENT_PROMPT}

DATA_ATUAL: ${todayLocalISO()}
CONTEXTO_AGENDA_DISPONIVEL: ${includeAgendaContext ? 'true' : 'false'}
AGENDA_ATUAL:
${agendaContext}`;

  if (!parsed) {
    try {
      const contextMessages = likelyMutatingIntent
        ? []
        : getWhatsAppConversationContext(senderNumber);
      const raw = await callOpenAI(
        prompt,
        [...contextMessages, { role: 'user', content: userPayload }],
        WHATSAPP_AGENT_MAX_TOKENS,
        {
          model: WHATSAPP_MODEL,
          expectJson: true,
          temperature: 0,
          usageKind: 'whatsapp_agent',
          cache: !likelyMutatingIntent,
          cacheTtlMs: 120000,
        }
      );
      parsed = parseJSONFromLLM(raw);
    } catch (error) {
      if (String(error.message || '').includes('OPENAI_API_KEY')) {
        return ensureWhatsAppResponseStyle('A chave da OpenAI não está configurada no servidor. Ajuste o .env e reinicie.');
      }
      console.error('[WhatsApp Agent] Erro:', error.message);
      return ensureWhatsAppResponseStyle('Tive um erro agora e não consegui processar. Tenta de novo em instantes.');
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return ensureWhatsAppResponseStyle('Não consegui interpretar direito agora. Me manda de novo em uma frase simples.');
  }

  const actionsRaw = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [];
  const temporalHints = inferTemporalHintsFromText(userText);
  const actionsWithTemporal = applyTemporalHintsToActions(actionsRaw, temporalHints);
  const actionsWithDailyFollowup = applyDailyFollowUpHintsToActions(actionsWithTemporal, userText, temporalHints);
  const actionsWithFrente = applyFrenteHintsToActions(actionsWithDailyFollowup, userText);
  let actions = await hardenWhatsAppActions(actionsWithFrente, { userText, sourceType });
  const mutatingIntent = likelyMutatingIntent;

  if (mutatingIntent && actions.length === 0 && hasCreateIntentText(userText)) {
    const fallbackTitle = await inferCreateTitleSmart(userText, {});
    const fallbackTask = {
      title: fallbackTitle,
      detail: sourceType === 'audio' ? trimTextForModel(userText, 220) : null,
      frente: inferFrenteFromText(userText),
      type: inferTypeFromText(userText),
      date: temporalHints.explicitDate ? temporalHints.date : todayLocalISO(),
      startTime: temporalHints.explicitTime ? temporalHints.startTime : null,
      source: 'whatsapp',
    };
    actions = await hardenWhatsAppActions(
      [{ type: 'create', task: fallbackTask }],
      { userText, sourceType }
    );
  }

  const hasMutatingActions = actions.some((action) => isMutatingActionType(action?.type));
  const hasCreateAction = actions.some((action) => String(action?.type || '').toLowerCase() === 'create');

  if (mutatingIntent && actions.length === 0) {
    if (senderNumber && hasCreateIntentText(userText)) {
      const temporalHintsLocal = inferTemporalHintsFromText(userText);
      setPendingTitleClarification(senderNumber, {
        task: {
          detail: sourceType === 'audio' ? trimTextForModel(userText, 220) : null,
          frente: inferFrenteFromText(userText),
          type: inferTypeFromText(userText),
          date: temporalHintsLocal.explicitDate ? temporalHintsLocal.date : todayLocalISO(),
          startTime: temporalHintsLocal.explicitTime ? temporalHintsLocal.startTime : null,
        },
      });
    }
    return ensureWhatsAppResponseStyle(
      'Entendi a solicitação, senhor, mas não consegui mapear a tarefa com segurança.',
      {
        question: 'Pode me mandar o nome exato da tarefa ou o código curto entre parênteses?',
      }
    );
  }

  // Se configurado, exige confirmação explícita para mutações vindas de áudio.
  if (WHATSAPP_AUDIO_REQUIRE_CONFIRM && sourceType === 'audio' && hasMutatingActions) {
    const preview = await executeWhatsAppActions({
      actions,
      tasks,
      commit: false,
    });

    setPendingAudioConfirmation(senderNumber, {
      actions,
      createdAt: Date.now(),
    });

    const previewParts = [];
    if (typeof parsed.reply === 'string' && parsed.reply.trim()) previewParts.push(parsed.reply.trim());
    if (preview.changes.length > 0) previewParts.push(preview.changes.join('\n'));
    if (preview.listOutputs.length > 0) previewParts.push(preview.listOutputs.join('\n\n'));
    previewParts.push('⚠️ Esse comando veio por áudio. Para segurança, ainda NÃO apliquei.');
    previewParts.push('Responde "confirmar" para aplicar ou "cancelar" para descartar.');

    return ensureWhatsAppResponseStyle(previewParts.join('\n\n'), {
      question: 'Quer confirmar ou cancelar essa alteração de áudio?',
      suggestions: [
        'confirmar',
        'cancelar',
        'me mostrar a agenda de hoje antes de decidir',
      ],
    });
  }

  const exec = await executeWhatsAppActions({
    actions,
    tasks,
    commit: true,
  });
  if (hasCreateAction) {
    clearPendingTitleClarification(senderNumber);
    clearPendingReminder(senderNumber);
  }

  if (exec.blockedBySelection) {
    return ensureWhatsAppResponseStyle(exec.changes.join('\n\n'));
  }

  const responseParts = [];
  if (typeof parsed.reply === 'string' && parsed.reply.trim()) responseParts.push(parsed.reply.trim());
  if (exec.changes.length > 0) responseParts.push(exec.changes.join('\n'));
  const assurance = buildReminderAssuranceMessage(exec.remindableTasks);
  if (assurance) responseParts.push(assurance);
  if (exec.listOutputs.length > 0) responseParts.push(exec.listOutputs.join('\n\n'));
  if (typeof parsed.ask === 'string' && parsed.ask.trim()) responseParts.push(parsed.ask.trim());

  if (responseParts.length === 0) {
    responseParts.push('Fechado. Se quiser, te mostro agora a agenda de hoje.');
  }

  const finalResponse = ensureWhatsAppResponseStyle(responseParts.join('\n\n'));
  if (!mutatingIntent && !hasMutatingActions) {
    saveWhatsAppConversationTurn(senderNumber, userPayload, finalResponse);
  }
  return finalResponse;
}

function startWhatsAppAgent() {
  startReminders(callOpenAI, SER_COACH_PROMPT, {
    onIncomingMessage: processWhatsAppMessage,
    openAIOptions: { model: WHATSAPP_MODEL, usageKind: 'whatsapp_fallback' },
    transcribeAudio: transcribeAudioForWhatsApp,
    getAgendaTasks: async () => {
      const agenda = await readAgendaData();
      return agenda.tasks;
    },
    buildTaskReminderMessage: buildTaskReminderMessage,
    buildDailyFollowUpCheckMessage: buildDailyFollowupPromptMessage,
    onReminderSent: registerReminderDispatch,
    buildEndOfDayReportMessage,
    buildWeeklyCostReportMessage,
    reminderLeadMinutes: WHATSAPP_TASK_REMINDER_MINUTES,
    reminderOffsetsMinutes: WHATSAPP_REMINDER_OFFSETS_MINUTES,
    dailyFollowUpDefaultTime: WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME,
    endOfDayHour: WHATSAPP_END_REPORT_HOUR,
    endOfDayMinute: WHATSAPP_END_REPORT_MINUTE,
    weeklyCostReportEnabled: WHATSAPP_WEEKLY_COST_REPORT_ENABLED,
    weeklyCostReportDay: WHATSAPP_WEEKLY_COST_REPORT_DAY,
    weeklyCostReportHour: WHATSAPP_WEEKLY_COST_REPORT_HOUR,
    weeklyCostReportMinute: WHATSAPP_WEEKLY_COST_REPORT_MINUTE,
  });
}

// ─── Chat do assistente IA (consultas gerais) ───
app.post('/api/chat', requireReadAccess, async (req, res) => {
  try {
    const { messages } = req.body;
    const safeMessages = sanitizeMessagesForModel(messages || [], {
      maxMessages: APP_CHAT_HISTORY_LIMIT,
      maxCharsPerMessage: APP_CHAT_MAX_CHARS_PER_MESSAGE,
    });
    const text = await callOpenAI(SER_COACH_PROMPT, safeMessages, CHAT_MAX_TOKENS, {
      model: CHAT_MODEL,
      usageKind: 'app_chat',
      cache: true,
      cacheTtlMs: OPENAI_CACHE_TTL_MS,
    });
    res.json({ text, model: CHAT_MODEL });
  } catch (err) {
    console.error('Erro na API OpenAI (/api/chat):', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat do inbox (classificação de tarefas) ───
app.post('/api/parse-tasks', requireReadAccess, async (req, res) => {
  try {
    const { text, sopKeys } = req.body;
    const safeText = trimTextForModel(text || '', 1800);

    const now = new Date(`${todayLocalISO()}T12:00:00`);
    const today = todayLocalISO();
    const dayNames = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    const todayDow = dayNames[now.getDay()];
    const dayMap = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const name = dayNames[d.getDay()];
      const dateStr = todayLocalISO(d);
      const label = i === 0 ? `${name} (hoje)` : i === 1 ? `${name} (amanhã)` : name;
      dayMap.push(`- "${name}" ou "${name.split('-')[0]}" = ${dateStr} (${label})`);
    }

    const tipos = sopKeys || 'Reunião, SEO, WordPress, Conteúdo, Follow-up, Proposta, Gestão equipe, Alimentação, Esporte, Casa, Outro';

    const systemPrompt = `Assistente de extração do Sistema SER.
Frentes: taka (Estúdio Taka), haldan (gerência), pessoal (casa/saúde).
Tipos válidos: ${tipos}.
HOJE: ${today} (${todayDow}).

Retorne APENAS JSON:
{"tasks":[{"title":"...","frente":"taka|haldan|pessoal","type":"...","estimatedTime":30,"detail":"...","date":"YYYY-MM-DD","startTime":"HH:MM ou null"}],"message":"..."}

Mapa obrigatório dos dias:
${dayMap.join('\n')}

Regras:
- "hoje" = ${today}; "amanhã" = próximo dia.
- Dia da semana deve usar o mapa acima (sem calcular fora dele).
- "semana que vem" = segunda da próxima semana.
- Sem data explícita: use ${today}.
- Horário: "às 14h"/"10:30" => HH:MM; manhã=08:00; tarde=14:00; noite=19:00; sem horário => null.
- Frente padrão: médico/seo/conteúdo/proposta=taka; equipe/haldan=haldan; treino/comida/casa/saúde/mari=pessoal.
- Agrupe frases da mesma tarefa.
- Se não for pedido de tarefas: {"tasks":[],"message":"resposta útil ao senhor Sergio"}.
Sem markdown, sem texto fora do JSON.`;

    const raw = await callOpenAI(systemPrompt, [{ role: 'user', content: safeText }], PARSER_MAX_TOKENS, {
      model: PARSER_MODEL,
      expectJson: true,
      temperature: 0.1,
      usageKind: 'app_parser',
      cache: true,
      cacheTtlMs: OPENAI_CACHE_TTL_MS,
    });
    const parsed = parseJSONFromLLM(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      throw new Error('Resposta da IA de parser não veio em JSON válido.');
    }
    res.json(parsed);
  } catch (err) {
    console.error('Erro no parse de tarefas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usage/summary', requireReadAccess, async (req, res) => {
  try {
    const rawPeriod = String(req.query?.period || 'today').trim();
    const allowed = new Set(['today', 'all_time', 'last_7_days', 'month_current', 'month_last', 'month_prev']);
    const period = allowed.has(rawPeriod) ? rawPeriod : 'today';
    const summary = await getUsageSummary(period);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => {
  const whatsapp = getStatus();
  res.json({
    ok: true,
    ts: nowISO(),
    uptimeSec: Math.round(process.uptime()),
    storage: {
      mode: STORAGE_MODE,
      backend: runtimeStorageBackend,
      supabaseEnabled: isUsingSupabaseStorage(),
      dataDir: DATA_DIR,
      tasksTable: SUPABASE_TASKS_TABLE,
      usageTable: SUPABASE_USAGE_TABLE,
    },
    openai: {
      configured: Boolean(API_KEY),
      models: {
        chat: CHAT_MODEL,
        parser: PARSER_MODEL,
        whatsapp: WHATSAPP_MODEL,
        transcribe: TRANSCRIBE_MODEL,
      },
      cache: {
        ttlMs: OPENAI_CACHE_TTL_MS,
        maxItems: OPENAI_CACHE_MAX_ITEMS,
        size: openaiResponseCache.size,
      },
    },
    auth: {
      enabled: Boolean(ADMIN_TOKEN),
      requireRead: REQUIRE_AUTH_READ,
    },
    whatsapp: {
      status: whatsapp.status,
      remindersEnabled: whatsapp.remindersEnabled,
      phoneConfigured: Boolean(whatsapp.phoneNumber),
      qrcodeReady: Boolean(whatsapp.qrcode),
    },
  });
});

// ─── Agenda (sincronização App + WhatsApp) ───
app.get('/api/agenda/tasks', requireReadAccess, async (_req, res) => {
  try {
    const agenda = await readAgendaData();
    res.json({ tasks: sortAgendaTasks(agenda.tasks) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agenda/sync', requireAdmin, async (req, res) => {
  try {
    const incomingTasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    const normalizedIncoming = sortAgendaTasks(
      incomingTasks.map((task) => normalizeTaskInput(task, {}, { touch: false }))
    );
    const agenda = await readAgendaData();
    const merged = mergeTaskLists(agenda.tasks, normalizedIncoming);
    await writeAgendaData(merged);
    res.json({ ok: true, count: merged.length, tasks: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agenda/tasks', requireAdmin, async (req, res) => {
  try {
    const agenda = await readAgendaData();
    const created = normalizeTaskInput(
      {
        ...(req.body || {}),
        source: 'api',
      },
      {},
      { touch: true }
    );
    const next = sortAgendaTasks([...agenda.tasks, created]);
    await writeAgendaData(next);
    res.json({ ok: true, task: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/agenda/tasks/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const agenda = await readAgendaData();
    const idx = agenda.tasks.findIndex((task) => String(task.id) === String(id));
    if (idx < 0) return res.status(404).json({ error: 'Tarefa não encontrada.' });

    const updated = normalizeTaskInput(
      {
        ...agenda.tasks[idx],
        ...(req.body || {}),
        id: agenda.tasks[idx].id,
        source: 'api',
      },
      agenda.tasks[idx],
      { touch: true }
    );
    const next = [...agenda.tasks];
    next[idx] = updated;
    await writeAgendaData(next);
    return res.json({ ok: true, task: updated });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agenda/tasks/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const agenda = await readAgendaData();
    const next = agenda.tasks.filter((task) => String(task.id) !== String(id));
    await writeAgendaData(next);
    res.json({ ok: true, count: next.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// WHATSAPP — Endpoints (whatsapp-web.js)
// ═══════════════════════════════════════════════════════════════

app.get('/api/whatsapp/qr', requireAdmin, async (_req, res) => {
  try {
    const result = await createInstance();
    res.json(result);
  } catch (err) {
    console.error('Erro ao gerar QR WhatsApp:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/status', requireAdmin, async (_req, res) => {
  try {
    res.json({
      ...getStatus(),
      openAIConfigured: Boolean(API_KEY),
      models: {
        chat: CHAT_MODEL,
        parser: PARSER_MODEL,
        whatsapp: WHATSAPP_MODEL,
        transcribe: TRANSCRIBE_MODEL,
      },
    });
  } catch {
    res.json({ status: 'disconnected' });
  }
});

app.post('/api/whatsapp/config', requireAdmin, (_req, res) => {
  const { phoneNumber, remindersEnabled: remEnabled } = _req.body || {};

  if (phoneNumber !== undefined) {
    const sanitizedPhone = String(phoneNumber || '').replace(/\D/g, '');
    if (sanitizedPhone) {
      setPhoneNumber(sanitizedPhone);
    }
  }
  if (remEnabled !== undefined) {
    setRemindersEnabled(Boolean(remEnabled));
  }

  startWhatsAppAgent();
  res.json(getStatus());
});

await ensureAgendaStorage();
await ensureUsageStorage();

app.listen(PORT, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SISTEMA SER — Servidor rodando!');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`  Frontend: http://localhost:${FRONTEND_PORT}`);
  console.log(`  Backend:  http://localhost:${PORT}`);
  console.log(`  Modelo Chat:      ${CHAT_MODEL}`);
  console.log(`  Modelo Parser:    ${PARSER_MODEL}`);
  console.log(`  Modelo WhatsApp:  ${WHATSAPP_MODEL}`);
  console.log(`  Tokens máx Chat/Parser/WA: ${CHAT_MAX_TOKENS}/${PARSER_MAX_TOKENS}/${WHATSAPP_AGENT_MAX_TOKENS}`);
  console.log(`  Histórico Chat (max msgs/chars): ${APP_CHAT_HISTORY_LIMIT}/${APP_CHAT_MAX_CHARS_PER_MESSAGE}`);
  console.log(`  Cache OpenAI TTL/itens: ${OPENAI_CACHE_TTL_MS}ms/${OPENAI_CACHE_MAX_ITEMS}`);
  console.log(`  Contexto WA (tarefas): ${WHATSAPP_CONTEXT_TASK_LIMIT}`);
  console.log(`  Modelo Áudio:     ${TRANSCRIBE_MODEL}`);
  console.log(`  Limite áudio IA:  ${WHATSAPP_AUDIO_MAX_MB} MB`);
  console.log(`  API Key:  ${API_KEY ? 'CONFIGURADA' : 'NAO CONFIGURADA'}`);
  console.log(`  Auth API: ${ADMIN_TOKEN ? 'token ativo (SER_ADMIN_TOKEN)' : 'desativada'}`);
  console.log(`  Storage: ${runtimeStorageBackend}${isUsingSupabaseStorage() ? ` (${SUPABASE_TASKS_TABLE}/${SUPABASE_USAGE_TABLE})` : ` (${AGENDA_FILE})`}`);
  console.log(`  CORS: ${allowedCorsOrigins.length > 0 ? allowedCorsOrigins.join(', ') : 'liberado (sem filtro explícito)'}`);
  console.log(`  WhatsApp auth path: ${process.env.WHATSAPP_AUTH_PATH || './.wwebjs_auth'}`);
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log(`  Chromium: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
  }
  console.log(`  Lembretes WhatsApp (min antes): ${WHATSAPP_REMINDER_OFFSETS_MINUTES.join(', ')}`);
  console.log(`  Follow-up diário padrão: ${WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME}`);
  console.log(`  Relatório fim do dia: ${String(WHATSAPP_END_REPORT_HOUR).padStart(2, '0')}:${String(WHATSAPP_END_REPORT_MINUTE).padStart(2, '0')}`);
  console.log(`  Relatório semanal de custo: ${WHATSAPP_WEEKLY_COST_REPORT_ENABLED ? 'ativo' : 'desativado'} | dia ${WHATSAPP_WEEKLY_COST_REPORT_DAY} às ${String(WHATSAPP_WEEKLY_COST_REPORT_HOUR).padStart(2, '0')}:${String(WHATSAPP_WEEKLY_COST_REPORT_MINUTE).padStart(2, '0')}`);
  console.log(`  Confirmação de áudio: ${WHATSAPP_AUDIO_REQUIRE_CONFIRM ? 'ativa' : 'desativada'}${WHATSAPP_AUDIO_REQUIRE_CONFIRM ? ` (TTL ${WHATSAPP_AUDIO_CONFIRM_TTL_MINUTES} min)` : ''}`);
  console.log('');
  console.log('  WhatsApp: whatsapp-web.js (com assistente de agenda)');
  console.log('');
  console.log('  Ctrl+C para parar');
  console.log('');

  if (!API_KEY) {
    console.log('  ⚠️  Configure OPENAI_API_KEY no .env para liberar chat e WhatsApp IA.');
  }

  if (process.env.WHATSAPP_NUMBER) {
    setPhoneNumber(process.env.WHATSAPP_NUMBER);
  }
  startWhatsAppAgent();
});

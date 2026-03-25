import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const TASKS_TABLE = String(process.env.SUPABASE_TASKS_TABLE || 'ser_tasks').trim();
const USAGE_TABLE = String(process.env.SUPABASE_USAGE_TABLE || 'ser_usage_events').trim();
const AGENDA_FILE = path.join(projectRoot, 'data', 'agenda.json');
const USAGE_FILE = path.join(projectRoot, 'data', 'usage-log.json');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente antes de rodar a migração.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 10);
}

function normalizeTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)/);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function toTaskRow(task = {}) {
  const createdAt = task.createdAt || new Date().toISOString();
  const updatedAt = task.updatedAt || createdAt;
  return {
    id: String(task.id || crypto.randomUUID()),
    title: String(task.title || 'Tarefa sem título'),
    detail: task.detail ? String(task.detail) : null,
    frente: String(task.frente || 'pessoal'),
    type: String(task.type || 'Outro'),
    date: normalizeDate(task.date),
    start_time: normalizeTime(task.startTime),
    estimated_time: Number.isFinite(Number(task.estimatedTime)) ? Number(task.estimatedTime) : 30,
    steps: Array.isArray(task.steps) ? task.steps : [],
    created_at: createdAt,
    updated_at: updatedAt,
    completed_at: task.completedAt || null,
    follow_up_daily: Boolean(task.followUpDaily),
    follow_up_time: normalizeTime(task.followUpTime),
    follow_up_client: task.followUpClient ? String(task.followUpClient) : null,
    follow_up_subject: task.followUpSubject ? String(task.followUpSubject) : null,
    source: task.source ? String(task.source) : 'app',
  };
}

function toUsageRow(event = {}) {
  const safeEvent = {
    id: String(event.id || crypto.randomUUID()),
    ts: event.ts || new Date().toISOString(),
    ...event,
  };

  const known = new Set([
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
    if (known.has(key)) return;
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

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function upsertInBatches(table, rows, chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`Erro no upsert em ${table}: ${error.message}`);
  }
}

async function main() {
  const agenda = await readJson(AGENDA_FILE, { tasks: [] });
  const usage = await readJson(USAGE_FILE, { events: [] });

  const taskRows = (Array.isArray(agenda.tasks) ? agenda.tasks : []).map(toTaskRow);
  const usageRows = (Array.isArray(usage.events) ? usage.events : []).map(toUsageRow);

  const { error: checkTasksError } = await supabase.from(TASKS_TABLE).select('id').limit(1);
  if (checkTasksError) throw new Error(`Tabela ${TASKS_TABLE} indisponível: ${checkTasksError.message}`);

  const { error: checkUsageError } = await supabase.from(USAGE_TABLE).select('id').limit(1);
  if (checkUsageError) throw new Error(`Tabela ${USAGE_TABLE} indisponível: ${checkUsageError.message}`);

  if (taskRows.length > 0) await upsertInBatches(TASKS_TABLE, taskRows, 400);
  if (usageRows.length > 0) await upsertInBatches(USAGE_TABLE, usageRows, 400);

  console.log(`Migração concluída.`);
  console.log(`- Tarefas enviadas: ${taskRows.length}`);
  console.log(`- Eventos de uso enviados: ${usageRows.length}`);
}

main().catch((err) => {
  console.error(`Falha na migração: ${err.message}`);
  process.exit(1);
});

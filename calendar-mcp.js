// ═══════════════════════════════════════════════════════════════
// SISTEMA SER — MCP Google Calendar (Leitura + Escrita)
// ═══════════════════════════════════════════════════════════════

import { normalizeTime } from './shared-utils.js';

const GOOGLE_ENABLED = process.env.GOOGLE_CALENDAR_ENABLED === 'true';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

// ─── Cache de access token ───
let cachedAccessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => 'Erro desconhecido');
    throw new Error(`Erro ao renovar token Google: ${err}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedAccessToken;
}

// ─── Timezone offset helper ───
function tzOffset() {
  // Offset para America/Sao_Paulo (-03:00 ou -02:00 horário de verão)
  // Simplificado para -03:00 (Brasil não tem mais horário de verão desde 2019)
  return '-03:00';
}

function timeToMinutes(timeStr) {
  const t = normalizeTime(timeStr);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// LEITURA — Buscar eventos do dia
// ═══════════════════════════════════════════════════════════════
export async function getCalendarEvents(date) {
  if (!GOOGLE_ENABLED || !CLIENT_ID || !REFRESH_TOKEN) {
    return [];
  }

  try {
    const token = await getAccessToken();
    const offset = tzOffset();
    const timeMin = `${date}T00:00:00${offset}`;
    const timeMax = `${date}T23:59:59${offset}`;

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) {
      console.error(`[Calendar] Erro ao buscar eventos: HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
    return (data.items || []).map((event) => ({
      id: event.id,
      title: event.summary || 'Sem título',
      start: event.start?.dateTime?.slice(11, 16) || '00:00',
      end: event.end?.dateTime?.slice(11, 16) || '23:59',
      allDay: Boolean(event.start?.date),
      source: 'google_calendar',
    }));
  } catch (err) {
    console.error('[Calendar] Erro:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// ESCRITA — Criar evento quando tarefa é agendada
// ═══════════════════════════════════════════════════════════════
export async function createCalendarEvent(task) {
  if (!GOOGLE_ENABLED || !CLIENT_ID || !REFRESH_TOKEN) {
    return null;
  }

  if (!task.startTime || !task.date) return null;

  try {
    const token = await getAccessToken();
    const offset = tzOffset();

    const startMin = timeToMinutes(task.startTime);
    const endMin = startMin + (task.estimatedTime || 30);
    const endTime = minutesToHHMM(endMin);

    // Cores do Google Calendar por frente
    const colorMap = { taka: '11', haldan: '10', pessoal: '3' };
    const energyEmoji = { pesada: '🔴', media: '🟡', leve: '🟢' };

    const event = {
      summary: `[SER] ${energyEmoji[task.energyLevel] || ''} ${task.title}`,
      description: [
        `Frente: ${task.frente || 'pessoal'}`,
        `Tipo: ${task.type || 'Outro'}`,
        `Energia: ${task.energyLevel || 'media'}`,
        task.detail ? `Detalhe: ${task.detail}` : '',
      ].filter(Boolean).join('\n'),
      start: {
        dateTime: `${task.date}T${task.startTime}:00${offset}`,
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: `${task.date}T${endTime}:00${offset}`,
        timeZone: TIMEZONE,
      },
      colorId: colorMap[task.frente] || '7',
    };

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    if (!res.ok) {
      console.error(`[Calendar] Erro ao criar evento: HTTP ${res.status}`);
      return null;
    }

    const created = await res.json();
    console.log(`[Calendar] Evento criado: ${created.id} — ${task.title}`);
    return created.id;
  } catch (err) {
    console.error('[Calendar] Erro ao criar evento:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXCLUSÃO — Remover evento quando tarefa é deletada
// ═══════════════════════════════════════════════════════════════
export async function deleteCalendarEvent(eventId) {
  if (!GOOGLE_ENABLED || !CLIENT_ID || !REFRESH_TOKEN || !eventId) {
    return false;
  }

  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    return res.ok || res.status === 404;
  } catch (err) {
    console.error('[Calendar] Erro ao deletar evento:', err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// STATUS — Verificar se integração está ativa
// ═══════════════════════════════════════════════════════════════
export function isCalendarEnabled() {
  return GOOGLE_ENABLED && Boolean(CLIENT_ID && REFRESH_TOKEN);
}

export function getCalendarStatus() {
  return {
    enabled: isCalendarEnabled(),
    calendarId: CALENDAR_ID,
    hasCredentials: Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN),
  };
}

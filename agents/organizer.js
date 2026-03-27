// =============================================================================
// Organizer Agent — SER System v4
// Agente responsavel por agendar tarefas nos horarios disponiveis.
// Usa gpt-4o-mini (modelo mais barato) para decisoes de agendamento.
// =============================================================================

import { normalizeTime } from '../shared-utils.js';

// ---------------------------------------------------------------------------
// Constantes de configuracao
// ---------------------------------------------------------------------------

const WORK_START = '06:00';
const WORK_END   = '20:00';
const LUNCH_START = '12:00';
const LUNCH_END   = '13:00';
const BUFFER_MINUTES = 15;

// ---------------------------------------------------------------------------
// System Prompt do Organizer
// ---------------------------------------------------------------------------

export const ORGANIZER_PROMPT = `Voce e o Organizer Agent do SER System v4.
Sua funcao e agendar tarefas nos horarios disponiveis do dia, respeitando regras rigidas.

## Regras de agendamento

1. **Horario de trabalho**: 06:00 ate 20:00. Nunca agende fora desse intervalo.
2. **Nunca sobreponha horarios** (double-book). Cada minuto so pode ter uma tarefa.
3. **Buffer de 15 minutos** entre tarefas consecutivas.
4. **Almoco 12:00-13:00 e sagrado** — nunca agende nada nesse horario.
5. **Tarefas pesadas** (peso = "pesada") devem ser agendadas preferencialmente pela manha (06:00-12:00).
6. **Tarefas leves** (peso = "leve") podem ir para a tarde (14:00-18:00).
7. Se o dia estiver cheio, sugira o proximo dia disponivel.
8. **Respeite deadlines** — se a tarefa tem prazo, agende antes do prazo.

## Formato de resposta

Se conseguir agendar, retorne JSON:
{
  "scheduled": true,
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "conflicts": [],
  "alternativeSlots": [{ "start": "HH:MM", "end": "HH:MM" }],
  "warnings": []
}

Se NAO conseguir encaixar, retorne JSON:
{
  "scheduled": false,
  "reason": "motivo pelo qual nao foi possivel agendar",
  "suggestion": { "date": "YYYY-MM-DD", "startTime": "HH:MM" },
  "alternativeDates": ["YYYY-MM-DD"]
}

Responda APENAS com JSON valido, sem texto adicional.`;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Converte "HH:MM" em minutos desde meia-noite */
function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Converte minutos desde meia-noite em "HH:MM" */
function minutesToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Extrai blocos ocupados (em minutos) a partir da agenda existente e eventos
 * do calendario. Cada bloco e { start, end } em minutos desde meia-noite.
 */
function extractOccupiedBlocks(existingAgenda = [], calendarEvents = []) {
  const blocks = [];

  // Blocos da agenda existente
  for (const item of existingAgenda) {
    const start = normalizeTime(item.startTime || item.start);
    const end   = normalizeTime(item.endTime || item.end);
    if (start && end) {
      blocks.push({ start: timeToMinutes(start), end: timeToMinutes(end) });
    }
  }

  // Blocos dos eventos do calendario
  for (const evt of calendarEvents) {
    const start = normalizeTime(evt.startTime || evt.start);
    const end   = normalizeTime(evt.endTime || evt.end);
    if (start && end) {
      blocks.push({ start: timeToMinutes(start), end: timeToMinutes(end) });
    }
  }

  // Bloco do almoco — sempre reservado
  blocks.push({
    start: timeToMinutes(LUNCH_START),
    end:   timeToMinutes(LUNCH_END),
  });

  // Ordena por inicio
  blocks.sort((a, b) => a.start - b.start);

  return blocks;
}

// ---------------------------------------------------------------------------
// findAvailableSlots — funcao pura, sem IA
// ---------------------------------------------------------------------------

/**
 * Encontra lacunas de tempo disponiveis no dia.
 *
 * @param {string} date - Data no formato "YYYY-MM-DD" (informativo)
 * @param {Array}  existingAgenda - Tarefas ja agendadas [{ startTime, endTime, ... }]
 * @param {Array}  calendarEvents - Eventos do calendario [{ startTime, endTime, ... }]
 * @param {number} durationMinutes - Duracao minima desejada em minutos (filtro opcional)
 * @returns {Array<{ start: string, end: string, durationMinutes: number }>}
 */
export function findAvailableSlots(date, existingAgenda = [], calendarEvents = [], durationMinutes = 0) {
  const blocks = extractOccupiedBlocks(existingAgenda, calendarEvents);
  const slots = [];

  const dayStart = timeToMinutes(WORK_START);
  const dayEnd   = timeToMinutes(WORK_END);

  // Mescla blocos sobrepostos para simplificar a busca de lacunas
  const merged = [];
  for (const block of blocks) {
    // Limita blocos ao horario de trabalho
    const bStart = Math.max(block.start, dayStart);
    const bEnd   = Math.min(block.end, dayEnd);
    if (bStart >= bEnd) continue;

    if (merged.length === 0 || bStart > merged[merged.length - 1].end) {
      merged.push({ start: bStart, end: bEnd });
    } else {
      // Estende o bloco anterior se houver sobreposicao
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, bEnd);
    }
  }

  // Percorre as lacunas entre blocos ocupados
  let cursor = dayStart;

  for (const block of merged) {
    // Adiciona buffer apos a tarefa anterior (se cursor nao e o inicio do dia)
    const effectiveCursor = cursor > dayStart ? cursor + BUFFER_MINUTES : cursor;

    if (effectiveCursor < block.start) {
      const gapStart = effectiveCursor;
      // Termina antes do bloco, com buffer antes do proximo compromisso
      const gapEnd = block.start - BUFFER_MINUTES;

      if (gapEnd > gapStart) {
        const dur = gapEnd - gapStart;
        if (dur >= durationMinutes) {
          slots.push({
            start: minutesToTime(gapStart),
            end:   minutesToTime(gapEnd),
            durationMinutes: dur,
          });
        }
      }
    }

    cursor = Math.max(cursor, block.end);
  }

  // Lacuna final ate o fim do expediente
  const effectiveCursor = cursor > dayStart ? cursor + BUFFER_MINUTES : cursor;
  if (effectiveCursor < dayEnd) {
    const dur = dayEnd - effectiveCursor;
    if (dur >= durationMinutes) {
      slots.push({
        start: minutesToTime(effectiveCursor),
        end:   minutesToTime(dayEnd),
        durationMinutes: dur,
      });
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// callOrganizerAgent — chamada ao modelo GPT-4o-mini
// ---------------------------------------------------------------------------

/**
 * Chama o Organizer Agent para decidir onde encaixar uma tarefa.
 *
 * @param {object} taskData - Dados da tarefa (titulo, duracao, peso, deadline, etc.)
 * @param {Array}  existingAgenda - Tarefas ja agendadas no dia
 * @param {Array}  calendarEvents - Eventos do calendario (Google Calendar, etc.)
 * @param {object} options - { callOpenAI, today, currentTime }
 * @returns {Promise<object>} Resposta do agente com agendamento ou sugestao
 */
export async function callOrganizerAgent(taskData, existingAgenda = [], calendarEvents = [], options = {}) {
  const { callOpenAI, today, currentTime } = options;

  if (!callOpenAI) {
    throw new Error('callOrganizerAgent requer options.callOpenAI');
  }

  // Calcula slots disponiveis para dar contexto ao modelo
  const availableSlots = findAvailableSlots(today, existingAgenda, calendarEvents);

  // Monta a mensagem do usuario com todo o contexto necessario
  const userMessage = `## Contexto

Data de hoje: ${today || 'nao informada'}
Hora atual: ${currentTime || 'nao informada'}

## Tarefa a agendar

${JSON.stringify(taskData, null, 2)}

## Agenda existente do dia

${existingAgenda.length > 0 ? JSON.stringify(existingAgenda, null, 2) : 'Nenhuma tarefa agendada ainda.'}

## Eventos do calendario

${calendarEvents.length > 0 ? JSON.stringify(calendarEvents, null, 2) : 'Nenhum evento no calendario.'}

## Slots disponiveis (calculados automaticamente)

${availableSlots.length > 0 ? JSON.stringify(availableSlots, null, 2) : 'Nenhum slot disponivel neste dia.'}

Agende a tarefa no melhor horario disponivel. Retorne APENAS JSON.`;

  const response = await callOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0,
    maxTokens: 300,
    expectJson: true,
    usageKind: 'organizer_agent',
    messages: [
      { role: 'system', content: ORGANIZER_PROMPT },
      { role: 'user',   content: userMessage },
    ],
  });

  return response;
}

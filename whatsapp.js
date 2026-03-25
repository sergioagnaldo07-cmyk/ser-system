// ═══════════════════════════════════════════════════════════════
// SISTEMA SER — Módulo WhatsApp via whatsapp-web.js
// Sem Docker, roda direto no Node.js
// ═══════════════════════════════════════════════════════════════

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';
import {
  normalizeText as sharedNormalizeText,
  normalizeTime as sharedNormalizeTime,
  todayLocalISO as sharedTodayLocalISO,
} from './shared-utils.js';

// ─── Estado local ───
let connectionStatus = 'disconnected';
let qrCodeBase64 = null;
let userPhoneNumber = process.env.WHATSAPP_NUMBER || '';
const whatsappAuthPath = process.env.WHATSAPP_AUTH_PATH || './.wwebjs_auth';
const chromiumExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '';
let remindersEnabled = true;
let reminderIntervals = [];
let client = null;
let callOpenAIFn = null;
let systemPromptText = '';
let onIncomingMessage = null;
let openAIOptions = {};
let reminderRuntimeOptions = {};
let transcribeAudioFn = null;
let getAgendaTasksFn = null;
let buildTaskReminderMessageFn = null;
let buildDailyFollowUpCheckMessageFn = null;
let buildEndOfDayReportMessageFn = null;
let buildWeeklyCostReportMessageFn = null;
let onReminderSentFn = null;

let reminderLeadMinutes = 60;
let reminderOffsetsMinutes = [60, 0];
let dailyFollowUpDefaultTime = process.env.WHATSAPP_DAILY_FOLLOWUP_DEFAULT_TIME || '10:00';
let endOfDayHour = 20;
let endOfDayMinute = Number(process.env.WHATSAPP_END_REPORT_MINUTE || 0);
let weeklyCostReportEnabled = process.env.WHATSAPP_WEEKLY_COST_REPORT_ENABLED !== 'false';
let weeklyCostReportDay = Number(process.env.WHATSAPP_WEEKLY_COST_REPORT_DAY || 1);
let weeklyCostReportHour = Number(process.env.WHATSAPP_WEEKLY_COST_REPORT_HOUR || 9);
let weeklyCostReportMinute = Number(process.env.WHATSAPP_WEEKLY_COST_REPORT_MINUTE || 0);
let reminderTickRunning = false;
let lastReminderDateKey = '';
let lastEndOfDayReportDate = '';
let lastWeeklyCostReportWeekKey = '';
let lastGapSuggestionKey = '';
const sentTaskReminderKeys = new Set();
const whatsappAutoReconnect = process.env.WHATSAPP_AUTO_RECONNECT !== 'false';
const whatsappReconnectBaseMs = Math.max(1000, Number(process.env.WHATSAPP_RECONNECT_BASE_MS || 5000));
const whatsappReconnectMaxMs = Math.max(whatsappReconnectBaseMs, Number(process.env.WHATSAPP_RECONNECT_MAX_MS || 60000));
let isClientInitializing = false;
let reconnectTimer = null;
let reconnectAttempts = 0;

const restrictIncomingByPhone = process.env.WHATSAPP_RESTRICT_NUMBER === 'true';

function normalizePhone(number) {
  return String(number || '').replace(/\D/g, '');
}

function normalizeText(value = '') {
  return sharedNormalizeText(value);
}

function localDateISO() {
  return sharedTodayLocalISO();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}

function startOfWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // semana começa na segunda
  d.setDate(d.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeReminderOffsets(offsets, fallbackLead = 60) {
  const raw = Array.isArray(offsets) && offsets.length
    ? offsets
    : [fallbackLead, 0];
  const parsed = raw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0);
  if (parsed.length === 0) return [Math.max(0, Number(fallbackLead) || 60), 0];
  return [...new Set(parsed)].sort((a, b) => b - a);
}

function ensureReminderSchedulerAfterPhoneBind() {
  if (!remindersEnabled || !userPhoneNumber) return;
  if (reminderIntervals.length > 0) return;
  if (!callOpenAIFn || !systemPromptText) return;
  startReminders(callOpenAIFn, systemPromptText, reminderRuntimeOptions || {});
}

function normalizeTime(value) {
  return sharedNormalizeTime(value);
}

function sanitizeMimeType(mimeType) {
  return String(mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
}

function extensionFromMime(mimeType) {
  const clean = sanitizeMimeType(mimeType);
  const map = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/webm': 'webm',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
  };
  return map[clean] || 'ogg';
}

function isAuthorizedSender(senderNumber, rawFrom = '') {
  if (!restrictIncomingByPhone) return true;

  // Contatos via @lid nem sempre trazem telefone em formato numérico.
  if (String(rawFrom || '').endsWith('@lid')) return true;

  const configured = normalizePhone(userPhoneNumber);
  const sender = normalizePhone(senderNumber);

  if (!configured) return true;
  if (!sender) return false;
  if (sender === configured) return true;

  const senderTail = sender.slice(-10);
  const configuredTail = configured.slice(-10);
  return senderTail && configuredTail && senderTail === configuredTail;
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
  out = out.replace(/\b[Pp]ra o senhor\b/g, 'para o senhor');
  out = out.replace(/(^|\n)\s*o senhor/g, '$1O senhor');
  out = out.replace(/(^|\n)\s*Quer\b/g, '$1O senhor quer');
  return out;
}

function ensureFollowUpStyle(text, options = {}) {
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

async function simulateTyping(chatId = '', textLength = 0, options = {}) {
  if (!client || connectionStatus !== 'connected' || !chatId) return;
  const chars = Math.max(1, Number(textLength) || 1);
  const minMs = Number(options.minMs || 1500);
  const maxMs = Number(options.maxMs || 8000);
  const msPerChar = Number(options.msPerChar || 35);
  const typingMs = Math.min(maxMs, Math.max(minMs, Math.round(chars * msPerChar)));

  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    await new Promise((resolve) => setTimeout(resolve, typingMs));
    await chat.clearState();
  } catch {
    // typing indicator é cosmético
  }
}

async function sendHumanLikeReply(msg, text = '') {
  const finalText = String(text || '').trim();
  if (!finalText) return;

  const paragraphs = finalText.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length <= 2) {
    await simulateTyping(msg.from, finalText.length, { maxMs: 5000, msPerChar: 30 });
    await msg.reply(finalText);
    return;
  }

  for (let i = 0; i < paragraphs.length; i += 1) {
    const chunk = paragraphs[i];
    await simulateTyping(msg.from, chunk.length, { minMs: 1200, maxMs: 4000, msPerChar: 35 });
    if (i === 0) {
      await msg.reply(chunk);
    } else {
      await client.sendMessage(msg.from, chunk);
    }
    if (i < paragraphs.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800 + Math.round(Math.random() * 1200)));
    }
  }
}

function taskReminderKey(task, offsetMinutes) {
  const idPart = String(task.id || task.title || 'sem-id');
  return `${idPart}|${task.date || ''}|${task.startTime || ''}|${offsetMinutes}`;
}

function parseTaskDateTime(task) {
  if (!task?.date || !task?.startTime) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(task.date))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(task.startTime))) return null;
  const when = new Date(`${task.date}T${task.startTime}:00`);
  if (Number.isNaN(when.getTime())) return null;
  return when;
}

function parseFollowUpDateTime(task, dateISO) {
  const targetDate = String(dateISO || '').trim();
  const followUpTime = normalizeTime(task?.followUpTime || task?.startTime || dailyFollowUpDefaultTime);
  if (!targetDate || !followUpTime) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const when = new Date(`${targetDate}T${followUpTime}:00`);
  if (Number.isNaN(when.getTime())) return null;
  return when;
}

function isDailyFollowUpTask(task, dateISO) {
  if (!task || task.completedAt) return false;
  if (!task.followUpDaily) return false;

  const taskDate = String(task.date || '').trim();
  if (taskDate && /^\d{4}-\d{2}-\d{2}$/.test(taskDate) && taskDate > dateISO) return false;

  return Boolean(normalizeTime(task.followUpTime || task.startTime || dailyFollowUpDefaultTime));
}

async function notifyReminderSent(payload = {}) {
  if (typeof onReminderSentFn !== 'function') return;
  try {
    await onReminderSentFn(payload);
  } catch (err) {
    console.error('[WhatsApp] Erro no callback de reminder enviado:', err.message);
  }
}

function defaultTaskReminderMessage(task, minutesBefore = reminderLeadMinutes) {
  const timeText = task.startTime ? `às ${task.startTime}` : 'no horário combinado';
  const frente = task.frente || 'pessoal';
  const base = minutesBefore === 0
    ? `⏰ Sergio, agora é hora de "${task.title}" ${timeText} (${frente}).`
    : `Lembrete: em ${minutesBefore} minuto(s), o senhor tem "${task.title}" ${timeText} (${frente}).`;
  return ensureFollowUpStyle(
    base,
    {
      question: minutesBefore === 0 ? 'O senhor quer ajuda para começar agora?' : 'O senhor precisa de algo para essa tarefa?',
      suggestions: [
        'quebrar essa tarefa em passos rápidos',
        'revisar o que o senhor precisa preparar antes',
        'ajustar o horário se o senhor estiver apertado',
      ],
    }
  );
}

function defaultEndOfDayMessage() {
  return ensureFollowUpStyle(
    'Pode ir dormir e descansar tranquilo, senhor, que eu vou seguir trabalhando e cuidando da agenda por aqui.',
    { appendQuestion: false }
  );
}

function defaultDailyFollowUpCheckMessage(task = {}) {
  const title = String(task?.followUpSubject || task?.detail || task?.title || 'essa pendência').trim();
  return ensureFollowUpStyle(
    `🔔 Senhor Sergio, já teve retorno sobre "${title}"?\n\nMe responda: "sim" ou "ainda não".`,
    { question: 'Precisa de mais alguma coisa agora, senhor?' }
  );
}

function buildAgendaSnapshotByDate(tasks = [], targetDate) {
  const list = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => !task?.completedAt && task?.date === targetDate)
    .sort((a, b) => {
      const ta = String(a?.startTime || '99:99');
      const tb = String(b?.startTime || '99:99');
      if (ta !== tb) return ta.localeCompare(tb);
      return String(a?.title || '').localeCompare(String(b?.title || ''), 'pt-BR');
    });
  return list;
}

async function buildMorningBriefMessage() {
  const today = localDateISO();
  const tasks = typeof getAgendaTasksFn === 'function' ? await getAgendaTasksFn() : [];
  const dayTasks = buildAgendaSnapshotByDate(tasks, today);

  if (dayTasks.length === 0) {
    return ensureFollowUpStyle(
      'Bom dia, senhor. Agenda limpa hoje. Quer que eu crie alguma tarefa?',
      { appendQuestion: false }
    );
  }

  const totalMinutes = dayTasks.reduce((sum, task) => sum + (task?.estimatedTime || 30), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const withTime = dayTasks.filter((task) => task?.startTime).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const withoutTime = dayTasks.filter((task) => !task?.startTime);

  const lines = [
    `Bom dia, senhor. Hoje tem ${dayTasks.length} tarefa${dayTasks.length > 1 ? 's' : ''}, ~${totalHours}h estimadas.`,
  ];

  if (totalMinutes > 480) {
    lines.push('Atenção: isso passa de 8h. Vamos priorizar o essencial.');
  }

  if (withTime.length > 0) {
    lines.push('');
    lines.push('Compromissos fixos:');
    withTime.slice(0, 5).forEach((task) => {
      lines.push(`${task.startTime} - ${task.title} [${task.frente}]`);
    });
  }

  if (withoutTime.length > 0) {
    lines.push('');
    lines.push('Sem horário definido:');
    withoutTime.slice(0, 5).forEach((task) => {
      lines.push(`- ${task.title} [${task.frente}]`);
    });
  }

  lines.push('');
  lines.push('Quer ajustar algo antes de começar?');

  return ensureFollowUpStyle(formatWhatsAppCoreText(lines.join('\n')), { appendQuestion: false });
}

async function buildMiddayCheckinMessage() {
  const today = localDateISO();
  const tasks = typeof getAgendaTasksFn === 'function' ? await getAgendaTasksFn() : [];
  const dayTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => task?.date === today);
  const completed = dayTasks.filter((task) => Boolean(task?.completedAt));
  const pending = dayTasks.filter((task) => !task?.completedAt);

  if (dayTasks.length === 0) {
    return ensureFollowUpStyle(
      'Meio do dia, senhor. Agenda continua limpa.',
      { appendQuestion: false }
    );
  }

  const lines = [];
  if (completed.length > 0) {
    lines.push(`Metade do dia. Já concluiu ${completed.length} de ${dayTasks.length} tarefa${dayTasks.length > 1 ? 's' : ''}.`);
  } else {
    lines.push(`Metade do dia, senhor. Ainda nenhuma tarefa concluída de ${dayTasks.length}.`);
  }

  if (pending.length > 0) {
    const next = pending.find((task) => task?.startTime) || pending[0];
    lines.push(`Próximo foco: ${next?.startTime ? `${next.startTime} ` : ''}${next?.title || 'tarefa sem título'}.`);

    if (pending.length > 3) {
      lines.push(`Ainda tem ${pending.length} pendentes. Precisa repriorizar?`);
    }
  } else {
    lines.push('Tudo concluído. Pode descansar ou adiantar o de amanhã.');
  }

  return ensureFollowUpStyle(lines.join('\n'));
}

function buildGapSuggestionFromTasks(tasks = [], dateISO = localDateISO()) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const dayTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => !task?.completedAt && task?.date === dateISO);

  const fixed = dayTasks
    .filter((task) => task?.startTime)
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));
  const nextFixed = fixed.find((task) => {
    const [h, m] = String(task.startTime || '00:00').split(':').map(Number);
    return ((h * 60) + m) > currentMinutes;
  }) || null;

  let availableMinutes = 120;
  if (nextFixed?.startTime) {
    const [h, m] = String(nextFixed.startTime || '00:00').split(':').map(Number);
    availableMinutes = Math.max(0, (h * 60 + m) - currentMinutes);
  }
  if (availableMinutes < 45) return null;

  const flexible = dayTasks
    .filter((task) => !task?.startTime)
    .filter((task) => Number(task?.estimatedTime || 30) <= availableMinutes)
    .sort((a, b) => Number(a?.estimatedTime || 30) - Number(b?.estimatedTime || 30));
  if (flexible.length === 0) return null;

  return {
    task: flexible[0],
    nextFixed,
    availableMinutes,
  };
}

async function runSmartRemindersTick() {
  if (reminderTickRunning) return;
  if (!remindersEnabled || !userPhoneNumber) return;
  if (connectionStatus !== 'connected') return;

  reminderTickRunning = true;
  try {
    const now = new Date();
    const dateKey = localDateISO();

    if (dateKey !== lastReminderDateKey) {
      sentTaskReminderKeys.clear();
      lastReminderDateKey = dateKey;
      lastGapSuggestionKey = '';
    }

    if (typeof getAgendaTasksFn === 'function') {
      const agendaTasks = await getAgendaTasksFn();
      const activeTasks = Array.isArray(agendaTasks) ? agendaTasks : [];
      const scheduledTasks = activeTasks.filter(
        (task) => !task?.completedAt && task?.date && task?.startTime && !task?.followUpDaily
      );
      const dailyFollowUpTasks = activeTasks.filter((task) => isDailyFollowUpTask(task, dateKey));

      for (const task of scheduledTasks) {
        const when = parseTaskDateTime(task);
        if (!when) continue;

        const diffMinutes = (when.getTime() - now.getTime()) / 60000;
        for (const offset of reminderOffsetsMinutes) {
          if (!(diffMinutes <= offset && diffMinutes > offset - 1.25)) continue;

          const key = taskReminderKey(task, offset);
          if (sentTaskReminderKeys.has(key)) continue;

          const customMessage = typeof buildTaskReminderMessageFn === 'function'
            ? await buildTaskReminderMessageFn(task, { minutesBefore: offset })
            : null;
          const msg = ensureFollowUpStyle(customMessage || defaultTaskReminderMessage(task, offset), {
            question: offset === 0 ? 'O senhor quer ajuda para começar agora?' : 'O senhor precisa de algo para essa tarefa?',
          });

          await sendMessage(userPhoneNumber, msg);
          sentTaskReminderKeys.add(key);
          await notifyReminderSent({
            kind: 'task_reminder',
            dateKey,
            offsetMinutes: offset,
            phoneNumber: userPhoneNumber,
            task,
          });
          console.log(
            `[WhatsApp] Lembrete enviado (${offset}min) para tarefa (${String(task.id || '').slice(0, 6)}): ${task.title}`
          );
        }
      }

      for (const task of dailyFollowUpTasks) {
        const when = parseFollowUpDateTime(task, dateKey);
        if (!when) continue;
        const diffMinutes = (when.getTime() - now.getTime()) / 60000;
        if (!(diffMinutes <= 0 && diffMinutes > -1.25)) continue;

        const key = `followup|${String(task.id || '')}|${dateKey}`;
        if (sentTaskReminderKeys.has(key)) continue;

        const customMessage = typeof buildDailyFollowUpCheckMessageFn === 'function'
          ? await buildDailyFollowUpCheckMessageFn(task)
          : null;
        const msg = ensureFollowUpStyle(customMessage || defaultDailyFollowUpCheckMessage(task), {
          question: 'Precisa de mais alguma coisa agora, senhor?',
        });

        await sendMessage(userPhoneNumber, msg);
        sentTaskReminderKeys.add(key);
        await notifyReminderSent({
          kind: 'daily_followup_check',
          dateKey,
          offsetMinutes: 0,
          phoneNumber: userPhoneNumber,
          task,
        });
        console.log(
          `[WhatsApp] Follow-up diário enviado (${String(task.id || '').slice(0, 6)}): ${task.title}`
        );
      }

      if ((now.getMinutes() % 30) === 0) {
        const gapSuggestion = buildGapSuggestionFromTasks(activeTasks, dateKey);
        if (gapSuggestion?.task) {
          const halfHourSlot = `${String(now.getHours()).padStart(2, '0')}:${now.getMinutes() >= 30 ? '30' : '00'}`;
          const suggestionKey = `${dateKey}|${halfHourSlot}|${String(gapSuggestion.task.id || '')}`;
          if (suggestionKey !== lastGapSuggestionKey) {
            const nextFixedText = gapSuggestion.nextFixed?.startTime
              ? `O próximo compromisso é só às ${gapSuggestion.nextFixed.startTime}.`
              : 'Sem compromisso fixo nas próximas horas.';
            const msg = ensureFollowUpStyle(
              `${nextFixedText}\nO senhor tem ${gapSuggestion.availableMinutes} minutos livres.\nQue tal atacar "${gapSuggestion.task.title}" agora?`,
              { question: 'Quer que eu ajuste o horário dessa tarefa para começar agora?' }
            );
            await sendMessage(userPhoneNumber, msg);
            lastGapSuggestionKey = suggestionKey;
            await notifyReminderSent({
              kind: 'gap_suggestion',
              dateKey,
              phoneNumber: userPhoneNumber,
              task: gapSuggestion.task,
            });
            console.log(`[WhatsApp] Sugestão de janela livre enviada (${String(gapSuggestion.task.id || '').slice(0, 6)}).`);
          }
        }
      }
    }

    if (
      now.getHours() === endOfDayHour &&
      now.getMinutes() === endOfDayMinute &&
      lastEndOfDayReportDate !== dateKey
    ) {
      const customReport = typeof buildEndOfDayReportMessageFn === 'function'
        ? await buildEndOfDayReportMessageFn()
        : null;
      const reportMsg = ensureFollowUpStyle(customReport || defaultEndOfDayMessage(), {
        appendQuestion: false,
      });
      await sendMessage(userPhoneNumber, reportMsg);
      lastEndOfDayReportDate = dateKey;
      console.log('[WhatsApp] Relatório de fim de dia enviado.');
    }

    const weekKey = startOfWeekKey(now);
    if (
      weeklyCostReportEnabled &&
      now.getDay() === weeklyCostReportDay &&
      now.getHours() === weeklyCostReportHour &&
      now.getMinutes() === weeklyCostReportMinute &&
      lastWeeklyCostReportWeekKey !== weekKey
    ) {
      const customWeekly = typeof buildWeeklyCostReportMessageFn === 'function'
        ? await buildWeeklyCostReportMessageFn()
        : null;
      const weeklyMsg = ensureFollowUpStyle(
        customWeekly || '📊 Relatório semanal: acompanhe os gastos do WhatsApp e do app.',
        { question: 'Precisa de mais alguma coisa agora, senhor?' }
      );

      await sendMessage(userPhoneNumber, weeklyMsg);
      lastWeeklyCostReportWeekKey = weekKey;
      await notifyReminderSent({
        kind: 'weekly_cost_report',
        dateKey,
        phoneNumber: userPhoneNumber,
      });
      console.log('[WhatsApp] Relatório semanal de custos enviado.');
    }
  } catch (err) {
    console.error('[WhatsApp] Erro no agendador inteligente:', err.message);
  } finally {
    reminderTickRunning = false;
  }
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function nextReconnectDelayMs() {
  const delay = Math.min(
    whatsappReconnectMaxMs,
    Math.round(whatsappReconnectBaseMs * (1.7 ** reconnectAttempts))
  );
  reconnectAttempts += 1;
  return delay;
}

function scheduleReconnect(reason = '') {
  if (!whatsappAutoReconnect) return;
  if (reconnectTimer || isClientInitializing) return;

  const delay = nextReconnectDelayMs();
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await ensureClientInitialized();
      console.log('[WhatsApp] Reconexão iniciada com sucesso.');
    } catch (err) {
      console.error('[WhatsApp] Falha ao iniciar reconexão:', err.message);
      scheduleReconnect('retry');
    }
  }, delay);

  console.log(
    `[WhatsApp] Reconexão agendada em ${Math.round(delay / 1000)}s${reason ? ` (${reason})` : ''}.`
  );
}

async function ensureClientInitialized() {
  initClient();
  if (!client) throw new Error('Cliente WhatsApp não inicializado.');

  if (connectionStatus === 'connected') return;
  if (isClientInitializing) return;

  isClientInitializing = true;
  connectionStatus = 'connecting';
  qrCodeBase64 = null;

  try {
    await client.initialize();
  } finally {
    isClientInitializing = false;
  }
}

// ─── Inicializar cliente WhatsApp ───
function initClient() {
  if (client) return;

  const puppeteerArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
  ];
  const puppeteerConfig = {
    headless: true,
    args: puppeteerArgs,
  };
  if (chromiumExecutablePath) {
    puppeteerConfig.executablePath = chromiumExecutablePath;
  }

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: whatsappAuthPath }),
    puppeteer: puppeteerConfig,
  });

  client.on('qr', async (qr) => {
    console.log('[WhatsApp] QR Code gerado! Escaneie no app.');
    connectionStatus = 'connecting';
    try {
      qrCodeBase64 = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
    } catch (err) {
      console.error('[WhatsApp] Erro ao gerar QR image:', err.message);
    }
  });

  client.on('ready', () => {
    console.log('[WhatsApp] Conectado com sucesso!');
    connectionStatus = 'connected';
    qrCodeBase64 = null;
    reconnectAttempts = 0;
    clearReconnectTimer();
  });

  client.on('authenticated', () => {
    console.log('[WhatsApp] Autenticado!');
    connectionStatus = 'connecting';
  });

  client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Falha na autenticacao:', msg);
    connectionStatus = 'disconnected';
    qrCodeBase64 = null;
    try { client?.destroy(); } catch {}
    client = null;
    scheduleReconnect('auth_failure');
  });

  client.on('disconnected', (reason) => {
    console.log('[WhatsApp] Desconectado:', reason);
    connectionStatus = 'disconnected';
    qrCodeBase64 = null;
    client = null;
    scheduleReconnect(`disconnected:${reason || 'unknown'}`);
  });

  // Processar mensagens recebidas
  client.on('message', async (msg) => {
    if (msg.fromMe) return;
    if (msg.from?.endsWith('@g.us')) return;

    const senderNumber = normalizePhone(msg.from);
    if (!isAuthorizedSender(senderNumber, msg.from)) {
      console.log(`[WhatsApp] Ignorando mensagem de número não autorizado: ${senderNumber}`);
      return;
    }

    try {
      const chat = await client.getChatById(msg.from);
      await chat.sendSeen();
    } catch {
      // silencioso
    }

    try {
      await msg.react('👀');
    } catch {
      // silencioso
    }

    if (!normalizePhone(userPhoneNumber) && senderNumber) {
      userPhoneNumber = senderNumber;
      console.log(`[WhatsApp] Número de lembrete configurado automaticamente: ${senderNumber}`);
      ensureReminderSchedulerAfterPhoneBind();
    }

    let text = String(msg.body || '').trim();
    let sourceType = 'text';

    // Suporte a áudio/voz (ptt) com transcrição
    if ((!text || text.length < 2) && msg.hasMedia && typeof transcribeAudioFn === 'function') {
      try {
        const media = await msg.downloadMedia();
        const mimeType = sanitizeMimeType(media?.mimetype);
        const isAudio = mimeType.startsWith('audio/') || msg.type === 'audio' || msg.type === 'ptt';

        if (isAudio && media?.data) {
          const extension = extensionFromMime(mimeType);
          const fileName = media?.filename || `whatsapp-audio-${Date.now()}.${extension}`;
          const transcription = await transcribeAudioFn({
            base64Data: media.data,
            mimeType,
            fileName,
            senderNumber,
          });
          text = String(transcription || '').trim();
          sourceType = 'audio';
          if (text) {
            console.log(`[WhatsApp] Áudio transcrito de ${senderNumber}: ${text}`);
          }
        }
      } catch (err) {
        console.error('[WhatsApp] Erro ao transcrever áudio:', err.message);
        const errText = normalizeText(err?.message || '');
        const isTooLarge =
          errText.includes('excede o limite') ||
          errText.includes('limite de') ||
          errText.includes('too large') ||
          errText.includes('payload too large');
        const feedback = isTooLarge
          ? 'Seu áudio está grande demais para transcrição de uma vez. Tenta dividir em partes menores e me mandar em sequência.'
          : 'Não consegui transcrever seu áudio agora. Tenta de novo em alguns segundos ou manda em texto.';
        await msg.reply(
          feedback
        ).catch(() => {});
        return;
      }
    }

    if (!text || text.length < 2) return;
    console.log(`[WhatsApp] Mensagem de ${senderNumber}${sourceType === 'audio' ? ' (áudio)' : ''}: ${text}`);

    try {
      let response = null;

      if (typeof onIncomingMessage === 'function') {
        response = await onIncomingMessage({
          text,
          senderNumber,
          sourceType,
          rawMessage: msg,
        });
      }

      if (!response && callOpenAIFn && systemPromptText) {
        response = await callOpenAIFn(
          `${systemPromptText}\n\nCONTEXTO: conversa no WhatsApp. Respostas curtas, diretas e sem markdown.`,
          [{ role: 'user', content: text }],
          500,
          openAIOptions
        );
      }

      const replyText = typeof response === 'string'
        ? response.trim()
        : (typeof response?.text === 'string' ? response.text.trim() : '');
      const reaction = typeof response?.reaction === 'string'
        ? String(response.reaction || '').trim()
        : '';

      if (replyText) {
        await sendHumanLikeReply(msg, replyText);
        console.log(`[WhatsApp] Resposta enviada para ${senderNumber}`);
      }
      if (reaction) {
        try {
          await msg.react(reaction);
        } catch {
          // silencioso
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Erro ao processar mensagem:', err.message);
    }
  });
}

// ─── Criar instância / Gerar QR Code ───
async function createInstance() {
  try {
    if (connectionStatus === 'connected') {
      return {
        success: true,
        qrcode: null,
        status: 'connected',
      };
    }

    await ensureClientInitialized();
    await new Promise((resolve) => setTimeout(resolve, 2500));

    return {
      success: true,
      qrcode: qrCodeBase64,
      status: connectionStatus,
    };
  } catch (err) {
    console.error('[WhatsApp] Erro ao inicializar:', err.message);
    connectionStatus = 'disconnected';
    return { success: false, error: err.message };
  }
}

// ─── Verificar status da conexão ───
async function checkStatus() {
  return { status: connectionStatus };
}

// ─── Enviar mensagem ───
async function sendMessage(number, text) {
  if (!number) throw new Error('Numero nao configurado');
  if (!client || connectionStatus !== 'connected') {
    throw new Error('WhatsApp nao conectado');
  }

  const cleanNumber = number.replace(/\D/g, '');
  const chatId = `${cleanNumber}@c.us`;

  await client.sendMessage(chatId, text);
  return { success: true };
}

// ─── Processar mensagem do webhook (compatibilidade com server.js) ───
async function processIncomingMessage() {
  // Mensagens são processadas via client.on('message') acima
  return null;
}

// ─── Configurar webhook (não necessário com whatsapp-web.js) ───
async function setupWebhook() {
  console.log('[WhatsApp] whatsapp-web.js nao precisa de webhook externo');
  return true;
}

// ─── Lembretes agendados ───
function startReminders(callOpenAI, systemPrompt) {
  const options = arguments[2] || {};
  reminderRuntimeOptions = options;

  // Salvar referências para uso no handler de mensagens
  callOpenAIFn = callOpenAI;
  systemPromptText = systemPrompt;
  onIncomingMessage = typeof options.onIncomingMessage === 'function' ? options.onIncomingMessage : null;
  openAIOptions = options.openAIOptions || {};
  transcribeAudioFn = typeof options.transcribeAudio === 'function' ? options.transcribeAudio : null;
  getAgendaTasksFn = typeof options.getAgendaTasks === 'function' ? options.getAgendaTasks : null;
  buildTaskReminderMessageFn = typeof options.buildTaskReminderMessage === 'function'
    ? options.buildTaskReminderMessage
    : null;
  buildDailyFollowUpCheckMessageFn = typeof options.buildDailyFollowUpCheckMessage === 'function'
    ? options.buildDailyFollowUpCheckMessage
    : null;
  buildEndOfDayReportMessageFn = typeof options.buildEndOfDayReportMessage === 'function'
    ? options.buildEndOfDayReportMessage
    : null;
  buildWeeklyCostReportMessageFn = typeof options.buildWeeklyCostReportMessage === 'function'
    ? options.buildWeeklyCostReportMessage
    : null;
  onReminderSentFn = typeof options.onReminderSent === 'function' ? options.onReminderSent : null;

  reminderLeadMinutes = Number(options.reminderLeadMinutes || 60);
  reminderOffsetsMinutes = normalizeReminderOffsets(options.reminderOffsetsMinutes, reminderLeadMinutes);
  dailyFollowUpDefaultTime = normalizeTime(options.dailyFollowUpDefaultTime || dailyFollowUpDefaultTime) || '10:00';
  endOfDayHour = clampInt(options.endOfDayHour ?? 20, 0, 23, 20);
  endOfDayMinute = clampInt(options.endOfDayMinute ?? 0, 0, 59, 0);
  weeklyCostReportEnabled = options.weeklyCostReportEnabled === undefined
    ? weeklyCostReportEnabled
    : Boolean(options.weeklyCostReportEnabled);
  weeklyCostReportDay = clampInt(options.weeklyCostReportDay ?? weeklyCostReportDay, 0, 6, 1);
  weeklyCostReportHour = clampInt(options.weeklyCostReportHour ?? weeklyCostReportHour, 0, 23, 9);
  weeklyCostReportMinute = clampInt(options.weeklyCostReportMinute ?? weeklyCostReportMinute, 0, 59, 0);

  stopReminders();
  ensureClientInitialized().catch((err) => {
    console.error('[WhatsApp] Não consegui iniciar a sessão automaticamente:', err.message);
    scheduleReconnect('startup');
  });

  if (!remindersEnabled || !userPhoneNumber) {
    console.log('[WhatsApp] Lembretes desativados ou numero nao configurado');
    return;
  }

  const scheduleDaily = (hour, minute, getMessage) => {
    const check = () => {
      const now = new Date();
      if (now.getHours() === hour && now.getMinutes() === minute) {
        getMessage().then((msg) => {
          if (msg && userPhoneNumber && connectionStatus === 'connected') {
            sendMessage(userPhoneNumber, msg).catch((err) =>
              console.error('[WhatsApp] Erro ao enviar lembrete:', err.message)
            );
          }
        }).catch((err) => {
          console.error('[WhatsApp] Erro no lembrete diário:', err.message);
        });
      }
    };
    return setInterval(check, 60 * 1000);
  };

  reminderIntervals.push(scheduleDaily(7, 0, async () => {
    try {
      return await buildMorningBriefMessage();
    } catch {
      return ensureFollowUpStyle(
        'Bom dia, senhor. Precisando de mim, já estou por aqui.',
        { appendQuestion: false }
      );
    }
  }));

  reminderIntervals.push(scheduleDaily(13, 0, async () => {
    try {
      return await buildMiddayCheckinMessage();
    } catch {
      return ensureFollowUpStyle('Check-in do meio do dia: vamos revisar o progresso e ajustar o que for necessário.');
    }
  }));

  reminderIntervals.push(setInterval(() => {
    runSmartRemindersTick().catch((err) => {
      console.error('[WhatsApp] Erro no tick de lembretes:', err.message);
    });
  }, 60 * 1000));

  // Roda uma vez ao iniciar para não perder janelas de lembrete após restart.
  runSmartRemindersTick().catch((err) => {
    console.error('[WhatsApp] Erro ao iniciar lembretes inteligentes:', err.message);
  });

  console.log(
    `[WhatsApp] Lembretes agendados: 7h, 13h, offsets [${reminderOffsetsMinutes.join(', ')}] min, relatório ${String(endOfDayHour).padStart(2, '0')}:${String(endOfDayMinute).padStart(2, '0')} e semanal (${weeklyCostReportEnabled ? `dia ${weeklyCostReportDay} ${String(weeklyCostReportHour).padStart(2, '0')}:${String(weeklyCostReportMinute).padStart(2, '0')}` : 'desativado'})`
  );
}

function stopReminders() {
  reminderIntervals.forEach((id) => clearInterval(id));
  reminderIntervals = [];
  reminderTickRunning = false;
  sentTaskReminderKeys.clear();
}

// ─── Getters / Setters ───
function getStatus() {
  return {
    status: connectionStatus,
    qrcode: qrCodeBase64,
    phoneNumber: userPhoneNumber,
    remindersEnabled,
    autoReconnect: whatsappAutoReconnect,
    reconnectPending: Boolean(reconnectTimer),
    reconnectAttempts,
    initializing: isClientInitializing,
  };
}

function setPhoneNumber(number) {
  userPhoneNumber = number;
  ensureReminderSchedulerAfterPhoneBind();
}

function setRemindersEnabled(enabled) {
  remindersEnabled = enabled;
}

export {
  createInstance,
  checkStatus,
  sendMessage,
  processIncomingMessage,
  setupWebhook,
  startReminders,
  stopReminders,
  getStatus,
  setPhoneNumber,
  setRemindersEnabled,
};

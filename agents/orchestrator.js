// ═══════════════════════════════════════════════════════════════
// SISTEMA SER v4 — Orquestrador de Agentes
// Integra: Maestro → Triagem → Organizador → Guardião
// ═══════════════════════════════════════════════════════════════

import { todayLocalISO, normalizeText, normalizeTime } from '../shared-utils.js';
import { maestroRoute, MAESTRO_HANDLERS, detectEnergyFromText } from './maestro.js';
import { callTriageAgent } from './triage.js';
import { callOrganizerAgent, findAvailableSlots } from './organizer.js';
import { callGuardianAgent, shouldActivateGuardian, calculateBurnoutScore } from './guardian.js';
import { getCalendarEvents, createCalendarEvent, isCalendarEnabled } from '../calendar-mcp.js';

// ─── Memória de conversa WhatsApp ───
const CONTEXT_MAX_MESSAGES = Number(process.env.WHATSAPP_CONTEXT_MESSAGES || 6);
const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutos
const conversationHistory = new Map();

function getConversationHistory(senderNumber) {
  const history = conversationHistory.get(senderNumber) || [];
  const now = Date.now();
  const recent = history.filter((msg) => (now - msg.timestamp) < CONTEXT_TTL_MS);
  conversationHistory.set(senderNumber, recent);
  return recent.slice(-CONTEXT_MAX_MESSAGES).map(({ role, content }) => ({ role, content }));
}

function addToHistory(senderNumber, role, content) {
  const history = conversationHistory.get(senderNumber) || [];
  history.push({ role, content, timestamp: Date.now() });
  if (history.length > 20) history.splice(0, history.length - 20);
  conversationHistory.set(senderNumber, history);
}

// ─── Energy check-ins em memória ───
const energyCheckins = new Map(); // date → { level, timestamp }
let lastEnergyLevel = null;
let lastEnergyCheckinTime = null;

function recordEnergyCheckin(level) {
  const today = todayLocalISO();
  lastEnergyLevel = level;
  lastEnergyCheckinTime = Date.now();
  const dayCheckins = energyCheckins.get(today) || [];
  dayCheckins.push({ level, timestamp: Date.now() });
  energyCheckins.set(today, dayCheckins);
}

export function getLastEnergy() {
  return lastEnergyLevel;
}

export function getLastEnergyCheckinTime() {
  return lastEnergyCheckinTime;
}

// ─── Formatação de data PT ───
function formatDatePt(dateStr) {
  try {
    const d = new Date(`${dateStr}T12:00:00`);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  } catch {
    return dateStr;
  }
}

function getDayName(dateStr) {
  const days = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  try {
    return days[new Date(`${dateStr}T12:00:00`).getDay()];
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// PROCESSAMENTO PRINCIPAL DE MENSAGEM
// ═══════════════════════════════════════════════════════════════
export async function processMessage(text, options = {}) {
  const {
    senderNumber = '',
    sourceType = 'text',
    callOpenAI,                    // Função existente do server.js
    getAgendaTasks,                // Busca tarefas do banco
    saveTask,                      // Salva tarefa no banco
    updateTask,                    // Atualiza tarefa
    completeTask,                  // Marca como concluída
    formatWhatsAppResponse,        // Formata resposta pro WA
    anthropicApiKey = '',
    existingProcessMessage = null, // Fallback pro processamento antigo
  } = options;

  const userText = String(text || '').trim();
  if (!userText) {
    return { text: 'Não entendi, senhor. Pode repetir?', reaction: '❓' };
  }

  const today = todayLocalISO();
  const tasks = typeof getAgendaTasks === 'function' ? await getAgendaTasks() : [];
  const dayTasks = tasks.filter((t) => !t.completedAt && t.date === today);

  // ═══ PASSO 1: MAESTRO (regex, $0) ═══
  const route = maestroRoute(userText);

  // Se o Maestro consegue resolver sem IA
  if (!route.needsAI && MAESTRO_HANDLERS[route.handler]) {
    const handler = MAESTRO_HANDLERS[route.handler];

    // Preparar contexto pro handler
    const context = {
      text: userText,
      tasks,
      today,
      targetDate: today,
      taskMatch: null,
      energyLevel: null,
    };

    // Extrair data se necessário
    if (route.extractDate) {
      const { inferDateFromText } = await import('./maestro.js').catch(() => ({}));
      if (inferDateFromText) {
        const dateHint = inferDateFromText(userText);
        if (dateHint.explicitDate) context.targetDate = dateHint.date;
      }
    }

    // Detectar energia
    const energy = detectEnergyFromText(userText);
    if (energy) {
      context.energyLevel = energy;
      recordEnergyCheckin(energy);
    }

    try {
      const result = await handler(context);
      if (result?.text) {
        addToHistory(senderNumber, 'user', userText);
        addToHistory(senderNumber, 'assistant', result.text);
      }
      return result;
    } catch (err) {
      console.error(`[Orchestrator] Erro no handler ${route.handler}:`, err.message);
      // Fall through pra IA
    }
  }

  // ═══ PASSO 2: TRIAGEM (GPT-4.1-mini) ═══
  console.log('[Orchestrator] Maestro não resolveu, acionando Triagem...');

  let triageResult = null;
  try {
    triageResult = await callTriageAgent(userText, {
      callOpenAI,
      today,
      dayName: getDayName(today),
    });
  } catch (err) {
    console.error('[Orchestrator] Erro na Triagem:', err.message);
  }

  // Se a Triagem entendeu que não é tarefa (é conversa/dúvida)
  if (triageResult?.understood && triageResult.tasks?.length === 0 && triageResult.reply) {
    addToHistory(senderNumber, 'user', userText);
    addToHistory(senderNumber, 'assistant', triageResult.reply);
    return { text: triageResult.reply, reaction: '💬' };
  }

  // Se a Triagem não entendeu, pede clarificação
  if (!triageResult?.understood && triageResult?.clarification) {
    return { text: triageResult.clarification, reaction: '❓' };
  }

  // Se não tem tarefas extraídas, fallback pro processamento existente
  if (!triageResult?.tasks?.length) {
    if (existingProcessMessage) {
      const fallbackResult = await existingProcessMessage({ text: userText, sourceType, senderNumber });
      return typeof fallbackResult === 'string' ? { text: fallbackResult } : fallbackResult;
    }
    return { text: 'Não consegui processar, senhor. Tenta de novo com mais detalhes.', reaction: '❓' };
  }

  // ═══ PASSO 3: ORGANIZADOR (GPT-4o-mini) — para cada tarefa ═══
  const results = [];
  const newTasksForGuardian = [];

  for (const taskData of triageResult.tasks) {
    // Buscar eventos do Google Calendar se habilitado
    const calendarEvents = isCalendarEnabled()
      ? await getCalendarEvents(taskData.date || today).catch(() => [])
      : [];

    // Se a tarefa já tem horário definido pelo usuário, não precisa do Organizador
    if (taskData.startTime) {
      newTasksForGuardian.push(taskData);
      results.push({
        task: taskData,
        scheduled: true,
        startTime: taskData.startTime,
      });
      continue;
    }

    // Organizador encontra o melhor horário
    try {
      const existingForDate = tasks.filter((t) => !t.completedAt && t.date === (taskData.date || today));
      const orgResult = await callOrganizerAgent(taskData, existingForDate, calendarEvents, {
        callOpenAI,
        today,
        currentTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }),
      });

      if (orgResult?.scheduled) {
        taskData.startTime = orgResult.startTime;
        taskData.date = orgResult.date || taskData.date;
      }

      newTasksForGuardian.push(taskData);
      results.push({
        task: taskData,
        scheduled: orgResult?.scheduled ?? true,
        startTime: orgResult?.startTime || null,
        warnings: orgResult?.warnings || [],
        alternatives: orgResult?.alternativeSlots || [],
      });
    } catch (err) {
      console.error('[Orchestrator] Erro no Organizador:', err.message);
      newTasksForGuardian.push(taskData);
      results.push({ task: taskData, scheduled: true });
    }
  }

  // ═══ PASSO 4: GUARDIÃO (Claude Haiku) — só se necessário ═══
  let guardianResult = null;
  const allDayTasksAfter = [...dayTasks, ...newTasksForGuardian.filter((t) => t.date === today)];
  const burnoutScore = calculateBurnoutScore(tasks, today, []);

  if (shouldActivateGuardian(allDayTasksAfter, newTasksForGuardian[0], lastEnergyLevel, burnoutScore.score)) {
    console.log('[Orchestrator] Guardião ativado! Score:', burnoutScore.score);

    if (anthropicApiKey) {
      try {
        guardianResult = await callGuardianAgent(allDayTasksAfter, newTasksForGuardian[0], {
          anthropicApiKey,
          userEnergy: lastEnergyLevel,
          burnoutScore: burnoutScore.score,
          currentTime: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }),
        });
      } catch (err) {
        console.error('[Orchestrator] Erro no Guardião:', err.message);
      }
    }
  }

  // ═══ PASSO 5: SALVAR TAREFAS NO BANCO ═══
  const savedTasks = [];
  for (const result of results) {
    if (!result.task) continue;

    // Se o Guardião vetou, não salvar
    if (guardianResult && !guardianResult.approved) {
      continue;
    }

    try {
      if (typeof saveTask === 'function') {
        const saved = await saveTask({
          title: result.task.title,
          detail: result.task.detail || null,
          frente: result.task.frente || 'pessoal',
          type: result.task.type || 'Outro',
          date: result.task.date || today,
          startTime: result.task.startTime || null,
          estimatedTime: result.task.estimatedTime || 30,
          energyLevel: result.task.energyLevel || 'media',
          deadline: result.task.deadline || null,
          status: 'pendente',
          source: sourceType === 'audio' ? 'whatsapp_audio' : 'whatsapp',
        });

        if (saved) {
          savedTasks.push(saved);

          // Criar evento no Google Calendar
          if (isCalendarEnabled() && saved.startTime) {
            createCalendarEvent(saved).catch((err) => {
              console.error('[Orchestrator] Erro ao criar evento no calendar:', err.message);
            });
          }
        }
      }
    } catch (err) {
      console.error('[Orchestrator] Erro ao salvar tarefa:', err.message);
    }
  }

  // ═══ PASSO 6: MONTAR RESPOSTA ═══
  const responseParts = [];

  // Se o Guardião vetou
  if (guardianResult && !guardianResult.approved) {
    responseParts.push(guardianResult.message || 'Senhor, não vou agendar isso agora. A carga está pesada demais.');
    if (guardianResult.veto?.redistribute?.length > 0) {
      responseParts.push('Sugiro redistribuir:');
      guardianResult.veto.redistribute.forEach((r) => {
        responseParts.push(`- "${r.taskId}" → ${formatDatePt(r.moveToDate)}: ${r.reason}`);
      });
    }
    addToHistory(senderNumber, 'user', userText);
    addToHistory(senderNumber, 'assistant', responseParts.join('\n'));
    return { text: responseParts.join('\n'), reaction: '⚠️' };
  }

  // Tarefas salvas com sucesso
  if (savedTasks.length > 0) {
    if (savedTasks.length === 1) {
      const t = savedTasks[0];
      const energy = { leve: '🟢', media: '🟡', pesada: '🔴' }[t.energyLevel] || '';
      const time = t.startTime || 'sem horário';
      responseParts.push(`Agendado: ${energy} ${t.title}`);
      responseParts.push(`${formatDatePt(t.date)} às ${time} [${t.frente}]`);
    } else {
      responseParts.push(`${savedTasks.length} tarefas agendadas:`);
      savedTasks.forEach((t) => {
        const energy = { leve: '🟢', media: '🟡', pesada: '🔴' }[t.energyLevel] || '';
        const time = t.startTime || '--:--';
        responseParts.push(`${energy} ${time} ${t.title} [${t.frente}]`);
      });
    }
  }

  // Avisos do Guardião (aprovado mas com warnings)
  if (guardianResult?.warnings?.length > 0) {
    responseParts.push('');
    responseParts.push(guardianResult.warnings.join('\n'));
  }

  // Pausa obrigatória
  if (guardianResult?.mandatoryBreak) {
    responseParts.push(`\nPausa obrigatória de ${guardianResult.mandatoryBreak.duration}min após esta tarefa.`);
    if (guardianResult.mandatoryBreak.suggestion) {
      responseParts.push(guardianResult.mandatoryBreak.suggestion);
    }
  }

  // Se o Guardião fatiou a tarefa
  if (guardianResult?.slicedSteps?.length > 0) {
    responseParts.push('\nQuebrando em passos:');
    guardianResult.slicedSteps.forEach((step, i) => {
      responseParts.push(`${i + 1}. ${step.text} (~${step.time}min)`);
    });
  }

  // Mensagem do Triagem se tinha algo
  if (triageResult?.reply && savedTasks.length === 0) {
    responseParts.push(triageResult.reply);
  }

  const finalText = responseParts.join('\n') || 'Fechado, senhor.';
  const reaction = savedTasks.length > 0 ? '📝' : (guardianResult?.approved === false ? '⚠️' : '👍');

  addToHistory(senderNumber, 'user', userText);
  addToHistory(senderNumber, 'assistant', finalText);

  return { text: finalText, reaction };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTAÇÕES PARA HOOKS
// ═══════════════════════════════════════════════════════════════
export { calculateBurnoutScore };

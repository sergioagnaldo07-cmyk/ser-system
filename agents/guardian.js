// ============================================================
// Guardian Agent — SER System v4
// Agente de protecao empatica contra burnout
// Modelo: Claude Haiku 4.5 (Anthropic API)
// Ativado apenas quando triggered (~5% das mensagens)
// ============================================================

import { todayLocalISO, normalizeText } from '../shared-utils.js';

// ------------------------------------------------------------
// System prompt do Guardian
// ------------------------------------------------------------

export const GUARDIAN_PROMPT = `Voce e o Guardian, agente protetor do SER System.
Seu papel e proteger Sergio contra burnout e sobrecarga.

CONTEXTO SOBRE SERGIO:
- Trabalha em 3 frentes simultaneas (projetos distintos)
- Parceira: Mari. Estao esperando um filho
- Tendencia natural a se sobrecarregar e aceitar demais
- Precisa de lembretes firmes mas respeitosos

REGRAS INEGOCIAVEIS:
- Maximo 8 horas de tarefas por dia
- Maximo 2 tarefas pesadas consecutivas
- Nenhuma tarefa pesada apos as 18h
- Almoco sagrado: 12h-13h, sem excecoes
- Energia baixa: apenas tarefas leves nas proximas 2 horas
- Tarefa atrasada >30min: perguntar com gentileza, nunca pressionar

PODERES:
- Pode VETAR agendamentos que violem as regras
- Pode FATIAR tarefas pesadas em 3-5 passos de no maximo 15 minutos cada
- Pode sugerir pausas obrigatorias

TOM:
- Firme mas acolhedor
- Trate como "senhor"
- Sem emojis
- Frases curtas e diretas

RESPONDA SEMPRE em JSON valido com esta estrutura:
{
  "approved": boolean,
  "veto": { "reason": string, "redistribute": string } | null,
  "warnings": [string],
  "message": string,
  "slicedSteps": [{ "step": string, "minutes": number }] | null,
  "mandatoryBreak": { "after": string, "duration": number } | null
}

Se aprovado, approved=true e veto=null.
Se vetado, approved=false e veto contem motivo e sugestao de redistribuicao.
warnings pode conter alertas mesmo quando aprovado.
slicedSteps so aparece quando voce fatiar uma tarefa pesada.
mandatoryBreak aparece quando detectar necessidade de pausa.`;

// ------------------------------------------------------------
// Verifica se o Guardian deve ser ativado (logica pura, sem IA)
// ------------------------------------------------------------

export function shouldActivateGuardian(dayAgenda, newTask, userEnergy, burnoutScore) {
  const tasks = Array.isArray(dayAgenda) ? dayAgenda : [];

  // Calcula total de horas planejadas no dia
  const totalMinutes = tasks.reduce((sum, t) => {
    const dur = Number(t.duration || t.duracao || 0);
    return sum + dur;
  }, 0);
  const totalHours = totalMinutes / 60;

  // Criterio 1: dia com mais de 6h de tarefas
  if (totalHours > 6) return true;

  // Criterio 2: 3+ tarefas pesadas no mesmo dia
  const heavyCount = tasks.filter((t) => isHeavyTask(t)).length;
  if (heavyCount >= 3) return true;

  // Criterio 3: tarefa pesada apos 18h
  if (newTask && isHeavyTask(newTask)) {
    const startTime = newTask.startTime || newTask.hora_inicio || newTask.start;
    if (startTime && parseHour(startTime) >= 18) return true;
  }

  // Criterio 4: energia baixa e tarefa pesada em menos de 2h
  if (userEnergy && normalizeText(String(userEnergy)) === 'baixa' && newTask && isHeavyTask(newTask)) {
    const startTime = newTask.startTime || newTask.hora_inicio || newTask.start;
    if (startTime) {
      const taskHour = parseHour(startTime);
      const now = new Date();
      const currentHour = now.getHours() + now.getMinutes() / 60;
      if (taskHour - currentHour < 2 && taskHour - currentHour >= 0) return true;
    }
  }

  // Criterio 5: burnout score acima de 60
  if (typeof burnoutScore === 'number' && burnoutScore > 60) return true;

  return false;
}

// ------------------------------------------------------------
// Calcula o score de burnout (logica pura, sem IA)
// Retorna { score, level, factors, suggestion }
// ------------------------------------------------------------

export function calculateBurnoutScore(allTasks, today, recentCheckins) {
  const tasks = Array.isArray(allTasks) ? allTasks : [];
  const todayStr = today || todayLocalISO();
  const factors = [];
  let score = 0;

  // Filtra tarefas do dia
  const todayTasks = tasks.filter((t) => {
    const taskDate = t.date || t.data || t.scheduled_date || '';
    return String(taskDate).startsWith(todayStr);
  });

  // Fator: total de horas planejadas hoje
  const totalMinutes = todayTasks.reduce((sum, t) => {
    const dur = Number(t.duration || t.duracao || 0);
    return sum + dur;
  }, 0);
  const totalHours = totalMinutes / 60;

  if (totalHours > 8) {
    score += 30;
    factors.push(`Mais de 8h planejadas hoje (${totalHours.toFixed(1)}h) → +30`);
  } else if (totalHours > 6) {
    score += 15;
    factors.push(`Mais de 6h planejadas hoje (${totalHours.toFixed(1)}h) → +15`);
  }

  // Fator: tarefas atrasadas (max +25)
  const overdueTasks = todayTasks.filter((t) => {
    const status = normalizeText(String(t.status || ''));
    return status === 'atrasada' || status === 'overdue' || status === 'atrasado';
  });
  const overduePoints = Math.min(overdueTasks.length * 5, 25);
  if (overduePoints > 0) {
    score += overduePoints;
    factors.push(`${overdueTasks.length} tarefa(s) atrasada(s) → +${overduePoints}`);
  }

  // Fator: tarefas pesadas hoje (max +30)
  const heavyTasks = todayTasks.filter((t) => isHeavyTask(t));
  const heavyPoints = Math.min(heavyTasks.length * 10, 30);
  if (heavyPoints > 0) {
    score += heavyPoints;
    factors.push(`${heavyTasks.length} tarefa(s) pesada(s) hoje → +${heavyPoints}`);
  }

  // Garante score entre 0 e 100
  score = Math.min(Math.max(score, 0), 100);

  // Determina nivel
  let level;
  if (score <= 30) level = 'baixo';
  else if (score <= 60) level = 'moderado';
  else if (score <= 80) level = 'alto';
  else level = 'critico';

  // Sugestao baseada no nivel
  let suggestion;
  switch (level) {
    case 'baixo':
      suggestion = 'Dia tranquilo, senhor. Siga em frente.';
      break;
    case 'moderado':
      suggestion = 'Atencao com a carga, senhor. Considere pausas entre tarefas.';
      break;
    case 'alto':
      suggestion = 'Carga elevada, senhor. Recomendo adiar tarefas nao urgentes para amanha.';
      break;
    case 'critico':
      suggestion = 'Carga critica, senhor. Precisa reduzir tarefas hoje. Sua saude vem primeiro.';
      break;
  }

  return { score, level, factors, suggestion };
}

// ------------------------------------------------------------
// Chama o Guardian Agent via Anthropic API (fetch direto)
// ------------------------------------------------------------

export async function callGuardianAgent(fullDayAgenda, newTask, options = {}) {
  const {
    anthropicApiKey,
    userEnergy = 'normal',
    burnoutScore = 0,
    currentTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  } = options;

  if (!anthropicApiKey) {
    throw new Error('Guardian Agent requer anthropicApiKey nas options.');
  }

  // Monta o contexto para o modelo
  const agendaSummary = Array.isArray(fullDayAgenda)
    ? fullDayAgenda
        .map((t) => {
          const name = t.title || t.titulo || t.name || 'sem titulo';
          const time = t.startTime || t.hora_inicio || t.start || '?';
          const dur = t.duration || t.duracao || '?';
          const weight = isHeavyTask(t) ? 'PESADA' : 'leve';
          return `- ${time} | ${name} | ${dur}min | ${weight}`;
        })
        .join('\n')
    : 'Sem agenda definida.';

  const newTaskDesc = newTask
    ? `Titulo: ${newTask.title || newTask.titulo || 'sem titulo'}
Horario: ${newTask.startTime || newTask.hora_inicio || newTask.start || 'nao definido'}
Duracao: ${newTask.duration || newTask.duracao || 'nao definida'}min
Peso: ${isHeavyTask(newTask) ? 'PESADA' : 'leve'}`
    : 'Nenhuma nova tarefa proposta.';

  const userMessage = `HORA ATUAL: ${currentTime}
ENERGIA DO SERGIO: ${userEnergy}
BURNOUT SCORE: ${burnoutScore}

AGENDA DO DIA:
${agendaSummary}

NOVA TAREFA PROPOSTA:
${newTaskDesc}

Analise e responda em JSON.`;

  // Chamada direta a API da Anthropic
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: GUARDIAN_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'sem corpo');
    throw new Error(`Guardian API falhou (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  // Extrai texto da resposta
  const rawText = data.content?.[0]?.text || '';

  // Tenta parsear JSON da resposta
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Resposta do Guardian nao contem JSON valido.');
    }
    return JSON.parse(jsonMatch[0]);
  } catch (parseError) {
    // Retorna fallback seguro em caso de erro de parse
    return {
      approved: false,
      veto: { reason: 'Erro ao processar resposta do Guardian.', redistribute: 'Tente novamente.' },
      warnings: ['Falha no parse da resposta do modelo.'],
      message: 'Senhor, houve um problema na minha analise. Por seguranca, recomendo revisar manualmente.',
      slicedSteps: null,
      mandatoryBreak: null,
    };
  }
}

// ------------------------------------------------------------
// Helpers internos
// ------------------------------------------------------------

/**
 * Determina se uma tarefa e pesada com base em peso, tipo ou duracao.
 */
function isHeavyTask(task) {
  if (!task) return false;

  // Verifica campo de peso explicito
  const weight = normalizeText(String(task.weight || task.peso || ''));
  if (weight === 'pesada' || weight === 'heavy' || weight === 'alta') return true;

  // Verifica tipo/categoria
  const type = normalizeText(String(task.type || task.tipo || task.category || ''));
  if (type === 'pesada' || type === 'heavy' || type === 'deep work' || type === 'deep_work') return true;

  // Duracao longa (>= 60min) indica tarefa pesada
  const duration = Number(task.duration || task.duracao || 0);
  if (duration >= 60) return true;

  return false;
}

/**
 * Extrai hora (como numero decimal) de uma string de horario.
 * Ex: "14:30" → 14.5, "18h" → 18
 */
function parseHour(timeStr) {
  if (!timeStr) return -1;
  const str = String(timeStr).trim();

  // Formato HH:MM
  const match = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    return Number(match[1]) + Number(match[2]) / 60;
  }

  // Formato Xh
  const matchH = str.match(/^(\d{1,2})h$/i);
  if (matchH) {
    return Number(matchH[1]);
  }

  return -1;
}

// ============================================================================
// MAESTRO — Roteador Central do SER System v4
// ============================================================================
// Resolve 70-80% das mensagens do WhatsApp SEM usar IA.
// Usa regex + lógica local. Só encaminha para agentes IA quando não consegue
// resolver localmente.
// ============================================================================

import { normalizeText, todayLocalISO } from '../shared-utils.js';

// ============================================================================
// PADRÕES REGEX — cada rota tem seus gatilhos
// ============================================================================

// Saudações — "oi", "bom dia", "boa tarde", "boa noite", "e aí", "fala"
const RE_GREETING = /^(oi|ola|eai|e ai|fala|bom dia|boa tarde|boa noite|salve|hey|opa)$/;

// Confirmações — "ok", "beleza", "valeu", "entendi", "blz", "top", "certo"
const RE_ACK = /^(ok|beleza|blz|valeu|entendi|certo|top|massa|show|tranquilo|tmj|boa|perfeito|fechado|pode ser|pode)$/;

// Consulta de agenda — "agenda", "tarefas", "o que tenho", "meus compromissos"
const RE_AGENDA = /\b(agenda|tarefas?|o que (tenho|tem)|meus? compromissos?|pendencias?|pendencias|meu dia|como (esta|ta) meu dia)\b/;

// Conclusão rápida — "concluí", "terminei", "feito", "pronto", "done"
const RE_COMPLETE = /\b(conclui|terminei|feito|pronto|done|acabei|finalizei|completei)\b/;

// Mover tarefa — "mover X pra amanhã", "adiar", "passar pra segunda"
const RE_MOVE = /\b(mover|adiar|passar|transferir|empurrar|jogar)\b.*\b(pra|para|pro)\b/;

// Prioridades — "prioridade", "o que faço primeiro", "mais importante"
const RE_PRIORITY = /\b(prioridade|prioridades|o que faco primeiro|mais importante|urgente|por onde comeco|comecar por)\b/;

// Check-in de energia — "cansado", "energia alta", "travado", "focado", etc.
const RE_ENERGY = /\b(cansado|exausto|esgotado|sem energia|energia baixa|desanimado|travado|bloqueado|energia alta|focado|motivado|produtivo|animado|disposto|energia media|normal|ok de energia|mais ou menos)\b/;

// Consulta de uso/custos — "quanto gastei", "custo", "tokens", "consumo"
const RE_USAGE = /\b(quanto gastei|custo|custos|tokens?|consumo|gastos?|uso da ia|creditos?)\b/;

// ============================================================================
// DETECÇÃO DE ENERGIA — retorna 'alta', 'media' ou 'baixa'
// ============================================================================

const ENERGY_ALTA = /\b(energia alta|focado|motivado|produtivo|animado|disposto|on fire|a mil|energizado|pilhado)\b/;
const ENERGY_BAIXA = /\b(cansado|exausto|esgotado|sem energia|energia baixa|desanimado|travado|bloqueado|indisposto|preguicoso|preguica|morto|destruido)\b/;
const ENERGY_MEDIA = /\b(energia media|normal|ok de energia|mais ou menos|medio|razoavel|neutro)\b/;

/**
 * Detecta nível de energia a partir do texto normalizado.
 * @param {string} norm - texto já normalizado
 * @returns {'alta'|'media'|'baixa'|null}
 */
function detectEnergy(norm) {
  if (ENERGY_ALTA.test(norm)) return 'alta';
  if (ENERGY_BAIXA.test(norm)) return 'baixa';
  if (ENERGY_MEDIA.test(norm)) return 'media';
  return null;
}

// ============================================================================
// INFERÊNCIA DE DATA — extrai data-alvo do texto
// ============================================================================

// Mapa de dias da semana em português
const DIAS_SEMANA = {
  domingo: 0, segunda: 1, terca: 2, quarta: 3,
  quinta: 4, sexta: 5, sabado: 6,
};

/**
 * Infere a data-alvo mencionada no texto.
 * Suporta: "hoje", "amanhã", "depois de amanhã", dias da semana,
 * e datas explícitas como "25/03" ou "2026-03-25".
 * @param {string} norm - texto normalizado
 * @returns {string|null} data ISO (YYYY-MM-DD) ou null
 */
function inferDate(norm) {
  const hoje = new Date();

  // "hoje"
  if (/\bhoje\b/.test(norm)) {
    return todayLocalISO(hoje);
  }

  // "amanhã" / "amanha"
  if (/\bamanha\b/.test(norm)) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + 1);
    return todayLocalISO(d);
  }

  // "depois de amanhã"
  if (/\bdepois de amanha\b/.test(norm)) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + 2);
    return todayLocalISO(d);
  }

  // "próxima segunda", "segunda", "terça", etc.
  for (const [nome, dow] of Object.entries(DIAS_SEMANA)) {
    const re = new RegExp(`\\b${nome}\\b`);
    if (re.test(norm)) {
      const d = new Date(hoje);
      const diff = (dow - d.getDay() + 7) % 7 || 7; // sempre avança
      d.setDate(d.getDate() + diff);
      return todayLocalISO(d);
    }
  }

  // Data explícita DD/MM
  const matchDDMM = norm.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (matchDDMM) {
    const dd = String(matchDDMM[1]).padStart(2, '0');
    const mm = String(matchDDMM[2]).padStart(2, '0');
    const yyyy = hoje.getFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

// ============================================================================
// EXTRAÇÃO DE REFERÊNCIA A TAREFA — busca nome/trecho da tarefa no texto
// ============================================================================

/**
 * Tenta extrair o nome ou trecho da tarefa mencionada.
 * Remove palavras-chave de comando para isolar o nome.
 * @param {string} norm - texto normalizado
 * @returns {string|null}
 */
function extractTaskRef(norm) {
  // Remove verbos de comando e preposições temporais
  let cleaned = norm
    .replace(/\b(conclui|terminei|feito|pronto|done|acabei|finalizei|completei)\b/g, '')
    .replace(/\b(mover|adiar|passar|transferir|empurrar|jogar)\b/g, '')
    .replace(/\b(pra|para|pro|de|o|a|os|as|meu|minha|do|da)\b/g, '')
    .replace(/\b(hoje|amanha|depois de amanha)\b/g, '')
    .replace(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/g, '')
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length >= 2 ? cleaned : null;
}

// ============================================================================
// SAUDAÇÃO CONTEXTUAL — muda conforme hora do dia
// ============================================================================

/**
 * Retorna saudação adequada ao horário atual.
 * @returns {string}
 */
function greetingByTime() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia, senhor.';
  if (hour < 18) return 'Boa tarde, senhor.';
  return 'Boa noite, senhor.';
}

// ============================================================================
// maestroRoute — função principal de roteamento
// ============================================================================

/**
 * Analisa o texto da mensagem e decide a rota sem usar IA.
 * Retorna metadados para o dispatcher executar o handler correto.
 *
 * @param {string} text - texto bruto da mensagem do WhatsApp
 * @returns {{
 *   route: string,
 *   handler: string,
 *   needsAI: boolean,
 *   extractDate: string|null,
 *   needsSelector: boolean,
 *   energyDetected: 'alta'|'media'|'baixa'|null
 * }}
 */
export function maestroRoute(text) {
  const norm = normalizeText(text);
  const energy = detectEnergy(norm);
  const targetDate = inferDate(norm);
  const taskRef = extractTaskRef(norm);

  // --- Saudações ---
  if (RE_GREETING.test(norm)) {
    return {
      route: 'greeting',
      handler: 'handleGreeting',
      needsAI: false,
      extractDate: todayLocalISO(),
      needsSelector: false,
      energyDetected: energy,
    };
  }

  // --- Confirmações/Acknowledgements ---
  if (RE_ACK.test(norm)) {
    return {
      route: 'ack',
      handler: 'handleAck',
      needsAI: false,
      extractDate: null,
      needsSelector: false,
      energyDetected: null,
    };
  }

  // --- Check-in de energia (antes de agenda pois pode conter palavras sobrepostas) ---
  if (RE_ENERGY.test(norm) && energy) {
    return {
      route: 'energy',
      handler: 'handleEnergy',
      needsAI: false,
      extractDate: todayLocalISO(),
      needsSelector: false,
      energyDetected: energy,
    };
  }

  // --- Conclusão rápida de tarefa ---
  if (RE_COMPLETE.test(norm)) {
    return {
      route: 'complete',
      handler: 'handleComplete',
      needsAI: false,
      extractDate: todayLocalISO(),
      needsSelector: !taskRef, // se não achou referência, precisa perguntar qual
      energyDetected: energy,
    };
  }

  // --- Mover tarefa ---
  if (RE_MOVE.test(norm)) {
    return {
      route: 'move',
      handler: 'handleMove',
      needsAI: false,
      extractDate: targetDate,
      needsSelector: !taskRef, // se não achou referência, precisa perguntar qual
      energyDetected: energy,
    };
  }

  // --- Prioridades ---
  if (RE_PRIORITY.test(norm)) {
    return {
      route: 'priority',
      handler: 'handlePriority',
      needsAI: false,
      extractDate: todayLocalISO(),
      needsSelector: false,
      energyDetected: energy,
    };
  }

  // --- Consulta de agenda ---
  if (RE_AGENDA.test(norm)) {
    return {
      route: 'agenda',
      handler: 'handleAgenda',
      needsAI: false,
      extractDate: targetDate || todayLocalISO(),
      needsSelector: false,
      energyDetected: energy,
    };
  }

  // --- Consulta de uso/custos ---
  if (RE_USAGE.test(norm)) {
    return {
      route: 'usage',
      handler: 'handleUsage',
      needsAI: false,
      extractDate: null,
      needsSelector: false,
      energyDetected: null,
    };
  }

  // --- Fallback: não reconheceu → encaminha para IA ---
  return {
    route: 'ai_fallback',
    handler: 'handleAIFallback',
    needsAI: true,
    extractDate: targetDate,
    needsSelector: false,
    energyDetected: energy,
  };
}

// ============================================================================
// MAESTRO_HANDLERS — funções que geram a resposta para cada rota
// ============================================================================
// Cada handler recebe: { tasks, today, targetDate, taskMatch, energyLevel, text }
// Cada handler retorna: { text: string, reaction?: string }
// ============================================================================

export const MAESTRO_HANDLERS = {

  // --- Saudação: responde com briefing do dia ---
  handleGreeting({ tasks, today }) {
    const saudacao = greetingByTime();
    const pendentes = (tasks || []).filter(t => t.date === today && t.status !== 'done');
    const concluidas = (tasks || []).filter(t => t.date === today && t.status === 'done');

    if (pendentes.length === 0 && concluidas.length === 0) {
      return {
        text: `${saudacao}\n\nSua agenda para hoje está limpa. Nenhuma tarefa registrada.`,
        reaction: '👋',
      };
    }

    // Monta briefing
    let briefing = `${saudacao}\n\n📋 *Briefing do dia (${today}):*\n`;

    if (pendentes.length > 0) {
      briefing += `\n⏳ *Pendentes (${pendentes.length}):*\n`;
      pendentes.forEach((t, i) => {
        const prio = t.priority ? ` [${t.priority}]` : '';
        const hora = t.time ? ` às ${t.time}` : '';
        briefing += `  ${i + 1}. ${t.title}${prio}${hora}\n`;
      });
    }

    if (concluidas.length > 0) {
      briefing += `\n✅ *Concluídas (${concluidas.length}):*\n`;
      concluidas.forEach((t, i) => {
        briefing += `  ${i + 1}. ${t.title}\n`;
      });
    }

    return { text: briefing.trim(), reaction: '👋' };
  },

  // --- Confirmação: resposta curta ---
  handleAck() {
    return { text: 'Fechado, senhor.', reaction: '👍' };
  },

  // --- Consulta de agenda ---
  handleAgenda({ tasks, targetDate }) {
    const dataAlvo = targetDate || todayLocalISO();
    const tarefas = (tasks || []).filter(t => t.date === dataAlvo && t.status !== 'done');

    if (tarefas.length === 0) {
      return {
        text: `📋 Nenhuma tarefa pendente para *${dataAlvo}*.`,
        reaction: '📋',
      };
    }

    let msg = `📋 *Tarefas para ${dataAlvo}:*\n\n`;
    tarefas.forEach((t, i) => {
      const prio = t.priority ? ` [${t.priority}]` : '';
      const hora = t.time ? ` às ${t.time}` : '';
      const status = t.status === 'in_progress' ? ' 🔄' : '';
      msg += `${i + 1}. ${t.title}${prio}${hora}${status}\n`;
    });

    return { text: msg.trim(), reaction: '📋' };
  },

  // --- Conclusão rápida de tarefa ---
  handleComplete({ taskMatch, tasks, today }) {
    // Se não encontrou a tarefa específica, pede seleção
    if (!taskMatch) {
      const pendentes = (tasks || []).filter(t => t.date === today && t.status !== 'done');
      if (pendentes.length === 0) {
        return { text: 'Não há tarefas pendentes para hoje.', reaction: '🤔' };
      }

      let msg = '✅ Qual tarefa você concluiu?\n\n';
      pendentes.forEach((t, i) => {
        msg += `${i + 1}. ${t.title}\n`;
      });
      msg += '\nResponda com o número.';
      return { text: msg, reaction: '✅' };
    }

    // Tarefa encontrada — confirma conclusão
    return {
      text: `✅ *"${taskMatch.title}"* marcada como concluída. Parabéns, senhor!`,
      reaction: '🎉',
    };
  },

  // --- Mover tarefa para outra data ---
  handleMove({ taskMatch, targetDate, tasks, today }) {
    // Se não tem data-alvo, pergunta
    if (!targetDate) {
      return {
        text: '📅 Para qual data deseja mover? (ex: amanhã, segunda, 28/03)',
        reaction: '📅',
      };
    }

    // Se não encontrou a tarefa, pede seleção
    if (!taskMatch) {
      const pendentes = (tasks || []).filter(t => t.date === today && t.status !== 'done');
      if (pendentes.length === 0) {
        return { text: 'Não há tarefas pendentes para mover.', reaction: '🤔' };
      }

      let msg = '📅 Qual tarefa deseja mover?\n\n';
      pendentes.forEach((t, i) => {
        msg += `${i + 1}. ${t.title}\n`;
      });
      msg += `\nResponda com o número. Destino: *${targetDate}*`;
      return { text: msg, reaction: '📅' };
    }

    // Tudo certo — confirma movimentação
    return {
      text: `📅 *"${taskMatch.title}"* movida para *${targetDate}*. Ajustado, senhor.`,
      reaction: '📅',
    };
  },

  // --- Prioridades: lista ordenada ---
  handlePriority({ tasks, today }) {
    const pendentes = (tasks || []).filter(t => t.date === today && t.status !== 'done');

    if (pendentes.length === 0) {
      return { text: 'Sem tarefas pendentes para hoje. Dia livre, senhor.', reaction: '🎯' };
    }

    // Ordena por prioridade: alta > media > baixa > sem prioridade
    const pesosPrio = { alta: 0, media: 1, baixa: 2 };
    const ordenadas = [...pendentes].sort((a, b) => {
      const pa = pesosPrio[a.priority] ?? 3;
      const pb = pesosPrio[b.priority] ?? 3;
      return pa - pb;
    });

    let msg = '🎯 *Prioridades de hoje (ordem sugerida):*\n\n';
    ordenadas.forEach((t, i) => {
      const prio = t.priority ? ` [${t.priority}]` : '';
      const hora = t.time ? ` às ${t.time}` : '';
      msg += `${i + 1}. ${t.title}${prio}${hora}\n`;
    });

    msg += '\nComece pelo item 1. Uma coisa de cada vez, senhor.';
    return { text: msg.trim(), reaction: '🎯' };
  },

  // --- Check-in de energia ---
  handleEnergy({ energyLevel, tasks, today }) {
    const pendentes = (tasks || []).filter(t => t.date === today && t.status !== 'done');

    // Respostas adaptadas ao nível de energia
    const respostas = {
      alta: {
        text: '⚡ Energia alta registrada! Ótimo momento para atacar as tarefas mais pesadas.',
        reaction: '⚡',
      },
      media: {
        text: '🔋 Energia média registrada. Foque em tarefas moderadas e mantenha o ritmo.',
        reaction: '🔋',
      },
      baixa: {
        text: '🪫 Energia baixa registrada. Priorize apenas o essencial. Cuide-se, senhor.',
        reaction: '🪫',
      },
    };

    const resp = respostas[energyLevel] || respostas.media;

    // Sugere adaptação se há tarefas pendentes
    if (pendentes.length > 0 && energyLevel === 'baixa') {
      resp.text += `\n\nVocê tem ${pendentes.length} tarefa(s) pendente(s). Considere adiar as menos urgentes.`;
    } else if (pendentes.length > 0 && energyLevel === 'alta') {
      resp.text += `\n\nVocê tem ${pendentes.length} tarefa(s) pendente(s). Bora resolver tudo!`;
    }

    return resp;
  },

  // --- Consulta de uso/custos ---
  handleUsage({ text }) {
    // Cálculo local — os valores reais vêm do contexto de uso acumulado.
    // Aqui montamos a estrutura; o dispatcher preenche os dados reais.
    return {
      text: [
        '💰 *Resumo de uso:*\n',
        '• Mensagens hoje: _dados do dispatcher_',
        '• Chamadas IA hoje: _dados do dispatcher_',
        '• Tokens estimados: _dados do dispatcher_',
        '• Custo estimado: _dados do dispatcher_',
        '\nPara detalhes, o dispatcher preenche com dados reais do banco.',
      ].join('\n'),
      reaction: '💰',
    };
  },

  // --- Fallback: encaminha para IA ---
  handleAIFallback({ text }) {
    // O Maestro não responde — sinaliza que precisa de IA
    return {
      text: null, // null indica que o dispatcher deve acionar um agente IA
      reaction: '🤖',
    };
  },
};

// ============================================================================
// EXPORTS AUXILIARES — para testes e uso externo
// ============================================================================

export { detectEnergy, inferDate, extractTaskRef, greetingByTime };

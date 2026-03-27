// ═══════════════════════════════════════════════════════════════
// SISTEMA SER — Hooks (Vigias automáticos — SEM IA, $0)
// Monitoram o relógio e acionam agentes quando necessário
// ═══════════════════════════════════════════════════════════════

import { todayLocalISO, normalizeTime } from './shared-utils.js';

// ─── Estado dos hooks ───
let hookIntervals = [];
let lastBurnoutAlertDate = '';
let lastEnergyAskDate = '';
let lastEnergyAskHour = -1;
const overdueNotifiedTasks = new Set(); // taskId → já notificou

// ─── Configuração ───
const OVERDUE_GENTLE_MINUTES = 15;   // 15min atrasada → lembrete gentil
const OVERDUE_GUARDIAN_MINUTES = 30;  // 30min → aciona Guardião
const BURNOUT_CHECK_INTERVAL = 30;    // minutos
const ENERGY_ASK_INTERVAL = 3;        // horas sem check-in → perguntar

function timeToMinutes(timeStr) {
  const t = normalizeTime(timeStr);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function currentTimeMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function currentTimeHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function isWorkingHours() {
  const mins = currentTimeMinutes();
  return mins >= 360 && mins <= 1200; // 06:00 - 20:00
}

// ═══════════════════════════════════════════════════════════════
// HOOK 1: Tarefa atrasada (verifica a cada 1 min)
// ═══════════════════════════════════════════════════════════════
function createOverdueHook(deps) {
  const { getAgendaTasks, sendMessage, callGuardian, getLastEnergy, getBurnoutScore } = deps;

  return setInterval(async () => {
    if (!isWorkingHours()) return;

    try {
      const today = todayLocalISO();
      const nowMinutes = currentTimeMinutes();
      const tasks = await getAgendaTasks();

      const overdueTasks = tasks.filter((t) => {
        if (t.completedAt || t.date !== today || !t.startTime) return false;
        const taskMin = timeToMinutes(t.startTime);
        if (taskMin === null) return false;
        return nowMinutes > taskMin && (t.status === 'pendente' || !t.status);
      });

      for (const task of overdueTasks) {
        const taskMin = timeToMinutes(task.startTime);
        const delayMinutes = nowMinutes - taskMin;
        const taskKey = `${task.id}|${today}`;

        // 15min atrasada → lembrete gentil (sem IA)
        if (delayMinutes >= OVERDUE_GENTLE_MINUTES && delayMinutes < OVERDUE_GUARDIAN_MINUTES) {
          const notifKey = `${taskKey}|gentle`;
          if (!overdueNotifiedTasks.has(notifKey)) {
            overdueNotifiedTasks.add(notifKey);
            await sendMessage(
              `Senhor, "${task.title}" era pras ${task.startTime}. Tudo bem? Quer começar agora ou reagendar?`
            );
          }
        }

        // 30min+ atrasada → aciona Guardião (com IA)
        if (delayMinutes >= OVERDUE_GUARDIAN_MINUTES) {
          const notifKey = `${taskKey}|guardian`;
          if (!overdueNotifiedTasks.has(notifKey)) {
            overdueNotifiedTasks.add(notifKey);
            if (callGuardian) {
              try {
                const energy = await getLastEnergy();
                const burnout = await getBurnoutScore();
                const allDayTasks = tasks.filter((t2) => t2.date === today && !t2.completedAt);
                const result = await callGuardian(allDayTasks, task, {
                  userEnergy: energy,
                  burnoutScore: burnout?.score || 0,
                  currentTime: currentTimeHHMM(),
                });
                if (result?.message) {
                  await sendMessage(result.message);
                }
              } catch (err) {
                console.error('[Hook:Overdue] Erro ao chamar Guardião:', err.message);
                await sendMessage(
                  `Senhor, "${task.title}" está ${delayMinutes} minutos atrasada. Precisa de ajuda?`
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[Hook:Overdue] Erro:', err.message);
    }
  }, 60 * 1000); // A cada 1 minuto
}

// ═══════════════════════════════════════════════════════════════
// HOOK 2: Score de burnout (verifica a cada 30 min)
// ═══════════════════════════════════════════════════════════════
function createBurnoutHook(deps) {
  const { getBurnoutScore, sendMessage, callGuardian, getAgendaTasks, getLastEnergy } = deps;

  return setInterval(async () => {
    if (!isWorkingHours()) return;

    try {
      const today = todayLocalISO();
      const score = await getBurnoutScore();

      if (score.score > 60 && lastBurnoutAlertDate !== today) {
        lastBurnoutAlertDate = today;

        if (score.score > 70 && callGuardian) {
          const tasks = await getAgendaTasks();
          const dayTasks = tasks.filter((t) => t.date === today && !t.completedAt);
          const energy = await getLastEnergy();
          const result = await callGuardian(dayTasks, null, {
            userEnergy: energy,
            burnoutScore: score.score,
            currentTime: currentTimeHHMM(),
          });
          if (result?.message) {
            await sendMessage(result.message);
          }
        } else {
          await sendMessage(score.suggestion || 'Senhor, a carga está pesada hoje. Quer que eu redistribua algo?');
        }
      }
    } catch (err) {
      console.error('[Hook:Burnout] Erro:', err.message);
    }
  }, BURNOUT_CHECK_INTERVAL * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════
// HOOK 3: Check-in de energia (a cada 2h pergunta se não teve)
// ═══════════════════════════════════════════════════════════════
function createEnergyHook(deps) {
  const { getLastEnergyCheckinTime, sendMessage } = deps;

  return setInterval(async () => {
    if (!isWorkingHours()) return;

    try {
      const today = todayLocalISO();
      const now = new Date();
      const currentHour = now.getHours();

      // Evita perguntar mais de 1x na mesma janela de 2h
      if (lastEnergyAskDate === today && Math.abs(currentHour - lastEnergyAskHour) < ENERGY_ASK_INTERVAL) {
        return;
      }

      const lastCheckinTime = await getLastEnergyCheckinTime();
      const hoursSinceCheckin = lastCheckinTime
        ? (Date.now() - lastCheckinTime) / 3600000
        : 99;

      if (hoursSinceCheckin > ENERGY_ASK_INTERVAL) {
        lastEnergyAskDate = today;
        lastEnergyAskHour = currentHour;
        await sendMessage(
          'Senhor, como está a energia agora? Me responde: alta, média ou baixa.'
        );
      }
    } catch (err) {
      console.error('[Hook:Energy] Erro:', err.message);
    }
  }, 2 * 60 * 60 * 1000); // A cada 2 horas
}

// ═══════════════════════════════════════════════════════════════
// INICIAR / PARAR HOOKS
// ═══════════════════════════════════════════════════════════════
export function startHooks(deps) {
  stopHooks();

  console.log('[Hooks] Iniciando vigias automáticos...');

  hookIntervals.push(createOverdueHook(deps));
  hookIntervals.push(createBurnoutHook(deps));
  hookIntervals.push(createEnergyHook(deps));

  // Limpar cache diário à meia-noite
  hookIntervals.push(setInterval(() => {
    const today = todayLocalISO();
    if (lastBurnoutAlertDate !== today) {
      overdueNotifiedTasks.clear();
    }
  }, 60 * 60 * 1000));

  console.log(`[Hooks] ${hookIntervals.length} hooks ativos: overdue(1min), burnout(${BURNOUT_CHECK_INTERVAL}min), energy(2h)`);
}

export function stopHooks() {
  hookIntervals.forEach((id) => clearInterval(id));
  hookIntervals = [];
  overdueNotifiedTasks.clear();
  lastBurnoutAlertDate = '';
  lastEnergyAskDate = '';
  lastEnergyAskHour = -1;
}

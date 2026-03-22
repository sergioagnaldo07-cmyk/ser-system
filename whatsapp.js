// ═══════════════════════════════════════════════════════════════
// SISTEMA SER — Módulo WhatsApp via whatsapp-web.js
// Sem Docker, roda direto no Node.js
// ═══════════════════════════════════════════════════════════════

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import QRCode from 'qrcode';

// ─── Estado local ───
let connectionStatus = 'disconnected';
let qrCodeBase64 = null;
let userPhoneNumber = process.env.WHATSAPP_NUMBER || '';
let remindersEnabled = true;
let reminderIntervals = [];
let client = null;
let callOpenAIFn = null;
let systemPromptText = '';

// ─── Inicializar cliente WhatsApp ───
function initClient() {
  if (client) return;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
      ],
    },
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
  });

  client.on('authenticated', () => {
    console.log('[WhatsApp] Autenticado!');
    connectionStatus = 'connecting';
  });

  client.on('auth_failure', (msg) => {
    console.error('[WhatsApp] Falha na autenticacao:', msg);
    connectionStatus = 'disconnected';
    qrCodeBase64 = null;
  });

  client.on('disconnected', (reason) => {
    console.log('[WhatsApp] Desconectado:', reason);
    connectionStatus = 'disconnected';
    qrCodeBase64 = null;
    client = null;
  });

  // Processar mensagens recebidas
  client.on('message', async (msg) => {
    if (!callOpenAIFn || !systemPromptText) return;
    if (msg.fromMe) return;

    const text = msg.body;
    if (!text || text.length < 2) return;

    const senderNumber = msg.from.replace('@c.us', '');
    console.log(`[WhatsApp] Mensagem de ${senderNumber}: ${text}`);

    try {
      const response = await callOpenAIFn(
        systemPromptText + '\n\nCONTEXTO: Esta conversa esta acontecendo pelo WhatsApp. Mantenha respostas MUITO curtas (1-3 linhas). Nao use formatacao markdown.',
        [{ role: 'user', content: text }],
        500
      );

      if (response) {
        await msg.reply(response);
        console.log(`[WhatsApp] Resposta enviada para ${senderNumber}`);
      }
    } catch (err) {
      console.error('[WhatsApp] Erro ao processar mensagem:', err.message);
    }
  });
}

// ─── Criar instância / Gerar QR Code ───
async function createInstance() {
  try {
    initClient();
    connectionStatus = 'connecting';
    qrCodeBase64 = null;

    // Inicializa o cliente (gera QR code via evento 'qr')
    await client.initialize();

    // Espera um pouco pro QR ser gerado
    await new Promise(resolve => setTimeout(resolve, 3000));

    return {
      success: true,
      qrcode: qrCodeBase64,
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
  const chatId = cleanNumber + '@c.us';

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
  // Salvar referências para uso no handler de mensagens
  callOpenAIFn = callOpenAI;
  systemPromptText = systemPrompt;

  stopReminders();

  if (!remindersEnabled || !userPhoneNumber) {
    console.log('[WhatsApp] Lembretes desativados ou numero nao configurado');
    return;
  }

  const scheduleDaily = (hour, minute, getMessage) => {
    const check = () => {
      const now = new Date();
      if (now.getHours() === hour && now.getMinutes() === minute) {
        getMessage().then(msg => {
          if (msg && userPhoneNumber && connectionStatus === 'connected') {
            sendMessage(userPhoneNumber, msg).catch(err =>
              console.error('[WhatsApp] Erro ao enviar lembrete:', err.message)
            );
          }
        });
      }
    };
    return setInterval(check, 60 * 1000);
  };

  reminderIntervals.push(scheduleDaily(8, 0, async () => {
    try {
      return await callOpenAI(
        systemPrompt,
        [{ role: 'user', content: 'Me da o briefing da manha. Que horas sao, o que tenho pra fazer hoje? Seja direto e motivador. Resposta curta pro WhatsApp.' }],
        300
      );
    } catch { return 'Bom dia! Bora comecar o dia. Abre o Sistema SER e ve suas tarefas.'; }
  }));

  reminderIntervals.push(scheduleDaily(13, 0, async () => {
    try {
      return await callOpenAI(
        systemPrompt,
        [{ role: 'user', content: 'Check-in do meio dia. Me cobra sobre o progresso. Resposta curta pro WhatsApp.' }],
        300
      );
    } catch { return 'Meio dia! Hora de checar o progresso.'; }
  }));

  reminderIntervals.push(scheduleDaily(19, 0, async () => {
    try {
      return await callOpenAI(
        systemPrompt,
        [{ role: 'user', content: 'Fim do dia. Me da um resumo e manda descansar. Resposta curta pro WhatsApp.' }],
        300
      );
    } catch { return 'Dia acabando! Revisa o que fez e descansa.'; }
  }));

  console.log('[WhatsApp] Lembretes agendados: 8h, 13h, 19h');
}

function stopReminders() {
  reminderIntervals.forEach(id => clearInterval(id));
  reminderIntervals = [];
}

// ─── Getters / Setters ───
function getStatus() {
  return {
    status: connectionStatus,
    qrcode: qrCodeBase64,
    phoneNumber: userPhoneNumber,
    remindersEnabled,
  };
}

function setPhoneNumber(number) {
  userPhoneNumber = number;
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

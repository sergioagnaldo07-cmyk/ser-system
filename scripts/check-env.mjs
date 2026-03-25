import 'dotenv/config';

const requiredAlways = [
  'OPENAI_API_KEY',
];

const recommended = [
  'OPENAI_MODEL_CHAT',
  'OPENAI_MODEL_PARSER',
  'OPENAI_MODEL_WHATSAPP',
  'OPENAI_MODEL_TRANSCRIBE',
  'SER_DATA_DIR',
  'CORS_ORIGIN',
  'APP_CHAT_HISTORY_LIMIT',
  'APP_CHAT_MAX_CHARS_PER_MESSAGE',
  'OPENAI_CACHE_TTL_MS',
  'OPENAI_CACHE_MAX_ITEMS',
  'WHATSAPP_LLM_HISTORY_TURNS',
  'WHATSAPP_LLM_HISTORY_TTL_MS',
  'WHATSAPP_AUTH_PATH',
  'PUPPETEER_EXECUTABLE_PATH',
];

const storageModeRaw = String(process.env.SER_STORAGE_MODE || 'auto').trim().toLowerCase();
const storageMode = ['auto', 'supabase', 'file'].includes(storageModeRaw) ? storageModeRaw : 'auto';
const missing = [];
const warnings = [];

for (const key of requiredAlways) {
  if (!String(process.env[key] || '').trim()) missing.push(key);
}

for (const key of recommended) {
  if (!String(process.env[key] || '').trim()) warnings.push(`Recomendado definir ${key}`);
}

if (storageMode === 'supabase') {
  if (!String(process.env.SUPABASE_URL || '').trim()) missing.push('SUPABASE_URL');
  if (!String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) missing.push('SUPABASE_SERVICE_ROLE_KEY');
}

if (storageMode === 'auto') {
  const hasSupabase = Boolean(
    String(process.env.SUPABASE_URL || '').trim() &&
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  );
  if (!hasSupabase) {
    warnings.push('SER_STORAGE_MODE=auto sem Supabase: o sistema usará fallback em arquivo local.');
  }
}

if (String(process.env.WHATSAPP_AUDIO_REQUIRE_CONFIRM || '').trim() === 'true') {
  warnings.push('WHATSAPP_AUDIO_REQUIRE_CONFIRM=true: comandos por áudio exigirão confirmação.');
}
if (!String(process.env.SER_ADMIN_TOKEN || '').trim()) {
  warnings.push('SER_ADMIN_TOKEN não definido: endpoints administrativos ficam sem proteção.');
}

console.log('');
console.log('=== Check de ambiente (SER System) ===');
console.log(`Storage mode: ${storageMode}`);

if (missing.length > 0) {
  console.log('');
  console.log('❌ Variáveis obrigatórias ausentes:');
  missing.forEach((item) => console.log(`- ${item}`));
  process.exit(1);
}

console.log('✅ Obrigatórias OK');

if (warnings.length > 0) {
  console.log('');
  console.log('⚠️ Avisos:');
  warnings.forEach((item) => console.log(`- ${item}`));
}

console.log('');
console.log('Pronto para subir.');

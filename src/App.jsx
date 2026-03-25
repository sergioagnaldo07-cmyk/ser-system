import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ═══════════════════════════════════════════════════════════════
// SISTEMA SER v3.0 — Calendário + Layout Centralizado
// BACKLOG: Integração WhatsApp (assistente envia mensagens)
// ═══════════════════════════════════════════════════════════════

const FRENTES = { taka: "Estúdio Taka", haldan: "Haldan", pessoal: "Pessoal" };
const FRENTE_COLORS = {
  taka:    { primary: "#DE5A4A", light: "#FFF3F1", medium: "#F07A6D", dark: "#8F2F24", accent: "#F8B6AE" },
  haldan:  { primary: "#1A9A78", light: "#EBFAF5", medium: "#2BB792", dark: "#0F5F4A", accent: "#9DE3CF" },
  pessoal: { primary: "#626BE8", light: "#F0F1FF", medium: "#8189FF", dark: "#3F46B4", accent: "#BDC1FF" },
};
const FC = (f) => FRENTE_COLORS[f]?.primary || "#888";
const FBG = (f) => FRENTE_COLORS[f]?.light || "#F1EFE8";
const FDK = (f) => FRENTE_COLORS[f]?.dark || "#555";
const FAC = (f) => FRENTE_COLORS[f]?.accent || "#ccc";

const UI = {
  ink: "#0E172A",
  inkSoft: "#334155",
  muted: "#6B7280",
  line: "#D8E2EE",
  lineSoft: "#E8EEF5",
  pageTop: "#EEF3FA",
  pageBottom: "#F7FAFE",
  surface: "#FFFFFF",
  surfaceSoft: "#F6F9FD",
  darkA: "#0C1A2F",
  darkB: "#162A4A",
  success: "#1A9A78",
  warning: "#D1841D",
  shadowLg: "0 18px 40px rgba(15, 23, 42, 0.12)",
  shadowMd: "0 10px 24px rgba(15, 23, 42, 0.10)",
  shadowSm: "0 4px 12px rgba(15, 23, 42, 0.08)",
};

const TASK_TYPES = ["Reunião","SEO","WordPress","Conteúdo","Follow-up","Proposta","Gestão equipe","Alimentação","Esporte","Casa","Outro"];
const TYPE_ICONS = { "Reunião":"📅","SEO":"🔍","WordPress":"🌐","Conteúdo":"✏️","Follow-up":"📩","Proposta":"📊","Gestão equipe":"👥","Alimentação":"🍳","Esporte":"💪","Casa":"🏠","Outro":"📌" };

const TIME_BLOCKS = [
  { id:"pessoal_am", label:"Pessoal", time:"6h–8h", frente:"pessoal" },
  { id:"taka", label:"Estúdio Taka", time:"8h–12h", frente:"taka" },
  { id:"admin", label:"Administrativo", time:"12h–13h", frente:null },
  { id:"haldan", label:"Haldan", time:"13h–18h", frente:"haldan" },
  { id:"pessoal_pm", label:"Pessoal", time:"18h–20h", frente:"pessoal" },
];

const DEFAULT_SOPS = {
  "Reunião":{ steps:[{text:"Revisar histórico do cliente",time:5},{text:"Preparar pauta da reunião",time:10},{text:"Executar reunião",time:30},{text:"Registrar próximos passos",time:5}], totalTime:50 },
  "SEO":{ steps:[{text:"Pesquisar palavras-chave e concorrentes",time:15},{text:"Definir estrutura H2/H3",time:10},{text:"Redigir conteúdo otimizado",time:25},{text:"Revisar e formatar",time:10}], totalTime:60 },
  "WordPress":{ steps:[{text:"Abrir painel e localizar página",time:3},{text:"Executar alteração",time:15},{text:"Revisar no preview",time:5},{text:"Publicar e validar ao vivo",time:2}], totalTime:25 },
  "Conteúdo":{ steps:[{text:"Revisar briefing e referências",time:10},{text:"Redigir copy/legenda",time:20},{text:"Criar prompt de imagem ou buscar visual",time:10},{text:"Revisar e agendar",time:5}], totalTime:45 },
  "Follow-up":{ steps:[{text:"Verificar último contato",time:3},{text:"Redigir mensagem",time:5},{text:"Enviar e registrar",time:2}], totalTime:10 },
  "Proposta":{ steps:[{text:"Levantar necessidades do cliente",time:15},{text:"Definir escopo e valores",time:20},{text:"Montar apresentação",time:30},{text:"Revisar e enviar",time:10}], totalTime:75 },
  "Gestão equipe":{ steps:[{text:"Revisar entregas pendentes",time:10},{text:"Alinhar prioridades com time",time:15},{text:"Delegar novas tarefas",time:10}], totalTime:35 },
  "Alimentação":{ steps:[{text:"Verificar cardápio da semana",time:3},{text:"Preparar ingredientes",time:15},{text:"Cozinhar",time:30},{text:"Armazenar marmitas",time:10}], totalTime:58 },
  "Esporte":{ steps:[{text:"Preparar roupa e equipamento",time:5},{text:"Aquecimento",time:5},{text:"Treino principal",time:40},{text:"Alongamento e banho",time:15}], totalTime:65 },
  "Casa":{ steps:[{text:"Identificar pendências domésticas",time:5},{text:"Executar tarefa prioritária",time:20},{text:"Organizar ambiente",time:10}], totalTime:35 },
  "Outro":{ steps:[{text:"Definir objetivo da tarefa",time:5},{text:"Executar",time:20},{text:"Registrar resultado",time:5}], totalTime:30 },
};

// ─── CSS ───
const STYLE_ID = "ser-animations";
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style"); s.id = STYLE_ID;
  s.textContent = `
    @keyframes ser-fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
    @keyframes ser-slideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
    @keyframes ser-scaleIn { from { opacity:0; transform:scale(0.92); } to { opacity:1; transform:scale(1); } }
    @keyframes ser-pulse { 0%,100% { opacity:1; } 50% { opacity:0.7; } }
    @keyframes ser-confetti { 0% { transform:translateY(0) rotate(0deg); opacity:1; } 100% { transform:translateY(-60px) rotate(360deg); opacity:0; } }
    .ser-fadeIn { animation: ser-fadeIn 0.2s ease-out both; }
    .ser-slideUp { animation: ser-slideUp 0.25s ease-out both; }
    .ser-scaleIn { animation: ser-scaleIn 0.2s ease-out both; }
    .ser-pulse { animation: ser-pulse 1.5s ease-in-out infinite; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body {
      font-family:'Sora','Manrope','Avenir Next','Segoe UI',sans-serif;
      background:linear-gradient(180deg, ${UI.pageTop} 0%, ${UI.pageBottom} 100%);
      color:${UI.ink};
      overflow-x:hidden;
      text-rendering:optimizeLegibility;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
    }
    input,textarea,select,button { font-family:inherit; }
    button { transition:transform 0.16s ease, box-shadow 0.2s ease, background-color 0.2s ease, border-color 0.2s ease; }
    @media (hover:hover) and (pointer:fine) {
      button:hover { transform:translateY(-1px); }
    }
    button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible {
      outline:2px solid #8EA7FF;
      outline-offset:2px;
    }
    ::-webkit-scrollbar { width:4px; }
    ::-webkit-scrollbar-thumb { background:#d3d1c7; border-radius:4px; }
  `;
  document.head.appendChild(s);
}

// ─── Sound Engine ───
const SoundEngine = {
  ctx:null, enabled:true, _init:false,
  init() { if(this._init) return; try { this.ctx=new(window.AudioContext||window.webkitAudioContext)(); this._init=true; } catch(e){ this.enabled=false; } },
  _osc(freq,type,dur,vol=0.15) {
    if(!this.enabled||!this.ctx) return;
    if(this.ctx.state==="suspended") this.ctx.resume();
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
    o.connect(g).connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime+dur);
  },
  play(t) {
    if(!this.enabled||!this.ctx) return;
    const s = {
      "click":()=>this._osc(600,"sine",0.05,0.06),
      "task-create":()=>{ this._osc(440,"sine",0.15,0.12); setTimeout(()=>this._osc(554,"sine",0.1,0.08),80); },
      "step-check":()=>this._osc(880,"sine",0.08,0.1),
      "task-complete":()=>{ this._osc(523,"sine",0.3,0.12); setTimeout(()=>this._osc(659,"sine",0.25,0.1),120); setTimeout(()=>this._osc(784,"sine",0.35,0.12),240); },
      "task-delete":()=>this._osc(300,"triangle",0.2,0.08),
      "pomodoro-start":()=>{ const o=this.ctx.createOscillator(),g=this.ctx.createGain(),ct=this.ctx.currentTime; o.type="sine"; o.frequency.setValueAtTime(300,ct); o.frequency.exponentialRampToValueAtTime(600,ct+0.3); g.gain.setValueAtTime(0.12,ct); g.gain.exponentialRampToValueAtTime(0.001,ct+0.35); o.connect(g).connect(this.ctx.destination); o.start(ct); o.stop(ct+0.35); },
      "pomodoro-pause":()=>{ const o=this.ctx.createOscillator(),g=this.ctx.createGain(),ct=this.ctx.currentTime; o.type="sine"; o.frequency.setValueAtTime(500,ct); o.frequency.exponentialRampToValueAtTime(300,ct+0.25); g.gain.setValueAtTime(0.1,ct); g.gain.exponentialRampToValueAtTime(0.001,ct+0.3); o.connect(g).connect(this.ctx.destination); o.start(ct); o.stop(ct+0.3); },
      "pomodoro-reset":()=>this._osc(400,"triangle",0.15,0.08),
      "pomodoro-end":()=>{ this._osc(523,"sine",0.4,0.15); setTimeout(()=>this._osc(659,"sine",0.35,0.12),150); setTimeout(()=>this._osc(784,"sine",0.5,0.15),300); },
      "pomodoro-break-end":()=>this._osc(440,"sine",0.3,0.1),
      "chat-send":()=>this._osc(500,"sine",0.08,0.08),
      "chat-receive":()=>{ this._osc(600,"sine",0.1,0.08); setTimeout(()=>this._osc(700,"sine",0.1,0.06),100); },
      "chat-tasks-found":()=>{ this._osc(523,"sine",0.15,0.1); setTimeout(()=>this._osc(659,"sine",0.15,0.08),100); setTimeout(()=>this._osc(784,"sine",0.2,0.1),200); },
      "note-save":()=>this._osc(660,"sine",0.12,0.08),
      "celebration":()=>{ [523,587,659,698,784].forEach((f,i)=>setTimeout(()=>this._osc(f,"sine",0.3,0.1),i*100)); },
    };
    if(s[t]) s[t]();
  },
};

// ─── Utils ───
function genId() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function toLocalISO(dateObj = new Date()) {
  const d = new Date(dateObj);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function today() { return toLocalISO(new Date()); }

function fmtDate(d) { return new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"2-digit"}); }
function fmtDateFull(d) { return new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"}); }
function fmtDateShort(d) { const dt=new Date(d+"T12:00:00"); return dt.getDate(); }
function fmtWeekday(d) { return new Date(d+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short"}).replace(".",""); }

function addDays(dateStr, n) {
  const d = new Date(dateStr+"T12:00:00");
  d.setDate(d.getDate()+n);
  return toLocalISO(d);
}

function getWeekDays(centerDate) {
  const d = new Date(centerDate+"T12:00:00");
  const dow = d.getDay(); // 0=Sun
  const mon = new Date(d); mon.setDate(d.getDate() - ((dow+6)%7));
  return Array.from({length:7},(_,i)=>{
    const dd = new Date(mon); dd.setDate(mon.getDate()+i);
    return toLocalISO(dd);
  });
}

function getGreeting() { const h=new Date().getHours(); return h<12?"Bom dia":h<18?"Boa tarde":"Boa noite"; }
function getCurrentBlock() {
  const h=new Date().getHours();
  if(h>=6&&h<8) return TIME_BLOCKS[0]; if(h>=8&&h<12) return TIME_BLOCKS[1];
  if(h>=12&&h<13) return TIME_BLOCKS[2]; if(h>=13&&h<18) return TIME_BLOCKS[3];
  if(h>=18&&h<20) return TIME_BLOCKS[4]; return null;
}

// ─── Date parsing from natural language ───
function parseDateFromText(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const normalized = lower
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const t = today();
  const now = new Date(t + "T12:00:00");
  const candidates = [];
  const DAYS = { domingo:0, segunda:1, terca:2, quarta:3, quinta:4, sexta:5, sabado:6 };

  const addCandidate = (date, index, kind) => {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (isNaN(new Date(date + "T12:00:00").getTime())) return;
    candidates.push({ date, index: Number(index) || 0, kind });
  };

  for (const m of normalized.matchAll(/\bdepois de amanha\b/g)) addCandidate(addDays(t, 2), m.index, "relative");
  for (const m of normalized.matchAll(/\bamanha\b/g)) addCandidate(addDays(t, 1), m.index, "relative");
  for (const m of normalized.matchAll(/\bhoje\b/g)) {
    const idx = Number(m.index || 0);
    const negWindow = normalized.slice(Math.max(0, idx - 26), idx + 5);
    if (/\bnao\b[^.]{0,24}\bhoje\b/.test(negWindow)) continue;
    addCandidate(t, idx, "today");
  }

  for (const m of normalized.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (m[3] && String(m[3]).length === 2) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) addCandidate(toLocalISO(d), m.index, "ddmm");
  }

  for (const m of normalized.matchAll(/\bdia\s+(\d{1,2})\b/g)) {
    const wantedDay = parseInt(m[1], 10);
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (wantedDay < now.getDate()) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(wantedDay).padStart(2, "0")}`;
    addCandidate(iso, m.index, "day_only");
  }

  const weekdayPatterns = [
    { regex: /\bdomingo\b/g, key: "domingo" },
    { regex: /\bsegunda(?:\s+feira)?\b/g, key: "segunda" },
    { regex: /\bterca(?:\s+feira)?\b/g, key: "terca" },
    { regex: /\bquarta(?:\s+feira)?\b/g, key: "quarta" },
    { regex: /\bquinta(?:\s+feira)?\b/g, key: "quinta" },
    { regex: /\bsexta(?:\s+feira)?\b/g, key: "sexta" },
    { regex: /\bsabado(?:\s+feira)?\b/g, key: "sabado" },
  ];

  const globalNextWeek = /\bsemana que vem\b|\bproxima semana\b/.test(normalized);
  for (const p of weekdayPatterns) {
    for (const m of normalized.matchAll(p.regex)) {
      const idx = Number(m.index || 0);
      const around = normalized.slice(Math.max(0, idx - 24), idx + 40);
      const localNextWeek = /\b(semana que vem|proxima semana|que vem)\b/.test(around) || globalNextWeek;
      const curr = now.getDay();
      const dow = DAYS[p.key];
      let diff = dow - curr;
      if (diff <= 0) diff += 7;
      if (localNextWeek) diff += 7;
      addCandidate(addDays(t, diff), idx, "weekday");
    }
  }

  const weekPhrase = normalized.match(/\bsemana que vem\b|\bproxima semana\b/);
  if (weekPhrase && !candidates.some(c => c.kind === "weekday")) {
    const mondayDelta = (8 - now.getDay()) % 7 || 7;
    addCandidate(addDays(t, mondayDelta), weekPhrase.index, "week_next");
  }

  if (candidates.length === 0) return t;

  const hasNonToday = candidates.some(c => c.date !== t);
  const scored = candidates.map(c => {
    const before = normalized.slice(Math.max(0, c.index - 20), c.index);
    const hasTargetPrep = /\b(para|pra|pro|na|no)\s*$/.test(before);
    let score = c.index;
    if (hasTargetPrep) score += 10000;
    if (hasNonToday && c.date === t) score -= 700;
    if (c.kind === "weekday") score += 150;
    if (c.kind === "ddmm" || c.kind === "day_only") score += 100;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].date || t;
}

function getDateLabel(dateStr) {
  const t = today();
  if(dateStr === t) return "hoje";
  if(dateStr === addDays(t,1)) return "amanhã";
  if(dateStr === addDays(t,-1)) return "ontem";
  return fmtDate(dateStr);
}

// ─── Storage ───
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/+$/,"");
const API_ADMIN_TOKEN = String(import.meta.env.VITE_SER_ADMIN_TOKEN || "").trim();
const apiUrl = (path="") => API_BASE_URL ? `${API_BASE_URL}${path}` : path;
const apiFetch = (path, options={}) => {
  const method = String(options.method || "GET").toUpperCase();
  const finalHeaders = {
    ...(options.headers || {}),
  };
  if (API_ADMIN_TOKEN) {
    finalHeaders["x-ser-admin-token"] = API_ADMIN_TOKEN;
  }
  const finalOptions = {
    ...options,
    headers: finalHeaders,
  };
  if (method === "GET" && finalOptions.cache === undefined) {
    finalOptions.cache = "no-store";
  }
  return fetch(apiUrl(path), {
    ...finalOptions,
  });
};

async function extractApiError(response) {
  if (!response) return "Erro de conexão.";
  const fallback = `Erro ${response.status}`;
  try {
    const data = await response.json();
    if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
    return fallback;
  } catch {
    return fallback;
  }
}

const STORAGE_KEY = "ser_system_data";
const STREAK_KEY = "ser_streak";
const ONBOARDING_KEY = "ser_onboarding_done";

function loadData() { try { const r=localStorage.getItem(STORAGE_KEY); if(r) return JSON.parse(r); } catch(e){} return {tasks:[],sops:DEFAULT_SOPS,history:[],notes:[]}; }
function saveData(d) { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(d)); } catch(e){} }
function updateStreak() {
  let s; try { s=JSON.parse(localStorage.getItem(STREAK_KEY)); } catch(e){} if(!s) s={count:0,lastDate:null};
  const t=today(); if(s.lastDate===t) return s;
  const y=addDays(t,-1);
  const ns={count:s.lastDate===y?s.count+1:1, lastDate:t};
  try{localStorage.setItem(STREAK_KEY,JSON.stringify(ns));}catch(e){} return ns;
}

function sortTasksList(tasks = []) {
  return [...tasks].sort((a, b) => {
    if ((a.date || "") !== (b.date || "")) return (a.date || "").localeCompare(b.date || "");
    const ta = a.startTime || "99:99";
    const tb = b.startTime || "99:99";
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.title || "").localeCompare(String(b.title || ""), "pt-BR");
  });
}

function normalizeTaskShape(task, sops = DEFAULT_SOPS) {
  if (!task || typeof task !== "object") return null;
  const safeType = TASK_TYPES.includes(task.type) ? task.type : "Outro";
  const safeFrente = FRENTES[task.frente] ? task.frente : "pessoal";
  const fallbackSteps = (sops[safeType]?.steps || sops["Outro"]?.steps || []).map(s => ({ ...s, done: false }));
  const steps = Array.isArray(task.steps)
    ? task.steps
      .map(step => ({
        text: String(step?.text || "").trim(),
        time: Number.isFinite(Number(step?.time)) ? Number(step.time) : 0,
        done: Boolean(step?.done),
      }))
      .filter(step => step.text)
    : fallbackSteps;
  const estimatedFromSteps = steps.reduce((sum, step) => sum + (step.time || 0), 0);
  const estimatedRaw = Number(task.estimatedTime);
  const estimatedTime = Number.isFinite(estimatedRaw) && estimatedRaw > 0 ? estimatedRaw : (estimatedFromSteps || 30);

  return {
    ...task,
    id: task.id || genId(),
    title: String(task.title || "Nova tarefa").trim(),
    detail: task.detail ? String(task.detail) : null,
    frente: safeFrente,
    type: safeType,
    date: typeof task.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.date) ? task.date : today(),
    startTime: typeof task.startTime === "string" && /^\d{2}:\d{2}$/.test(task.startTime) ? task.startTime : null,
    followUpDaily: Boolean(task.followUpDaily),
    followUpTime: typeof task.followUpTime === "string" && /^\d{2}:\d{2}$/.test(task.followUpTime) ? task.followUpTime : null,
    followUpClient: task.followUpClient ? String(task.followUpClient) : null,
    followUpSubject: task.followUpSubject ? String(task.followUpSubject) : null,
    steps,
    estimatedTime,
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || task.createdAt || new Date().toISOString(),
    completedAt: task.completedAt || null,
  };
}

function serializeTasksForSync(tasks = []) {
  const sorted = sortTasksList(tasks).map(task => ({
    id: task.id,
    title: task.title,
    detail: task.detail || null,
    frente: task.frente,
    type: task.type,
    date: task.date,
    startTime: task.startTime || null,
    followUpDaily: Boolean(task.followUpDaily),
    followUpTime: task.followUpTime || null,
    followUpClient: task.followUpClient || null,
    followUpSubject: task.followUpSubject || null,
    estimatedTime: task.estimatedTime || 0,
    completedAt: task.completedAt || null,
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
    steps: (task.steps || []).map(step => ({
      text: step.text,
      time: step.time || 0,
      done: Boolean(step.done),
    })),
  }));
  return JSON.stringify(sorted);
}

function splitTasksByCompletion(tasks = [], sops = DEFAULT_SOPS) {
  const normalized = (tasks || []).map(task => normalizeTaskShape(task, sops)).filter(Boolean);
  const active = normalized.filter(task => !task.completedAt);
  const completed = normalized.filter(task => task.completedAt);
  return { active, completed };
}

function sortHistoryList(tasks = []) {
  return [...tasks].sort((a, b) => {
    const ta = new Date(a.completedAt || a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.completedAt || b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
}

// ─── Hooks ───
function usePomodoro() {
  const[sec,setSec]=useState(25*60); const[run,setRun]=useState(false);
  const[mode,setMode]=useState("work"); const[cyc,setCyc]=useState(0); const ref=useRef(null);
  useEffect(()=>{ if(run&&sec>0){ref.current=setInterval(()=>setSec(s=>s-1),1000);}else{clearInterval(ref.current);} return()=>clearInterval(ref.current); },[run,sec]);
  useEffect(()=>{ if(sec===0&&run){ setRun(false); if(mode==="work"){setCyc(c=>c+1);SoundEngine.play("pomodoro-end");setMode("break");setSec(5*60);} else{SoundEngine.play("pomodoro-break-end");setMode("work");setSec(25*60);}} },[sec,run,mode]);
  const toggle=()=>{SoundEngine.play(run?"pomodoro-pause":"pomodoro-start");setRun(r=>!r);};
  const reset=()=>{SoundEngine.play("pomodoro-reset");setRun(false);setSec(mode==="work"?25*60:5*60);};
  const display=`${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
  const total=mode==="work"?25*60:5*60;
  return {display,running:run,mode,toggle,reset,seconds:sec,progress:1-sec/total,cycles:cyc};
}

// ═══════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════
const W = ({children,style,...p}) => <div style={{maxWidth:600,margin:"0 auto",width:"100%",...style}} {...p}>{children}</div>;

function FrentePill({frente,small}) {
  if(!frente||!FRENTES[frente]) return null;
  return <span style={{display:"inline-block",padding:small?"2px 8px":"4px 12px",borderRadius:20,fontSize:small?10:11,fontWeight:600,background:FBG(frente),color:FC(frente)}}>{FRENTES[frente]}</span>;
}
function TypePill({type}) { return <span style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 8px",borderRadius:20,fontSize:10,fontWeight:500,background:"#F1EFE8",color:"#5F5E5A"}}>{TYPE_ICONS[type]||"📌"} {type}</span>; }

function Toast({message,onUndo,onClose}) {
  useEffect(()=>{const t=setTimeout(onClose,4000);return()=>clearTimeout(t);},[onClose]);
  return <div className="ser-slideUp" style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:"rgba(12,26,47,0.92)",backdropFilter:"blur(8px)",color:"#fff",padding:"12px 20px",borderRadius:14,fontSize:13,fontWeight:500,display:"flex",alignItems:"center",gap:12,boxShadow:UI.shadowLg,border:"1px solid rgba(255,255,255,0.16)",zIndex:200}}>
    {message}{onUndo&&<button onClick={onUndo} style={{background:"rgba(255,255,255,0.18)",border:"1px solid rgba(255,255,255,0.24)",color:"#fff",padding:"5px 12px",borderRadius:8,fontSize:12,cursor:"pointer",fontWeight:600}}>Desfazer</button>}
  </div>;
}

function Confetti({active}) {
  if(!active) return null;
  const c=["#B5302F","#0F6E56","#534AB7","#BA7517","#E24B4A"];
  return <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:300}}>{Array.from({length:20}).map((_,i)=><div key={i} style={{position:"absolute",left:`${10+Math.random()*80}%`,top:`${30+Math.random()*40}%`,width:8,height:8,borderRadius:Math.random()>0.5?"50%":2,background:c[i%5],animation:`ser-confetti ${0.6+Math.random()*0.6}s ease-out ${i*0.03}s both`}}/>)}</div>;
}

function CircularProgress({progress,size=160,stroke=5,color}) {
  const r=(size-stroke)/2, circ=2*Math.PI*r;
  return <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}><circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={stroke}/><circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circ} strokeDashoffset={circ*(1-progress)} strokeLinecap="round" style={{transition:"stroke-dashoffset 0.5s ease"}}/></svg>;
}

function DailyProgressRing({done,total}) {
  const pct=total>0?done/total:0; const r=16,circ=2*Math.PI*r;
  return <div style={{position:"relative",width:40,height:40,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <svg width={40} height={40} style={{position:"absolute",transform:"rotate(-90deg)"}}><circle cx={20} cy={20} r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={3}/><circle cx={20} cy={20} r={r} fill="none" stroke={pct>=1?"#5DCAA5":"#fff"} strokeWidth={3} strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round" style={{transition:"stroke-dashoffset 0.5s"}}/></svg>
    <span style={{fontSize:10,fontWeight:600,color:"#fff",zIndex:1}}>{Math.round(pct*100)}%</span>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// COMPACT POMODORO (side by side with stats)
// ═══════════════════════════════════════════════════════════════
function PomodoroCompact({pom,totalEstimate}) {
  const target=Math.max(1,Math.ceil((totalEstimate||50)/25));
  const col=pom.mode==="work"?"#5DCAA5":"#AFA9EC";
  return <div style={{background:`linear-gradient(165deg, ${UI.darkA} 0%, ${UI.darkB} 100%)`,borderRadius:18,padding:"16px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flex:1,minHeight:140,border:"1px solid rgba(255,255,255,0.08)",boxShadow:UI.shadowLg}}>
    <div style={{fontSize:9,fontWeight:600,color:"rgba(255,255,255,0.35)",textTransform:"uppercase",letterSpacing:"0.12em",marginBottom:8}}>{pom.mode==="work"?"Foco":"Pausa"}</div>
    <div style={{position:"relative",display:"inline-block"}}>
      <CircularProgress progress={pom.progress} size={100} stroke={4} color={col}/>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontFamily:"'SF Mono','Fira Code',monospace",fontSize:22,fontWeight:300,color:"#fff"}} className={pom.running?"ser-pulse":""}>{pom.display}</div>
      </div>
    </div>
    <div style={{display:"flex",gap:4,margin:"8px 0 4px"}}>{Array.from({length:Math.min(target,8)}).map((_,i)=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:i<pom.cycles?"#5DCAA5":"rgba(255,255,255,0.15)"}}/>)}</div>
    <div style={{fontSize:10,color:"rgba(255,255,255,0.3)",marginBottom:10}}>Ciclo {pom.cycles} de {target}</div>
    <div style={{display:"flex",gap:6}}>
      <button onClick={pom.toggle} style={{background:pom.running?"rgba(255,255,255,0.12)":"#fff",color:pom.running?"#fff":"#1A1A18",border:"none",borderRadius:10,padding:"7px 16px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{pom.running?"⏸":"▶"}</button>
      <button onClick={pom.reset} style={{background:"rgba(255,255,255,0.08)",color:"rgba(255,255,255,0.5)",border:"none",borderRadius:10,padding:"7px 12px",fontSize:12,cursor:"pointer"}}>↻</button>
    </div>
  </div>;
}

// ─── Stats Compact ───
function StatsCompact({tasks,dateStr}) {
  const dt=tasks.filter(t=>t.date===dateStr);
  const done=dt.filter(t=>t.completedAt).length;
  const pending=dt.filter(t=>!t.completedAt).length;
  const est=dt.filter(t=>!t.completedAt).reduce((s,t)=>s+(t.estimatedTime||0),0);
  return <div style={{display:"flex",flexDirection:"column",gap:6,flex:1}}>
    {[{l:"Pendentes",v:pending,c:"#BA7517"},{l:"Concluídas",v:done,c:"#0F6E56"},{l:"Estimado",v:`${est}m`,c:"#534AB7"}].map(s=>
      <div key={s.l} style={{background:`linear-gradient(180deg, ${UI.surface} 0%, ${UI.surfaceSoft} 100%)`,borderRadius:14,padding:"10px 14px",border:`1px solid ${UI.lineSoft}`,display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:UI.shadowSm}}>
        <span style={{fontSize:12,color:UI.muted,fontWeight:500}}>{s.l}</span>
        <span style={{fontSize:18,fontWeight:600,color:s.c}}>{s.v}</span>
      </div>
    )}
  </div>;
}

// ─── Active Block ───
function ActiveBlockIndicator() {
  const b=getCurrentBlock(); if(!b) return null; const f=b.frente;
  return <div style={{background:f?FBG(f):UI.surfaceSoft,borderRadius:14,padding:"10px 14px",display:"flex",alignItems:"center",gap:8,border:`1px solid ${f?FAC(f):UI.line}`,boxShadow:UI.shadowSm}}>
    <div style={{width:8,height:8,borderRadius:"50%",background:f?FC(f):"#5F5E5A",boxShadow:`0 0 6px ${f?FC(f)+"50":"transparent"}`}}/>
    <div><div style={{fontSize:12,fontWeight:600,color:f?FDK(f):UI.ink}}>{b.label}</div><div style={{fontSize:10,color:f?FC(f):UI.muted}}>{b.time}</div></div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// TASK CARD
// ═══════════════════════════════════════════════════════════════
function TaskCard({task,expanded,onToggleExpand,onToggleStep,onComplete,onDelete,onReschedule,onEdit,sops,index,postIt=false}) {
  const pct=task.steps?Math.round(task.steps.filter(s=>s.done).length/task.steps.length*100):0;
  const dateLabel = task.date !== today() ? getDateLabel(task.date) : null;
  return <div className="ser-slideUp" style={{
    background:postIt?`linear-gradient(180deg, ${FBG(task.frente)} 0%, ${UI.surface} 88%)`:UI.surface,
    border:postIt?`1px solid ${FAC(task.frente)}`:`1px solid ${UI.lineSoft}`,
    borderRadius:14,
    borderLeft:`4px solid ${FC(task.frente)}`,
    overflow:"hidden",
    boxShadow:postIt?UI.shadowMd:UI.shadowSm,
    animationDelay:`${(index||0)*0.05}s`
  }}>
    {postIt&&<div style={{height:6,background:`linear-gradient(90deg, ${FAC(task.frente)} 0%, ${FC(task.frente)} 100%)`,opacity:0.75}}/>}
    <div onClick={()=>{SoundEngine.play("click");onToggleExpand(task.id);}} style={{padding:"12px 14px",cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <span style={{fontSize:18,lineHeight:1,flexShrink:0,marginTop:1}}>{TYPE_ICONS[task.type]||"📌"}</span>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
            <span style={{fontSize:13,fontWeight:500,color:UI.ink,lineHeight:1.3}}>{task.startTime&&<span style={{fontSize:10,color:FDK(task.frente),fontWeight:700,marginRight:4}}>{task.startTime}</span>}{task.title}</span>
            {task.estimatedTime&&<span style={{fontSize:10,color:UI.muted,whiteSpace:"nowrap",flexShrink:0}}>{task.estimatedTime}m</span>}
          </div>
          <div style={{display:"flex",gap:4,alignItems:"center",marginTop:5,flexWrap:"wrap"}}>
            <FrentePill frente={task.frente} small/>
            {dateLabel && <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:"#FFF8E7",color:UI.warning,fontWeight:700}}>{dateLabel}</span>}
            {task.steps&&task.steps.length>0&&<div style={{display:"flex",alignItems:"center",gap:3,marginLeft:"auto"}}>
              <div style={{width:40,height:4,background:UI.lineSoft,borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:FAC(task.frente),borderRadius:3,transition:"width 0.3s"}}/></div>
              <span style={{fontSize:9,color:UI.muted,fontWeight:700}}>{pct}%</span>
            </div>}
          </div>
        </div>
      </div>
    </div>
    {expanded&&<div className="ser-fadeIn" style={{padding:"0 14px 12px",borderTop:postIt?`1px dashed ${FAC(task.frente)}`:`1px solid ${UI.lineSoft}`}}>
      {task.detail&&<p style={{fontSize:11,color:UI.inkSoft,lineHeight:1.5,margin:"8px 0",padding:"6px 8px",background:postIt?"rgba(255,255,255,0.65)":UI.surfaceSoft,borderRadius:8}}>{task.detail}</p>}
      <div style={{fontSize:9,fontWeight:700,color:UI.muted,textTransform:"uppercase",letterSpacing:"0.08em",margin:"8px 0 4px"}}>Modo de execução</div>
      {task.steps&&task.steps.map((step,i)=>
        <div key={i} onClick={e=>{e.stopPropagation();SoundEngine.play("step-check");onToggleStep(task.id,i);}} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:8,cursor:"pointer",marginBottom:2,background:step.done?FBG(task.frente):"transparent"}}>
          <div style={{width:18,height:18,borderRadius:18,flexShrink:0,border:step.done?"none":"2px solid #D3D1C7",background:step.done?FC(task.frente):"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
            {step.done&&<span className="ser-scaleIn" style={{color:"#fff",fontSize:10}}>✓</span>}
          </div>
          <span style={{fontSize:12,color:step.done?UI.muted:UI.ink,flex:1,textDecoration:step.done?"line-through":"none"}}>{step.text}</span>
          {step.time&&<span style={{fontSize:10,color:UI.muted}}>{step.time}m</span>}
        </div>
      )}
      <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
        <button onClick={e=>{e.stopPropagation();onComplete(task.id);}} style={{flex:1,padding:"9px 14px",borderRadius:10,border:"none",background:UI.darkA,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",boxShadow:UI.shadowSm}}>✓ Concluir</button>
        <button onClick={e=>{e.stopPropagation();onEdit&&onEdit(task);}} style={{padding:"9px 14px",borderRadius:10,border:`1px solid ${UI.line}`,background:"#fff",color:FRENTE_COLORS.pessoal.dark,fontSize:12,fontWeight:700,cursor:"pointer"}}>✎ Editar</button>
        <button onClick={e=>{e.stopPropagation();onReschedule&&onReschedule(task.id,addDays(task.date,1));}} style={{padding:"9px 14px",borderRadius:10,border:`1px solid ${UI.line}`,background:"#fff",color:UI.warning,fontSize:12,cursor:"pointer"}}>Amanhã →</button>
        <button onClick={e=>{e.stopPropagation();onDelete(task.id);}} style={{padding:"9px 12px",borderRadius:10,border:`1px solid ${UI.line}`,background:"#fff",color:"#B84A3D",fontSize:12,cursor:"pointer"}}>✕</button>
      </div>
    </div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// NEW TASK MODAL (with date picker)
// ═══════════════════════════════════════════════════════════════
function NewTaskModal({onClose,onAdd,sops,defaultDate}) {
  const[title,setTitle]=useState(""); const[detail,setDetail]=useState(""); const[frente,setFrente]=useState("taka");
  const[type,setType]=useState("Outro"); const[taskDate,setTaskDate]=useState(defaultDate||today());
  const[startTime,setStartTime]=useState("");
  const[steps,setSteps]=useState(()=>(sops["Outro"]?.steps||[]).map(s=>({...s})));
  const loadSOP=(t)=>{setType(t);setSteps((sops[t]?.steps||[]).map(s=>({...s})));};
  const totalTime=steps.reduce((s,st)=>s+(st.time||0),0);
  const handleAdd=()=>{if(!title.trim())return;const nowIso=new Date().toISOString();SoundEngine.play("task-create");onAdd({id:genId(),title:title.trim(),detail:detail.trim()||null,frente,type,steps:steps.filter(s=>s.text.trim()).map(s=>({...s,done:false})),estimatedTime:totalTime,createdAt:nowIso,updatedAt:nowIso,completedAt:null,date:taskDate,startTime:startTime||null});onClose();};
  const inp={padding:"10px 12px",borderRadius:10,border:"1px solid #E8E6DF",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:150}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} className="ser-slideUp" style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflow:"auto",padding:"20px 20px 28px"}}>
      <div style={{width:40,height:4,background:"#D3D1C7",borderRadius:2,margin:"0 auto 14px"}}/>
      <h2 style={{margin:"0 0 16px",fontSize:17,fontWeight:600}}>Nova tarefa</h2>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>TÍTULO</label>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex: Reunião dominical Haldan" style={inp} autoFocus/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>DETALHAMENTO (opcional)</label>
        <textarea value={detail} onChange={e=>setDetail(e.target.value)} rows={2} placeholder="Contexto extra..." style={{...inp,resize:"vertical"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>FRENTE</label><select value={frente} onChange={e=>setFrente(e.target.value)} style={{...inp,cursor:"pointer"}}>{Object.entries(FRENTES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>TIPO</label><select value={type} onChange={e=>loadSOP(e.target.value)} style={{...inp,cursor:"pointer"}}>{TASK_TYPES.map(t=><option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}</select></div>
      </div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>DATA</label>
        <div style={{display:"flex",gap:6}}>
          {[{l:"Hoje",d:today()},{l:"Amanhã",d:addDays(today(),1)},{l:fmtWeekday(addDays(today(),2)),d:addDays(today(),2)},{l:fmtWeekday(addDays(today(),3)),d:addDays(today(),3)}].map(o=>
            <button key={o.d} onClick={()=>setTaskDate(o.d)} style={{flex:1,padding:"8px 4px",borderRadius:8,border:taskDate===o.d?"2px solid #1A1A18":"1px solid #E8E6DF",background:taskDate===o.d?"#1A1A18":"#fff",color:taskDate===o.d?"#fff":"#555",fontSize:11,fontWeight:600,cursor:"pointer"}}>{o.l}</button>
          )}
        </div>
        <input type="date" value={taskDate} onChange={e=>setTaskDate(e.target.value)} style={{...inp,marginTop:6,fontSize:12}}/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>HORÁRIO (opcional)</label>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} style={{...inp,flex:1,fontSize:12}}/>
          {startTime&&<button onClick={()=>setStartTime("")} style={{padding:"8px 12px",borderRadius:10,border:"1px solid #E8E6DF",background:"#fff",fontSize:11,color:"#888",cursor:"pointer"}}>Limpar</button>}
        </div>
      </div>
      <div style={{background:"#FAFAF8",borderRadius:12,padding:"12px 14px",marginBottom:14}}>
        <div style={{fontSize:10,fontWeight:600,color:"#888",marginBottom:6}}>EXECUÇÃO — {totalTime} min</div>
        {steps.map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,marginBottom:3,padding:"5px 6px",background:"#fff",borderRadius:8,border:"1px solid #F0EEE8"}}>
          <span style={{color:"#aaa",fontSize:9,width:14,textAlign:"right"}}>{i+1}.</span>
          <input value={s.text} onChange={e=>{const ns=[...steps];ns[i]={...ns[i],text:e.target.value};setSteps(ns);}} style={{flex:1,border:"none",outline:"none",fontSize:12,background:"transparent",padding:"3px 0"}} placeholder="Etapa..."/>
          <input type="number" value={s.time} onChange={e=>{const ns=[...steps];ns[i]={...ns[i],time:parseInt(e.target.value)||0};setSteps(ns);}} style={{width:40,textAlign:"center",border:"1px solid #E8E6DF",borderRadius:6,fontSize:11,padding:"3px",outline:"none"}}/>
          <span style={{fontSize:9,color:"#aaa"}}>m</span>
          <button onClick={()=>setSteps(steps.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#ccc",fontSize:14,cursor:"pointer",padding:"0 2px"}}>×</button>
        </div>)}
        <button onClick={()=>setSteps([...steps,{text:"",time:10}])} style={{width:"100%",padding:"6px",borderRadius:8,border:"1px dashed #D3D1C7",background:"transparent",fontSize:11,color:"#888",cursor:"pointer",marginTop:3}}>+ Etapa</button>
      </div>
      <button onClick={handleAdd} disabled={!title.trim()} style={{width:"100%",padding:"13px",borderRadius:12,border:"none",background:title.trim()?"#1A1A18":"#D3D1C7",color:"#fff",fontSize:13,fontWeight:600,cursor:title.trim()?"pointer":"default"}}>Adicionar tarefa</button>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// EDIT TASK MODAL
// ═══════════════════════════════════════════════════════════════
function EditTaskModal({task,onClose,onSave,sops}) {
  const[title,setTitle]=useState(task.title);
  const[detail,setDetail]=useState(task.detail||"");
  const[frente,setFrente]=useState(task.frente);
  const[type,setType]=useState(task.type);
  const[taskDate,setTaskDate]=useState(task.date);
  const[startTime,setStartTime]=useState(task.startTime||"");
  const[steps,setSteps]=useState(()=>(task.steps||[]).map(s=>({...s})));
  const totalTime=steps.reduce((s,st)=>s+(st.time||0),0);
  const handleSave=()=>{if(!title.trim())return;SoundEngine.play("click");onSave({...task,title:title.trim(),detail:detail.trim()||null,frente,type,steps,estimatedTime:totalTime,date:taskDate,startTime:startTime||null,updatedAt:new Date().toISOString()});onClose();};
  const inp={padding:"10px 12px",borderRadius:10,border:"1px solid #E8E6DF",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:150}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} className="ser-slideUp" style={{background:"#fff",borderRadius:"20px 20px 0 0",width:"100%",maxWidth:600,maxHeight:"90vh",overflow:"auto",padding:"20px 20px 28px"}}>
      <div style={{width:40,height:4,background:"#D3D1C7",borderRadius:2,margin:"0 auto 14px"}}/>
      <h2 style={{margin:"0 0 16px",fontSize:17,fontWeight:600}}>Editar tarefa</h2>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>TÍTULO</label>
        <input value={title} onChange={e=>setTitle(e.target.value)} style={inp} autoFocus/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>DETALHAMENTO</label>
        <textarea value={detail} onChange={e=>setDetail(e.target.value)} rows={2} style={{...inp,resize:"vertical"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>FRENTE</label><select value={frente} onChange={e=>setFrente(e.target.value)} style={{...inp,cursor:"pointer"}}>{Object.entries(FRENTES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
        <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>TIPO</label><select value={type} onChange={e=>setType(e.target.value)} style={{...inp,cursor:"pointer"}}>{TASK_TYPES.map(t=><option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}</select></div>
      </div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>DATA</label>
        <div style={{display:"flex",gap:6}}>
          {[{l:"Hoje",d:today()},{l:"Amanhã",d:addDays(today(),1)},{l:fmtWeekday(addDays(today(),2)),d:addDays(today(),2)},{l:fmtWeekday(addDays(today(),3)),d:addDays(today(),3)},{l:fmtWeekday(addDays(today(),4)),d:addDays(today(),4)}].map(o=>
            <button key={o.d} onClick={()=>setTaskDate(o.d)} style={{flex:1,padding:"8px 2px",borderRadius:8,border:taskDate===o.d?"2px solid #1A1A18":"1px solid #E8E6DF",background:taskDate===o.d?"#1A1A18":"#fff",color:taskDate===o.d?"#fff":"#555",fontSize:10,fontWeight:600,cursor:"pointer"}}>{o.l}</button>
          )}
        </div>
        <input type="date" value={taskDate} onChange={e=>setTaskDate(e.target.value)} style={{...inp,marginTop:6,fontSize:12}}/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={{fontSize:10,fontWeight:600,color:"#888",display:"block",marginBottom:3}}>HORÁRIO (opcional)</label>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} style={{...inp,flex:1,fontSize:12}}/>
          {startTime&&<button onClick={()=>setStartTime("")} style={{padding:"8px 12px",borderRadius:10,border:"1px solid #E8E6DF",background:"#fff",fontSize:11,color:"#888",cursor:"pointer"}}>Limpar</button>}
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,padding:"13px",borderRadius:12,border:"1px solid #E8E6DF",background:"#fff",color:"#555",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
        <button onClick={handleSave} disabled={!title.trim()} style={{flex:2,padding:"13px",borderRadius:12,border:"none",background:title.trim()?"#1A1A18":"#D3D1C7",color:"#fff",fontSize:13,fontWeight:600,cursor:title.trim()?"pointer":"default"}}>Salvar</button>
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD CHAT (date-aware)
// ═══════════════════════════════════════════════════════════════
function DashboardChat({onAddTasks,sops}) {
  const[input,setInput]=useState(""); const[loading,setLoading]=useState(false);
  const[pending,setPending]=useState(null); const[messages,setMessages]=useState([]);
  const[useAI,setUseAI]=useState(true); const ref=useRef(null);
  useEffect(()=>{ref.current?.scrollIntoView({behavior:"smooth"});},[messages,pending]);
  const sopKeys=Object.keys(sops).join(", ");

  const sendMessage=async()=>{
    if(!input.trim()||loading) return; SoundEngine.play("chat-send");
    const txt=input.trim(); setMessages(p=>[...p,{role:"user",content:txt}]); setInput(""); setLoading(true); setPending(null);
    let parsed=null;
    if(useAI){ try{ const r=await apiFetch("/api/parse-tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:txt,sopKeys})}); if(r.ok) parsed=await r.json(); }catch{} }

    if(parsed&&parsed.tasks&&parsed.tasks.length>0){
      SoundEngine.play("chat-tasks-found");
      const enriched=parsed.tasks.map(t=>{
        const sop=sops[t.type]||sops["Outro"];
        const taskDate = t.date || parseDateFromText(txt);
        const nowIso = new Date().toISOString();
        return {id:genId(),title:t.title,detail:t.detail||null,frente:t.frente,type:t.type,steps:(sop?.steps||[]).map(s=>({...s,done:false})),estimatedTime:t.estimatedTime||sop?.totalTime||30,createdAt:nowIso,updatedAt:nowIso,completedAt:null,date:taskDate,startTime:t.startTime||null};
      });
      setPending(enriched);
      setMessages(p=>[...p,{role:"assistant",content:parsed.message||`Encontrei ${enriched.length} tarefa(s).`}]);
    } else if(parsed&&parsed.message) {
      SoundEngine.play("chat-receive");
      setMessages(p=>[...p,{role:"assistant",content:parsed.message}]);
    } else {
      const local=localParse(txt,sops);
      if(local.length>0){ SoundEngine.play("chat-tasks-found"); setPending(local); setMessages(p=>[...p,{role:"assistant",content:`${local.length} tarefa(s) identificada(s).`}]); }
      else { SoundEngine.play("chat-receive"); setMessages(p=>[...p,{role:"assistant",content:"Não identifiquei tarefas. Ex: 'reunião Dr. Ademar amanhã, treino sexta'"}]); }
    }
    setLoading(false);
  };

  const confirm=()=>{if(!pending)return;SoundEngine.play("task-create");onAddTasks(pending);setMessages(p=>[...p,{role:"system",content:`${pending.length} tarefa(s) adicionada(s)!`}]);setPending(null);};

  return <div style={{background:`linear-gradient(180deg, ${UI.surface} 0%, ${UI.surfaceSoft} 100%)`,borderRadius:18,border:`1px solid ${UI.lineSoft}`,overflow:"hidden",boxShadow:UI.shadowSm}}>
    <div style={{padding:"12px 16px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${UI.lineSoft}`}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:UI.success,boxShadow:"0 0 8px #1A9A7855"}}/>
        <span style={{fontSize:13,fontWeight:600,color:UI.ink}}>{getGreeting()}, Sergio</span>
      </div>
      <button onClick={()=>setUseAI(v=>!v)} style={{padding:"4px 10px",borderRadius:20,border:`1px solid ${useAI?FAC("haldan"):UI.line}`,background:useAI?FBG("haldan"):UI.surfaceSoft,color:useAI?FDK("haldan"):UI.muted,fontSize:9,fontWeight:700,cursor:"pointer"}}>{useAI?"IA":"Local"}</button>
    </div>
    <div style={{maxHeight:200,overflowY:"auto",padding:"10px 16px"}}>
      {messages.length===0&&!pending&&<div style={{display:"flex",flexWrap:"wrap",gap:4,padding:"4px 0"}}>
        {["O que tem pra hoje?","Tarefas de amanhã","Revisar semana"].map(q=><button key={q} onClick={()=>setInput(q)} style={{padding:"6px 12px",borderRadius:20,border:`1px solid ${UI.line}`,background:UI.surface,fontSize:11,color:UI.inkSoft,cursor:"pointer"}}>{q}</button>)}
      </div>}
      {messages.map((m,i)=><div key={i} className="ser-fadeIn" style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",marginBottom:4}}>
        <div style={{maxWidth:"85%",padding:"8px 12px",borderRadius:m.role==="user"?"12px 12px 3px 12px":"12px 12px 12px 3px",background:m.role==="user"?UI.darkA:m.role==="system"?FBG("haldan"):UI.surface,color:m.role==="user"?"#fff":m.role==="system"?FDK("haldan"):UI.inkSoft,fontSize:12,lineHeight:1.5,whiteSpace:"pre-wrap",border:m.role==="user"?"none":`1px solid ${UI.lineSoft}`}}>{m.content}</div>
      </div>)}
      {loading&&<div className="ser-pulse" style={{padding:"8px 12px",borderRadius:"12px 12px 12px 3px",background:UI.surface,color:UI.muted,fontSize:12,display:"inline-block",border:`1px solid ${UI.lineSoft}`}}>{useAI?"IA interpretando...":"Processando..."}</div>}
      <div ref={ref}/>
    </div>
    {pending&&<div style={{padding:"0 16px 10px"}}>
      <div style={{fontSize:10,fontWeight:600,color:"#888",marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>Tarefas identificadas</div>
      {pending.map((t,i)=><div key={t.id} className="ser-slideUp" style={{display:"flex",alignItems:"center",gap:6,padding:"8px 10px",background:UI.surface,borderRadius:10,marginBottom:3,borderLeft:`3px solid ${FC(t.frente)}`,border:`1px solid ${UI.lineSoft}`,animationDelay:`${i*0.05}s`}}>
        <span style={{fontSize:14}}>{TYPE_ICONS[t.type]||"📌"}</span>
        <div style={{flex:1}}><span style={{fontSize:12,fontWeight:500,color:UI.ink}}>{t.title}</span><div style={{display:"flex",gap:3,marginTop:2}}><FrentePill frente={t.frente} small/><span style={{fontSize:9,color:UI.muted}}>~{t.estimatedTime}m</span>{t.date!==today()&&<span style={{fontSize:9,padding:"1px 6px",borderRadius:20,background:"#FFF8E7",color:UI.warning,fontWeight:600}}>{getDateLabel(t.date)}</span>}</div></div>
        <button onClick={()=>setPending(p=>{const f=p.filter(x=>x.id!==t.id);return f.length?f:null;})} style={{background:"none",border:"none",color:"#B8C0CC",fontSize:16,cursor:"pointer"}}>×</button>
      </div>)}
      <button onClick={confirm} style={{width:"100%",padding:"10px",borderRadius:10,border:"none",background:UI.success,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4,boxShadow:UI.shadowSm}}>✓ Confirmar {pending.length} tarefa(s)</button>
    </div>}
    <div style={{padding:"6px 10px 10px",borderTop:`1px solid ${UI.lineSoft}`}}>
      <div style={{display:"flex",gap:6,alignItems:"center",background:UI.surface,borderRadius:24,padding:"3px 3px 3px 14px",border:`1px solid ${UI.line}`}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMessage()} placeholder="Reunião amanhã, treino sexta, SEO hoje..." style={{flex:1,border:"none",outline:"none",fontSize:12,background:"transparent",padding:"6px 0"}}/>
        <button onClick={sendMessage} disabled={!input.trim()||loading} style={{width:36,height:36,borderRadius:"50%",border:"none",background:input.trim()&&!loading?UI.darkA:"#CBD5E1",color:"#fff",fontSize:14,cursor:input.trim()&&!loading?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>↑</button>
      </div>
    </div>
  </div>;
}

// ─── Local parser (date-aware) ───
function localParse(text,sops) {
  const lines=text.split(/[,\n•]/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length) return [];
  const fKw={haldan:["haldan","equipe","gerência","gerencia","alinhamento interno"],taka:["taka","estúdio","estudio","cliente","dr.","dra.","seo","conteúdo","conteudo","proposta","wordpress","follow-up","followup"],pessoal:["treino","academia","corrida","esporte","cozinhar","comida","marmita","almoço","almoco","jantar","casa","limpar","organizar","mari","bebê","bebe","pessoal","saúde","saude"]};
  const tKw={"Reunião":["reunião","reuniao","call","meeting","alinhamento"],"SEO":["seo","texto seo","artigo","blog"],"WordPress":["wordpress","wp","site","página","pagina"],"Conteúdo":["conteúdo","conteudo","copy","legenda","post","instagram"],"Follow-up":["follow-up","followup","retorno","cobrar"],"Proposta":["proposta","orçamento","orcamento","pitch"],"Gestão equipe":["equipe","time","delegar","alinhar","gestão","gestao"],"Alimentação":["cozinhar","comida","marmita","almoço","almoco","jantar"],"Esporte":["treino","academia","corrida","exercício","exercicio"],"Casa":["limpar","organizar","casa","roupa","lavar","mercado"]};
  const globalDate = parseDateFromText(text);
  return lines.map(line=>{
    const lower=line.toLowerCase();
    let frente="taka"; for(const[f,kws]of Object.entries(fKw)){if(kws.some(k=>lower.includes(k))){frente=f;break;}}
    let type="Outro"; for(const[t,kws]of Object.entries(tKw)){if(kws.some(k=>lower.includes(k))){type=t;break;}}
    const sop=sops[type]||sops["Outro"];
    const tm=lower.match(/(\d+)\s*(h|hora|min)/);
    let est=sop?.totalTime||30; if(tm) est=tm[2].startsWith("h")?parseInt(tm[1])*60:parseInt(tm[1]);
    const lineDate = parseDateFromText(line);
    const date = lineDate !== today() ? lineDate : globalDate;
    // Parse time from text
    let startTime = null;
    const timeMatch = lower.match(/(?:às?\s*)?(\d{1,2})[h:](\d{0,2})/);
    if(timeMatch) { const h=parseInt(timeMatch[1]),m=parseInt(timeMatch[2]||"0"); if(h>=0&&h<=23) startTime=`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
    if(/\bde manh[aã]\b/.test(lower)) startTime="08:00";
    if(/\b[àa] tarde\b/.test(lower)) startTime="14:00";
    if(/\b[àa] noite\b/.test(lower)) startTime="19:00";
    const nowIso = new Date().toISOString();
    return {id:genId(),title:line.charAt(0).toUpperCase()+line.slice(1),detail:null,frente,type,steps:(sop?.steps||[]).map(s=>({...s,done:false})),estimatedTime:est,createdAt:nowIso,updatedAt:nowIso,completedAt:null,date,startTime};
  });
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR VIEW
// ═══════════════════════════════════════════════════════════════
function CalendarView({tasks,history,onSelectDate,selectedDate,onSetView}) {
  const [weekOffset,setWeekOffset]=useState(0);
  const center = addDays(today(),weekOffset*7);
  const week = getWeekDays(center);
  const t = today();

  const taskCountForDate=(d)=>{
    const active=tasks.filter(x=>x.date===d&&!x.completedAt).length;
    const done=history.filter(x=>(x.completedAt?.slice(0,10)||x.date)===d).length;
    return {active,done,total:active+done};
  };

  const frenteDotsForDate=(d)=>{
    const ts=tasks.filter(x=>x.date===d&&!x.completedAt);
    const frentes=[...new Set(ts.map(x=>x.frente))];
    return frentes.slice(0,3);
  };

  // Month overview: next 30 days grouped by week
  const monthStart = addDays(today(),0);
  const next30 = Array.from({length:30},(_,i)=>addDays(monthStart,i));

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
      <h3 style={{margin:0,fontSize:16,fontWeight:600}}>Calendário</h3>
      <div style={{fontSize:11,color:"#888",fontWeight:500}}>{new Date(center+"T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</div>
    </div>

    {/* Week navigation */}
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
      <button onClick={()=>setWeekOffset(w=>w-1)} style={{background:"#fff",border:"1px solid #E8E6DF",borderRadius:10,padding:"8px 12px",fontSize:14,cursor:"pointer",color:"#555"}}>←</button>
      <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {week.map(d=>{
          const isToday=d===t;
          const isSel=d===selectedDate;
          const {active,done}=taskCountForDate(d);
          const dots=frenteDotsForDate(d);
          return <button key={d} onClick={()=>{SoundEngine.play("click");onSelectDate(d);onSetView("day");}} style={{
            display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"8px 4px",borderRadius:12,border:isSel?"2px solid #1A1A18":isToday?"2px solid #0F6E56":"1px solid #E8E6DF",
            background:isSel?"#1A1A18":isToday?"#E1F5EE":"#fff",color:isSel?"#fff":isToday?"#085041":"#333",cursor:"pointer",
          }}>
            <span style={{fontSize:9,fontWeight:500,opacity:0.6,textTransform:"uppercase"}}>{fmtWeekday(d)}</span>
            <span style={{fontSize:16,fontWeight:600,lineHeight:1}}>{fmtDateShort(d)}</span>
            {active>0&&<div style={{display:"flex",gap:2,marginTop:2}}>{dots.map((f,i)=><div key={i} style={{width:5,height:5,borderRadius:"50%",background:isSel?"rgba(255,255,255,0.5)":FC(f)}}/>)}</div>}
            {active===0&&done>0&&<span style={{fontSize:8,color:isSel?"rgba(255,255,255,0.5)":"#5DCAA5"}}>✓{done}</span>}
          </button>;
        })}
      </div>
      <button onClick={()=>setWeekOffset(w=>w+1)} style={{background:"#fff",border:"1px solid #E8E6DF",borderRadius:10,padding:"8px 12px",fontSize:14,cursor:"pointer",color:"#555"}}>→</button>
    </div>

    {weekOffset!==0&&<button onClick={()=>setWeekOffset(0)} style={{display:"block",margin:"0 auto 16px",padding:"6px 16px",borderRadius:20,border:"1px solid #E8E6DF",background:"#fff",fontSize:11,color:"#555",cursor:"pointer"}}>↻ Voltar pra esta semana</button>}

    {/* Upcoming tasks preview */}
    <div style={{marginTop:8}}>
      <div style={{fontSize:11,fontWeight:600,color:"#888",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>Próximos dias</div>
      {[0,1,2,3,4,5,6].map(offset=>{
        const d=addDays(today(),offset);
        const ts=tasks.filter(x=>x.date===d&&!x.completedAt);
        if(ts.length===0) return null;
        return <div key={d} style={{marginBottom:8}}>
          <div onClick={()=>{onSelectDate(d);onSetView("day");}} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,cursor:"pointer"}}>
            <span style={{fontSize:12,fontWeight:600,color:d===today()?"#0F6E56":"#333"}}>{d===today()?"Hoje":d===addDays(today(),1)?"Amanhã":fmtDate(d)}</span>
            <span style={{fontSize:10,color:"#aaa"}}>{ts.length} tarefa{ts.length>1?"s":""}</span>
          </div>
          {ts.slice(0,3).map(task=><div key={task.id} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"#fff",borderRadius:10,marginBottom:2,borderLeft:`3px solid ${FC(task.frente)}`,border:"1px solid #E8E6DF"}}>
            <span style={{fontSize:13}}>{TYPE_ICONS[task.type]||"📌"}</span>
            <span style={{fontSize:12,color:"#333",flex:1}}>{task.startTime&&<span style={{fontSize:10,color:"#0F6E56",fontWeight:600,marginRight:4}}>{task.startTime}</span>}{task.title}</span>
            <span style={{fontSize:10,color:"#aaa"}}>{task.estimatedTime}m</span>
          </div>)}
          {ts.length>3&&<div style={{fontSize:10,color:"#888",paddingLeft:10}}>+{ts.length-3} mais</div>}
        </div>;
      }).filter(Boolean)}
      {tasks.filter(t=>t.date>=today()&&!t.completedAt).length===0&&<p style={{fontSize:12,color:"#888",textAlign:"center",padding:20}}>Nenhuma tarefa agendada. Use o chat!</p>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// AI CHAT VIEW
// ═══════════════════════════════════════════════════════════════
function AIChatView() {
  const[messages,setMessages]=useState([]); const[input,setInput]=useState(""); const[loading,setLoading]=useState(false); const ref=useRef(null);
  useEffect(()=>{ref.current?.scrollIntoView({behavior:"smooth"});},[messages]);
  const send=async()=>{
    if(!input.trim()||loading) return; SoundEngine.play("chat-send");
    const msg={role:"user",content:input.trim()}; const all=[...messages,msg]; setMessages(all); setInput(""); setLoading(true);
    try{
      const compact=all.slice(-10).map(m=>({role:m.role,content:String(m.content||"").slice(0,900)}));
      const r=await apiFetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:compact})});
      const d=await r.json(); SoundEngine.play("chat-receive"); setMessages(p=>[...p,{role:"assistant",content:d.error?`Erro: ${d.error}`:d.text}]);
    }
    catch{ setMessages(p=>[...p,{role:"assistant",content:"Erro de conexão."}]); }
    setLoading(false);
  };
  return <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 180px)"}}>
    <h3 style={{margin:"0 0 4px",fontSize:15,fontWeight:600}}>SER Coach</h3>
    <p style={{fontSize:10,color:"#888",margin:"0 0 10px"}}>Seu coach de produtividade e bem-estar</p>
    <div style={{flex:1,overflowY:"auto",marginBottom:10,display:"flex",flexDirection:"column",gap:6}}>
      {messages.length===0&&<div style={{textAlign:"center",padding:"30px 16px",color:"#888"}}>
        <div style={{fontSize:28,marginBottom:6,opacity:0.2}}>◉</div>
        <p style={{fontSize:12,margin:"0 0 12px"}}>Fala comigo. Tô aqui pra te ajudar a fechar o dia.</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:4,justifyContent:"center"}}>{["Tô travado numa tarefa","O que priorizo agora?","Tá pesado demais hoje","Como organizo minha semana?"].map(q=><button key={q} onClick={()=>setInput(q)} style={{padding:"6px 12px",borderRadius:20,border:"1px solid #E8E6DF",background:"#fff",fontSize:11,color:"#444",cursor:"pointer"}}>{q}</button>)}</div>
      </div>}
      {messages.map((m,i)=><div key={i} className="ser-fadeIn" style={{alignSelf:m.role==="user"?"flex-end":"flex-start",maxWidth:"85%",padding:"8px 14px",borderRadius:m.role==="user"?"14px 14px 3px 14px":"14px 14px 14px 3px",background:m.role==="user"?"#1A1A18":"#fff",color:m.role==="user"?"#fff":"#333",fontSize:12,lineHeight:1.6,whiteSpace:"pre-wrap",border:m.role==="user"?"none":"1px solid #E8E6DF"}}>{m.content}</div>)}
      {loading&&<div className="ser-pulse" style={{alignSelf:"flex-start",padding:"8px 14px",borderRadius:"14px 14px 14px 3px",background:"#fff",color:"#888",fontSize:12,border:"1px solid #E8E6DF"}}>Pensando...</div>}
      <div ref={ref}/>
    </div>
    <div style={{display:"flex",gap:6,alignItems:"center",background:"#fff",borderRadius:24,border:"1px solid #E8E6DF",padding:"3px 3px 3px 14px"}}>
      <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} placeholder="Fala comigo, Sergio..." style={{flex:1,border:"none",outline:"none",fontSize:12,background:"transparent",padding:"6px 0"}}/>
      <button onClick={send} disabled={!input.trim()||loading} style={{width:36,height:36,borderRadius:"50%",border:"none",background:input.trim()&&!loading?"#1A1A18":"#D3D1C7",color:"#fff",fontSize:14,cursor:input.trim()&&!loading?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>↑</button>
    </div>
  </div>;
}

// ─── Notes / Config / History (compact) ───
function NotesView({notes,onSave}) {
  const[activeNote,setActiveNote]=useState(null);const[editText,setEditText]=useState("");const[editTitle,setEditTitle]=useState("");
  const[filter,setFilter]=useState(null);const[showNew,setShowNew]=useState(false);const[newTitle,setNewTitle]=useState("");const[newFrente,setNewFrente]=useState("pessoal");
  const filtered=filter?notes.filter(n=>n.frente===filter):notes;
  const sorted=[...filtered].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
  const open=(n)=>{setActiveNote(n.id);setEditTitle(n.title);setEditText(n.content);};
  const save=()=>{if(!activeNote)return;SoundEngine.play("note-save");onSave(notes.map(n=>n.id===activeNote?{...n,title:editTitle,content:editText,updatedAt:new Date().toISOString()}:n));setActiveNote(null);};
  const create=()=>{if(!newTitle.trim())return;const n={id:genId(),title:newTitle.trim(),content:"",frente:newFrente,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};onSave([...notes,n]);setNewTitle("");setShowNew(false);open(n);};
  const del=(id)=>{SoundEngine.play("task-delete");onSave(notes.filter(n=>n.id!==id));if(activeNote===id)setActiveNote(null);};
  if(activeNote){const n=notes.find(x=>x.id===activeNote);return<div><button onClick={save} style={{background:"none",border:"none",fontSize:12,color:"#888",cursor:"pointer",padding:"0 0 10px"}}>← Voltar e salvar</button><input value={editTitle} onChange={e=>setEditTitle(e.target.value)} style={{width:"100%",border:"none",outline:"none",fontSize:18,fontWeight:600,color:"#1A1A18",marginBottom:6,padding:0,background:"transparent"}}/>{n&&<FrentePill frente={n.frente} small/>}<textarea value={editText} onChange={e=>setEditText(e.target.value)} placeholder="Escreva aqui..." style={{width:"100%",minHeight:350,border:"none",outline:"none",fontSize:13,lineHeight:1.7,color:"#333",resize:"vertical",marginTop:10,padding:0,background:"transparent",fontFamily:"'SF Mono',monospace"}}/></div>;}
  return<div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}><h3 style={{margin:0,fontSize:15,fontWeight:600}}>Notas</h3><button onClick={()=>setShowNew(true)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid #E8E6DF",background:"#fff",fontSize:11,fontWeight:600,cursor:"pointer",color:"#444"}}>+ Nova</button></div>
    <div style={{display:"flex",gap:3,marginBottom:12}}><button onClick={()=>setFilter(null)} style={{padding:"4px 10px",borderRadius:20,border:"none",fontSize:10,fontWeight:600,cursor:"pointer",background:!filter?"#1A1A18":"#E8E6DF",color:!filter?"#fff":"#888"}}>Todas</button>{Object.entries(FRENTES).map(([k,v])=><button key={k} onClick={()=>setFilter(k)} style={{padding:"4px 10px",borderRadius:20,border:"none",fontSize:10,fontWeight:600,cursor:"pointer",background:filter===k?FBG(k):"#E8E6DF",color:filter===k?FC(k):"#888"}}>{v.split(" ").pop()}</button>)}</div>
    {showNew&&<div className="ser-fadeIn" style={{background:"#FAFAF8",borderRadius:12,padding:"12px 14px",marginBottom:10}}><input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Título da nota..." style={{width:"100%",border:"1px solid #E8E6DF",borderRadius:10,padding:"8px 10px",fontSize:12,marginBottom:6,outline:"none"}} autoFocus/><div style={{display:"flex",gap:6}}><select value={newFrente} onChange={e=>setNewFrente(e.target.value)} style={{padding:"6px 8px",borderRadius:8,border:"1px solid #E8E6DF",fontSize:11,background:"#fff"}}>{Object.entries(FRENTES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button onClick={create} disabled={!newTitle.trim()} style={{padding:"6px 14px",borderRadius:8,border:"none",fontSize:11,fontWeight:600,background:newTitle.trim()?"#1A1A18":"#D3D1C7",color:"#fff",cursor:"pointer"}}>Criar</button><button onClick={()=>setShowNew(false)} style={{padding:"6px 10px",borderRadius:8,border:"none",fontSize:11,background:"none",color:"#888",cursor:"pointer"}}>Cancelar</button></div></div>}
    {sorted.length===0?<p style={{fontSize:12,color:"#888",textAlign:"center",padding:30}}>Nenhuma nota.</p>:sorted.map(n=><div key={n.id} onClick={()=>open(n)} className="ser-fadeIn" style={{background:"#fff",border:"1px solid #E8E6DF",borderRadius:12,padding:"10px 12px",marginBottom:4,cursor:"pointer",borderLeft:`3px solid ${FC(n.frente)}`}}><div style={{display:"flex",justifyContent:"space-between"}}><div><span style={{fontSize:13,fontWeight:500,color:"#1A1A18"}}>{n.title}</span><div style={{display:"flex",gap:4,marginTop:3}}><FrentePill frente={n.frente} small/><span style={{fontSize:9,color:"#aaa"}}>{fmtDate(n.updatedAt.slice(0,10))}</span></div></div><button onClick={e=>{e.stopPropagation();del(n.id);}} style={{background:"none",border:"none",color:"#ddd",fontSize:14,cursor:"pointer"}}>×</button></div>{n.content&&<p style={{fontSize:11,color:"#888",margin:"4px 0 0",lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.content.slice(0,80)}</p>}</div>)}
  </div>;
}

// ─── WhatsApp Setup ───
function WhatsAppSetup() {
  const[status,setStatus]=useState("disconnected");
  const[qrcode,setQrcode]=useState(null);
  const[phone,setPhone]=useState("");
  const[reminders,setReminders]=useState(true);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState(null);

  const fetchStatus=useCallback(async()=>{
    try{const r=await apiFetch("/api/whatsapp/status");const d=await r.json();setStatus(d.status||"disconnected");if(d.phoneNumber)setPhone(d.phoneNumber);if(d.remindersEnabled!==undefined)setReminders(d.remindersEnabled);if(d.qrcode)setQrcode(d.qrcode);if(d.status==="connected")setQrcode(null);}catch{}
  },[]);

  useEffect(()=>{fetchStatus();const iv=setInterval(fetchStatus,3000);return()=>clearInterval(iv);},[fetchStatus]);

  const generateQR=async()=>{
    setLoading(true);setError(null);
    try{const r=await apiFetch("/api/whatsapp/qr");const d=await r.json();if(d.qrcode)setQrcode(d.qrcode);if(d.success)setStatus("connecting");if(d.error)setError(d.error);}
    catch(e){setError("Erro ao conectar. Reinicie o servidor.");}
    finally{setLoading(false);}
  };

  const saveConfig=async()=>{
    try{await apiFetch("/api/whatsapp/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phoneNumber:phone,remindersEnabled:reminders})});setError(null);}
    catch{setError("Erro ao salvar configuracoes");}
  };

  const statusColor=status==="connected"?"#0F6E56":status==="connecting"?"#C4860B":"#999";
  const statusLabel=status==="connected"?"Conectado":status==="connecting"?"Aguardando scan...":"Desconectado";

  return<div style={{marginBottom:14}}>
    <h4 style={{fontSize:13,fontWeight:600,marginBottom:8}}>WhatsApp</h4>
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #E8E6DF",padding:"14px",marginBottom:8}}>
      {/* Status */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
        <div style={{width:8,height:8,borderRadius:4,background:statusColor}}/>
        <span style={{fontSize:12,fontWeight:500,color:statusColor}}>{statusLabel}</span>
      </div>

      {/* QR Code */}
      {status!=="connected"&&<div style={{textAlign:"center",marginBottom:12}}>
        {qrcode?<div>
          <img src={qrcode} alt="QR Code WhatsApp" style={{width:220,height:220,borderRadius:8,border:"1px solid #E8E6DF"}}/>
          <p style={{fontSize:10,color:"#888",marginTop:6}}>Abra o WhatsApp {'>'} Aparelhos conectados {'>'} Escaneie</p>
        </div>:<div>
          <button onClick={generateQR} disabled={loading} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#25D366",color:"#fff",fontSize:12,fontWeight:600,cursor:loading?"wait":"pointer",opacity:loading?0.6:1}}>
            {loading?"Gerando QR Code...":"Conectar WhatsApp"}
          </button>
          <p style={{fontSize:10,color:"#888",marginTop:6}}>Gera um QR Code pra conectar seu WhatsApp</p>
        </div>}
      </div>}

      {status==="connected"&&<div style={{textAlign:"center",padding:"8px 0",marginBottom:8}}>
        <span style={{fontSize:20,color:"#0F6E56"}}>&#x2713;</span>
        <p style={{fontSize:12,color:"#0F6E56",fontWeight:500,margin:"4px 0 0"}}>WhatsApp conectado!</p>
      </div>}

      {error&&<div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:8,padding:"8px 10px",marginBottom:10,fontSize:11,color:"#991B1B"}}>{error}</div>}

      {/* Numero */}
      <div style={{marginBottom:10}}>
        <label style={{fontSize:11,fontWeight:500,color:"#666",display:"block",marginBottom:4}}>Seu numero (com DDD e codigo do pais)</label>
        <div style={{display:"flex",gap:6}}>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="5511999999999" style={{flex:1,padding:"8px 10px",borderRadius:8,border:"1px solid #E8E6DF",fontSize:12,outline:"none"}}/>
          <button onClick={saveConfig} style={{padding:"8px 14px",borderRadius:8,border:"none",background:"#1A1A18",color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer"}}>Salvar</button>
        </div>
      </div>

      {/* Lembretes toggle */}
      <div onClick={()=>{const next=!reminders;setReminders(next);apiFetch("/api/whatsapp/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({remindersEnabled:next})}).catch(()=>{});}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",padding:"4px 0"}}>
        <div><div style={{fontSize:12,fontWeight:500}}>Lembretes diarios</div><div style={{fontSize:10,color:"#888"}}>8h, 13h e 19h via WhatsApp</div></div>
        <div style={{width:40,height:24,borderRadius:12,padding:2,background:reminders?"#25D366":"#D3D1C7",transition:"background 0.2s"}}><div style={{width:20,height:20,borderRadius:10,background:"#fff",transform:reminders?"translateX(16px)":"translateX(0)",transition:"transform 0.2s"}}/></div>
      </div>
    </div>
  </div>;
}

function ConfigView({soundEnabled,onToggleSound,sops}) {
  return<div>
    <h3 style={{margin:"0 0 14px",fontSize:15,fontWeight:600}}>Configurações</h3>
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #E8E6DF",overflow:"hidden",marginBottom:14}}>
      <div onClick={onToggleSound} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",cursor:"pointer"}}>
        <div><div style={{fontSize:13,fontWeight:500}}>Sons do sistema</div><div style={{fontSize:11,color:"#888"}}>Feedback sonoro</div></div>
        <div style={{width:40,height:24,borderRadius:12,padding:2,background:soundEnabled?"#0F6E56":"#D3D1C7",transition:"background 0.2s",cursor:"pointer"}}><div style={{width:20,height:20,borderRadius:10,background:"#fff",transform:soundEnabled?"translateX(16px)":"translateX(0)",transition:"transform 0.2s"}}/></div>
      </div>
    </div>
    <WhatsAppSetup/>
    <div style={{background:"#FAFAF8",borderRadius:12,padding:"12px 14px",marginBottom:14,border:"1px solid #E8E6DF"}}>
      <div style={{fontSize:10,fontWeight:600,color:"#888",marginBottom:4,textTransform:"uppercase"}}>Backlog</div>
      <div style={{fontSize:12,color:"#555",lineHeight:1.6}}>• Google Calendar sync<br/>• Google Drive (salvar entregas)</div>
    </div>
    <h4 style={{fontSize:13,fontWeight:600,marginBottom:8}}>Processos (SOPs)</h4>
    {Object.entries(sops).map(([type,sop])=><div key={type} style={{background:"#fff",borderRadius:12,padding:"10px 14px",marginBottom:6,border:"1px solid #E8E6DF"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:12,fontWeight:600}}>{TYPE_ICONS[type]} {type}</span><span style={{fontSize:10,color:"#888"}}>~{sop.totalTime}m</span></div>
      {sop.steps.map((s,i)=><div key={i} style={{display:"flex",gap:6,padding:"2px 0",fontSize:11,color:"#5F5E5A"}}><span style={{color:"#aaa",width:12,textAlign:"right",flexShrink:0}}>{i+1}.</span><span style={{flex:1}}>{s.text}</span><span style={{color:"#aaa"}}>{s.time}m</span></div>)}
    </div>)}
  </div>;
}

function Onboarding({onComplete}) {
  const[step,setStep]=useState(0);
  const steps=[{title:"Capture pelo chat",desc:"Digite suas tarefas em linguagem natural. Diga 'amanhã' ou 'sexta' e a IA agenda automaticamente.",icon:"💬"},{title:"Execute com Pomodoro",desc:"Cada tarefa tem um passo a passo. Use o timer pra manter o ritmo.",icon:"⏱"},{title:"Veja no calendário",desc:"Suas tarefas aparecem organizadas por dia. Arraste entre dias se precisar.",icon:"📅"}];
  const s=steps[step];
  return<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:500,padding:20}}>
    <div className="ser-scaleIn" style={{background:"#fff",borderRadius:20,padding:"28px 24px",maxWidth:340,width:"100%",textAlign:"center"}}>
      <div style={{fontSize:40,marginBottom:12}}>{s.icon}</div>
      <h2 style={{fontSize:18,fontWeight:600,margin:"0 0 6px"}}>{s.title}</h2>
      <p style={{fontSize:13,color:"#666",lineHeight:1.6,margin:"0 0 20px"}}>{s.desc}</p>
      <div style={{display:"flex",justifyContent:"center",gap:5,marginBottom:16}}>{steps.map((_,i)=><div key={i} style={{width:7,height:7,borderRadius:4,background:i===step?"#1A1A18":"#D3D1C7"}}/>)}</div>
      <button onClick={()=>{if(step<steps.length-1)setStep(step+1);else{localStorage.setItem(ONBOARDING_KEY,"true");onComplete();}}} style={{width:"100%",padding:"12px",borderRadius:12,border:"none",background:"#1A1A18",color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>{step<steps.length-1?"Próximo":"Começar!"}</button>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// BOTTOM NAV (with calendar)
// ═══════════════════════════════════════════════════════════════
const NAV_ITEMS=[{id:"dashboard",label:"Hoje",icon:"◉"},{id:"calendar",label:"Agenda",icon:"▦"},{id:"notes",label:"Notas",icon:"✎"},{id:"ai",label:"IA",icon:"◎"},{id:"config",label:"Config",icon:"⚙"}];

function BottomNav({view,setView}) {
  return<div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(255,255,255,0.9)",backdropFilter:"blur(10px)",borderTop:`1px solid ${UI.lineSoft}`,display:"flex",justifyContent:"center",gap:0,padding:"6px 0 env(safe-area-inset-bottom, 8px)",zIndex:100,boxShadow:"0 -6px 20px rgba(15,23,42,0.08)"}}>
    <div style={{display:"flex",maxWidth:680,width:"100%",justifyContent:"space-around"}}>
      {NAV_ITEMS.map(n=><button key={n.id} onClick={()=>{SoundEngine.play("click");setView(n.id);}} style={{background:view===n.id?"#EEF2FF":"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,padding:"6px 10px",borderRadius:10,color:view===n.id?UI.darkA:"#94A3B8",transition:"color 0.2s"}}>
        <span style={{fontSize:18,lineHeight:1}}>{n.icon}</span>
        <span style={{fontSize:9,fontWeight:view===n.id?700:600}}>{n.label}</span>
      </button>)}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function SERSystem() {
  const[data,setData]=useState(()=>loadData());
  const[view,setView]=useState("dashboard");
  const[showNewTask,setShowNewTask]=useState(false);
  const[expandedTask,setExpandedTask]=useState(null);
  const[filterFrente,setFilterFrente]=useState(null);
  const[toast,setToast]=useState(null);
  const[showConfetti,setShowConfetti]=useState(false);
  const[showOnboarding,setShowOnboarding]=useState(()=>!localStorage.getItem(ONBOARDING_KEY));
  const[soundEnabled,setSoundEnabled]=useState(true);
  const[selectedDate,setSelectedDate]=useState(today());
  const[editingTask,setEditingTask]=useState(null);
  const[syncReady,setSyncReady]=useState(false);
  const[syncStatus,setSyncStatus]=useState({mode:"connecting",message:"Sincronizando agenda..."});
  const[lastSyncAt,setLastSyncAt]=useState(null);
  const[viewportWidth,setViewportWidth]=useState(typeof window!=="undefined"?window.innerWidth:900);
  const syncHashRef=useRef(null);
  const streak=useMemo(()=>updateStreak(),[]);
  const pom=usePomodoro();

  useEffect(()=>{injectStyles();SoundEngine.init();},[]);
  useEffect(()=>{saveData(data);},[data]);
  useEffect(()=>{SoundEngine.enabled=soundEnabled;},[soundEnabled]);
  useEffect(()=>{
    if(typeof window==="undefined") return;
    const onResize=()=>setViewportWidth(window.innerWidth);
    window.addEventListener("resize",onResize);
    return()=>window.removeEventListener("resize",onResize);
  },[]);

  const applyRemoteSnapshot = useCallback((remoteTasks = []) => {
    setData(prev => {
      const split = splitTasksByCompletion(Array.isArray(remoteTasks) ? remoteTasks : [], prev.sops || DEFAULT_SOPS);
      const active = sortTasksList(split.active);
      const completed = sortHistoryList(split.completed);
      const nextHash = serializeTasksForSync([...active, ...completed]);
      const prevHash = serializeTasksForSync([...(prev.tasks || []), ...(prev.history || [])]);
      syncHashRef.current = nextHash;
      if (nextHash === prevHash) return prev;
      return { ...prev, tasks: active, history: completed };
    });
  }, []);

  const pullRemoteAgenda = useCallback(async () => {
    const r = await apiFetch("/api/agenda/tasks");
    if (!r.ok) throw new Error(await extractApiError(r));
    const d = await r.json().catch(() => ({}));
    const remote = Array.isArray(d?.tasks) ? d.tasks : [];
    applyRemoteSnapshot(remote);
    return remote.length;
  }, [applyRemoteSnapshot]);

  const refreshAgendaNow = useCallback(async () => {
    setSyncStatus({ mode: "connecting", message: "Atualizando agenda..." });
    try {
      await pullRemoteAgenda();
      setLastSyncAt(new Date().toISOString());
      setSyncStatus({ mode: "ok", message: "WhatsApp e página sincronizados." });
    } catch (err) {
      const msg = String(err?.message || "Falha ao atualizar agenda.");
      const friendly = /nao autorizado|não autorizado/i.test(msg)
        ? "Sem permissão para sincronizar. Verifique token."
        : "Sem conexão com o servidor de agenda.";
      setSyncStatus({ mode: "error", message: friendly });
    }
  }, [pullRemoteAgenda]);

  useEffect(()=>{
    let active=true;
    (async()=>{
      try{
        setSyncStatus({ mode: "connecting", message: "Sincronizando agenda..." });
        const r=await apiFetch("/api/agenda/tasks");
        if(!r.ok) throw new Error(await extractApiError(r));
        const d=await r.json().catch(()=>({}));
        const remote=Array.isArray(d?.tasks)?d.tasks:[];
        if(!active) return;
        applyRemoteSnapshot(remote);
        setLastSyncAt(new Date().toISOString());
        setSyncStatus({ mode: "ok", message: "WhatsApp e página sincronizados." });
      }catch(err){
        if(!active) return;
        const msg = String(err?.message || "Falha ao conectar.");
        const friendly = /nao autorizado|não autorizado/i.test(msg)
          ? "Sem permissão para sincronizar. Verifique token."
          : "Não consegui sincronizar com o servidor agora.";
        setSyncStatus({ mode: "error", message: friendly });
      }
      finally{ if(active) setSyncReady(true); }
    })();
    return()=>{active=false;};
  },[applyRemoteSnapshot]);

  useEffect(()=>{
    if(!syncReady) return;
    const allForSync=[...(data.tasks||[]),...(data.history||[])];
    const normalized=sortTasksList(allForSync.map(t=>normalizeTaskShape(t,data.sops||DEFAULT_SOPS)).filter(Boolean));
    const nextHash=serializeTasksForSync(normalized);
    if(nextHash===syncHashRef.current) return;

    let cancelled=false;
    (async()=>{
      try{
        setSyncStatus(prev=>prev.mode==="ok" ? { mode: "connecting", message: "Enviando alterações..." } : prev);
        const r=await apiFetch("/api/agenda/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tasks:normalized})});
        if(!r.ok) throw new Error(await extractApiError(r));
        const d=await r.json().catch(()=>null);
        if(cancelled) return;
        const remote=Array.isArray(d?.tasks)?d.tasks:[];
        if(remote.length===0){
          syncHashRef.current=nextHash;
        }else{
          applyRemoteSnapshot(remote);
        }
        setLastSyncAt(new Date().toISOString());
        setSyncStatus({ mode: "ok", message: "WhatsApp e página sincronizados." });
      }catch(err){
        if(cancelled) return;
        const msg = String(err?.message || "Falha ao sincronizar.");
        const friendly = /nao autorizado|não autorizado/i.test(msg)
          ? "Sem permissão para sincronizar. Verifique token."
          : "Falha ao sincronizar mudanças com o servidor.";
        setSyncStatus({ mode: "error", message: friendly });
      }
    })();

    return()=>{cancelled=true;};
  },[syncReady,data.tasks,data.history,data.sops,applyRemoteSnapshot]);

  useEffect(()=>{
    if(!syncReady) return;
    const iv=setInterval(async()=>{
      try{
        await pullRemoteAgenda();
        setLastSyncAt(new Date().toISOString());
        setSyncStatus(prev=>prev.mode==="error" ? { mode: "ok", message: "Sincronização restabelecida." } : prev);
      }catch(err){
        const msg = String(err?.message || "Falha ao atualizar.");
        const friendly = /nao autorizado|não autorizado/i.test(msg)
          ? "Sem permissão para ler a agenda no servidor."
          : "Sem conexão com o servidor de agenda.";
        setSyncStatus({ mode: "error", message: friendly });
      }
    },5000);
    return()=>clearInterval(iv);
  },[syncReady,pullRemoteAgenda]);

  const toggleStep=useCallback((taskId,stepIndex)=>{setData(d=>({...d,tasks:d.tasks.map(t=>t.id!==taskId?t:{...t,steps:t.steps.map((s,i)=>i===stepIndex?{...s,done:!s.done}:s),updatedAt:new Date().toISOString()})}));},[]);
  const completeTask=useCallback((taskId)=>{
    setData(d=>{const task=d.tasks.find(t=>t.id===taskId);if(!task)return d;const nowIso=new Date().toISOString();const completed={...task,completedAt:nowIso,updatedAt:nowIso,steps:task.steps.map(s=>({...s,done:true}))};return{...d,tasks:d.tasks.filter(t=>t.id!==taskId),history:sortHistoryList([...(d.history||[]),completed])};});
    setExpandedTask(null);SoundEngine.play("task-complete");setToast({message:"Tarefa concluída!",taskId});
    setTimeout(()=>{const remaining=data.tasks.filter(t=>t.id!==taskId&&t.date===today()&&!t.completedAt);if(remaining.length===0&&data.tasks.filter(t=>t.date===today()).length>1){setShowConfetti(true);SoundEngine.play("celebration");setTimeout(()=>setShowConfetti(false),2000);}},100);
  },[data.tasks]);
  const deleteTask=useCallback((taskId)=>{const task=data.tasks.find(t=>t.id===taskId);SoundEngine.play("task-delete");setData(d=>({...d,tasks:d.tasks.filter(t=>t.id!==taskId)}));setExpandedTask(null);if(task){setToast({message:"Tarefa removida",onUndo:()=>setData(d=>({...d,tasks:[...d.tasks,task]}))});}},[data.tasks]);
  const reschedule=useCallback((taskId,newDate)=>{SoundEngine.play("click");setData(d=>({...d,tasks:d.tasks.map(t=>t.id===taskId?{...t,date:newDate,updatedAt:new Date().toISOString()}:t)}));setExpandedTask(null);setToast({message:`Movida pra ${getDateLabel(newDate)}`});},[]);
  const saveEditedTask=useCallback((updatedTask)=>{setData(d=>({...d,tasks:d.tasks.map(t=>t.id===updatedTask.id?{...updatedTask,updatedAt:updatedTask.updatedAt||new Date().toISOString()}:t)}));setExpandedTask(null);setToast({message:"Tarefa atualizada!"});},[]);

  const viewDate = view==="day"?selectedDate:today();
  const dateTasks=data.tasks.filter(t=>t.date===viewDate&&!t.completedAt);
  const todayAll=data.tasks.filter(t=>t.date===today());
  const todayDone=todayAll.filter(t=>t.completedAt).length + data.history.filter(t=>(t.completedAt?.slice(0,10))===today()).length;
  const filtered=filterFrente?dateTasks.filter(t=>t.frente===filterFrente):dateTasks;
  const totalEstimate=dateTasks.reduce((s,t)=>s+(t.estimatedTime||0),0);
  const isWideDashboard = view==="dashboard" && viewportWidth>=1100;
  const layoutMaxWidth = isWideDashboard ? Math.max(1000,Math.min(1600,viewportWidth-32)) : 600;

  const renderTaskList = (tasks, dateStr) => {
    if(tasks.length===0) return <div style={{textAlign:"center",padding:"24px 16px",color:"#888"}}><div style={{fontSize:24,marginBottom:4,opacity:0.2}}>○</div><p style={{fontSize:12,margin:0}}>{dateStr===today()?"Pronto pra começar!":"Nada agendado."}</p></div>;
    return <div style={{display:"flex",flexDirection:"column",gap:6}}>{tasks.map((t,i)=><TaskCard key={t.id} task={t} index={i} expanded={expandedTask===t.id} onToggleExpand={id=>setExpandedTask(expandedTask===id?null:id)} onToggleStep={toggleStep} onComplete={completeTask} onDelete={deleteTask} onReschedule={reschedule} onEdit={t=>setEditingTask(t)} sops={data.sops}/>)}</div>;
  };

  const renderTaskBoard = (tasks, dateStr) => {
    if(tasks.length===0) return renderTaskList(tasks,dateStr);
    const order=["taka","haldan","pessoal"];
    return <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:14,alignItems:"start"}}>
      {order.map((frente,colIdx)=>{
        const colTasks=tasks.filter(t=>t.frente===frente);
        const active=!filterFrente||filterFrente===frente;
        return <div key={frente} style={{
          background:`linear-gradient(180deg, ${FBG(frente)} 0%, ${UI.surface} 72%)`,
          border:`1px solid ${FAC(frente)}`,
          borderTop:`6px solid ${FC(frente)}`,
          borderRadius:18,
          padding:12,
          minHeight:220,
          opacity:active?1:0.48,
          boxShadow:active?UI.shadowMd:"none",
          backdropFilter:"blur(2px)"
        }}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10,padding:"0 2px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:FC(frente)}}/>
              <span style={{fontSize:12,fontWeight:700,color:FDK(frente),letterSpacing:"0.01em"}}>{FRENTES[frente]}</span>
            </div>
            <span style={{fontSize:10,fontWeight:700,color:FC(frente),background:"#fff",border:`1px solid ${FAC(frente)}`,borderRadius:20,padding:"3px 8px"}}>{colTasks.length}</span>
          </div>
          {colTasks.length===0
            ? <div style={{textAlign:"center",padding:"14px 8px",fontSize:11,color:UI.muted}}>Sem tarefas nesta frente.</div>
            : <div style={{display:"flex",flexDirection:"column",gap:8}}>{colTasks.map((t,i)=><TaskCard key={t.id} task={t} index={i+(colIdx*0.1)} expanded={expandedTask===t.id} onToggleExpand={id=>setExpandedTask(expandedTask===id?null:id)} onToggleStep={toggleStep} onComplete={completeTask} onDelete={deleteTask} onReschedule={reschedule} onEdit={t=>setEditingTask(t)} sops={data.sops} postIt/>)}</div>}
        </div>;
      })}
    </div>;
  };

  return <div style={{background:`linear-gradient(180deg, ${UI.pageTop} 0%, ${UI.pageBottom} 100%)`,minHeight:"100vh",color:UI.ink,paddingBottom:70,position:"relative"}}>
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0}}>
      <div style={{position:"absolute",top:-120,left:-100,width:460,height:460,background:"radial-gradient(circle, rgba(97,120,255,0.14) 0%, rgba(97,120,255,0) 65%)"}}/>
      <div style={{position:"absolute",top:200,right:-120,width:420,height:420,background:"radial-gradient(circle, rgba(22,170,136,0.12) 0%, rgba(22,170,136,0) 70%)"}}/>
      <div style={{position:"absolute",bottom:-140,left:"30%",width:520,height:520,background:"radial-gradient(circle, rgba(222,90,74,0.10) 0%, rgba(222,90,74,0) 70%)"}}/>
    </div>
    {showOnboarding&&<Onboarding onComplete={()=>setShowOnboarding(false)}/>}
    <Confetti active={showConfetti}/>

    {/* Header */}
    <div style={{background:`linear-gradient(165deg, ${UI.darkA} 0%, ${UI.darkB} 100%)`,padding:"16px 20px 14px",borderRadius:"0 0 24px 24px",boxShadow:UI.shadowMd,position:"relative",zIndex:1}}>
      <W style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:9,color:"rgba(255,255,255,0.42)",fontWeight:700,letterSpacing:"0.15em",textTransform:"uppercase"}}>Sistema</div>
          <h1 style={{margin:0,fontSize:24,fontWeight:600,color:"#fff",letterSpacing:"-0.02em"}}>SER</h1>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {streak.count>1&&<div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontWeight:500}}>🔥 {streak.count}d</div>}
          <DailyProgressRing done={todayDone} total={todayAll.length||1}/>
        </div>
      </W>
      <W><div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
        <span style={{fontSize:11,color:"rgba(255,255,255,0.45)"}}>{fmtDate(today())}</span>
        <span style={{fontSize:10,color:"rgba(255,255,255,0.35)"}}>Separar · Executar · Revisar</span>
      </div></W>
    </div>

    {/* Content */}
    <div style={{padding:"14px 16px 16px",position:"relative",zIndex:1}}>
      <W style={isWideDashboard?{maxWidth:layoutMaxWidth}:undefined}>
        {view==="dashboard"&&<>
          {/* Stats + Pomodoro side by side */}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <StatsCompact tasks={[...data.tasks,...data.history]} dateStr={today()}/>
            <PomodoroCompact pom={pom} totalEstimate={totalEstimate}/>
          </div>

          <div style={{marginBottom:12}}><ActiveBlockIndicator/></div>

          <DashboardChat onAddTasks={tasks=>setData(d=>({...d,tasks:[...d.tasks,...tasks]}))} sops={data.sops}/>

          <div style={{marginTop:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <h3 style={{margin:0,fontSize:14,fontWeight:700,color:UI.ink}}>Tarefas de hoje</h3>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                <button
                  onClick={refreshAgendaNow}
                  style={{
                    padding:"4px 8px",
                    borderRadius:999,
                    border:`1px solid ${syncStatus.mode==="error" ? "#FECACA" : syncStatus.mode==="ok" ? "#BBF7D0" : "#DCE7F5"}`,
                    background:syncStatus.mode==="error" ? "#FEF2F2" : syncStatus.mode==="ok" ? "#ECFDF5" : "#F8FAFC",
                    color:syncStatus.mode==="error" ? "#B91C1C" : syncStatus.mode==="ok" ? "#166534" : "#334155",
                    fontSize:9,
                    fontWeight:700,
                    cursor:"pointer",
                    whiteSpace:"nowrap"
                  }}
                  title={syncStatus.message}
                >
                  {syncStatus.mode==="ok" ? "Sincronizado" : syncStatus.mode==="error" ? "Sem sync" : "Sincronizando"}
                </button>
                <div style={{display:"flex",gap:3}}>
                <button onClick={()=>setFilterFrente(null)} style={{padding:"5px 10px",borderRadius:20,border:!filterFrente?"1px solid rgba(12,26,47,0.18)":`1px solid ${UI.line}`,fontSize:9,fontWeight:700,cursor:"pointer",background:!filterFrente?UI.darkA:UI.surface,color:!filterFrente?"#fff":UI.muted,boxShadow:!filterFrente?UI.shadowSm:"none"}}>Todas</button>
                {Object.entries(FRENTES).map(([k,v])=><button key={k} onClick={()=>setFilterFrente(k)} style={{padding:"5px 10px",borderRadius:20,border:`1px solid ${filterFrente===k?FAC(k):UI.line}`,fontSize:9,fontWeight:700,cursor:"pointer",background:filterFrente===k?FBG(k):UI.surface,color:filterFrente===k?FC(k):UI.muted}}>{v.split(" ").pop()}</button>)}
                </div>
              </div>
            </div>
            {syncStatus.mode==="error"&&(
              <div style={{marginBottom:8,padding:"8px 10px",borderRadius:10,border:"1px solid #FECACA",background:"#FEF2F2",color:"#B91C1C",fontSize:11,fontWeight:600}}>
                {syncStatus.message}
              </div>
            )}
            {isWideDashboard?renderTaskBoard(filtered,today()):renderTaskList(filtered,today())}
            {lastSyncAt&&(
              <div style={{marginTop:8,fontSize:10,color:UI.muted}}>
                Última sincronização: {new Date(lastSyncAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}
              </div>
            )}
          </div>
        </>}

        {view==="calendar"&&<CalendarView tasks={data.tasks} history={data.history} selectedDate={selectedDate} onSelectDate={setSelectedDate} onSetView={setView}/>}

        {view==="day"&&<div>
          <button onClick={()=>setView("calendar")} style={{background:"none",border:"none",fontSize:12,color:"#888",cursor:"pointer",padding:"0 0 10px"}}>← Agenda</button>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <h3 style={{margin:"0 0 4px",fontSize:15,fontWeight:600}}>{selectedDate===today()?"Hoje":selectedDate===addDays(today(),1)?"Amanhã":fmtDateFull(selectedDate)}</h3>
              <p style={{fontSize:10,color:"#888",marginBottom:12}}>{dateTasks.length} tarefa{dateTasks.length!==1?"s":""} · ~{totalEstimate}m estimado</p>
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setSelectedDate(addDays(selectedDate,-1))} style={{background:"#fff",border:"1px solid #E8E6DF",borderRadius:8,padding:"6px 10px",fontSize:12,cursor:"pointer",color:"#555"}}>←</button>
              <button onClick={()=>setSelectedDate(addDays(selectedDate,1))} style={{background:"#fff",border:"1px solid #E8E6DF",borderRadius:8,padding:"6px 10px",fontSize:12,cursor:"pointer",color:"#555"}}>→</button>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"flex-end",gap:3,marginBottom:10}}>
            <button onClick={()=>setFilterFrente(null)} style={{padding:"4px 10px",borderRadius:20,border:"none",fontSize:9,fontWeight:600,cursor:"pointer",background:!filterFrente?"#1A1A18":"#E8E6DF",color:!filterFrente?"#fff":"#888"}}>Todas</button>
            {Object.entries(FRENTES).map(([k,v])=><button key={k} onClick={()=>setFilterFrente(k)} style={{padding:"4px 10px",borderRadius:20,border:"none",fontSize:9,fontWeight:600,cursor:"pointer",background:filterFrente===k?FBG(k):"#E8E6DF",color:filterFrente===k?FC(k):"#888"}}>{v.split(" ").pop()}</button>)}
          </div>

          {/* Timeline 6h-20h */}
          <div style={{position:"relative",marginBottom:16}}>
            {Array.from({length:15},(_,i)=>i+6).map(hour=>{
              const hourTasks=filtered.filter(t=>t.startTime&&parseInt(t.startTime.split(":")[0])===hour);
              const isNow=selectedDate===today()&&new Date().getHours()===hour;
              const blockColor = hour>=6&&hour<8?"pessoal":hour>=8&&hour<12?"taka":hour>=12&&hour<13?null:hour>=13&&hour<18?"haldan":hour>=18&&hour<20?"pessoal":null;
              return <div key={hour} style={{display:"flex",minHeight:hourTasks.length>0?"auto":36,borderBottom:"1px solid #F0EEE8",position:"relative"}}>
                <div style={{width:44,flexShrink:0,paddingTop:6,paddingRight:8,textAlign:"right"}}>
                  <span style={{fontSize:10,fontWeight:isNow?700:500,color:isNow?"#0F6E56":"#aaa"}}>{String(hour).padStart(2,"0")}:00</span>
                </div>
                <div style={{flex:1,padding:"4px 0",borderLeft:isNow?"2px solid #0F6E56":`1px solid ${blockColor?FAC(blockColor):"#E8E6DF"}`,paddingLeft:8,background:isNow?"rgba(15,110,86,0.03)":"transparent"}}>
                  {hourTasks.length>0?<div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {hourTasks.map(t=><div key={t.id} onClick={()=>setEditingTask(t)} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"#fff",borderRadius:10,borderLeft:`3px solid ${FC(t.frente)}`,border:"1px solid #E8E6DF",cursor:"pointer"}}>
                      <span style={{fontSize:12}}>{TYPE_ICONS[t.type]||"📌"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <span style={{fontSize:11,fontWeight:500,color:"#1A1A18"}}>{t.startTime} {t.title}</span>
                        <div style={{display:"flex",gap:3,marginTop:2}}><FrentePill frente={t.frente} small/><span style={{fontSize:9,color:"#aaa"}}>{t.estimatedTime}m</span></div>
                      </div>
                    </div>)}
                  </div>:null}
                </div>
              </div>;
            })}
          </div>

          {/* Tasks without time */}
          {(()=>{
            const noTime=filtered.filter(t=>!t.startTime);
            if(noTime.length===0) return null;
            return <div>
              <div style={{fontSize:11,fontWeight:600,color:"#888",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>Sem horário definido</div>
              {renderTaskList(noTime,viewDate)}
            </div>;
          })()}

          {/* Tasks with time that are also in the list for expansion */}
          {(()=>{
            const withTime=filtered.filter(t=>t.startTime);
            if(withTime.length===0) return null;
            return <div style={{marginTop:12}}>
              <div style={{fontSize:11,fontWeight:600,color:"#888",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>Agendadas</div>
              {renderTaskList(withTime,viewDate)}
            </div>;
          })()}
        </div>}

        {view==="notes"&&<NotesView notes={data.notes||[]} onSave={notes=>setData(d=>({...d,notes}))}/>}
        {view==="ai"&&<AIChatView/>}
        {view==="config"&&<ConfigView soundEnabled={soundEnabled} onToggleSound={()=>setSoundEnabled(v=>!v)} sops={data.sops}/>}
      </W>
    </div>

    {/* FAB */}
    <button onClick={()=>{SoundEngine.play("click");setShowNewTask(true);}} style={{position:"fixed",bottom:72,right:Math.max(16,(typeof window!=="undefined"?(window.innerWidth-layoutMaxWidth)/2:16)),width:52,height:52,borderRadius:"50%",border:"none",background:UI.darkA,color:"#fff",fontSize:24,fontWeight:300,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:UI.shadowLg,zIndex:90}}>+</button>

    <BottomNav view={view} setView={v=>{setView(v);setFilterFrente(null);setExpandedTask(null);}}/>
    {showNewTask&&<NewTaskModal onClose={()=>setShowNewTask(false)} onAdd={task=>setData(d=>({...d,tasks:[...d.tasks,task]}))} sops={data.sops} defaultDate={view==="day"?selectedDate:today()}/>}
    {editingTask&&<EditTaskModal task={editingTask} onClose={()=>setEditingTask(null)} onSave={saveEditedTask} sops={data.sops}/>}
    {toast&&<Toast message={toast.message} onUndo={toast.onUndo} onClose={()=>setToast(null)}/>}
  </div>;
}

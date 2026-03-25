export function todayLocalISO(date = new Date()) {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [h, m] = trimmed.split(':').map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  if (/^\d{1,2}h$/.test(trimmed)) {
    const h = Number(trimmed.replace('h', ''));
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }

  return null;
}

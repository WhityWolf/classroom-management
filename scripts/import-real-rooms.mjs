// One-off import script — run manually once per Supabase project, never imported by the app.
// Usage: node --env-file=.env.local scripts/import-real-rooms.mjs
//
// Reads the real room inventory from Salas_de_Aula.csv (LOCAL,BLOCO,NÚMERO,
// CAPACIDADE,EQUIPAMENTO) and upserts it into the `rooms` table, replacing the
// placeholder rooms scripts/seed-supabase.mjs used to generate. Also makes
// sure every real department (including BIO, added for this import) has a
// dept_statuses row, since the app reads that on every login.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, '..', 'Salas_de_Aula.csv');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEPTS = ['MATH', 'PHYS', 'CS', 'CHEM', 'BIO'];

// Blocos com chefe de departamento dono. Tudo que não está aqui (Espaço
// Integrado, Bloco II/IV/V do CCN2) é sala compartilhada (dept_id null) —
// só o Diretor aloca/edita.
const DEPT_BY_BLOCO = {
  'SG-01': 'BIO',
  'SG-02': 'CHEM',
  'SG-03': 'PHYS',
  'SG-04': 'MATH',
  'SG-09': 'CS',
  'PPG-Química': 'CHEM',
  'PPG-Matemática': 'MATH',
  'PROFMAT': 'MATH',
  'PPG-Computação': 'CS',
};

const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function parseEquipamento(raw) {
  const s = raw.trim();
  if (!s || /^nao tem$/i.test(s)) return { features: [], note: '' };
  if (/^Projetor$/i.test(s)) return { features: ['Projetor'], note: '' };
  if (/não funciona/i.test(s)) return { features: [], note: 'Projetor presente, porém não funciona.' };
  if (/com problema/i.test(s)) return { features: [], note: 'Projetor com problema (funcionamento instável).' };
  if (/cabo externo/i.test(s)) return { features: ['Projetor'], note: 'Projetor requer cabo externo.' };
  if (/mesas de desenho/i.test(s)) return { features: ['Mesas de Desenho'], note: '' };
  return { features: [s], note: '' };
}

function inferFloor(numero) {
  return /^\d{3}$/.test(numero) ? parseInt(numero[0], 10) : 1;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const [, ...rows] = lines;
  return rows.map(line => {
    const [LOCAL, BLOCO, NUMERO, CAPACIDADE, EQUIPAMENTO = ''] = line.split(',');
    return { LOCAL, BLOCO, NUMERO, CAPACIDADE, EQUIPAMENTO };
  });
}

function buildRooms(rows) {
  const byGroup = {};
  rows.forEach(r => { const k = `${r.LOCAL}|${r.BLOCO}`; (byGroup[k] = byGroup[k] || []).push(r); });

  const usedIds = new Set();
  return rows.map(r => {
    const groupKey = `${r.LOCAL}|${r.BLOCO}`;
    const snSiblings = byGroup[groupKey].filter(x => x.NUMERO.toLowerCase() === 'sn');
    const isSn = r.NUMERO.toLowerCase() === 'sn';
    const label = isSn
      ? (snSiblings.length > 1 ? `S/N-${snSiblings.indexOf(r) + 1}` : 'S/N')
      : r.NUMERO;

    let id = `${r.LOCAL}-${slugify(r.BLOCO)}-${slugify(r.NUMERO)}`;
    let n = 2;
    while (usedIds.has(id)) id = `${r.LOCAL}-${slugify(r.BLOCO)}-${slugify(r.NUMERO)}-${n++}`;
    usedIds.add(id);

    const { features, note } = parseEquipamento(r.EQUIPAMENTO);

    return {
      id,
      dept_id: DEPT_BY_BLOCO[r.BLOCO] ?? null,
      label,
      cap: parseInt(r.CAPACIDADE, 10),
      type: 'Sala de Aula',
      features,
      building: `${r.LOCAL} — ${r.BLOCO}`,
      floor: inferFloor(r.NUMERO),
      description: note,
    };
  });
}

async function main() {
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const rooms = buildRooms(rows);

  console.log(`Inserting ${rooms.length} rooms (${rooms.filter(r => !r.dept_id).length} shared)...`);
  let { error } = await supabase.from('rooms').insert(rooms);
  if (error) throw error;

  console.log('Seeding dept_statuses...');
  ({ error } = await supabase.from('dept_statuses')
    .upsert(DEPTS.map(d => ({ dept_id: d, status: 'active' })), { onConflict: 'dept_id' }));
  if (error) throw error;

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

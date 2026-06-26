// One-off import script — run manually once per Supabase project, never imported by the app.
// Usage: node --env-file=.env.local scripts/import-real-rooms.mjs
//
// Depends on sub_units/roles already existing (see the SQL seed commands
// provided alongside the user/role/sub-unit reformulation — supabase/schema.sql
// + the manual SQL Editor commands creating the institutional role, the 5
// example sub-units, and their coordination roles, in particular MATH_GRAD/
// MATH_POS/MATH_PROFMAT). This script only inserts blocks/rooms and points
// them at roles that must already be there — it does not create roles itself.
//
// Reads the real room inventory from scripts/data/salas-de-aula.csv
// (LOCAL,BLOCO,NÚMERO,CAPACIDADE,EQUIPAMENTO), upserts one `blocks` row per
// distinct LOCAL+BLOCO pair (the granularity the CSV already has but the old
// schema collapsed into a single dept_id + a free-text building string), then
// inserts `rooms` pointing at the right block_id + role_id. Also seeds a
// coordination_statuses row for every role referenced here, since the app
// reads that on every login.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.join(__dirname, 'data', 'salas-de-aula.csv');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Blocos com uma coordenação dona (role_id granular, não mais um departamento
// inteiro — ex.: os 3 blocos de Matemática vão para 3 coordenações
// diferentes, MATH_GRAD/MATH_POS/MATH_PROFMAT, em vez de um único MATH).
// Tudo que não está aqui (Espaço Integrado, Bloco II/IV/V do CCN2) é sala
// compartilhada (role_id null) — só quem tem permissão institucional
// (MANAGE_ROOMS) aloca/edita.
const ROLE_BY_BLOCO = {
  'SG-01': 'BIO_HEAD',
  'SG-02': 'CHEM_HEAD',
  'SG-03': 'PHYS_HEAD',
  'SG-04': 'MATH_GRAD',
  'SG-09': 'CS_HEAD',
  'PPG-Química': 'CHEM_HEAD',
  'PPG-Matemática': 'MATH_POS',
  'PROFMAT': 'MATH_PROFMAT',
  'PPG-Computação': 'CS_HEAD',
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

function buildBlocks(rows) {
  const seen = new Map();
  rows.forEach(r => {
    const id = `${r.LOCAL}-${slugify(r.BLOCO)}`;
    if (!seen.has(id)) seen.set(id, { id, local: r.LOCAL, name: r.BLOCO });
  });
  return [...seen.values()];
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
      role_id: ROLE_BY_BLOCO[r.BLOCO] ?? null,
      block_id: `${r.LOCAL}-${slugify(r.BLOCO)}`,
      label,
      cap: parseInt(r.CAPACIDADE, 10),
      type: 'Sala de Aula',
      features,
      floor: inferFloor(r.NUMERO),
      description: note,
    };
  });
}

async function main() {
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const blocks = buildBlocks(rows);
  const rooms = buildRooms(rows);

  console.log(`Inserting ${blocks.length} blocks...`);
  let { error } = await supabase.from('blocks').upsert(blocks, { onConflict: 'id' });
  if (error) throw error;

  console.log(`Inserting ${rooms.length} rooms (${rooms.filter(r => !r.role_id).length} shared)...`);
  ({ error } = await supabase.from('rooms').insert(rooms));
  if (error) throw error;

  const roleIds = [...new Set(Object.values(ROLE_BY_BLOCO))];
  console.log('Seeding coordination_statuses...');
  ({ error } = await supabase.from('coordination_statuses')
    .upsert(roleIds.map(role_id => ({ role_id, status: 'active' })), { onConflict: 'role_id' }));
  if (error) throw error;

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

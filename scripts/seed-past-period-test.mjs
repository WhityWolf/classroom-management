// One-off script — run manually, safe to re-run after clearing (see note
// below). Inserts fictional courses tagged period='2025.2' (a *past* period,
// since the live data's most recent period is '2026.1') purely so the
// read-only/past-period UI (disabled Salas tab, locked editing, "período
// passado" banner) can be exercised without touching any real data.
// Mix of fully-allocated, partially-allocated, and unallocated courses per
// department, to also exercise the dimmed/pending states in a read-only view.
// Rows are tagged with id suffix "-2025-2" (via courseId's own slugify of the
// period) so they're easy to find and delete later:
//   delete from courses where period = '2025.2';
// Usage: node --env-file=.env.local scripts/seed-past-period-test.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PERIOD = '2025.2';
const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const courseId = (deptId, code, sec, period) => `${deptId}-${slugify(code)}-${sec}-${slugify(period)}`;

// allocation: 'full' (every day in blocks gets a room), 'partial' (only the
// first day), 'none' (left pending — even a wrapped-up past period can have
// a turma that never got placed in real life).
const COURSES = [
  // MATH — rooms: CCN1-SG-04-257(40), CCN1-PPG-MATEMATICA-SN(50), CCN1-PPG-MATEMATICA-SN-2(50), CCN1-PPG-MATEMATICA-SN-3(50)
  { dept: 'MATH', code: 'DMA0501', name: 'Cálculo Avançado', teacher: 'MARIA EDUARDA SANTOS', enroll: 35, days: ['Segunda', 'Quarta'], sh: 8, eh: 10, room: 'CCN1-SG-04-257', alloc: 'full' },
  { dept: 'MATH', code: 'DMA0502', name: 'Topologia Geral', teacher: 'JOSÉ RICARDO ALMEIDA', enroll: 18, days: ['Terça', 'Quinta'], sh: 14, eh: 16, room: 'CCN1-PPG-MATEMATICA-SN', alloc: 'full' },
  { dept: 'MATH', code: 'DMA0503', name: 'Álgebra Abstrata', teacher: 'PAULA FERNANDES LIMA', enroll: 22, days: ['Segunda', 'Quarta', 'Sexta'], sh: 10, eh: 12, room: 'CCN1-PPG-MATEMATICA-SN-2', alloc: 'partial' },
  { dept: 'MATH', code: 'DMA0504', name: 'Geometria Diferencial', teacher: 'CARLOS ALBERTO NUNES', enroll: 15, days: ['Terça', 'Quinta'], sh: 16, eh: 18, room: 'CCN1-PPG-MATEMATICA-SN-3', alloc: 'none' },
  // PHYS — rooms: CCN1-SG-03-229(20), CCN1-SG-03-227(45)
  { dept: 'PHYS', code: 'FIS0201', name: 'Mecânica Clássica II', teacher: 'ROBERTO CARLOS MOTA', enroll: 19, days: ['Segunda', 'Quarta'], sh: 8, eh: 10, room: 'CCN1-SG-03-229', alloc: 'full' },
  { dept: 'PHYS', code: 'FIS0202', name: 'Termodinâmica Avançada', teacher: 'FERNANDA OLIVEIRA COSTA', enroll: 30, days: ['Terça', 'Quinta'], sh: 10, eh: 12, room: 'CCN1-SG-03-227', alloc: 'full' },
  { dept: 'PHYS', code: 'FIS0203', name: 'Física Nuclear', teacher: 'ANTÔNIO MARQUES SILVA', enroll: 12, days: ['Segunda', 'Quarta'], sh: 14, eh: 16, room: 'CCN1-SG-03-229', alloc: 'none' },
  // CS — rooms: CCN1-SG-09-260(30), CCN1-SG-09-262(30), CCN1-PPG-COMPUTACAO-SN(28)
  { dept: 'CS', code: 'CCI0301', name: 'Algoritmos Avançados', teacher: 'LUCAS GABRIEL TEIXEIRA', enroll: 28, days: ['Segunda', 'Quarta'], sh: 14, eh: 16, room: 'CCN1-SG-09-260', alloc: 'full' },
  { dept: 'CS', code: 'CCI0302', name: 'Compiladores', teacher: 'AMANDA CRISTINA ROCHA', enroll: 17, days: ['Terça', 'Quinta'], sh: 16, eh: 18, room: 'CCN1-SG-09-262', alloc: 'full' },
  { dept: 'CS', code: 'CCI0303', name: 'Redes de Computadores II', teacher: 'BRUNO HENRIQUE PEREIRA', enroll: 25, days: ['Segunda', 'Quarta', 'Sexta'], sh: 8, eh: 10, room: 'CCN1-PPG-COMPUTACAO-SN', alloc: 'partial' },
  // CHEM — rooms: CCN1-PPG-QUIMICA-SN(20), CCN1-SG-02-215(44), CCN1-SG-02-216(49), CCN1-SG-02-217(43)
  { dept: 'CHEM', code: 'QUI0201', name: 'Química Orgânica II', teacher: 'JULIANA APARECIDA DIAS', enroll: 38, days: ['Segunda', 'Quarta'], sh: 8, eh: 10, room: 'CCN1-SG-02-215', alloc: 'full' },
  { dept: 'CHEM', code: 'QUI0202', name: 'Bioquímica Avançada', teacher: 'RODRIGO SOUZA BARROS', enroll: 41, days: ['Terça', 'Quinta'], sh: 10, eh: 12, room: 'CCN1-SG-02-216', alloc: 'full' },
  { dept: 'CHEM', code: 'QUI0203', name: 'Eletroquímica', teacher: 'PATRÍCIA REGINA MELO', enroll: 14, days: ['Segunda', 'Quarta'], sh: 16, eh: 18, room: 'CCN1-PPG-QUIMICA-SN', alloc: 'none' },
  // BIO — rooms: CCN1-SG-01-1(45), CCN1-SG-01-5(45), CCN1-SG-01-6(45), CCN1-SG-01-7(45)
  { dept: 'BIO', code: 'BIO0301', name: 'Genética Avançada', teacher: 'CAMILA FERREIRA AZEVEDO', enroll: 33, days: ['Segunda', 'Quarta'], sh: 14, eh: 16, room: 'CCN1-SG-01-7', alloc: 'full' },
  { dept: 'BIO', code: 'BIO0302', name: 'Ecologia de Comunidades', teacher: 'GUSTAVO HENRIQUE RAMOS', enroll: 27, days: ['Terça', 'Quinta'], sh: 16, eh: 18, room: 'CCN1-SG-01-6', alloc: 'full' },
  { dept: 'BIO', code: 'BIO0303', name: 'Imunologia Aplicada', teacher: 'LARISSA CRISTINA NOGUEIRA', enroll: 20, days: ['Segunda', 'Quarta'], sh: 8, eh: 10, room: 'CCN1-SG-01-5', alloc: 'partial' },
];

function toCourseRow(c) {
  const blocks = [{ days: c.days, sh: c.sh, eh: c.eh }];
  const roomByDay = {};
  if (c.alloc === 'full') c.days.forEach(d => { roomByDay[d] = c.room; });
  else if (c.alloc === 'partial') roomByDay[c.days[0]] = c.room;
  return {
    id: courseId(c.dept, c.code, 1, PERIOD),
    code: c.code, name: c.name, sec: 1, dept_id: c.dept, period: PERIOD,
    teacher: c.teacher, blocks, enroll: c.enroll, room_by_day: roomByDay,
  };
}

async function main() {
  const rows = COURSES.map(toCourseRow);
  console.log(`Inserindo ${rows.length} disciplinas fictícias no período ${PERIOD}...`);
  const { error } = await supabase.from('courses').insert(rows);
  if (error) throw error;
  const full = rows.filter(r => Object.keys(r.room_by_day).length === r.blocks[0].days.length).length;
  const partial = rows.filter(r => { const n = Object.keys(r.room_by_day).length; return n > 0 && n < r.blocks[0].days.length; }).length;
  const none = rows.filter(r => Object.keys(r.room_by_day).length === 0).length;
  console.log(`Pronto — ${full} totalmente alocadas, ${partial} parcialmente, ${none} pendentes.`);
  console.log(`Pra remover depois: delete from courses where period = '${PERIOD}';`);
}

main().catch(e => { console.error(e); process.exit(1); });

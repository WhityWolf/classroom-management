// One-off script — run manually, any number of times is safe to re-run after
// clearing (see note below). Inserts placeholder courses per coordination
// purely so the allocation flow can be exercised in the UI. Does NOT touch
// rooms or coordination_statuses — those come from scripts/import-real-rooms.mjs.
// MATH is deliberately excluded — it already has real data imported from a
// SIGAA export (scripts/import-real-rooms.mjs is rooms-only; the courses
// came through the in-app CSV/ods importer, see CourseImportModal). These
// rows are all tagged with id prefix "<role>-TEST" so they're easy to find
// and delete later (`delete from courses where id like '%-TEST%';`).
// Depends on the example roles (PHYS_HEAD/CS_HEAD/CHEM_HEAD/BIO_HEAD) already
// existing — see the SQL seed commands provided with the reformulation.
// Usage: node --env-file=.env.local scripts/seed-test-courses.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const COURSE_NAMES = {
  PHYS_HEAD: ['Mecânica Clássica', 'Eletromagnetismo', 'Termodinâmica', 'Mecânica Quântica', 'Óptica', 'Relatividade Especial', 'Astrofísica', 'Física Nuclear', 'Dinâmica de Fluidos', 'Teoria de Ondas'],
  CS_HEAD:   ['Algoritmos', 'Estruturas de Dados', 'Sistemas Operacionais', 'Redes de Computadores', 'Banco de Dados', 'Inteligência Artificial', 'Aprendizado de Máquina', 'Compiladores', 'Engenharia de Software', 'Computação Gráfica'],
  CHEM_HEAD: ['Química Orgânica', 'Química Inorgânica', 'Química Física', 'Bioquímica', 'Química Analítica', 'Química de Polímeros', 'Eletroquímica', 'Espectroscopia', 'Termoquímica', 'Cinética'],
  BIO_HEAD:  ['Biologia Celular', 'Genética', 'Ecologia', 'Botânica', 'Zoologia', 'Microbiologia', 'Fisiologia Animal', 'Fisiologia Vegetal', 'Evolução', 'Imunologia'],
};

function mkRng(s) { s = s >>> 0; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function generate() {
  const r = mkRng(2024);
  const courses = [];
  Object.entries(COURSE_NAMES).forEach(([roleId, names]) => {
    names.forEach((name, i) => {
      const sh = 8 + Math.floor(r() * 8);
      const eh = sh + (r() < .6 ? 2 : 1);
      courses.push({
        id: `${roleId}-TEST${i + 1}`,
        code: `${roleId}${100 + i}`,
        name,
        sec: 1,
        role_id: roleId,
        blocks: [{ days: r() < .5 ? ['Segunda', 'Quarta'] : ['Terça', 'Quinta'], sh, eh }],
        enroll: 20 + Math.floor(r() * 40),
        room_by_day: {},
      });
    });
  });
  return courses;
}

async function main() {
  const courses = generate();
  console.log(`Inserting ${courses.length} test courses...`);
  const { error } = await supabase.from('courses').insert(courses);
  if (error) throw error;
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

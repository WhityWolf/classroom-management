// One-off script — run manually, any number of times is safe to re-run after
// clearing (see note below). Inserts a handful of placeholder courses per
// department (including BIO) purely so the allocation flow can be exercised
// in the UI. Does NOT touch rooms or dept_statuses — those come from
// scripts/import-real-rooms.mjs. Replace with real course data when available;
// these rows are all tagged with id prefix "<dept>-TEST" so they're easy to
// find and delete later (`delete from courses where id like '%-TEST%';`).
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
  MATH: ['Cálculo I', 'Álgebra Linear', 'Estatística', 'Equações Diferenciais', 'Geometria'],
  PHYS: ['Mecânica Clássica', 'Eletromagnetismo', 'Termodinâmica', 'Óptica', 'Astrofísica'],
  CS:   ['Algoritmos', 'Estruturas de Dados', 'Banco de Dados', 'Redes de Computadores', 'Engenharia de Software'],
  CHEM: ['Química Orgânica', 'Química Analítica', 'Bioquímica', 'Eletroquímica', 'Química Ambiental'],
  BIO:  ['Biologia Celular', 'Genética', 'Ecologia', 'Botânica', 'Zoologia'],
};

function mkRng(s) { s = s >>> 0; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function generate() {
  const r = mkRng(2024);
  const courses = [];
  Object.entries(COURSE_NAMES).forEach(([dept, names]) => {
    names.forEach((name, i) => {
      const sh = 8 + Math.floor(r() * 8);
      const eh = sh + (r() < .6 ? 2 : 1);
      courses.push({
        id: `${dept}-TEST${i + 1}`,
        code: `${dept}${100 + i}`,
        name,
        sec: 1,
        dept_id: dept,
        blocks: [{ days: r() < .5 ? ['Segunda', 'Quarta'] : ['Terça', 'Quinta'], sh, eh }],
        enroll: 20 + Math.floor(r() * 40),
        room: null,
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

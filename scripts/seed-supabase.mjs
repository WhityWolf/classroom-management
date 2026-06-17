// One-off seed script — run manually once per Supabase project, never imported by the app.
// Usage: node --env-file=.env.local scripts/seed-supabase.mjs
//
// Reproduces the same deterministic generator the app used to run on every
// page load (same PRNG seeds), so the dataset doesn't reshuffle at migration
// time. After running this once, the app only ever reads/writes Supabase.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEPTS = [{ id: 'MATH' }, { id: 'PHYS' }, { id: 'CS' }, { id: 'CHEM' }];
const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const ROOM_TYPES = ['Anfiteatro', 'Laboratório', 'Sala de Seminário', 'Laboratório de Informática', 'Sala Tutorial', 'Auditório'];
const ROOM_FEATS = [['Projetor', 'Quadro Branco'], ['Projetor', 'Quadro Inteligente'], ['Quadro Branco', 'Ar-condicionado'], ['Projetor', 'Ar-condicionado', 'Quadro Branco'], ['Quadro Inteligente', 'Equipamento de Lab'], ['Computadores', 'Projetor', 'Ar-condicionado']];
const COURSE_NAMES = {
  MATH: ['Cálculo I', 'Cálculo II', 'Álgebra Linear', 'Estatística', 'Equações Diferenciais', 'Teoria dos Números', 'Álgebra Abstrata', 'Análise Real', 'Análise Complexa', 'Topologia', 'Probabilidade', 'Matemática Discreta', 'Análise Numérica', 'Teoria dos Grafos', 'Otimização', 'Geometria', 'Lógica', 'Teoria dos Conjuntos', 'Modelagem Matemática', 'Teoria dos Jogos'],
  PHYS: ['Mecânica Clássica', 'Eletromagnetismo', 'Termodinâmica', 'Mecânica Quântica', 'Óptica', 'Relatividade Especial', 'Astrofísica', 'Física Nuclear', 'Dinâmica de Fluidos', 'Teoria de Ondas', 'Física do Estado Sólido', 'Física de Partículas', 'Biofísica', 'Acústica', 'Física de Plasma', 'Física Atômica', 'Fotônica', 'Física Computacional', 'Física Médica', 'Geofísica'],
  CS: ['Algoritmos', 'Estruturas de Dados', 'Sistemas Operacionais', 'Redes de Computadores', 'Banco de Dados', 'Inteligência Artificial', 'Aprendizado de Máquina', 'Compiladores', 'Engenharia de Software', 'Computação Gráfica', 'Segurança Cibernética', 'Desenvolvimento Web', 'Computação em Nuvem', 'Sistemas Distribuídos', 'Visão Computacional', 'PLN', 'Robótica', 'IHC', 'Computação Paralela', 'Desenvolvimento de Jogos'],
  CHEM: ['Química Orgânica', 'Química Inorgânica', 'Química Física', 'Bioquímica', 'Química Analítica', 'Química de Polímeros', 'Eletroquímica', 'Espectroscopia', 'Termoquímica', 'Cinética', 'Catálise', 'Química Ambiental', 'Química Medicinal', 'Química Computacional', 'Química Verde', 'Nanoquímica', 'Química de Superfícies', 'Cristalografia', 'Radioquímica', 'Biologia Química'],
};

function mkRng(s) { s = s >>> 0; return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

function generate() {
  const r = mkRng(31415), r2 = mkRng(99991);
  const rooms = DEPTS.flatMap(d => Array.from({ length: 30 }, (_, i) => ({
    id: `${d.id}-R${String(i + 1).padStart(2, '0')}`, dept_id: d.id, label: `${d.id[0]}${200 + i + 1}`,
    cap: [20, 30, 40, 50, 60, 80, 100, 120][Math.floor(r() * 8)],
    type: ROOM_TYPES[Math.floor(r2() * ROOM_TYPES.length)],
    features: ROOM_FEATS[Math.floor(r2() * ROOM_FEATS.length)],
    building: `Bloco-${d.id[0]}`, floor: Math.floor(r2() * 4) + 1,
    description: '',
  })));
  const courses = []; let n = 1;
  DEPTS.forEach(d => {
    const ns = COURSE_NAMES[d.id];
    for (let i = 0; i < 175; i++) {
      const p = r();
      const days = p < .35 ? ['Segunda', 'Quarta', 'Sexta'] : p < .65 ? ['Terça', 'Quinta'] : p < .80 ? ['Segunda', 'Quarta'] : p < .92 ? ['Segunda', 'Quinta'] : [DAYS[Math.floor(r() * 5)]];
      const sh = Math.floor(r() * 10) + 8, dur = r() < .5 ? 1 : r() < .75 ? 2 : 3, eh = Math.min(sh + dur, 20);
      courses.push({
        id: `${d.id}-C${n++}`, code: `${d.id}${(Math.floor(i / ns.length) + 1) * 100 + (i % ns.length) + 1}`,
        name: ns[i % ns.length] + (Math.floor(i / ns.length) > 0 ? ` ${Math.floor(i / ns.length) + 1}` : ''),
        sec: Math.floor(r() * 4) + 1, dept_id: d.id, days, sh, eh,
        enroll: Math.floor(r() * 90) + 10, room: null,
      });
    }
  });
  return { rooms, courses };
}

async function main() {
  const { rooms, courses } = generate();

  console.log(`Inserting ${rooms.length} rooms...`);
  let { error } = await supabase.from('rooms').insert(rooms);
  if (error) throw error;

  console.log(`Inserting ${courses.length} courses...`);
  ({ error } = await supabase.from('courses').insert(courses));
  if (error) throw error;

  console.log('Seeding dept_statuses...');
  ({ error } = await supabase.from('dept_statuses').insert(DEPTS.map(d => ({ dept_id: d.id, status: 'active' }))));
  if (error) throw error;

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });

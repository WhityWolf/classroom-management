import { useState, useMemo, Fragment, useRef, useEffect, createContext, useContext } from 'react';
import { ThemeCtx, LIGHT, DARK, useT, dtc, dbg } from './theme.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { isInstitutionalRole } from './auth/roles.js';
import { PERMS } from './auth/permissions.js';
import { DEFAULT_PERIOD, PERIOD_RE, comparePeriods } from './periods.js';
import LoginPage from './components/LoginPage.jsx';
import UserManagement from './components/UserManagement.jsx';
import ManagementScreen from './components/ManagementScreen.jsx';
import ProfileScreen from './components/ProfileScreen.jsx';
import * as db from './db/allocations.js';
import * as mgmt from './db/management.js';
import * as authApi from './db/authApi.js';
import { useRealtimeSync } from './db/useRealtimeSync.js';
import { supabaseConfigured } from './db/supabaseClient.js';
import campusMapImg from './assets/campus-map.png';
// ?url força o Vite a tratar o import como URL de asset estático mesmo
// .xlsx não estando na lista padrão de extensões reconhecidas (que cobre
// principalmente imagem/mídia/fonte) — sem isso, precisaria de
// assetsInclude no vite.config.js. Modelo de exemplo pro botão "Baixar
// modelo" em CourseImportModal — mesma cópia também em
// scripts/data/exemplo-importacao-disciplinas.xlsx, pra quem quiser o
// arquivo sem abrir o app.
import importTemplateXlsx from './assets/modelo-importacao-disciplinas.xlsx?url';

const DAYS  = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
// 6:00–21:00 start hours (eh can go one past the last entry, i.e. 22:00) —
// matches the real SIGAA slot table: M1=6h..M6=11h, T1=12h..T6=17h, N1=18h..N4=21h.
const HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];

// Salas sem função dona (role_id null no banco — ex.: Espaço Integrado, blocos
// do CCN2) são "compartilhadas": só quem tem permissão institucional
// (MANAGE_ROOMS) aloca/edita essas salas. gRole cai aqui (ver makeGRole) para
// que o restante do código (badges, cores) não precise tratar null à parte.
const SHARED_ROOM_ROLE = { id:null, full:'Sala Compartilhada (gerida pela Direção)', clr:'#94A3B8', textClr:'#475569', bg:'#1e293b', lightBg:'#f1f5f9' };

const DS = { ACTIVE:'active', FINISHED:'finished', FORCE_FINISHED:'force_finished' };

// Sentinela pro seletor de função ativa de quem tem visão institucional —
// "Todas" não é uma função real, é o único valor desse seletor que faz a
// barra lateral mostrar disciplinas de qualquer função (com o rótulo de
// dona aparecendo em cada uma); qualquer função real ali filtra a lista só
// pras disciplinas daquela função, sem o rótulo (já fica implícito).
const ALL_ROLES = '__ALL__';

// ─── Sub-unidades/funções/blocos: dados dinâmicos, não mais enums fixos ──────
// roles/subUnits/blocks chegam do banco (db.fetchAll(), ver Dashboard) — os
// helpers abaixo fecham sobre essas listas em vez de uma constante de módulo
// como o antigo DEPTS. RolesCtx evita ter que passar roles/subUnits/blocks
// como prop por toda a árvore de componentes da tela de alocação.
function makeGRole(roles, subUnits) {
  return roleId => {
    const role = roles.find(r => r.id === roleId);
    if (!role) return { ...SHARED_ROOM_ROLE, subUnitFull: SHARED_ROOM_ROLE.full };
    const su = role.subUnitId ? subUnits.find(s => s.id === role.subUnitId) : null;
    if (su) return { id: role.id, full: role.name, subUnitFull: su.fullName, clr: su.clr, textClr: su.textClr, bg: su.bg, lightBg: su.lightBg };
    return { id: role.id, full: role.name, subUnitFull: role.name, clr: SHARED_ROOM_ROLE.clr, textClr: SHARED_ROOM_ROLE.textClr, bg: SHARED_ROOM_ROLE.bg, lightBg: SHARED_ROOM_ROLE.lightBg };
  };
}
function makeGBlockLabel(blocks) {
  return blockId => {
    const b = blocks.find(x => x.id === blockId);
    return b ? `${b.local} — ${b.name}` : '—';
  };
}
const RolesCtx = createContext(null);
function useRolesData() {
  const ctx = useContext(RolesCtx);
  if (!ctx) throw new Error('useRolesData must be used inside <RolesCtx.Provider>');
  return ctx;
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

// Uma disciplina pode se reunir em dias diferentes com horários diferentes
// (ex.: Segunda/Quarta 15h-18h e Sexta 17h-18h) — cada combinação é um
// "bloco". course.blocks = [{days:[...], sh, eh}, ...].
const totalWeeklyHours=course=>course.blocks.reduce((s,b)=>s+b.days.length*(b.eh-b.sh),0);
const courseOccupiesDay=(course,day)=>course.blocks.some(b=>b.days.includes(day));
// Assume que um dia aparece em no máximo um bloco por disciplina — verdade
// em todos os exemplos reais vistos, não vale a pena tratar o caso teórico contrário.
const blockForDay=(course,day)=>course.blocks.find(b=>b.days.includes(day));
const fmtSchedule=course=>course.blocks.map(b=>`${b.days.map(d=>d.slice(0,3)).join('/')} ${fmtHour(b.sh)}–${fmtHour(b.eh)}`).join('; ');

// A disciplina pode estar em salas diferentes em dias diferentes (ex.:
// Segunda na Sala A, Quarta na Sala B) — por isso `room` não é mais um campo
// único: course.roomByDay = {[dia]: roomId}, um dia ausente = não alocado
// ainda. courseDays junta os dias de todos os blocos (sem repetir).
const courseDays=course=>[...new Set(course.blocks.flatMap(b=>b.days))];
const hasAnyAllocation=course=>Object.keys(course.roomByDay||{}).length>0;
const isFullyAllocated=course=>{const days=courseDays(course);return days.length>0&&days.every(d=>course.roomByDay?.[d]);};

function buildAlloc(courses){const m={};courses.forEach(c=>{const rbd=c.roomByDay||{};c.blocks.forEach(block=>{block.days.forEach(day=>{const rid=rbd[day];if(!rid)return;for(let h=block.sh;h<block.eh;h++){const k=`${rid}|${day}|${h}`;if(!m[k])m[k]=[];m[k].push(c);}});});});return m;}
// `day` omitido = checa a disciplina inteira (todos os dias/blocos) — usado
// pela ListView, que aloca todos os dias na mesma sala de uma vez. `day`
// informado = checa só aquele dia — usado pela Grade, que aloca dia a dia.
function roomFree(rid,course,alloc,day){for(const block of course.blocks)for(const d of block.days){if(day&&d!==day)continue;for(let h=block.sh;h<block.eh;h++)if((alloc[`${rid}|${d}|${h}`]||[]).length)return false;}return true;}
function getConflicts(rid,course,alloc,courses,day){const ids=new Set();for(const block of course.blocks)for(const d of block.days){if(day&&d!==day)continue;for(let h=block.sh;h<block.eh;h++)(alloc[`${rid}|${d}|${h}`]||[]).forEach(c=>{if(c.id!==course.id)ids.add(c.id);});}return[...ids].map(id=>courses.find(c=>c.id===id)).filter(Boolean);}
function rowSlots(rid,day,alloc){const slots=[];let h=HOURS[0];const maxH=HOURS[HOURS.length-1]+1;while(h<maxH){const arr=alloc[`${rid}|${day}|${h}`]||[];if(arr.length){const c=arr[0];const block=blockForDay(c,day);if(block.sh===h){slots.push({h,span:block.eh-block.sh,c,merged:arr.length-1});h=block.eh;}else h++;}else{slots.push({h,span:1,c:null,merged:0});h++;}}return slots;}
// Texto da sala pra exibir no card da disciplina: se todos os dias já
// alocados estão na mesma sala (o caso comum), mostra só o nome da sala;
// senão, detalha sala por dia (curso alocado em salas diferentes, ou ainda
// parcialmente alocado).
function fmtRoomByDay(course,rooms){
  const days=courseDays(course),rbd=course.roomByDay||{};
  const allocatedDays=days.filter(d=>rbd[d]);
  if(allocatedDays.length===0)return null;
  const uniqueRooms=new Set(allocatedDays.map(d=>rbd[d]));
  if(uniqueRooms.size===1&&allocatedDays.length===days.length){
    const rid=rbd[allocatedDays[0]];
    return rooms.find(r=>r.id===rid)?.label??rid;
  }
  return allocatedDays.map(d=>`${d.slice(0,3)}: ${rooms.find(r=>r.id===rbd[d])?.label??rbd[d]}`).join(' · ');
}
function fmtHour(h){return`${String(h).padStart(2,'0')}:00`;}
function escapeHtml(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// Renderiza o conteúdo de uma célula do Mapa de Salas (buildCellContent) como
// HTML estático, para o gerador de PDF — espelha o branch por modo usado em
// RoomMapGrid, mas produzindo string em vez de JSX.
function renderCellHtml(content,cd){
  if(!content)return'';
  let html=`<span style="color:${cd.textClr};font-weight:700">${escapeHtml(content.primary)}</span>`;
  if(content.mode==='detalhado')html+=`<br><span class="tchr">${escapeHtml(content.name)}</span>`;
  if(content.teacher)html+=`<br><span class="tchr">${escapeHtml(content.teacher)}</span>`;
  if(content.mode==='detalhado')html+=`<br><span class="tchr">${escapeHtml(content.timeRange)} · ${content.enroll} alunos</span>`;
  if(content.merged>0)html+=`<span class="merged">+${content.merged}</span>`;
  return html;
}
// Deriva os campos exibidos numa célula alocada do Mapa de Salas, conforme o
// modo de visão ('padrao'|'detalhado'|'simples') — usado tanto por RoomMapGrid
// (JSX) quanto por generatePdf/roomHtml (string HTML), para as duas
// renderizações nunca divergirem no que mostram.
function buildCellContent(cell,day,mode){
  if(!cell.c)return null;
  const c=cell.c,sb=blockForDay(c,day);
  const secSuffix=c.sec!=null?` T${c.sec}`:'';
  const tooltip=`${c.name}${c.sec!=null?` · Turma ${c.sec}`:''}${c.teacher?` · ${c.teacher}`:''} · ${fmtHour(sb.sh)}–${fmtHour(sb.eh)} · ${c.enroll} alunos`;
  if(mode==='simples')return{mode,tooltip,primary:c.code};
  if(mode==='detalhado')return{mode,tooltip,primary:`${c.code}${secSuffix}`,name:c.name,teacher:c.teacher||null,timeRange:`${fmtHour(sb.sh)}–${fmtHour(sb.eh)}`,enroll:c.enroll,merged:cell.merged};
  return{mode,tooltip,primary:`${c.code}${secSuffix}`,teacher:c.teacher||null,merged:cell.merged};
}

// ─── Catálogo de disciplinas (criação manual + import ODS) ───────────────────
// id derivado de dept+código+seção+período: dobra como detector de duplicata
// (colisão de PK = erro claro) já que `code` não tem unicidade no schema.
// Período entra no id porque a mesma disciplina (código+seção) se repete a
// cada período letivo — sem ele, importar/criar a "mesma" disciplina num
// período novo colidiria com o registro (read-only) do período antigo.
// código/seção não são editáveis após a criação (só name/days/sh/eh/enroll
// mudam), então o id nunca precisa ser regenerado — não adicione edição de
// código/seção sem revisitar isto.
const slugify=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const courseId=(roleId,code,sec,period)=>`${roleId}-${slugify(code)}-${sec}-${slugify(period)}`;
function ptError(e) {
  const msg = e?.message ?? String(e);
  if (msg.includes('foreign key constraint'))  return 'Referência inválida: verifique se todos os campos obrigatórios foram preenchidos corretamente.';
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) return 'Já existe um registro com esse valor (dado duplicado).';
  if (msg.includes('null value in column'))    return 'Campo obrigatório não preenchido.';
  if (msg.includes('value too long'))          return 'Um dos campos excede o tamanho máximo permitido.';
  if (msg.includes('invalid input syntax'))    return 'Formato de dado inválido em um dos campos.';
  return msg;
}

// Parser de CSV com suporte a campos entre aspas (a célula "Docente(s)" do
// SIGAA costuma ter vírgulas dentro, ex. "NOME (20h), OUTRO NOME (20h)" — um
// split(',') ingênuo desalinharia todas as colunas seguintes nessas linhas).
function parseCsvRows(text){
  const rows=[];
  let row=[],field='',inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQuotes){
      if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else inQuotes=false;}
      else field+=ch;
    }else if(ch==='"')inQuotes=true;
    else if(ch===','){row.push(field);field='';}
    else if(ch==='\r'){/* ignora */}
    else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
    else field+=ch;
  }
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows.filter(r=>r.some(c=>c.trim().length));
}

// .ods/.xlsx — mesma estrutura de linhas do CSV, só que como array de arrays
// já separado por célula (sem o problema de vírgula embutida). xlsx é
// importado dinamicamente: só baixa o pacote (pesado) quando alguém
// efetivamente sobe um arquivo nesse formato — quem só usa CSV nunca paga
// esse custo no carregamento inicial do app.
async function parseSheetRows(file){
  const XLSX=await import('xlsx');
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(buf,{type:'array'});
  const sheet=wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});
}

const SIGAA_DAY_DIGIT={2:'Segunda',3:'Terça',4:'Quarta',5:'Quinta',6:'Sexta',7:'Sábado'};
const SIGAA_SHIFT_BASE={M:5,T:11,N:17}; // hora(slot n) = base+n — M1=6h,T1=12h,N1=18h

// A célula "Docente(s)" do SIGAA traz "<matrícula> - <NOME> (<carga>h)" por
// professor, podendo ter mais de um separado por ", " e " e " antes do
// último (ex.: "123 - A (20h), 456 - B (20h) e 789 - C (20h)") — extrai só
// os nomes, descartando matrícula e carga horária. Sem matches reconhecidos,
// devolve a célula como veio em vez de descartar a informação.
function parseTeacherNames(raw){
  const str=(raw??'').toString().trim();
  if(!str)return'';
  const names=[...str.matchAll(/\d+\s*-\s*([^()]+?)\s*\(\d+h?\)/gi)].map(m=>m[1].trim()).filter(Boolean);
  return names.length?names.join(', '):str;
}

// "35M34 (10/03/2026 - 11/07/2026)" → ignora a faixa de datas; pode ter mais
// de um bloco separado por espaço (dias/horários diferentes na mesma turma,
// ex. "2T456 6T56" = Segunda à tarde num horário, Sexta noutro).
function parseHorarioToBlocks(raw){
  const clean=String(raw??'').replace(/\([^)]*\)/g,'').trim();
  const segs=clean.split(/\s+/).filter(Boolean);
  const blocks=[],errors=[];
  segs.forEach(seg=>{
    const m=seg.match(/^([2-7]+)([MTNmtn])([1-9]+)$/);
    if(!m){errors.push(`Formato de horário não reconhecido: "${seg}"`);return;}
    const days=[...m[1]].map(d=>SIGAA_DAY_DIGIT[d]);
    const slots=[...m[3]].map(Number);
    const base=SIGAA_SHIFT_BASE[m[2].toUpperCase()];
    blocks.push({days,sh:base+Math.min(...slots),eh:base+Math.max(...slots)+1});
  });
  return{blocks,errors};
}

// Lê as linhas (uma por disciplina/turma). `rows` é um array de arrays já
// sem a linha de título (ela é sempre a primeira e é descartada aqui).
// "Turma" em branco fica sem número de turma — a decisão de numerar (e como)
// é do usuário; o sistema nunca inventa um número a partir da ordem das
// linhas. Duas linhas do mesmo código sem Turma preenchida são tratadas como
// a mesma turma (erro de duplicata), forçando quem importou a diferenciá-las.
// Lê um relatório de oferta de turmas do SIGAA (.csv/.ods/.xlsx) — não é uma
// planilha de uma disciplina por linha, é um bloco "cabeçalho de disciplina"
// seguido de uma ou mais linhas de turma:
//   "DMA0192 - ALGEBRA LINEAR (GRADUAÇÃO)"
//   "2026.2","Turma 01","<docente>","REGULAR","A DEFINIR DOCENTE","35M34","A definir","0/60 alunos"
// Colunas da linha de turma, na ordem: Ano Período, Turma, Docente(s), Tipo,
// Situação, Horário, Local, Mat./Cap. — só Turma, Docente(s), Horário e
// Mat./Cap. viram dado de verdade; Ano Período (o período já é escolhido na
// tela, antes de abrir o import — não é lido do arquivo), Tipo, Situação e
// Local são ignorados (a situação não filtra nada: turmas ainda com "A
// DEFINIR DOCENTE" — o normal bem no início do período, antes de professor
// ser designado — precisam entrar no sistema do mesmo jeito, pra já dar pra
// planejar a sala com antecedência).
function groupSigaaRows(rows){
  const out=[];
  let current=null;
  rows.slice(1).forEach(row=>{
    const col1=(row[1]??'').toString().trim();
    if(!col1){
      const text=(row[0]??'').toString().trim();
      if(!text)return; // linha em branco entre blocos
      const m=text.match(/^(.+?)\s-\s(.+?)\s\(([^)]*)\)\s*$/);
      current=m?{code:m[1].trim(),name:m[2].trim()}:{code:text,name:text,headerError:`Cabeçalho de disciplina não reconhecido: "${text}"`};
      return;
    }
    const errors={};
    if(!current)errors.codigo='Linha de turma sem cabeçalho de disciplina associado';
    else if(current.headerError)errors.codigo=current.headerError;
    const secMatch=col1.match(/Turma\s+(\d+)/i);
    if(!secMatch)errors.secao=`Não foi possível identificar a seção em "${col1}"`;
    const teacher=parseTeacherNames(row[2]);
    const{blocks,errors:horarioErrors}=parseHorarioToBlocks(row[5]);
    if(horarioErrors.length)errors.horario=horarioErrors.join('; ');
    else if(blocks.length===0)errors.horario='Horário vazio ou não reconhecido';
    const matMatch=(row[7]??'').toString().match(/(\d+)/);
    const enroll=matMatch?Number(matMatch[1]):NaN;
    if(!Number.isInteger(enroll)||enroll<0)errors.matriculados=`Matrícula não reconhecida em "${row[7]}"`;
    out.push({
      raw:{codigo:current?.code,nome:current?.name,turma:col1,docente:row[2],horario:row[5],matriculados:row[7]},
      normalized:{code:current?.code,name:current?.name,sec:secMatch?Number(secMatch[1]):null,teacher,blocks,enroll},
      errors,
    });
  });
  return out;
}

// ─── Algoritmo de alocação automática ────────────────────────────────────────
function autoAllocate(unplacedCourses, rooms, existingAlloc) {
  const sorted=[...unplacedCourses].sort((a,b)=>{
    if(b.enroll!==a.enroll)return b.enroll-a.enroll;
    return totalWeeklyHours(b)-totalWeeklyHours(a);
  });
  const tempAlloc={};
  Object.entries(existingAlloc).forEach(([k,arr])=>{tempAlloc[k]=[...arr];});
  const assignments=[],failed=[];
  for(const course of sorted){
    const candidates=rooms.filter(r=>r.cap>=course.enroll&&roomFree(r.id,course,tempAlloc));
    if(candidates.length===0){
      const bestCap=rooms.reduce((m,r)=>Math.max(m,r.cap),0);
      const reason=bestCap<course.enroll
        ?`Nenhuma sala tem capacidade suficiente (necessário ${course.enroll}, máximo disponível ${bestCap})`
        :'Todas as salas compatíveis estão ocupadas neste horário';
      failed.push({course,reason});
      continue;
    }
    const best=candidates.reduce((prev,curr)=>{
      const s=r=>(r.roleId===course.roleId?10000:0)-(r.cap-course.enroll);
      return s(curr)>s(prev)?curr:prev;
    });
    assignments.push({course,room:best});
    course.blocks.forEach(block=>{
      block.days.forEach(day=>{
        for(let h=block.sh;h<block.eh;h++){
          const k=`${best.id}|${day}|${h}`;
          if(!tempAlloc[k])tempAlloc[k]=[];
          tempAlloc[k].push(course);
        }
      });
    });
  }
  return{assignments,failed};
}

// ─── Raiz ─────────────────────────────────────────────────────────────────────
export default function App(){
  const[theme,setTheme]=useState('light');
  const T=theme==='light'?LIGHT:DARK;
  return(
    <ThemeCtx.Provider value={{T,theme,toggleTheme:()=>setTheme(t=>t==='light'?'dark':'light')}}>
      <AuthProvider><AppRouter/></AuthProvider>
    </ThemeCtx.Provider>
  );
}
function AppRouter(){
  const{currentUser,isLoading}=useAuth();
  const{T}=useT();
  if(isLoading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:12,color:T.dim}}>Carregando…</div>;
  if(!currentUser)return<LoginPage/>;
  return<Dashboard/>;
}

// ─── Painel principal ─────────────────────────────────────────────────────────
function Dashboard(){
  const{currentUser,logout,can}=useAuth();
  const{T,theme,toggleTheme}=useT();

  const isInstitutional=isInstitutionalRole(currentUser.role);

  // null até o primeiro fetch resolver (institucional cai no primeiro role de
  // coordenação disponível — ver useEffect abaixo; uma função de coordenação
  // já sabe a sua própria roleId de cara, currentUser.roleId).
  const[activeRoleId,setActiveRoleId]=useState(isInstitutional?null:currentUser.roleId);
  const[subUnits,setSubUnits]        =useState([]);
  const[roles,setRoles]              =useState([]);
  const[blocks,setBlocks]            =useState([]);
  const[rooms,setRooms]              =useState([]);
  const[courses,setCourses]          =useState([]);
  const[coordinationStatuses,setCoordinationStatuses]=useState({});
  const[notifications,setNotifs]     =useState([]);
  const[featureOptions,setFeatureOptions]=useState([]);
  // Períodos persistidos (tabela periods) — existem por conta própria, sem
  // depender de ter alguma disciplina cadastrada. Ver allPeriods abaixo.
  const[periods,setPeriods]          =useState([]);
  // Período marcado manualmente como "atual" para todo mundo (app_settings,
  // banco compartilhado) — null = comportamento automático. Não confundir
  // com `periodOverride` abaixo, que é só "qual período estou vendo agora"
  // (local, por navegador).
  const[currentPeriodOverride,setCurrentPeriodOverride]=useState(null);
  const[dataLoading,setDataLoading]  =useState(true);
  const[loadError,setLoadError]      =useState(null);

  useEffect(()=>{
    if(!supabaseConfigured){
      setLoadError('Supabase não configurado — defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example).');
      setDataLoading(false);
      return;
    }
    let active=true;
    db.fetchAll()
      .then(data=>{
        if(!active)return;
        setSubUnits(data.subUnits);setRoles(data.roles);setBlocks(data.blocks);
        setRooms(data.rooms);setCourses(data.courses);
        setCoordinationStatuses(data.coordinationStatuses);
        setNotifs(data.notifications);setFeatureOptions(data.featureOptions);
        setCurrentPeriodOverride(data.currentPeriodOverride);
        setPeriods(data.periods);
        if(isInstitutional){
          setActiveRoleId(prev=>prev??data.roles.find(r=>r.subUnitId)?.id??data.roles[0]?.id??null);
        }
      })
      .catch(e=>{if(active)setLoadError(e.message);})
      .finally(()=>{if(active)setDataLoading(false);});
    return()=>{active=false;};
  },[]);

  useRealtimeSync({setSubUnits,setRoles,setBlocks,setRooms,setCourses,setCoordinationStatuses,setNotifs,setFeatureOptions,setCurrentPeriodOverride,setPeriods});

  const gRole=useMemo(()=>makeGRole(roles,subUnits),[roles,subUnits]);
  const gBlockLabel=useMemo(()=>makeGBlockLabel(blocks),[blocks]);

  const[screen,         setScreen]         =useState('select'); // 'select' | 'allocate' | 'map'
  const[selId,          setSelId]          =useState(null);
  const[day,            setDay]            =useState('Segunda');
  const[viewMode,       setViewMode]       =useState('list');
  const[search,         setSearch]         =useState('');
  const[finishConfirm,  setFinishConfirm]  =useState(false);
  const[editingCourse,  setEditingCourse]  =useState(null);
  const[creatingCourse, setCreatingCourse] =useState(false);
  const[importingCourses,setImportingCourses]=useState(false);
  const[featuresModal,  setFeaturesModal]  =useState(null);
  const[autoAllocResult,setAutoAllocResult]=useState(null);
  const[autoAllocConfirm,setAutoAllocConfirm]=useState(false);
  const[autoAllocAskScope,setAutoAllocAskScope]=useState(false);
  const[deptPanel,      setDeptPanel]      =useState(false);
  const[notifPanel,     setNotifPanel]     =useState(false);
  const[mergeModal,     setMergeModal]     =useState(null);
  const[dayPickerModal, setDayPickerModal] =useState(null);
  const[showUsers,      setShowUsers]      =useState(false);
  const[toast,          setToast]          =useState(null);
  // null = "segue o período mais recente" (currentPeriod) — assim, quando um
  // período novo é criado (ou os dados terminam de carregar), o usuário cai
  // nele automaticamente em vez de ficar presa num valor calculado cedo
  // demais (antes dos cursos carregarem). Selecionar manualmente um período
  // existente no dropdown grava aqui; "Voltar ao período atual" limpa pra null.
  const[periodOverride,setPeriodOverride]  =useState(null);
  // Desbloqueio institucional de período passado — deliberado e reversível,
  // nunca persiste sozinho: reseta pra false sempre que selectedPeriod muda
  // (ver useEffect abaixo), então toda entrada em modo "editar histórico"
  // exige uma ação fresca, não é um estado que sobrevive escondido.
  const[pastEditUnlocked,setPastEditUnlocked]=useState(false);

  // Erros ('err') e avisos ('warn' — ex.: "sala ocupada em algum dia",
  // "horário alterado, realoque") costumam ser mais importantes de realmente
  // ler do que uma confirmação de sucesso — por isso ficam visíveis bem mais
  // tempo (8s) do que um 'ok' (4s), que é só a confirmação rápida do que o
  // usuário acabou de fazer. toastTimer guarda o timeout pendente pra poder
  // cancelá-lo: sem isso, um toast antigo (ex. um 'ok' de 4s) podia apagar um
  // toast novo e mais importante (ex. um 'err' de 8s) que apareceu logo em
  // seguida, antes do tempo dele terminar.
  const toastTimer=useRef(null);
  const showToast=(msg,type='ok')=>{
    clearTimeout(toastTimer.current);
    setToast({msg,type});
    toastTimer.current=setTimeout(()=>setToast(null),type==='ok'?4000:8000);
  };

  // "Atual" = sempre o maior valor (comparação numérica ano.período) entre
  // os períodos conhecidos (persistidos na tabela periods OU já referenciados
  // por alguma disciplina — a união cobre dados legados cujo período ainda
  // não tenha uma linha própria em periods) — só ele é editável.
  const allPeriods=useMemo(()=>{
    const s=new Set([...periods,...courses.map(c=>c.period)]);
    return[...s].sort(comparePeriods);
  },[periods,courses]);
  // currentPeriodOverride (app_settings, compartilhado) tem prioridade sobre
  // o cálculo automático (maior período) quando a Diretoria fixa um período
  // manualmente na aba Períodos de Gerenciamento.
  const currentPeriod=currentPeriodOverride??(allPeriods[allPeriods.length-1]??DEFAULT_PERIOD);
  const selectedPeriod=periodOverride??currentPeriod;
  const isPastPeriod=selectedPeriod!==currentPeriod;
  // Se o período selecionado localmente for excluído (na aba Períodos de
  // Gerenciamento, por outro usuário ou nesta mesma sessão), ele some de
  // allPeriods — sem isso a seleção ficaria presa numa referência morta.
  useEffect(()=>{if(periodOverride&&!allPeriods.includes(periodOverride))setPeriodOverride(null);},[allPeriods]);
  // Instituição pode destravar um período passado pra corrigir alocação
  // histórica — não-institucional nunca pode, então periodLocked===isPastPeriod
  // pra eles, preservando o travamento absoluto que já existia.
  const periodLocked=isPastPeriod&&!(isInstitutional&&pastEditUnlocked);
  useEffect(()=>{setPastEditUnlocked(false);},[selectedPeriod]);
  const periodCourses=useMemo(()=>courses.filter(c=>c.period===selectedPeriod),[courses,selectedPeriod]);

  const d         =gRole(activeRoleId);
  const alloc     =useMemo(()=>buildAlloc(periodCourses),[periodCourses]);
  const sel       =useMemo(()=>selId?periodCourses.find(c=>c.id===selId):null,[selId,periodCourses]);
  const ROOMS     =rooms;
  const myStatus  =!isInstitutional?(coordinationStatuses[currentUser.roleId]??DS.ACTIVE):null;
  const isLocked  =!isInstitutional&&myStatus!==DS.ACTIVE;
  const unreadCount=notifications.filter(n=>!n.read).length;

  const visRooms=useMemo(()=>
    isInstitutional
      ?[...ROOMS.filter(r=>r.roleId===activeRoleId),...ROOMS.filter(r=>r.roleId!==activeRoleId)]
      :ROOMS.filter(r=>r.roleId===currentUser.roleId)
  ,[ROOMS,activeRoleId,isInstitutional,currentUser.roleId]);

  // Lista única — sem aba Pendentes/Alocadas. Pendentes (e parciais) vêm
  // primeiro, já alocadas (100%) depois e esmaecidas no CourseCard — sort é
  // estável, então só reagrupa, não embaralha a ordem dentro de cada grupo.
  // Visão institucional: o seletor de função no topo decide o que aparece
  // aqui — uma função específica mostra só as disciplinas dela, "Todas"
  // mostra de qualquer função (com o rótulo de dona em cada uma).
  const visibleSidebarCourses=useMemo(()=>{
    const base=!isInstitutional
      ?periodCourses.filter(c=>c.roleId===currentUser.roleId)
      :activeRoleId===ALL_ROLES?periodCourses:periodCourses.filter(c=>c.roleId===activeRoleId);
    const filtered=search.trim()
      ?base.filter(c=>{const q=search.toLowerCase();return c.name.toLowerCase().includes(q)||c.code.toLowerCase().includes(q);})
      :base;
    return[...filtered].sort((a,b)=>Number(isFullyAllocated(a))-Number(isFullyAllocated(b)));
  },[periodCourses,isInstitutional,currentUser.roleId,activeRoleId,search]);
  const pendingCount=useMemo(()=>visibleSidebarCourses.filter(c=>!isFullyAllocated(c)).length,[visibleSidebarCourses]);
  const allocatedCount=visibleSidebarCourses.length-pendingCount;

  // Alvo do "Alocar Automaticamente": só disciplinas com ZERO dias alocados.
  // O algoritmo (autoAllocate) só sabe propor uma sala única pra semana toda
  // — rodar nele uma disciplina parcial sobrescreveria silenciosamente os
  // dias que o usuário já tinha colocado manualmente em salas diferentes.
  // "All" = universo total pra quem clica (todas as funções pra
  // institucional vendo "Todas", só a própria função pra coordenação) — é o
  // que sempre alimentou o botão/contador. "Mine" só faz sentido pra
  // institucional com uma função específica selecionada no topo (não
  // "Todas"): dá pra escolher rodar só nela em vez de em todas de uma vez —
  // ver autoAllocAskScope/handleAutoAllocateClick abaixo.
  const autoAllocInputAll=useMemo(()=>{
    const base=!isInstitutional?periodCourses.filter(c=>c.roleId===currentUser.roleId):periodCourses;
    return base.filter(c=>!hasAnyAllocation(c));
  },[periodCourses,isInstitutional,currentUser.roleId]);
  const autoAllocInputMine=useMemo(()=>{
    if(activeRoleId===ALL_ROLES)return autoAllocInputAll;
    return periodCourses.filter(c=>c.roleId===activeRoleId&&!hasAnyAllocation(c));
  },[periodCourses,activeRoleId,autoAllocInputAll]);
  const autoAllocInput=autoAllocInputAll;

  const stats=useMemo(()=>{
    const viewingAll=activeRoleId===ALL_ROLES;
    const mine=viewingAll?periodCourses:periodCourses.filter(c=>c.roleId===activeRoleId);
    const done=mine.filter(isFullyAllocated);
    // "Outra Função" não tem sentido olhando "Todas" de uma vez — não há um
    // único "próprio" pra comparar contra.
    const cross=viewingAll?0:mine.filter(c=>Object.values(c.roomByDay||{}).some(rid=>{
      const room=ROOMS.find(r=>r.id===rid);return room&&room.roleId&&room.roleId!==activeRoleId;
    })).length;
    return{total:mine.length,done:done.length,pend:mine.length-done.length,cross};
  },[periodCourses,activeRoleId,ROOMS]);

  // Período passado é somente leitura por padrão — instituição pode
  // destravar via periodLocked (ver acima); não-institucional nunca pode.
  const canAllocate   =!periodLocked&&(isInstitutional||!isLocked);
  const canDealloc    =!periodLocked&&(isInstitutional||!isLocked);
  const canMerge      =canAllocate&&can(PERMS.MERGE_GROUPS);
  const canEditFeatures=can(PERMS.MANAGE_ROOMS);
  const canEditCourse =canAllocate;
  const canManageCatalog=canAllocate;
  const targetRoleId  =isInstitutional?activeRoleId:currentUser.roleId;
  // Salas (ListView) é uma ferramenta de ação — clicar aloca. Sem ação
  // possível num período passado, ela não tem valor como leitura (ao
  // contrário da Grade, que serve bem só pra consultar onde algo ficou).
  // Força Horários sem precisar de efeito: a UI renderiza por este valor,
  // não pelo `viewMode` bruto, então não há "vazamento" de um clique antigo.
  const effectiveViewMode=periodLocked?'grid':viewMode;

  // Clique vindo da Grade — sempre um dia específico (a aba ativa). Mesclar
  // exige saber qual bloco/horário está em conflito pra mostrar no modal, daí
  // só fazer sentido aqui (dia único), não no fluxo "todos os dias" da Salas.
  const tryAllocate=(rid,day)=>{
    if(!canAllocate||!sel)return;
    if(roomFree(rid,sel,alloc,day))forceAllocate(rid,day);
    else if(canMerge)setMergeModal({roomId:rid,day});
  };
  // Clique vindo da vista em Salas — sem aba de dia, então primeiro confirma
  // se a sala está livre pra disciplina inteira (se não, não há um único dia
  // óbvio pra mesclar; manda usar a Grade). Se estiver livre e a disciplina
  // ocorrer em mais de um dia, pergunta quais dias alocar nesta sala em vez
  // de assumir "todos" de cara — DayPickerModal faz essa pergunta.
  const trySalasAllocate=rid=>{
    if(!canAllocate||!sel)return;
    if(!roomFree(rid,sel,alloc)){
      showToast('Sala ocupada em algum dia da semana — use a vista "Horários" para ver dia a dia e mesclar se necessário.','warn');
      return;
    }
    if(courseDays(sel).length<=1)forceAllocate(rid,null);
    else setDayPickerModal({roomId:rid});
  };
  // `days` aceita: undefined/null → todos os dias da disciplina (vista em
  // Salas, "todos os dias"); uma string → um único dia (clique na Grade);
  // um array → o subconjunto escolhido no DayPickerModal (vista em Salas,
  // "dias específicos").
  const forceAllocate=async(rid,days)=>{
    if(!sel)return;
    const course=sel,room=ROOMS.find(r=>r.id===rid);
    const targetDays=days==null?courseDays(course):Array.isArray(days)?days:[days];
    const nextRoomByDay={...course.roomByDay};
    targetDays.forEach(d=>{nextRoomByDay[d]=rid;});
    setMergeModal(null);setDayPickerModal(null);
    // Mantém a disciplina selecionada se ainda faltar alocar outro dia dela
    // (fluxo da Grade: aloca Segunda, troca a aba pra Quarta, aloca de novo
    // sem precisar reselecionar) — só desmarca quando ficar 100% alocada.
    const stillSelected=courseDays(course).some(d=>!nextRoomByDay[d]);
    setSelId(stillSelected?course.id:null);
    if(isInstitutional)setActiveRoleId(course.roleId);
    const daysLabel=days==null?'todos os dias':targetDays.join(', ');
    try{
      await db.setCourseRoomByDay(course.id,nextRoomByDay);
      showToast(`${course.code} alocada em ${room?.label??rid} (${daysLabel}).`,'ok');
    }catch(e){
      showToast(`Falha ao alocar: ${ptError(e)}`,'err');
    }
  };
  // `day` presente = remove só a sala daquele dia (clique no chip da Grade);
  // ausente = remove a alocação inteira (botão "remover" da barra lateral).
  const deallocate=async(cid,day)=>{
    if(!canDealloc)return;
    const course=courses.find(c=>c.id===cid);
    if(!course)return;
    const oldRoomByDay=course.roomByDay||{};
    const roomLabel=day
      ?ROOMS.find(r=>r.id===oldRoomByDay[day])?.label
      :fmtRoomByDay(course,ROOMS);
    const nextRoomByDay=day
      ?Object.fromEntries(Object.entries(oldRoomByDay).filter(([d])=>d!==day))
      :{};
    try{
      await db.setCourseRoomByDay(cid,nextRoomByDay);
      showToast(`${course.code} desalocada${day?` (${day})`:''}${roomLabel?` (estava em ${roomLabel})`:''}.`,'warn');
    }catch(e){
      showToast(`Falha ao desalocar: ${ptError(e)}`,'err');
    }
  };
  const saveFeatures=async(rid,feats,desc)=>{
    if(!canEditFeatures)return;
    setFeaturesModal(null);
    try{
      await db.saveRoomFeatures(rid,feats,desc);
    }catch(e){
      showToast(`Falha ao salvar sala: ${ptError(e)}`,'err');
    }
  };
  const addFeatureOption=async name=>{
    if(!canEditFeatures||!name.trim()||featureOptions.includes(name.trim()))return;
    try{
      await db.addFeatureOption(name.trim());
    }catch(e){
      showToast(`Falha ao criar recurso: ${ptError(e)}`,'err');
    }
  };
  const removeFeatureOption=async name=>{
    if(!canEditFeatures)return;
    try{
      await db.removeFeatureOption(name);
    }catch(e){
      showToast(`Falha ao remover recurso: ${ptError(e)}`,'err');
    }
  };
  const selectCourse=c=>{
    if(!canAllocate)return;
    if(selId===c.id){setSelId(null);return;}
    setSelId(c.id);
    if(isInstitutional)setActiveRoleId(c.roleId);
  };
  const handleEditCourse=async(courseId,changes)=>{
    setEditingCourse(null);
    if(!canEditCourse)return;
    const original=courses.find(c=>c.id===courseId);
    if(!original)return;
    const updated={...original,...changes};
    let finalRoomByDay=original.roomByDay||{};
    // TODO (production): conflict check reads from local realtime-synced state,
    // not a fresh DB read — acceptable race window for this prototype's scale.
    if(changes.blocks!==undefined){
      const newDays=new Set(courseDays(updated));
      // Conflito só importa dentro do mesmo período — outro período não
      // disputa sala com este (eles nem coexistem na grade ao mesmo tempo).
      const others=courses.filter(c=>c.id!==courseId&&c.period===original.period);
      const othersAlloc=buildAlloc(others);
      const next={};let droppedAny=false;
      Object.entries(finalRoomByDay).forEach(([day,rid])=>{
        // o dia some do novo horário, ou a sala que já tinha deixou de estar
        // livre nele (mudou o horário pra um que colide com outra disciplina)
        if(newDays.has(day)&&roomFree(rid,updated,othersAlloc,day))next[day]=rid;
        else droppedAny=true;
      });
      finalRoomByDay=next;
      if(droppedAny)showToast('Horário alterado — sala removida em algum dia. Por favor, realoque.','warn');
    }
    try{
      await db.editCourse(courseId,{...changes,roomByDay:finalRoomByDay});
    }catch(e){
      showToast(`Falha ao salvar disciplina: ${ptError(e)}`,'err');
    }
  };
  const handleCreateCourse=async course=>{
    setCreatingCourse(false);
    if(!canManageCatalog)return;
    try{
      await db.createCourse(course);
      showToast(`${course.code} criada.`,'ok');
    }catch(e){
      showToast(`Falha ao criar disciplina: ${ptError(e)}`,'err');
    }
  };
  const handleDeleteCourse=async course=>{
    if(!canManageCatalog)return;
    try{
      await db.deleteCourse(course.id);
      if(selId===course.id)setSel(null);
      showToast(`${course.code} excluída.`,'ok');
    }catch(e){
      showToast(`Falha ao excluir disciplina: ${ptError(e)}`,'err');
    }
  };
  const handleImportCourses=async newCourses=>{
    setImportingCourses(false);
    if(!canManageCatalog)return;
    try{
      await db.replaceRoleCourses(targetRoleId,selectedPeriod,newCourses);
      showToast(`${newCourses.length} disciplina${newCourses.length!==1?'s':''} importada${newCourses.length!==1?'s':''} para ${gRole(targetRoleId)?.full} (${selectedPeriod}).`,'ok');
    }catch(e){
      showToast(`Falha ao importar disciplinas: ${ptError(e)}`,'err');
    }
  };

  // Período agora é uma entidade persistida por conta própria (tabela
  // periods, ver supabase/schema.sql) — não depende mais de ter alguma
  // disciplina cadastrada nele pra "existir" de fato, nem desaparece se a
  // última disciplina for removida. A criação em si (validação de
  // formato/recência + INSERT em periods) acontece na aba "Períodos" de
  // Gerenciamento (db.createPeriod, via mgmt.createPeriod); isto só
  // completa a transição de volta pra esta tela: seleciona o período
  // recém-criado e foca em Alocar Disciplinas (mesmo comportamento de
  // navegação de antes). Só o Diretor decide quando um novo período letivo
  // começa.
  const handlePeriodCreatedFromManagement=trimmed=>{
    setPeriodOverride(trimmed);
    setSelId(null);
    setScreen('allocate');
    showToast(`Período ${trimmed} criado e selecionado.`,'ok');
  };

  const runAutoAllocate=courseList=>{
    if(courseList.length===0){showToast('Não há disciplinas para alocar.','warn');return;}
    setAutoAllocResult(autoAllocate(courseList,visRooms,alloc));
  };
  // Sempre mostra o aviso primeiro — o algoritmo (autoAllocate) só olha
  // capacidade e disponibilidade de horário, nunca tipo/recursos da sala,
  // então disciplinas que precisam de uma sala específica (ex.: laboratório)
  // podem acabar numa sala comum se não forem alocadas manualmente antes.
  const handleAutoAllocate=()=>{
    if(!canManageCatalog)return;
    setAutoAllocConfirm(true);
  };
  // Institucional com uma função específica selecionada no topo (não
  // "Todas") pode escolher entre alocar automaticamente só as disciplinas
  // dessa função ou de todas de uma vez — passo extra só faz sentido aqui;
  // com "Todas" selecionada (ou pra coordenação, que só tem a própria função
  // de qualquer forma) não há ambiguidade de escopo, roda direto como antes.
  const confirmAutoAllocateWarning=()=>{
    setAutoAllocConfirm(false);
    if(isInstitutional&&activeRoleId!==ALL_ROLES){setAutoAllocAskScope(true);return;}
    runAutoAllocate(autoAllocInputAll);
  };
  const handleAutoAllocateScope=scope=>{
    setAutoAllocAskScope(false);
    runAutoAllocate(scope==='mine'?autoAllocInputMine:autoAllocInputAll);
  };
  const handleApplyAllocation=async()=>{
    if(!autoAllocResult||!canManageCatalog)return;
    const{assignments}=autoAllocResult;
    setAutoAllocResult(null);setSelId(null);
    try{
      await db.applyAllocations(assignments);
      showToast(`✨ ${assignments.length} disciplina${assignments.length!==1?'s':''} alocada${assignments.length!==1?'s':''} automaticamente.`,'ok');
    }catch(e){
      showToast(`Falha ao aplicar alocação automática: ${ptError(e)}`,'err');
    }
  };

  const handleFinish=async()=>{
    if(isPastPeriod)return;
    setSelId(null);setFinishConfirm(false);
    try{
      await db.finishCoordination();
      showToast('Alocação enviada. O diretor foi notificado.','ok');
    }catch(e){
      showToast(`Falha ao enviar alocação: ${ptError(e)}`,'err');
    }
  };
  const handleReopen=async roleId=>{
    try{await db.setCoordinationStatus(roleId,DS.ACTIVE);showToast(`${gRole(roleId)?.full} reaberto.`,'ok');}
    catch(e){showToast(`Falha: ${ptError(e)}`,'err');}
  };
  const handleForceFinish=async roleId=>{
    try{await db.setCoordinationStatus(roleId,DS.FORCE_FINISHED);showToast(`${gRole(roleId)?.full} bloqueado.`,'ok');}
    catch(e){showToast(`Falha: ${ptError(e)}`,'err');}
  };
  const markNotifsRead=()=>{db.markAllNotificationsRead().catch(()=>{});};

  const mergeRoom  =mergeModal?ROOMS.find(r=>r.id===mergeModal.roomId):null;
  const mergeCons  =(mergeModal&&sel)?getConflicts(mergeModal.roomId,sel,alloc,courses,mergeModal.day):[];
  const mergeTotal =sel?mergeCons.reduce((s,c)=>s+c.enroll,0)+sel.enroll:0;
  const dClr       =dtc(d,theme);
  const selBannerBg=dbg(d,theme);
  const mono       ={fontFamily:"'DM Mono',monospace"};

  if(dataLoading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:12,color:T.dim}}>Carregando dados…</div>;
  if(loadError)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:12,color:'#ef4444',padding:20,textAlign:'center'}}>Erro ao carregar dados: {loadError}</div>;
  if(screen==='select')return<ScreenSelector onPick={setScreen} subUnits={subUnits}/>;
  if(screen==='profile')return<ProfileScreen onBack={()=>setScreen('select')} subUnits={subUnits}/>;
  if(screen==='map')return<RoomMapScreen rooms={ROOMS} courses={courses} roles={roles} subUnits={subUnits} blocks={blocks} periods={periods} currentPeriodOverride={currentPeriodOverride} onBack={()=>setScreen('select')} onProfile={()=>setScreen('profile')}/>;
  if(screen==='campus')return<CampusMapScreen blocks={blocks} rooms={ROOMS} onBack={()=>setScreen('select')}/>;
  if(screen==='manage')return<ManagementScreen onBack={()=>setScreen('select')} onProfile={()=>setScreen('profile')}
    courses={courses} onPeriodCreated={handlePeriodCreatedFromManagement}
    currentPeriodOverride={currentPeriodOverride}/>;

  return(
    <RolesCtx.Provider value={{roles,subUnits,blocks,gRole,gBlockLabel}}>
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button,select,input,textarea{font-family:inherit;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:${T.scrollTrack};}
        ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px;}
        .cc:hover{background:${T.hover}!important;}
        .cc.sel{background:${selBannerBg}!important;border-color:${d.clr}!important;}
        .cc.locked{opacity:.5;cursor:default!important;}
        .cc.done:not(.sel){opacity:.5;}
        .gridcell-hl:hover{background:${d.clr}44!important;}
        .gridcell-merge:hover{background:#F59E0B33!important;}
        .chip-own:hover{filter:brightness(${theme==='light'?'.92':'1.15'});}
        .room-card:hover .feat-btn{opacity:1!important;}
        .viewbtn:hover{background:${T.faint}!important;}
        .viewbtn.active{background:${selBannerBg}!important;border-color:${d.clr}!important;color:${dClr}!important;}
        .icon-btn:hover{background:${T.inner}!important;border-color:${T.muted}!important;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
        @keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}
      `}</style>

      {/* Cabeçalho */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',background:T.surface,borderBottom:`1px solid ${T.bdr}`,flexShrink:0,boxShadow:T.shadowSm}}>
        <button className="icon-btn" onClick={()=>setScreen('select')} title="Voltar ao menu"
          style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>☰</button>
        {isInstitutional?(
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <select value={activeRoleId??''} onChange={e=>{setActiveRoleId(e.target.value);setSelId(null);}}
              title="Função em exibição — filtra as disciplinas da barra lateral"
              style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:6,color:dClr,fontSize:13,fontWeight:600,outline:'none',cursor:'pointer'}}>
              <option value={ALL_ROLES}>Todas</option>
              {subUnits.map(su=>(
                <optgroup key={su.id} label={su.fullName}>
                  {roles.filter(r=>r.subUnitId===su.id).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                </optgroup>
              ))}
            </select>
            {/* Fica FORA da caixa do <select> — dentro dela mostraria só o
                texto puro da <option> selecionada, sem estilo, e o pedido
                era não mexer no conteúdo da caixa em si. */}
            {d.subUnitFull!==d.full&&<span style={{...mono,fontSize:10,color:T.dim}}>· {d.subUnitFull}</span>}
          </div>
        ):(
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:d.clr,boxShadow:`0 0 8px ${d.clr}99`}}/>
            <span style={{fontSize:13,fontWeight:600,color:dClr}}>{d.full}</span>
            {d.subUnitFull!==d.full&&<span style={{...mono,fontSize:10,color:T.dim}}>· {d.subUnitFull}</span>}
          </div>
        )}
        <div style={{width:1,height:20,background:T.bdr2}}/>
        <select value={selectedPeriod} onChange={e=>{setPeriodOverride(e.target.value===currentPeriod?null:e.target.value);setSelId(null);}}
          title="Período letivo em exibição" style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:6,color:isPastPeriod?T.muted:dClr,fontSize:12,fontWeight:600,outline:'none',cursor:'pointer'}}>
          {allPeriods.map(p=><option key={p} value={p}>{p}{p===currentPeriod?' (atual)':' — somente leitura'}</option>)}
        </select>
        {isPastPeriod&&(isInstitutional?(
          <button onClick={()=>{if(pastEditUnlocked)setSelId(null);setPastEditUnlocked(v=>!v);}}
            title={pastEditUnlocked?'Clique para bloquear novamente':'Clique para habilitar edição deste período passado'}
            style={{...mono,fontSize:9,fontWeight:700,cursor:'pointer',borderRadius:4,padding:'3px 7px',whiteSpace:'nowrap',
              color:pastEditUnlocked?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#b45309':'#FBBF24'),
              background:pastEditUnlocked?(theme==='light'?'#fef2f2':'#2a0a0a'):(theme==='light'?'#fffbeb':'#1a1400'),
              border:`1px solid ${pastEditUnlocked?(theme==='light'?'#fca5a5':'#ef444444'):(theme==='light'?'#fcd34d':'#F59E0B44')}`}}>
            {pastEditUnlocked?'🔓 EDIÇÃO HABILITADA (PERÍODO PASSADO)':'🔒 PERÍODO PASSADO — SOMENTE LEITURA'}
          </button>
        ):(
          <span style={{...mono,fontSize:9,color:theme==='light'?'#b45309':'#FBBF24',background:theme==='light'?'#fffbeb':'#1a1400',border:`1px solid ${theme==='light'?'#fcd34d':'#F59E0B44'}`,borderRadius:4,padding:'3px 7px',whiteSpace:'nowrap'}}>🔒 PERÍODO PASSADO — SOMENTE LEITURA</span>
        ))}
        <div style={{flex:1}}/>
        {[['Total',stats.total,T.muted],['Alocadas',stats.done,theme==='light'?'#059669':'#34D399'],['Pendentes',stats.pend,theme==='light'?'#b45309':'#FBBF24'],['Outra Função',stats.cross,theme==='light'?'#5b21b6':'#A78BFA']].map(([l,v,c])=>(
          <div key={l} style={{textAlign:'center',padding:'0 12px',borderLeft:`1px solid ${T.bdr}`}}>
            <div style={{fontSize:18,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
            <div style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginTop:2}}>{l}</div>
          </div>
        ))}
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:isInstitutional?(theme==='light'?'#5b21b6':'#A78BFA'):dClr}}/>
          <span style={{...mono,fontSize:10,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{currentUser.role.name}</span>
          {(()=>{const su=subUnits.find(s=>s.id===currentUser.role?.subUnitId);return su&&<span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{su.name}</span>;})()}
        </div>
        {isInstitutional&&(
          <>
            <button className="icon-btn" onClick={()=>{setDeptPanel(true);setNotifPanel(false);}} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Coordenações</button>
            <button className="icon-btn" onClick={()=>{setNotifPanel(v=>!v);markNotifsRead();}} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:unreadCount>0?(theme==='light'?'#b45309':'#FBBF24'):T.muted,fontSize:11,cursor:'pointer'}}>
              🔔{unreadCount>0&&<span style={{marginLeft:4,background:'#ef4444',color:'#fff',borderRadius:10,padding:'0 5px',fontSize:9}}>{unreadCount}</span>}
            </button>
            <button className="icon-btn" onClick={()=>setShowUsers(true)} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>👥 Usuários</button>
          </>
        )}
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={()=>setScreen('profile')} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>👤 Perfil</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Sair</button>
      </div>

      {/* Corpo */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* Barra lateral */}
        <aside style={{width:274,borderRight:`1px solid ${T.bdr}`,display:'flex',flexDirection:'column',overflow:'hidden',background:theme==='light'?T.surface:T.card}}>
          <div style={{padding:'10px 12px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Buscar disciplinas…" disabled={isLocked}
              style={{width:'100%',padding:'5px 9px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:12,outline:'none',opacity:isLocked?.6:1}}/>
            <div style={{fontSize:11,color:T.muted,marginTop:5}}>
              {pendingCount} pendente{pendingCount!==1?'s':''} · {allocatedCount} alocada{allocatedCount!==1?'s':''}
            </div>
          </div>

          {isLocked&&(
            <div style={{padding:'10px 14px',background:myStatus===DS.FORCE_FINISHED?(theme==='light'?'#fef2f2':'#1a0505'):(theme==='light'?'#f0fdf4':'#0a2a0a'),borderBottom:`1px solid ${myStatus===DS.FORCE_FINISHED?'#ef444433':'#34d39933'}`,flexShrink:0}}>
              <div style={{fontSize:12,fontWeight:600,color:myStatus===DS.FORCE_FINISHED?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#15803d':'#34d399'),marginBottom:2}}>
                {myStatus===DS.FORCE_FINISHED?'🔒 Bloqueado pelo Diretor':'✓ Envio Concluído'}
              </div>
              <div style={{fontSize:11,color:T.muted,lineHeight:1.4}}>
                {myStatus===DS.FORCE_FINISHED?'Sua alocação foi bloqueada pelo diretor institucional.':'Você enviou suas alocações.'}
              </div>
            </div>
          )}

          <div style={{flex:1,overflowY:'auto',padding:'5px'}}>
            {visibleSidebarCourses.length===0?(
              <div style={{textAlign:'center',padding:32,color:T.dim}}>
                <div style={{fontSize:25,marginBottom:8}}>{search?'∅':'—'}</div>
                <div style={{fontSize:13}}>{search?'Nenhum resultado':'Nenhuma disciplina cadastrada ainda'}</div>
              </div>
            ):visibleSidebarCourses.map(c=>(
              <CourseCard key={c.id} course={c} activeRole={gRole(activeRoleId)} showRoleBadge={isInstitutional&&activeRoleId===ALL_ROLES}
                selected={selId===c.id} locked={isLocked}
                roomLabel={fmtRoomByDay(c,ROOMS)}
                onSelect={()=>selectCourse(c)}
                onEdit={canEditCourse?()=>setEditingCourse(c):null}
                onRemove={hasAnyAllocation(c)&&canDealloc&&!isLocked?()=>deallocate(c.id):null}
                onDelete={canManageCatalog?()=>handleDeleteCourse(c):null}/>
            ))}
          </div>

          {!isLocked&&!periodLocked&&(
            <div style={{padding:'10px 12px',borderTop:`1px solid ${T.bdr}`,flexShrink:0,display:'flex',flexDirection:'column',gap:6}}>
              {canManageCatalog&&activeRoleId!==ALL_ROLES&&(
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>setCreatingCourse(true)}
                    style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.txt2,fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;}}>
                    + Nova Disciplina
                  </button>
                  <button onClick={()=>setImportingCourses(true)}
                    style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.txt2,fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;}}>
                    ⇪ Subir Planilha
                  </button>
                </div>
              )}
              {autoAllocInput.length>0&&(
                <button onClick={handleAutoAllocate}
                  style={{width:'100%',padding:'8px',background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,borderRadius:7,color:theme==='light'?'#1d4ed8':'#60A5FA',fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}
                  onMouseEnter={e=>{e.currentTarget.style.background=theme==='light'?'#dbeafe':'#1e3a5f';}}
                  onMouseLeave={e=>{e.currentTarget.style.background=theme==='light'?'#eff6ff':'#0d1f3d';}}>
                  ✨ Alocar Automaticamente
                </button>
              )}
              {!isInstitutional&&(
                <button onClick={()=>setFinishConfirm(true)}
                  style={{width:'100%',padding:'8px',background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,color:theme==='light'?'#15803d':'#34d399',fontSize:12,fontWeight:600,cursor:'pointer',transition:'all .15s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background=theme==='light'?'#dcfce7':'#0d3321';}}
                  onMouseLeave={e=>{e.currentTarget.style.background=theme==='light'?'#f0fdf4':'#0a2a0a';}}>
                  ✓ Marcar como Concluído
                </button>
              )}
            </div>
          )}
        </aside>

        {/* Área principal */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',borderBottom:`1px solid ${T.bdr}`,background:theme==='light'?T.surface:T.card,flexShrink:0}}>
            <div style={{display:'flex',gap:2,border:`1px solid ${T.bdr2}`,borderRadius:6,overflow:'hidden'}}>
              {[['list','≡ Salas'],['grid','⊞ Horários']].map(([m,lbl])=>{
                const disabled=m==='list'&&periodLocked;
                return(
                  <button key={m} disabled={disabled} title={disabled?'Período passado é somente leitura — use Horários para consultar.':undefined}
                    className={`viewbtn${effectiveViewMode===m?' active':''}`} onClick={()=>!disabled&&setViewMode(m)}
                    style={{padding:'4px 12px',fontSize:11,fontWeight:500,background:'transparent',border:'none',color:disabled?T.dim:(effectiveViewMode===m?dClr:T.muted),transition:'all .12s',cursor:disabled?'not-allowed':'pointer',opacity:disabled?.5:1}}>{lbl}</button>
                );
              })}
            </div>
            <div style={{width:1,height:16,background:T.bdr2}}/>
            {effectiveViewMode==='grid'&&DAYS.map(dy=>(
              <button key={dy} onClick={()=>setDay(dy)} style={{padding:'4px 10px',borderRadius:5,fontSize:11,fontWeight:500,background:day===dy?d.clr:'transparent',color:day===dy?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${day===dy?d.clr:T.bdr2}`,transition:'all .12s',cursor:'pointer'}}>{dy.slice(0,3)}</button>
            ))}
            <div style={{flex:1}}/>
            <span style={{...mono,fontSize:10,color:T.dim}}>{isInstitutional?'Visão institucional — todas as salas visíveis':`Exibindo apenas salas da função ${gRole(currentUser.roleId)?.full}`}</span>
          </div>

          {sel&&canAllocate&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',background:selBannerBg,borderBottom:`1px solid ${d.clr}44`,flexShrink:0}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:d.clr,animation:'blink 1.5s infinite'}}/>
              <span style={{...mono,fontSize:11,color:dClr,fontWeight:600}}>{sel.code}</span>
              <span style={{fontSize:12,color:T.txt2,maxWidth:200,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sel.name}</span>
              <span style={{...mono,fontSize:11,color:T.muted}}>{fmtSchedule(sel)} · {sel.enroll} alunos</span>
              <div style={{flex:1}}/>
              {effectiveViewMode==='grid'&&!courseOccupiesDay(sel,day)&&<span style={{fontSize:10,color:theme==='light'?'#b45309':'#FBBF24'}}>Não ocorre na {day} — mude para {sel.blocks.flatMap(b=>b.days)[0]?.slice(0,3)}</span>}
              {effectiveViewMode==='grid'&&courseOccupiesDay(sel,day)&&<span style={{fontSize:10,color:T.muted}}><span style={{color:d.clr}}>●</span> livre {canMerge&&<><span style={{color:'#F59E0B'}}>●</span> mesclar</>}</span>}
              <button onClick={()=>setSelId(null)} style={{padding:'2px 8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:10,cursor:'pointer'}}>✕</button>
            </div>
          )}

          <div style={{flex:1,overflow:'auto',background:T.bg}}>
            {effectiveViewMode==='grid'?(
              <Grid rooms={visRooms} day={day} alloc={alloc} courses={periodCourses} sel={sel} roleId={activeRoleId} dept={d}
                canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse}
                onTryAlloc={rid=>tryAllocate(rid,day)} onDealloc={cid=>deallocate(cid,day)} onEditFeatures={setFeaturesModal} onEditCourse={setEditingCourse}/>
            ):(
              <ListView rooms={visRooms} alloc={alloc} courses={periodCourses} sel={sel} roleId={activeRoleId} dept={d}
                canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse}
                onTryAlloc={trySalasAllocate} onDealloc={cid=>deallocate(cid,null)} onEditFeatures={setFeaturesModal} onEditCourse={setEditingCourse}/>
            )}
          </div>
        </div>
      </div>

      {/* Modais */}
      {finishConfirm&&<FinishConfirmModal roleName={gRole(currentUser.roleId)?.full} remaining={autoAllocInput.length} onConfirm={handleFinish} onCancel={()=>setFinishConfirm(false)}/>}
      {deptPanel&&<CoordinationStatusPanel roles={roles} subUnits={subUnits} coordinationStatuses={coordinationStatuses} notifications={notifications} onReopen={handleReopen} onForceFinish={handleForceFinish} onClose={()=>setDeptPanel(false)}/>}
      {notifPanel&&<NotifPanel notifications={notifications} onClose={()=>setNotifPanel(false)}/>}
      {(editingCourse||creatingCourse)&&<CourseEditModal course={editingCourse} isInstitutional={isInstitutional} targetRoleId={targetRoleId} courses={courses} period={selectedPeriod}
        onSave={handleEditCourse} onCreate={handleCreateCourse} onCancel={()=>{setEditingCourse(null);setCreatingCourse(false);}}/>}
      {importingCourses&&<CourseImportModal targetRoleId={targetRoleId} roleName={gRole(targetRoleId)?.full} period={selectedPeriod}
        existingCourses={courses.filter(c=>c.roleId===targetRoleId&&c.period===selectedPeriod)}
        onConfirm={handleImportCourses} onCancel={()=>setImportingCourses(false)}/>}
      {featuresModal&&canEditFeatures&&<RoomFeaturesModal room={ROOMS.find(r=>r.id===featuresModal)} dept={d} featureOptions={featureOptions} onSave={saveFeatures} onClose={()=>setFeaturesModal(null)} onAddOption={addFeatureOption} onRemoveOption={removeFeatureOption}/>}
      {autoAllocConfirm&&<AutoAllocWarningModal onConfirm={confirmAutoAllocateWarning} onCancel={()=>setAutoAllocConfirm(false)}/>}
      {autoAllocAskScope&&<AutoAllocScopeModal roleName={d.full} allCount={autoAllocInputAll.length} mineCount={autoAllocInputMine.length} onChoose={handleAutoAllocateScope} onCancel={()=>setAutoAllocAskScope(false)}/>}
      {autoAllocResult&&<AutoAllocModal result={autoAllocResult} dept={d} onApply={handleApplyAllocation} onCancel={()=>setAutoAllocResult(null)}/>}
      {mergeModal&&sel&&mergeRoom&&<MergeModal room={mergeRoom} incomingCourse={sel} conflicts={mergeCons} totalEnroll={mergeTotal} dept={d} day={mergeModal.day} onConfirm={()=>forceAllocate(mergeModal.roomId,mergeModal.day)} onCancel={()=>setMergeModal(null)}/>}
      {dayPickerModal&&sel&&<DayPickerModal room={ROOMS.find(r=>r.id===dayPickerModal.roomId)} course={sel} dept={d} onConfirm={days=>forceAllocate(dayPickerModal.roomId,days)} onCancel={()=>setDayPickerModal(null)}/>}
      {showUsers&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'stretch',justifyContent:'flex-end',zIndex:200}}>
          <div style={{width:'min(900px,95vw)',background:T.surface,borderLeft:`1px solid ${T.bdr}`,display:'flex',flexDirection:'column',animation:'slideIn .2s ease'}}>
            <UserManagement onClose={()=>setShowUsers(false)} roles={roles} subUnits={subUnits}/>
          </div>
        </div>
      )}
      {toast&&(
        <div style={{position:'fixed',bottom:20,right:20,padding:'10px 16px',borderRadius:8,fontFamily:"'DM Mono',monospace",fontSize:12,zIndex:300,animation:'fadeIn .2s ease',boxShadow:T.shadowMd,
          background:toast.type==='warn'?(theme==='light'?'#fffbeb':'#2a1a00'):toast.type==='err'?(theme==='light'?'#fef2f2':'#2a0a0a'):(theme==='light'?'#f0fdf4':'#0a2a0a'),
          border:`1px solid ${toast.type==='warn'?'#F59E0B44':toast.type==='err'?'#ef444444':'#34d39944'}`,
          color:toast.type==='warn'?(theme==='light'?'#92400e':'#FBBF24'):toast.type==='err'?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#15803d':'#34d399')}}>
          {toast.msg}
        </div>
      )}
    </div>
    </RolesCtx.Provider>
  );
}

// ─── Seleção de tela inicial ───────────────────────────────────────────────────
// Tela intermediária pós-login: o usuário escolhe entre o fluxo de alocação
// (Dashboard de sempre) e o mapa somente-leitura de salas já alocadas, em vez
// de cair direto na alocação. Não usa nenhum estado do Dashboard — só precisa
// do callback pra trocar a tela.
function ScreenSelector({onPick,subUnits}){
  const{currentUser,logout,can}=useAuth();
  const{T,theme,toggleTheme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  // "Gerenciamento" não é exclusivo do Diretor por identidade de role — é
  // qualquer função institucional com pelo menos uma destas permissões
  // (Diretor e seus secretários têm todas, por exemplo).
  const canManage=can(PERMS.CREATE_ANY_USER)||can(PERMS.MANAGE_SUB_UNITS)||can(PERMS.MANAGE_ROLES)||can(PERMS.MANAGE_ROOMS)||can(PERMS.MANAGE_BLOCKS);
  const cards=[
    {key:'allocate',icon:'📋',title:'Alocar Disciplinas',desc:'Cadastre disciplinas e aloque-as nas salas da sua função.'},
    {key:'map',icon:'🗺',title:'Mapa de Salas',desc:'Veja uma visão geral de todas as salas, com disciplinas alocadas por dia e horário.'},
    {key:'campus',icon:'📍',title:'Localização de Salas',desc:'Veja onde cada bloco fica fisicamente no campus.'},
    ...(canManage?[{key:'manage',icon:'⚙️',title:'Gerenciamento',desc:'Usuários, funções, sub-unidades, salas e blocos.'}]:[]),
  ];
  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button{font-family:inherit;}
        .icon-btn:hover{background:${T.inner}!important;border-color:${T.muted}!important;}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
        <div style={{flex:1}}/>
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <span style={{...mono,fontSize:10,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{currentUser.role.name}</span>
          {(()=>{const su=subUnits.find(s=>s.id===currentUser.role?.subUnitId);return su&&<span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{su.name}</span>;})()}
        </div>
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={()=>onPick('profile')} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>👤 Perfil</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Sair</button>
      </div>
      <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:28,animation:'fadeIn .2s ease'}}>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:21,fontWeight:700,marginBottom:4}}>Sistema de Gerenciamento de Salas de Aula — CCN/UFPI</div>
        </div>
        <div style={{display:'flex',gap:20,flexWrap:'wrap',justifyContent:'center'}}>
          {cards.map(c=>(
            <button key={c.key} onClick={()=>onPick(c.key)}
              style={{width:260,padding:'28px 24px',background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,cursor:'pointer',textAlign:'left',transition:'all .15s',boxShadow:T.shadowSm}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;e.currentTarget.style.boxShadow=T.shadowMd;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr;e.currentTarget.style.boxShadow=T.shadowSm;}}>
              <div style={{fontSize:31,marginBottom:14}}>{c.icon}</div>
              <div style={{fontSize:16,fontWeight:700,color:T.txt,marginBottom:6}}>{c.title}</div>
              <div style={{fontSize:12,color:T.muted,lineHeight:1.5}}>{c.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tela: mapa de salas ───────────────────────────────────────────────────────
// Visão somente-leitura — mostra uma tabela por sala, com dias da semana como
// colunas e faixas horárias (8h–22h) como linhas, para todos os departamentos
// de uma vez.
function RoomMapScreen({rooms,courses,roles,subUnits,blocks,periods,currentPeriodOverride,onBack,onProfile}){
  const{currentUser,logout}=useAuth();
  const{T,theme,toggleTheme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const gRole=useMemo(()=>makeGRole(roles,subUnits),[roles,subUnits]);
  const gBlockLabel=useMemo(()=>makeGBlockLabel(blocks),[blocks]);
  // União com `periods` (persistido) e não só os períodos já referenciados
  // por alguma disciplina — um período recém-criado sem nenhuma disciplina
  // ainda continua selecionável aqui, mostrando todas as salas vazias.
  const allPeriods=useMemo(()=>{
    const s=new Set([...periods,...courses.map(c=>c.period)]);
    return[...s].sort(comparePeriods);
  },[periods,courses]);
  const currentPeriod=currentPeriodOverride??(allPeriods[allPeriods.length-1]??DEFAULT_PERIOD);
  const[periodOverride,setPeriodOverride]=useState(null);
  const selectedPeriod=periodOverride??currentPeriod;
  const periodCourses=useMemo(()=>courses.filter(c=>c.period===selectedPeriod),[courses,selectedPeriod]);
  const alloc=useMemo(()=>buildAlloc(periodCourses),[periodCourses]);
  const allocatedRoomIds=useMemo(()=>new Set(periodCourses.flatMap(c=>Object.values(c.roomByDay||{}))),[periodCourses]);
  const allocatedRooms=useMemo(()=>rooms.filter(r=>allocatedRoomIds.has(r.id)),[rooms,allocatedRoomIds]);
  const[roomFilter,setRoomFilter]=useState('all'); // 'all' | 'allocated' | 'empty'
  const[cellMode,setCellMode]=useState('padrao'); // 'padrao' | 'detalhado' | 'simples'
  const displayRooms=useMemo(()=>{
    if(roomFilter==='allocated')return allocatedRooms;
    if(roomFilter==='empty')return rooms.filter(r=>!allocatedRoomIds.has(r.id));
    return rooms;
  },[roomFilter,rooms,allocatedRooms,allocatedRoomIds]);
  const subUnitOrder=name=>{const i=subUnits.findIndex(s=>s.fullName===name);return i===-1?subUnits.length:i;};

  const[mapUsers,setMapUsers]=useState([]);
  useEffect(()=>{authApi.getUsers().then(setMapUsers).catch(()=>{});},[]);
  // roleId → nome(s) dos usuários com aquela função; vazio = "Diretoria"
  const roleUserNames=useMemo(()=>{
    const m={};
    mapUsers.forEach(u=>{if(!m[u.roleId])m[u.roleId]=[];m[u.roleId].push(u.name);});
    return m;
  },[mapUsers]);
  const getRoomResponsible=room=>roleUserNames[room.roleId]?.join(', ')||'Diretoria';

  const MAP_HOURS=HOURS.filter(h=>h>=8); // 8..21 → faixas 8:00–9:00 até 21:00–22:00

  // Retorna um mapa hour→{span,c,merged}|null para renderização vertical.
  // null = célula coberta pelo rowSpan de um slot anterior naquele dia.
  const buildColMap=(rid,day)=>{
    const slots=rowSlots(rid,day,alloc);
    const map={};
    for(const slot of slots){
      const start=Math.max(slot.h,8);
      const end=Math.min(slot.h+slot.span,22);
      if(end<=8)continue;
      const span=end-start;
      if(!(start in map)){
        map[start]={span,c:slot.c,merged:slot.merged};
        for(let i=1;i<span;i++){if(start+i<=21)map[start+i]=null;}
      }
    }
    for(const h of MAP_HOURS){if(!(h in map))map[h]={span:1,c:null,merged:0};}
    return map;
  };

  const generatePdf=()=>{
    const groupOf=r=>gRole(r.roleId).subUnitFull;
    const groupOrder=name=>{const i=subUnits.findIndex(s=>s.fullName===name);return i===-1?subUnits.length:i;};
    const sorted=[...displayRooms].sort((a,b)=>groupOrder(groupOf(a))-groupOrder(groupOf(b))||gBlockLabel(a.blockId).localeCompare(gBlockLabel(b.blockId))||a.label.localeCompare(b.label,undefined,{numeric:true}));
    const dateStr=new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const thDays=DAYS.map(d=>`<th>${d.slice(0,3)}</th>`).join('');
    // Uma sala por página: sem agrupamento visual de depto/bloco acima de
    // várias salas (não faz mais sentido com paginação 1-a-1) — o contexto
    // depto·bloco vai embutido no próprio cabeçalho de cada sala.
    const roomHtml=(room,deptName,blockLabel,isLast)=>{
      const rd=gRole(room.roleId);
      const colMaps={};DAYS.forEach(d=>{colMaps[d]=buildColMap(room.id,d);});
      const bodyRows=MAP_HOURS.map(h=>{
        const cells=DAYS.map(d=>{
          const cell=colMaps[d][h];
          if(cell===null)return'';
          if(!cell.c)return`<td></td>`;
          const cd=gRole(cell.c.roleId);
          const content=buildCellContent(cell,d,cellMode);
          return`<td rowspan="${cell.span}" title="${escapeHtml(content.tooltip)}" style="border-left:2px solid ${cd.clr};background:${cd.clr}22">${renderCellHtml(content,cd)}</td>`;
        }).join('');
        return`<tr><td class="hcell">${h}:00–${h+1}:00</td>${cells}</tr>`;
      }).join('');
      const responsible=getRoomResponsible(room);
      return`<div class="room-card" style="${isLast?'':'page-break-after:always;'}">`
        +`<div class="room-hdr" style="border-left:3px solid ${rd.clr}">`
        +`<div class="room-ctx">${escapeHtml(deptName)} · ${escapeHtml(blockLabel)}</div>`
        +`<div class="room-title" style="color:${rd.textClr}" title="${escapeHtml(`${room.type} · ${room.cap} alunos · ${responsible}`)}">Sala ${escapeHtml(room.label)}</div>`
        +`</div>`
        +`<table><thead><tr><th class="hth">Horário</th>${thDays}</tr></thead><tbody>${bodyRows}</tbody></table>`
        +`<div class="room-meta">Período ${escapeHtml(selectedPeriod)} · Gerado em ${dateStr}</div>`
        +`</div>`;
    };
    const roomsHtml=sorted.map((room,i)=>roomHtml(room,groupOf(room),gBlockLabel(room.blockId),i===sorted.length-1)).join('');
    const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>Mapa de Salas — ${selectedPeriod}</title><style>
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:Arial,sans-serif;font-size:9px;color:#1e293b;padding:6mm;}
      .room-card{border:1px solid #b8c4d0;border-radius:4px;overflow:hidden;page-break-inside:avoid;width:100%;}
      .room-hdr{display:flex;flex-direction:column;align-items:center;text-align:center;padding:8px;background:#f8fafc;border-bottom:1px solid #b8c4d0;}
      .room-ctx{font-size:7px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;}
      .room-title{font-size:14px;font-weight:700;}
      table{border-collapse:collapse;width:100%;table-layout:fixed;}
      .hth{width:16%;}
      th{background:#f8fafc;padding:3px 3px;text-align:center;border:1px solid #b8c4d0;font-size:7px;font-weight:600;white-space:nowrap;}
      td{padding:2px 3px;border:1px solid #b8c4d0;height:20px;vertical-align:top;overflow:hidden;font-size:7px;}
      td span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .hcell{color:#94a3b8;background:#f8fafc;white-space:nowrap;font-size:6px;}
      .tchr{color:#64748b;font-size:6px;}
      .merged{color:#d97706;font-size:6px;}
      .room-meta{font-size:6px;color:#94a3b8;text-align:right;padding:3px 8px;}
      @media print{@page{size:A4 landscape;margin:18mm 10mm;}}
    </style></head><body>${roomsHtml}</body></html>`;
    const w=window.open('','_blank');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(()=>w.print(),400);
  };

  const presentGroups=useMemo(()=>{
    const byName=new Map();
    displayRooms.forEach(r=>{const rd=gRole(r.roleId);if(!byName.has(rd.subUnitFull))byName.set(rd.subUnitFull,rd);});
    return[...byName.values()].sort((a,b)=>subUnitOrder(a.subUnitFull)-subUnitOrder(b.subUnitFull));
  },[displayRooms,roles,subUnits]);
  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button{font-family:inherit;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:${T.scrollTrack};}
        ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px;}
        .icon-btn:hover{background:${T.inner}!important;border-color:${T.muted}!important;}
      `}</style>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',background:T.surface,borderBottom:`1px solid ${T.bdr}`,flexShrink:0,boxShadow:T.shadowSm}}>
        <button className="icon-btn" onClick={onBack} title="Voltar ao menu" style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>☰</button>
        <span style={{fontSize:14,fontWeight:700,color:T.txt}}>🗺 Mapa de Salas</span>
        <div style={{width:1,height:16,background:T.bdr2}}/>
        <select value={selectedPeriod} onChange={e=>setPeriodOverride(e.target.value===currentPeriod?null:e.target.value)}
          title="Período letivo em exibição" style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,fontWeight:600,outline:'none',cursor:'pointer'}}>
          {allPeriods.map(p=><option key={p} value={p}>{p}{p===currentPeriod?' (atual)':''}</option>)}
        </select>
        <div style={{width:1,height:16,background:T.bdr2}}/>
        <select value={roomFilter} onChange={e=>setRoomFilter(e.target.value)}
          title="Filtrar salas" style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,fontWeight:600,outline:'none',cursor:'pointer'}}>
          <option value="all">Todas as salas</option>
          <option value="allocated">Apenas alocadas</option>
          <option value="empty">Apenas vazias</option>
        </select>
        <div style={{width:1,height:16,background:T.bdr2}}/>
        <select value={cellMode} onChange={e=>setCellMode(e.target.value)}
          title="Detalhamento das disciplinas exibido em cada célula" style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,fontWeight:600,outline:'none',cursor:'pointer'}}>
          <option value="padrao">Padrão</option>
          <option value="detalhado">Detalhado</option>
          <option value="simples">Simples</option>
        </select>
        <div style={{flex:1}}/>
        <span style={{...mono,fontSize:10,color:T.dim}}>{allocatedRooms.length} sala{allocatedRooms.length!==1?'s':''} alocada{allocatedRooms.length!==1?'s':''}</span>
        <button onClick={generatePdf} disabled={allocatedRooms.length===0} title="Gerar PDF com o mapa completo"
          style={{padding:'5px 12px',background:theme==='light'?'#0f172a':'#e2e8f0',border:'none',borderRadius:6,color:theme==='light'?'#f1f5f9':'#0f172a',fontSize:12,fontWeight:600,cursor:allocatedRooms.length===0?'not-allowed':'pointer',opacity:allocatedRooms.length===0?.4:1,transition:'opacity .15s'}}>
          ⬇ PDF
        </button>
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <span style={{...mono,fontSize:10,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{currentUser.role.name}</span>
          {(()=>{const su=subUnits.find(s=>s.id===currentUser.role?.subUnitId);return su&&<span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{su.name}</span>;})()}
        </div>
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={onProfile} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>👤 Perfil</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Sair</button>
      </div>
      {presentGroups.length>0&&(
        <div style={{display:'flex',alignItems:'center',gap:14,padding:'7px 18px',background:T.surface,borderBottom:`1px solid ${T.bdr}`,flexShrink:0,flexWrap:'wrap'}}>
          <span style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>Legenda</span>
          {presentGroups.map(dp=>(
            <div key={dp.subUnitFull} style={{display:'flex',alignItems:'center',gap:5}}>
              <div style={{width:8,height:8,borderRadius:2,background:dp.clr,flexShrink:0}}/>
              <span style={{...mono,fontSize:10,color:T.muted}}>{dp.subUnitFull}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{flex:1,overflow:'auto',background:T.bg,padding:16}}>
        <RoomMapGrid rooms={displayRooms} alloc={alloc} mapHours={MAP_HOURS} buildColMap={buildColMap} gRole={gRole} gBlockLabel={gBlockLabel} subUnits={subUnits} getRoomResponsible={getRoomResponsible} cellMode={cellMode}/>
      </div>
    </div>
  );
}

// Grade somente-leitura do Mapa de Salas — uma tabela por sala, com dias da
// semana como colunas e horários (8h–22h) como linhas. buildColMap é passado
// pelo RoomMapScreen para não precisar passar alloc inteiro para cada card.
function RoomMapGrid({rooms,alloc,mapHours,buildColMap,gRole,gBlockLabel,subUnits,getRoomResponsible,cellMode}){
  const{T,theme}=useT();
  const groupOf=room=>gRole(room.roleId).subUnitFull;
  const groupOrder=name=>{const i=subUnits.findIndex(s=>s.fullName===name);return i===-1?subUnits.length:i;};
  const byGroupBlockLabel=(a,b)=>groupOrder(groupOf(a))-groupOrder(groupOf(b))||gBlockLabel(a.blockId).localeCompare(gBlockLabel(b.blockId))||a.label.localeCompare(b.label,undefined,{numeric:true});
  const sorted=useMemo(()=>[...rooms].sort(byGroupBlockLabel),[rooms]);
  const groupCounts=useMemo(()=>{const m={};sorted.forEach(r=>{const g=groupOf(r);m[g]=(m[g]||0)+1;});return m;},[sorted]);
  if(sorted.length===0)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:10,padding:40}}>
      <div style={{fontSize:33,opacity:.15}}>🗺</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.dim}}>Nenhuma sala cadastrada.</div>
    </div>
  );
  const tableBdrClr=theme==='light'?'#b8c4d0':'#253355';
  const thBdr=`1px solid ${tableBdrClr}`;
  const shiftBg=h=>h===12||h===18?T.faint:T.bg;
  // Agrupa rooms sequencialmente por departamento para intercalar separadores
  // Agrupa por departamento e, dentro de cada depto, por bloco
  const groups=[];
  sorted.forEach(room=>{
    const g=groupOf(room);
    if(!groups.length||groups[groups.length-1].name!==g)
      groups.push({name:g,rd:gRole(room.roleId),blocks:[]});
    const grp=groups[groups.length-1];
    const blkLabel=gBlockLabel(room.blockId);
    if(!grp.blocks.length||grp.blocks[grp.blocks.length-1].blockId!==room.blockId)
      grp.blocks.push({blockId:room.blockId,label:blkLabel,rooms:[]});
    grp.blocks[grp.blocks.length-1].rooms.push(room);
  });
  return(
    <div style={{display:'flex',flexDirection:'column',gap:28}}>
      {groups.map(grp=>{
        const rd=grp.rd,rdClr=dtc(rd,theme);
        return(
          <div key={grp.name}>
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',marginBottom:14,background:`${rd.clr}${theme==='light'?'14':'10'}`,borderLeft:`3px solid ${rd.clr}`,borderRadius:'0 6px 6px 0'}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:rdClr,letterSpacing:1,textTransform:'uppercase'}}>{grp.name}</span>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>· {groupCounts[grp.name]} sala{groupCounts[grp.name]!==1?'s':''}</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:20}}>
              {grp.blocks.map(blk=>(
                <div key={blk.blockId}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10,paddingLeft:10}}>
                    <div style={{width:2,height:12,borderRadius:1,background:T.bdr2,flexShrink:0}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:600,color:T.txt2,letterSpacing:.5}}>{blk.label}</span>
                    <div style={{flex:1,height:1,background:T.bdr}}/>
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
                    {blk.rooms.map(room=>{
                      const rdR=gRole(room.roleId),rdRClr=dtc(rdR,theme);
                      const colMaps={};DAYS.forEach(d=>{colMaps[d]=buildColMap(room.id,d);});
                      return(
                        <div key={room.id} style={{flex:'1 1 620px',minWidth:520,border:`1px solid ${tableBdrClr}`,borderRadius:8,overflow:'hidden',background:T.surface}}>
                          <div style={{padding:'6px 10px',borderBottom:`1px solid ${tableBdrClr}`,borderLeft:`3px solid ${rdR.clr}`,background:`${rdR.clr}${theme==='light'?'10':'0a'}`,textAlign:'center'}}>
                            <span title={`${room.type} · ${room.cap} alunos · ${getRoomResponsible(room)}`} style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:rdRClr,cursor:'help'}}>Sala {room.label}</span>
                          </div>
                          <div>
                      <table style={{borderCollapse:'collapse',width:'100%',tableLayout:'fixed'}}>
                        <colgroup>
                          <col style={{width:'16%'}}/>
                          {DAYS.map(d=><col key={d} style={{width:'14%'}}/>)}
                        </colgroup>
                        <thead>
                          <tr style={{background:T.surface}}>
                            <th style={{padding:'5px 6px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,fontWeight:400,borderBottom:thBdr,borderRight:thBdr,letterSpacing:.5,textTransform:'uppercase'}}>Horário</th>
                            {DAYS.map(d=><th key={d} style={{padding:'5px 4px',textAlign:'center',fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,fontWeight:600,borderBottom:thBdr,borderLeft:thBdr}}>{d.slice(0,3)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {mapHours.map(h=>(
                            <tr key={h} style={{background:shiftBg(h)}}>
                              <td style={{padding:'3px 6px',fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,borderBottom:thBdr,borderRight:thBdr,whiteSpace:'nowrap'}}>{h}:00–{h+1}:00</td>
                              {DAYS.map(d=>{
                                const cell=colMaps[d][h];
                                if(cell===null)return null;
                                if(!cell.c)return<td key={d} style={{borderBottom:thBdr,borderLeft:thBdr}}/>;
                                const cd=gRole(cell.c.roleId),cdClr=dtc(cd,theme);
                                const content=buildCellContent(cell,d,cellMode);
                                return(
                                  <td key={d} rowSpan={cell.span}
                                    title={content.tooltip}
                                    style={{padding:'3px 4px',borderBottom:thBdr,borderLeft:`2px solid ${cd.clr}`,verticalAlign:'top',background:`${cd.clr}${theme==='light'?'1e':'16'}`,overflow:'hidden'}}>
                                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:cdClr,fontWeight:700,overflowWrap:'anywhere',lineHeight:1.2}}>{content.primary}</div>
                                    {content.mode==='detalhado'&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:1}}>{content.name}</div>}
                                    {content.teacher&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:1}}>{content.teacher}</div>}
                                    {content.mode==='detalhado'&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',marginTop:1}}>{content.timeRange} · {content.enroll} alunos</div>}
                                    {content.merged>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:'#d97706'}}>+{content.merged}</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card de disciplina ───────────────────────────────────────────────────────
// ─── Mapa do Campus — pinos de bloco sobre uma imagem estática (não usa
// nenhum serviço de mapa externo: a imagem já vem "cozida" a partir de um
// export do OpenStreetMap, então a tela funciona 100% offline/rede interna).
// Posição de cada pino é salva como porcentagem da imagem (block.mapX/mapY,
// 0-100), não pixel — continua válida em qualquer tamanho de tela ou se a
// imagem for trocada por uma versão de resolução diferente depois. ─────────
// Converte a posição percentual de um pino (block.mapX/mapY, 0-100) em
// lat/lon real, pra abrir a localização/rota no Google Maps sem precisar
// cadastrar coordenada por bloco. A princípio dava pra fazer isso por
// interpolação linear direta usando a tag <bounds> do map.osm original
// (export do OpenStreetMap usado pra gerar campus-map.png, mantido fora do
// repo) — mas a proporção lon/lat desse bbox bruto não bate com a
// proporção da imagem renderizada (a ferramenta de export recortou/deu
// margem diferente da consulta bruta), o que gerava erro de até ~50-116m.
// Por isso os coeficientes abaixo vêm de uma transformação afim (rotação +
// escala não-uniforme, sem distorção perspectiva) calibrada por mínimos
// quadrados a partir de 5 pontos de controle: prédios com marcador/rótulo
// já "cozidos" na própria imagem (RU-CCN, Reitoria, HU, RU II, Biblioteca
// Universitária) cuja posição em pixel foi extraída detectando o ponto
// escuro do marcador na imagem, casada com a lat/lon real do mesmo prédio
// lida do map.osm — erro residual caiu pra ~2-17m. Se a imagem for trocada
// de novo, repetir esse processo (achar prédios rotulados na imagem nova,
// pegar lat/lon deles no .osm correspondente, reajustar os coeficientes).
const CAMPUS_GEO_TRANSFORM={
  latA:7.39853864e-6,  latB:-1.08716770e-4, latC:-5.05296922,
  lonA:1.53449600e-4,  lonB:-3.49992620e-6, lonC:-42.80189400,
};
function pinLatLng(x,y){
  const{latA,latB,latC,lonA,lonB,lonC}=CAMPUS_GEO_TRANSFORM;
  const lat=latA*x+latB*y+latC;
  const lon=lonA*x+lonB*y+lonC;
  return{lat,lon};
}

function CampusMapScreen({blocks,rooms,onBack}){
  const{can}=useAuth();
  const{T,theme,toggleTheme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const canEdit=can(PERMS.MANAGE_BLOCKS);

  const[editing,setEditing]=useState(false);
  const[selectedId,setSelectedId]=useState(null);   // pino aberto (ver detalhes, os dois modos)
  const[placingId,setPlacingId]=useState(null);      // bloco esperando um clique no mapa pra ser posicionado (só edição)
  const[dragId,setDragId]=useState(null);            // bloco sendo arrastado agora (só edição)
  const[dragPos,setDragPos]=useState(null);          // {x,y} prévia visual durante o arraste, antes de salvar
  const[saving,setSaving]=useState(false);
  const[toast,setToast]=useState(null);
  const imgWrapRef=useRef(null);
  // Menus laterais (CCN1/CCN2): bloco expandido mostra suas salas inline; o
  // último bloco clicado num menu fica "em destaque" (cor diferente da
  // seleção-por-clique-no-pino, que abre o modal) e o mapa rola até o pino
  // correspondente, se ele já tiver posição.
  const[expandedIds,setExpandedIds]=useState(()=>new Set());
  const[highlightId,setHighlightId]=useState(null);
  const pinRefs=useRef({});

  const showToast=(msg,type='ok')=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);};

  const positioned=useMemo(()=>blocks.filter(b=>b.mapX!=null&&b.mapY!=null),[blocks]);
  const unpositioned=useMemo(()=>blocks.filter(b=>b.mapX==null||b.mapY==null),[blocks]);
  const roomsOf=blockId=>rooms.filter(r=>r.blockId===blockId);
  const selectedBlock=blocks.find(b=>b.id===selectedId)??null;

  const stopEditing=()=>{setEditing(false);setPlacingId(null);setDragId(null);setDragPos(null);setSelectedId(null);};

  const posFromEvent=e=>{
    const rect=imgWrapRef.current.getBoundingClientRect();
    const x=((e.clientX-rect.left)/rect.width)*100;
    const y=((e.clientY-rect.top)/rect.height)*100;
    return{x:Math.max(0,Math.min(100,x)),y:Math.max(0,Math.min(100,y))};
  };

  const savePosition=async(blockId,x,y)=>{
    setSaving(true);
    try{ await mgmt.setBlockPosition(blockId,x,y); }
    catch(e){ showToast(`Falha ao salvar posição: ${ptError(e)}`,'err'); }
    finally{ setSaving(false); }
  };

  const handleMapClick=e=>{
    if(!editing||!placingId||dragId)return;
    const{x,y}=posFromEvent(e);
    const id=placingId;
    setPlacingId(null);
    savePosition(id,x,y).then(()=>showToast('Posição definida.'));
  };

  // Arraste: acompanha o mouse na janela inteira (o cursor pode sair do
  // pino durante o arraste), só grava no banco no mouseup — sem isso, cada
  // pixel de movimento viraria uma chamada de rede.
  useEffect(()=>{
    if(!dragId)return;
    const onMove=e=>setDragPos(posFromEvent(e));
    const onUp=e=>{
      const{x,y}=posFromEvent(e);
      const id=dragId;
      setDragId(null);setDragPos(null);
      savePosition(id,x,y).then(()=>showToast('Posição atualizada.'));
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    return()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);};
    // eslint-disable-next-line
  },[dragId]);

  const clearPosition=async blockId=>{
    setSelectedId(null);
    await savePosition(blockId,null,null);
    showToast('Bloco voltou pra lista de "sem posição".');
  };

  const toggleBlockPanel=id=>{
    setExpandedIds(prev=>{
      const next=new Set(prev);
      if(next.has(id))next.delete(id);else next.add(id);
      return next;
    });
    setHighlightId(id);
    pinRefs.current[id]?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});
  };

  const renderBlockPanel=(local,side)=>{
    const list=blocks.filter(b=>b.local===local);
    return(
      <div style={{width:250,flexShrink:0,[side==='left'?'borderRight':'borderLeft']:`1px solid ${T.bdr}`,background:T.surface,overflow:'auto',padding:14}}>
        <div style={{fontSize:12,fontWeight:700,color:T.txt,marginBottom:2}}>{local}</div>
        <div style={{...mono,fontSize:10,color:T.dim,marginBottom:10}}>{list.length} bloco{list.length!==1?'s':''}</div>
        {list.length===0?(
          <div style={{fontSize:11,color:T.dim,fontStyle:'italic'}}>Nenhum bloco cadastrado.</div>
        ):list.map(b=>{
          const expanded=expandedIds.has(b.id);
          const rs=roomsOf(b.id);
          const isHighlighted=highlightId===b.id;
          const hasPosition=b.mapX!=null&&b.mapY!=null;
          return(
            <div key={b.id} style={{marginBottom:6}}>
              <button onClick={()=>toggleBlockPanel(b.id)}
                style={{display:'flex',alignItems:'center',gap:8,width:'100%',textAlign:'left',padding:'8px 10px',borderRadius:7,cursor:'pointer',
                  background:isHighlighted?'#f59e0b22':T.inner,border:`1px solid ${isHighlighted?'#f59e0b':T.bdr2}`}}>
                <span style={{fontSize:9,color:T.dim,transform:expanded?'rotate(90deg)':'none',transition:'transform .15s',flexShrink:0}}>▶</span>
                <span style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:T.txt}}>{b.name}</div>
                  <div style={{...mono,fontSize:9,color:T.dim}}>{rs.length} sala{rs.length!==1?'s':''}{!hasPosition?' · sem posição no mapa':''}</div>
                </span>
              </button>
              {expanded&&(
                <div style={{paddingLeft:22,marginTop:4}}>
                  {rs.length===0?(
                    <div style={{fontSize:11,color:T.dim,fontStyle:'italic',padding:'4px 0'}}>Nenhuma sala cadastrada.</div>
                  ):rs.map(r=>(
                    <div key={r.id} style={{fontSize:11,color:T.txt,padding:'4px 0',borderBottom:`1px solid ${T.bdr}`}}>
                      Sala {r.label} <span style={{color:T.dim}}>· {r.cap} lugares</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button{font-family:inherit;}
        .icon-btn:hover{background:${T.inner}!important;border-color:${T.muted}!important;}
        .campus-pin{transition:transform .1s;}
        .campus-pin:hover{transform:translate(-50%,-100%) scale(1.15);}
        @keyframes campus-pin-pulse{0%,100%{filter:drop-shadow(0 0 2px #f59e0b);}50%{filter:drop-shadow(0 0 10px #f59e0b);}}
        .campus-pin-highlighted{animation:campus-pin-pulse 1.3s ease-in-out infinite;}
      `}</style>

      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',background:T.surface,borderBottom:`1px solid ${T.bdr}`,flexShrink:0,boxShadow:T.shadowSm}}>
        <button className="icon-btn" onClick={onBack} title="Voltar ao menu" style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>☰</button>
        <span style={{fontSize:14,fontWeight:700,color:T.txt}}>📍 Localização de Salas</span>
        <div style={{width:1,height:16,background:T.bdr2}}/>
        <span style={{...mono,fontSize:11,color:T.dim}}>{positioned.length} bloco{positioned.length!==1?'s':''} no mapa{unpositioned.length>0?` · ${unpositioned.length} sem posição`:''}</span>
        <div style={{flex:1}}/>
        {saving&&<span style={{...mono,fontSize:10,color:T.dim}}>Salvando…</span>}
        {canEdit&&(
          <button className="icon-btn" onClick={()=>editing?stopEditing():setEditing(true)}
            style={{padding:'5px 12px',background:editing?'#3b82f6':T.inner,border:`1px solid ${editing?'#3b82f6':T.bdr2}`,borderRadius:6,color:editing?'#fff':T.muted,fontSize:11,fontWeight:600,cursor:'pointer'}}>
            {editing?'✕ Concluir edição':'✎ Editar posições'}
          </button>
        )}
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
      </div>

      <div style={{flex:1,minHeight:0,display:'flex',overflow:'hidden'}}>
        {editing?(
          <div style={{width:260,flexShrink:0,borderRight:`1px solid ${T.bdr}`,background:T.surface,overflow:'auto',padding:14}}>
            <div style={{fontSize:12,fontWeight:700,color:T.txt,marginBottom:4}}>Blocos sem posição</div>
            <div style={{fontSize:11,color:T.dim,marginBottom:12,lineHeight:1.5}}>
              Clique num bloco da lista e depois clique no mapa pra posicioná-lo. Pra reposicionar um que já está no mapa, arraste o pino direto.
            </div>
            {unpositioned.length===0?(
              <div style={{fontSize:11,color:T.dim,fontStyle:'italic'}}>Todos os blocos já têm posição definida.</div>
            ):unpositioned.map(b=>(
              <button key={b.id} onClick={()=>setPlacingId(placingId===b.id?null:b.id)}
                style={{display:'block',width:'100%',textAlign:'left',padding:'8px 10px',marginBottom:6,borderRadius:7,cursor:'pointer',
                  background:placingId===b.id?'#3b82f622':T.inner,border:`1px solid ${placingId===b.id?'#3b82f6':T.bdr2}`}}>
                <div style={{fontSize:12,fontWeight:600,color:T.txt}}>{b.local} — {b.name}</div>
                {placingId===b.id&&<div style={{...mono,fontSize:9,color:'#3b82f6',marginTop:2}}>Clique no mapa…</div>}
              </button>
            ))}
          </div>
        ):renderBlockPanel('CCN2','left')}

        <div style={{flex:1,minWidth:0,minHeight:0,overflow:'hidden',position:'relative',background:'#dfe3e0',display:'flex',alignItems:'center',justifyContent:'center'}}>
          {/* aspectRatio+max-w/h (em vez de um width fixo em px) faz esse
          wrapper ocupar o maior tamanho possível preservando a proporção da
          imagem sem nunca estourar o espaço disponível — a tela inteira cabe
          sem precisar rolar, em qualquer resolução. Os pinos continuam
          posicionados por % em cima desse wrapper (não da imagem em si), e
          como o wrapper agora tem exatamente o formato/tamanho renderizado
          da imagem (sem sobra tipo letterbox), a matemática de % continua
          válida sem nenhuma mudança. */}
          <div ref={imgWrapRef} onClick={handleMapClick}
            style={{position:'relative',aspectRatio:'2906/2124',maxWidth:'100%',maxHeight:'100%',width:'auto',height:'auto',cursor:editing&&placingId?'crosshair':'default'}}>
            <img src={campusMapImg} alt="Mapa do campus" draggable={false}
              style={{display:'block',width:'100%',height:'100%',userSelect:'none'}}/>

            {positioned.map(b=>{
              const isDragging=dragId===b.id;
              const x=isDragging&&dragPos?dragPos.x:b.mapX;
              const y=isDragging&&dragPos?dragPos.y:b.mapY;
              const isHighlighted=highlightId===b.id;
              return(
                <div key={b.id} ref={el=>{pinRefs.current[b.id]=el;}}
                  className={`campus-pin${isHighlighted?' campus-pin-highlighted':''}`}
                  onMouseDown={e=>{if(!editing)return;e.preventDefault();e.stopPropagation();setDragId(b.id);}}
                  onClick={e=>{e.stopPropagation();if(!editing)setSelectedId(b.id);}}
                  title={`${b.local} — ${b.name}`}
                  style={{
                    position:'absolute',left:`${x}%`,top:`${y}%`,transform:'translate(-50%,-100%)',
                    cursor:editing?'grab':'pointer',zIndex:isDragging?20:selectedId===b.id?15:isHighlighted?14:10,
                    filter:isDragging?'drop-shadow(0 4px 6px rgba(0,0,0,.35))':'drop-shadow(0 2px 3px rgba(0,0,0,.25))',
                  }}>
                  <svg width="30" height="38" viewBox="0 0 30 38">
                    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 23 15 23s15-12.5 15-23C30 6.7 23.3 0 15 0z"
                      fill={selectedId===b.id||isDragging?'#3b82f6':isHighlighted?'#f59e0b':'#1e3a5f'} stroke="#fff" strokeWidth="1.5"/>
                    <circle cx="15" cy="15" r="6" fill="#fff"/>
                  </svg>
                  <span style={{
                    position:'absolute',left:34,top:15,transform:'translateY(-50%)',whiteSpace:'nowrap',
                    pointerEvents:'none',fontSize:11,fontWeight:700,color:'#0f172a',
                    background:'rgba(255,255,255,.88)',padding:'2px 6px',borderRadius:5,
                    boxShadow:'0 1px 3px rgba(0,0,0,.3)',
                  }}>{b.local} — {b.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {!editing&&renderBlockPanel('CCN1','right')}
      </div>

      {selectedBlock&&!editing&&(
        <div onClick={()=>setSelectedId(null)} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.35)':'rgba(0,0,0,.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:24,width:340,maxHeight:'70vh',display:'flex',flexDirection:'column',boxShadow:T.shadowMd}}>
            <div style={{display:'flex',alignItems:'flex-start',marginBottom:14}}>
              <div>
                <div style={{fontSize:16,fontWeight:700,color:T.txt}}>{selectedBlock.local}</div>
                <div style={{fontSize:13,color:T.muted}}>{selectedBlock.name}</div>
              </div>
              <button onClick={()=>setSelectedId(null)} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{...mono,fontSize:10,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>
              {roomsOf(selectedBlock.id).length} sala{roomsOf(selectedBlock.id).length!==1?'s':''}
            </div>
            <div style={{overflow:'auto',flex:1}}>
              {roomsOf(selectedBlock.id).length===0?(
                <div style={{fontSize:12,color:T.dim,fontStyle:'italic'}}>Nenhuma sala cadastrada neste bloco ainda.</div>
              ):roomsOf(selectedBlock.id).map(r=>(
                <div key={r.id} style={{padding:'7px 0',borderBottom:`1px solid ${T.bdr}`,fontSize:12,color:T.txt}}>
                  Sala {r.label} <span style={{color:T.dim}}>· {r.cap} lugares</span>
                </div>
              ))}
            </div>
            {(()=>{const{lat,lon}=pinLatLng(selectedBlock.mapX,selectedBlock.mapY);return(
              <div style={{display:'flex',gap:8,marginTop:14,paddingTop:14,borderTop:`1px solid ${T.bdr}`}}>
                <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`} target="_blank" rel="noopener noreferrer"
                  style={{flex:1,textAlign:'center',padding:'8px 0',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.txt,fontSize:12,fontWeight:600,textDecoration:'none'}}>
                  📍 Ver no Google Maps
                </a>
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`} target="_blank" rel="noopener noreferrer"
                  style={{flex:1,textAlign:'center',padding:'8px 0',background:'#3b82f6',border:'1px solid #3b82f6',borderRadius:7,color:'#fff',fontSize:12,fontWeight:600,textDecoration:'none'}}>
                  🧭 Traçar rota
                </a>
              </div>
            );})()}
          </div>
        </div>
      )}

      {selectedBlock&&editing&&(
        <div style={{position:'fixed',bottom:20,left:'50%',transform:'translateX(-50%)',background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:10,padding:'10px 16px',display:'flex',alignItems:'center',gap:12,boxShadow:T.shadowMd,zIndex:100}}>
          <span style={{fontSize:12,color:T.txt}}><strong>{selectedBlock.local} — {selectedBlock.name}</strong></span>
          <button onClick={()=>clearPosition(selectedBlock.id)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Remover do mapa</button>
          <button onClick={()=>setSelectedId(null)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}}>Fechar</button>
        </div>
      )}

      {toast&&(
        <div style={{position:'fixed',bottom:20,right:20,padding:'10px 16px',borderRadius:8,fontSize:12,fontWeight:600,zIndex:200,
          background:toast.type==='err'?(theme==='light'?'#fef2f2':'#2a0a0a'):(theme==='light'?'#f0fdf4':'#0a2a0a'),
          border:`1px solid ${toast.type==='err'?'#ef444444':'#34d39944'}`,
          color:toast.type==='err'?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#15803d':'#34d399')}}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function CourseCard({course,activeRole,showRoleBadge,selected,locked,roomLabel,onSelect,onEdit,onRemove,onDelete}){
  const{T,theme}=useT();
  const{gRole}=useRolesData();
  const[confirmDel,setConfirmDel]=useState(false);
  const cd=gRole(course.roleId),badgeClr=dtc(cd,theme);
  const done=isFullyAllocated(course);
  return(
    <div className={`cc${selected?' sel':''}${locked?' locked':''}${done?' done':''}`}
      style={{padding:'8px 10px',borderRadius:6,marginBottom:2,cursor:(locked||!onSelect)?'default':'pointer',background:'transparent',border:`1px solid ${selected?activeRole.clr:T.bdr}`,transition:'background .1s, border-color .1s, opacity .15s'}}>
      {showRoleBadge&&(
        <div style={{marginBottom:4}} onClick={onSelect}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:badgeClr,background:`${cd.clr}${theme==='light'?'22':'14'}`,border:`1px solid ${cd.clr}44`,borderRadius:3,padding:'1px 4px'}}>{cd.full}</span>
        </div>
      )}
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:showRoleBadge?badgeClr:dtc(activeRole,theme)}} onClick={onSelect}>{course.code}</span>
          {course.sec!=null&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,border:`1px solid ${T.bdr2}`,borderRadius:3,padding:'1px 4px'}} onClick={onSelect}>Turma {course.sec}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}} onClick={onSelect}>{course.enroll} alunos</span>
          {onEdit&&!locked&&(
            <button onClick={e=>{e.stopPropagation();onEdit();}} title="Editar disciplina"
              style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:9,padding:'1px 4px',cursor:'pointer',lineHeight:1.3,transition:'all .1s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;e.currentTarget.style.color=T.txt;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✏</button>
          )}
          {onRemove&&(
            <button onClick={e=>{e.stopPropagation();onRemove();}} title="Remover alocação"
              style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:9,padding:'1px 4px',cursor:'pointer',lineHeight:1.3,transition:'all .1s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✕</button>
          )}
          {onDelete&&!confirmDel&&(
            <button onClick={e=>{e.stopPropagation();setConfirmDel(true);}} title="Excluir disciplina"
              style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:9,padding:'1px 4px',cursor:'pointer',lineHeight:1.3,transition:'all .1s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>🗑</button>
          )}
          {onDelete&&confirmDel&&(
            <>
              <button onClick={e=>{e.stopPropagation();onDelete();}} title="Confirmar exclusão"
                style={{background:'#ef4444',border:'none',borderRadius:3,color:'#fff',fontSize:9,padding:'1px 6px',cursor:'pointer',lineHeight:1.3,fontWeight:600}}>Excluir</button>
              <button onClick={e=>{e.stopPropagation();setConfirmDel(false);}} title="Cancelar"
                style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:9,padding:'1px 4px',cursor:'pointer',lineHeight:1.3}}>✕</button>
            </>
          )}
        </div>
      </div>
      <div style={{fontSize:12,fontWeight:500,color:T.txt,marginBottom:2,lineHeight:1.3}} onClick={onSelect}>{course.name}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}} onClick={onSelect}>{fmtSchedule(course)}</div>
      {course.teacher&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} onClick={onSelect} title={course.teacher}>👤 {course.teacher}</div>}
      {roomLabel&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:badgeClr,marginTop:2}}>📍 {roomLabel}</div>}
    </div>
  );
}

// ─── Grade ────────────────────────────────────────────────────────────────────
function Grid({rooms,day,alloc,courses,sel,roleId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const{gRole,gBlockLabel}=useRolesData();
  const CW=76,RH=33,LW=130;
  const byBlockThenLabel=(a,b)=>gBlockLabel(a.blockId).localeCompare(gBlockLabel(b.blockId))||a.label.localeCompare(b.label,undefined,{numeric:true});
  const sorted=useMemo(()=>[
    ...rooms.filter(r=>r.roleId===roleId).sort(byBlockThenLabel),
    ...rooms.filter(r=>r.roleId!==roleId).sort(byBlockThenLabel),
  ],[rooms,roleId]);
  return(
    <table style={{borderCollapse:'collapse',tableLayout:'fixed',minWidth:LW+CW*HOURS.length}}>
      <colgroup><col style={{width:LW}}/>{HOURS.map(h=><col key={h} style={{width:CW}}/>)}</colgroup>
      <thead>
        <tr style={{position:'sticky',top:0,zIndex:5,background:T.surface,boxShadow:theme==='light'?'0 1px 2px rgba(0,0,0,.06)':'none'}}>
          <th style={{padding:'7px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>Sala / Lim. Alunos</th>
          {HOURS.map(h=><th key={h} style={{padding:'7px 0 7px 5px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`}}>{h}:00</th>)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((room,idx)=>{
          const isOwn=room.roleId===roleId,rd=gRole(room.roleId),rdClr=dtc(rd,theme);
          const free=canAllocate&&sel?roomFree(room.id,sel,alloc,day):false;
          const hasCon=canAllocate&&sel?!free:false;
          const slots=rowSlots(room.id,day,alloc);
          const selBlock=sel?blockForDay(sel,day):null;
          const dayOk=!!selBlock;
          const showSep=!isOwn&&sorted[idx-1]?.roleId===roleId;
          const showBlockSep=idx===0||sorted[idx-1]?.blockId!==room.blockId;
          const capWarn=sel&&room.cap<sel.enroll;
          const rowBg=isOwn?(theme==='light'?'#ffffff':T.bg):(theme==='light'?T.faint:T.inner);
          return(
            <Fragment key={room.id}>
              {showSep&&<tr><td colSpan={HOURS.length+1} style={{padding:'5px 10px',fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,color:T.txt2,background:T.faint,borderTop:`1px solid ${T.bdr}`,borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>Outras Funções ↓</td></tr>}
              {showBlockSep&&<tr><td colSpan={HOURS.length+1} style={{padding:'4px 10px 4px 18px',fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:600,color:T.txt2,background:T.faint,letterSpacing:.5}}>{gBlockLabel(room.blockId)}</td></tr>}
              <tr style={{borderBottom:`1px solid ${T.bdr}`,background:rowBg}}>
                <td style={{padding:'0 6px 0 10px',height:RH}}>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:2,height:18,borderRadius:1,background:rd.clr,opacity:isOwn?1:0.4}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:isOwn?rdClr:T.muted,whiteSpace:'nowrap'}}>{room.label}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:capWarn&&sel?'#d97706':T.dim}}>{room.cap}{capWarn&&sel?'⚠':''}</span>
                    {room.features.length>0&&<span title={room.features.join(', ')} style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,opacity:.7}}>⚙{room.features.length}</span>}
                    {room.desc&&<span title={room.desc} style={{fontSize:10,color:T.dim,opacity:.7}}>💬</span>}
                    {canEditFeatures&&<button onClick={()=>onEditFeatures(room.id)} title="Editar recursos"
                      style={{background:'none',border:'none',color:T.dim,fontSize:10,padding:'0 1px',lineHeight:1,opacity:0,transition:'opacity .1s',cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>✏</button>}
                  </div>
                </td>
                {slots.map((slot,si)=>{
                  if(slot.c){
                    const cd=gRole(slot.c.roleId),cdClr=dtc(cd,theme),isMine=slot.c.roleId===roleId;
                    const isMergeZone=canAllocate&&canMerge&&sel&&dayOk&&hasCon&&slot.h>=selBlock.sh&&slot.h<selBlock.eh;
                    const slotBlock=blockForDay(slot.c,day);
                    return(
                      <td key={si} colSpan={slot.span} style={{padding:'2px 2px',height:RH,verticalAlign:'middle',background:isMergeZone?(theme==='light'?'#fffbeb':'#F59E0B0f'):'transparent',cursor:isMergeZone?'pointer':'default',transition:'background .1s'}} className={isMergeZone?'gridcell-merge':''} onClick={()=>isMergeZone&&onTryAlloc(room.id)}>
                        <div onClick={e=>{if(isMine&&canDealloc&&!isMergeZone){e.stopPropagation();onDealloc(slot.c.id);}}} className={isMine&&canDealloc?'chip-own':''}
                          title={`${slot.c.name}${slot.c.sec!=null?` · Turma ${slot.c.sec}`:''}${slot.c.teacher?` · ${slot.c.teacher}`:''} · ${fmtHour(slotBlock.sh)}–${fmtHour(slotBlock.eh)} · ${slot.c.enroll} alunos${isMine&&canDealloc?'\nClique para desalocar':''}${isMergeZone?'\nClique para mesclar':''}`}
                          style={{height:'100%',padding:'0 5px',borderRadius:3,background:isMine?`${cd.clr}${theme==='light'?'28':'22'}`:`${cd.clr}${theme==='light'?'18':'0e'}`,borderLeft:`2px solid ${isMergeZone?'#F59E0B':cd.clr}`,display:'flex',alignItems:'center',gap:4,overflow:'hidden',cursor:isMergeZone?'pointer':isMine&&canDealloc?'pointer':'default',transition:'filter .12s'}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:isMergeZone?'#d97706':cdClr,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>{slot.c.code}</span>
                          {slot.merged>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:'#d97706',background:'#F59E0B22',borderRadius:2,padding:'0 3px',flexShrink:0}}>+{slot.merged}</span>}
                          {isMergeZone&&<span style={{fontSize:10,flexShrink:0}}>⇄</span>}
                          {isMine&&canEditCourse&&<button onClick={e=>{e.stopPropagation();onEditCourse(slot.c);}} title="Editar" style={{background:'none',border:'none',color:cdClr,fontSize:9,padding:0,cursor:'pointer',opacity:.7,flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.7}>✏</button>}
                        </div>
                      </td>
                    );
                  }
                  const hlFree=canAllocate&&free&&dayOk&&slot.h>=selBlock?.sh&&slot.h<selBlock?.eh;
                  return(
                    <td key={si} style={{padding:'2px 2px',height:RH,verticalAlign:'middle',background:hlFree?`${dept.clr}${theme==='light'?'22':'1a'}`:'transparent',cursor:hlFree?'pointer':'default',transition:'background .1s'}} className={hlFree?'gridcell-hl':''} onClick={()=>hlFree&&onTryAlloc(room.id)}>
                      {hlFree&&<div style={{height:'100%',borderRadius:3,border:`1px dashed ${dept.clr}${theme==='light'?'88':'44'}`,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:12,color:`${dept.clr}${theme==='light'?'aa':'66'}`}}>+</span></div>}
                    </td>
                  );
                })}
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Vista em lista ───────────────────────────────────────────────────────────
function ListView({rooms,alloc,courses,sel,roleId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T}=useT();
  const{gRole}=useRolesData();
  const sorted=useMemo(()=>[...rooms.filter(r=>r.roleId===roleId),...rooms.filter(r=>r.roleId!==roleId)],[rooms,roleId]);
  if(!sel)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}>
      <div style={{fontSize:37,opacity:.12}}>≡</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:T.dim}}>{canAllocate?'Selecione uma disciplina à esquerda para ver a disponibilidade das salas':'Vista somente leitura'}</div>
    </div>
  );
  const own=sorted.filter(r=>r.roleId===roleId),oth=sorted.filter(r=>r.roleId!==roleId);
  return(
    <div style={{padding:16,display:'flex',flexDirection:'column',gap:20,animation:'fadeIn .2s ease'}}>
      <RoomSection title={`${gRole(roleId).full} — Salas Próprias`} rooms={own} alloc={alloc} courses={courses} sel={sel} roleId={roleId} dept={dept} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>
      {oth.length>0&&<RoomSection title="Outras Funções — Alocação Cruzada" rooms={oth} alloc={alloc} courses={courses} sel={sel} roleId={roleId} dept={dept} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>}
    </div>
  );
}

function RoomSection({title,rooms,alloc,courses,sel,roleId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const{gBlockLabel}=useRolesData();
  const free=rooms.filter(r=>roomFree(r.id,sel,alloc)),busy=rooms.filter(r=>!roomFree(r.id,sel,alloc));
  const freeSet=new Set(free.map(r=>r.id));
  const byBlock=useMemo(()=>{
    const groups={};
    rooms.forEach(r=>{const label=gBlockLabel(r.blockId);(groups[label]=groups[label]||[]).push(r);});
    return Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  },[rooms]);
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,fontWeight:700,color:T.txt2,textTransform:'uppercase',letterSpacing:1}}>{title}</span>
        <div style={{flex:1,height:1,background:T.bdr}}/>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:theme==='light'?'#059669':'#34D399'}}>{free.length} livres</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>/</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:theme==='light'?'#d97706':'#F59E0B'}}>{busy.length} {canMerge?'disponíveis para mescla':'ocupadas'}</span>
      </div>
      {byBlock.map(([blockLabel,bRooms])=>{
        const bSorted=[...bRooms].sort((a,b)=>(freeSet.has(b.id)?1:0)-(freeSet.has(a.id)?1:0)||a.label.localeCompare(b.label,undefined,{numeric:true}));
        return(
          <div key={blockLabel} style={{marginBottom:14}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:600,color:T.txt2,marginBottom:6,paddingLeft:2,letterSpacing:.5}}>{blockLabel}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',gap:8}}>
              {bSorted.map(r=><RoomCard key={r.id} room={r} sel={sel} alloc={alloc} courses={courses} roleId={roleId} dept={dept} status={freeSet.has(r.id)?'available':'busy'} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoomCard({room,sel,alloc,courses,roleId,dept,status,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const{gRole}=useRolesData();
  const rd=gRole(room.roleId),rdClr=dtc(rd,theme);
  const isOwn=room.roleId===roleId,avail=status==='available';
  const capWarn=sel&&room.cap<sel.enroll;
  const conflicts=avail?[]:getConflicts(room.id,sel,alloc,courses);
  const mergeTotal=avail?(sel?.enroll||0):conflicts.reduce((s,c)=>s+c.enroll,0)+(sel?.enroll||0);
  const overCap=mergeTotal>room.cap;
  const[hov,setHov]=useState(false);
  const clickable=avail&&canAllocate;
  return(
    <div className="room-card" onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={()=>clickable&&onTryAlloc(room.id)}
      style={{borderRadius:8,padding:'12px 14px',background:avail?(hov&&clickable?`${dept.clr}18`:T.surface):(theme==='light'?T.card:T.inner),border:`1px solid ${avail?(hov&&clickable?dept.clr:`${dept.clr}33`):T.bdr}`,cursor:clickable?'pointer':'default',transition:'all .15s',boxShadow:avail&&hov&&clickable?`0 4px 12px ${dept.clr}22`:T.shadowSm}}>
      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
        <div style={{width:2,height:16,borderRadius:1,background:rd.clr,opacity:isOwn?1:0.5}}/>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:500,color:isOwn?rdClr:T.muted}}>{room.label}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:capWarn?'#d97706':T.dim,marginLeft:'auto'}}>limite {room.cap}{capWarn?'⚠':''}</span>
        {canEditFeatures&&(
          <button onClick={e=>{e.stopPropagation();onEditFeatures(room.id);}} className="feat-btn"
            title="Editar recursos da sala"
            style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:9,padding:'1px 5px',opacity:0,transition:'opacity .15s',cursor:'pointer'}}
            onMouseEnter={e=>{e.stopPropagation();e.currentTarget.style.borderColor=T.muted;}}
            onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>⚙ editar</button>
        )}
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginBottom:6}}>{room.type} · Andar {room.floor}</div>
      {room.features.length>0&&(
        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:6}}>
          {room.features.map(f=><span key={f} style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted,border:`1px solid ${T.bdr}`,borderRadius:3,padding:'1px 4px',background:T.inner}}>{f}</span>)}
        </div>
      )}
      {room.desc&&(
        <div style={{fontSize:11,color:T.muted,lineHeight:1.5,marginBottom:8,fontStyle:'italic',borderLeft:`2px solid ${rd.clr}44`,paddingLeft:6}}>{room.desc}</div>
      )}
      <CapacityBar cap={room.cap} enroll={sel?.enroll||0} conflicts={avail?[]:conflicts} avail={avail}/>
      {avail?(
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:theme==='light'?'#059669':'#34D399'}}/>
          <span style={{fontSize:10,color:theme==='light'?'#059669':'#34D399',fontFamily:"'DM Mono',monospace"}}>Disponível</span>
          {capWarn&&<span style={{fontSize:9,color:'#d97706',marginLeft:'auto'}}>⚠ abaixo da capacidade</span>}
          {hov&&clickable&&!capWarn&&<span style={{fontSize:9,color:dtc(dept,theme),marginLeft:'auto'}}>Clique para alocar →</span>}
        </div>
      ):(
        <div style={{marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:6}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#F59E0B'}}/>
            <span style={{fontSize:10,color:theme==='light'?'#d97706':'#F59E0B',fontFamily:"'DM Mono',monospace"}}>{conflicts.length} conflito{conflicts.length!==1?'s':''}</span>
          </div>
          {conflicts.map(c=>{
            const cd=gRole(c.roleId),cdClr=dtc(cd,theme),isMine=c.roleId===roleId;
            return(
              <div key={c.id} title={[c.sec!=null?`Turma ${c.sec}`:null,c.teacher].filter(Boolean).join(' · ')||undefined} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 6px',background:`${cd.clr}${theme==='light'?'18':'0e'}`,borderRadius:4,marginBottom:2}}>
                <div style={{width:2,height:10,borderRadius:1,background:cd.clr}}/>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:cdClr,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.code}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{c.enroll} al.</span>
                {isMine&&canDealloc&&<button onClick={e=>{e.stopPropagation();onDealloc(c.id);}} style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 4px',cursor:'pointer',lineHeight:1.2}} onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✕</button>}
                {isMine&&canEditCourse&&<button onClick={e=>{e.stopPropagation();onEditCourse(c);}} style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 4px',cursor:'pointer',lineHeight:1.2}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.muted} onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>✏</button>}
              </div>
            );
          })}
          {canMerge&&canAllocate&&(
            <button onClick={e=>{e.stopPropagation();onTryAlloc(room.id);}} style={{width:'100%',marginTop:8,padding:'6px',borderRadius:5,background:overCap?(theme==='light'?'#fef3c7':'#3a1a0a'):(theme==='light'?'#fefce8':'#1a1400'),border:`1px solid ${overCap?'#F59E0B':'#F59E0B88'}`,color:theme==='light'?overCap?'#92400e':'#78350f':'#d4a017',fontSize:11,fontWeight:600,transition:'all .12s',cursor:'pointer'}}>
              ⇄ Mesclar Turmas{overCap?' ⚠':''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Barra de capacidade ──────────────────────────────────────────────────────
function CapacityBar({cap,enroll,conflicts,avail}){
  const{T,theme}=useT();
  const existing=conflicts.reduce((s,c)=>s+c.enroll,0),total=existing+enroll,over=total>cap;
  const pctEx=Math.min(existing/cap,1)*100,pctNew=Math.min(enroll/cap,Math.max(0,1-pctEx/100))*100;
  const pctTotal=Math.min(total/cap,1)*100;
  const pctColor=over?'#ef4444':total/cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399';
  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{avail?`${enroll} / ${cap} vagas`:`${total} / ${cap} vagas${over?' (acima do limite)':''}`}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:pctColor}}>{Math.round(total/cap*100)}%</span>
      </div>
      <div style={{height:5,borderRadius:3,background:T.barTrack,overflow:'hidden',display:'flex'}}>
        {avail?<div style={{width:`${pctTotal}%`,background:pctColor,borderRadius:3,transition:'width .3s'}}/>:
          <><div style={{width:`${pctEx}%`,background:T.barExist,borderRadius:'3px 0 0 3px',flexShrink:0}}/><div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',flexShrink:0}}/></>}
      </div>
      {!avail&&<div style={{display:'flex',gap:10,marginTop:3}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.barExist}}>■ existente {existing}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:over?'#ef4444':'#d97706'}}>■ entrante {enroll}</span>
      </div>}
    </div>
  );
}

// ─── Modal de recursos da sala ────────────────────────────────────────────────
function RoomFeaturesModal({room,dept,featureOptions,onSave,onClose,onAddOption,onRemoveOption}){
  const{T,theme}=useT();
  const{gRole}=useRolesData();
  const mono={fontFamily:"'DM Mono',monospace"};
  const rd=gRole(room.roleId),rdClr=dtc(rd,theme);
  const[selected,setSelected]=useState(new Set(room.features));
  const[desc,setDesc]        =useState(room.desc||'');
  const[newOption,setNewOption]=useState('');
  const toggle=f=>setSelected(prev=>{const s=new Set(prev);s.has(f)?s.delete(f):s.add(f);return s;});
  const submitNewOption=()=>{
    const name=newOption.trim();
    if(!name)return;
    onAddOption(name);
    setSelected(prev=>new Set(prev).add(name));
    setNewOption('');
  };
  const removeOption=f=>{
    onRemoveOption(f);
    setSelected(prev=>{const s=new Set(prev);s.delete(f);return s;});
  };
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:540,maxHeight:'85vh',display:'flex',flexDirection:'column',animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        {/* Cabeçalho */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20,flexShrink:0}}>
          <div style={{width:3,height:20,borderRadius:1,background:rd.clr}}/>
          <span style={{...mono,fontSize:12,color:rdClr,fontWeight:500}}>{room.label}</span>
          <span style={{...mono,fontSize:10,color:T.dim}}>{room.type} · Limite {room.cap} · Andar {room.floor}</span>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
          {/* Descrição */}
          <div style={{marginBottom:20}}>
            <div style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Descrição da Sala</div>
            <textarea
              value={desc}
              onChange={e=>setDesc(e.target.value)}
              placeholder="Observações sobre o espaço, instruções de acesso, particularidades…"
              rows={3}
              style={{width:'100%',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,
                color:T.txt,fontSize:13,padding:'9px 12px',outline:'none',resize:'vertical',
                lineHeight:1.6,fontFamily:"'DM Sans',sans-serif"}}/>
          </div>

          {/* Recursos */}
          <div style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:14}}>
            Recursos e Equipamentos — {selected.size} selecionados
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
            {featureOptions.length===0&&<span style={{...mono,fontSize:11,color:T.dim}}>Nenhum recurso cadastrado ainda.</span>}
            {featureOptions.map(f=>{
              const active=selected.has(f);
              return(
                <div key={f} style={{display:'flex',alignItems:'center',borderRadius:6,border:`1px solid ${active?rd.clr:T.bdr2}`,background:active?(theme==='light'?`${rd.clr}22`:`${rd.clr}18`):'transparent',overflow:'hidden'}}>
                  <button onClick={()=>toggle(f)} style={{padding:'5px 4px 5px 10px',border:'none',background:'none',fontSize:12,cursor:'pointer',color:active?rdClr:T.muted,fontWeight:active?600:400}}>
                    {active?'✓ ':''}{f}
                  </button>
                  <button onClick={()=>removeOption(f)} title="Remover este recurso do catálogo"
                    style={{padding:'5px 8px',border:'none',background:'none',cursor:'pointer',fontSize:10,color:T.dim,lineHeight:1}}
                    onMouseEnter={e=>e.currentTarget.style.color='#ef4444'} onMouseLeave={e=>e.currentTarget.style.color=T.dim}>✕</button>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:6,marginBottom:6}}>
            <input value={newOption} onChange={e=>setNewOption(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();submitNewOption();}}}
              placeholder="Novo recurso (ex.: Sala com microscópio)"
              style={{flex:1,padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:13,outline:'none'}}/>
            <button onClick={submitNewOption} disabled={!newOption.trim()} style={{padding:'7px 14px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:newOption.trim()?T.txt:T.dim,fontSize:12,cursor:newOption.trim()?'pointer':'default'}}>+ Adicionar</button>
          </div>
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,flexShrink:0,borderTop:`1px solid ${T.bdr}`,paddingTop:16}}>
          <button onClick={onClose} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button onClick={()=>onSave(room.id,[...selected],desc.trim())} style={{padding:'8px 20px',background:dept.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:12,fontWeight:700,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Aviso antes da alocação automática — o algoritmo (autoAllocate) só
// considera capacidade e disponibilidade de horário, nunca tipo/recursos da
// sala, então disciplinas que precisam de uma sala específica (laboratório,
// projetor etc.) devem ser alocadas manualmente antes ─────────────────────
function AutoAllocWarningModal({onConfirm,onCancel}){
  const{T,theme}=useT();
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700,color:T.txt}}>✨ Alocar Automaticamente</div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:theme==='light'?'#fffbeb':'#1a1400',border:`1px solid ${theme==='light'?'#fcd34d':'#F59E0B44'}`,borderRadius:8,padding:'12px 14px',marginBottom:20,fontSize:13,color:theme==='light'?'#b45309':'#FBBF24',lineHeight:1.6}}>
          ⚠ A alocação automática só considera capacidade e horário livre — ela <strong>não sabe</strong> que uma disciplina precisa de um tipo específico de sala (ex.: um laboratório) e pode colocá-la numa sala comum.
        </div>
        <div style={{fontSize:13,color:T.txt2,lineHeight:1.6,marginBottom:20}}>Aloque manualmente as disciplinas que dependem de uma sala específica antes de continuar. Quer prosseguir com a alocação automática para as demais disciplinas pendentes?</div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button onClick={onConfirm} style={{padding:'8px 20px',borderRadius:7,fontSize:12,fontWeight:700,background:'#3b82f6',border:'none',color:'#fff',cursor:'pointer'}}>Continuar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Escolha de escopo antes da alocação automática (só institucional com
// uma função específica selecionada — ver handleAutoAllocate) ────────────────
function AutoAllocScopeModal({roleName,allCount,mineCount,onChoose,onCancel}){
  const{T,theme}=useT();
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:420,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:16}}>
          <div style={{fontSize:16,fontWeight:700,color:T.txt}}>✨ Alocar Automaticamente</div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{fontSize:13,color:T.txt2,lineHeight:1.6,marginBottom:20}}>Você está vendo a função <strong>{roleName}</strong>. Quer alocar automaticamente as disciplinas pendentes de todas as funções, ou só as de <strong>{roleName}</strong>?</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <button onClick={()=>onChoose('mine')} disabled={mineCount===0}
            style={{padding:'10px 14px',background:'#3b82f6',border:'none',borderRadius:8,color:'#fff',fontSize:13,fontWeight:600,cursor:mineCount===0?'default':'pointer',opacity:mineCount===0?.5:1,textAlign:'left'}}>
            Apenas {roleName} <span style={{fontWeight:400,opacity:.85}}>({mineCount} disciplina{mineCount!==1?'s':''})</span>
          </button>
          <button onClick={()=>onChoose('all')} disabled={allCount===0}
            style={{padding:'10px 14px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:8,color:T.txt,fontSize:13,fontWeight:600,cursor:allCount===0?'default':'pointer',opacity:allCount===0?.5:1,textAlign:'left'}}>
            Todas as funções <span style={{fontWeight:400,color:T.dim}}>({allCount} disciplina{allCount!==1?'s':''})</span>
          </button>
          <button onClick={onCancel} style={{padding:'8px',background:'transparent',border:'none',borderRadius:8,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de pré-visualização da alocação automática ────────────────────────
function AutoAllocModal({result,dept,onApply,onCancel}){
  const{T,theme}=useT();
  const{gRole}=useRolesData();
  const mono={fontFamily:"'DM Mono',monospace"};
  const[tab,setTab]=useState('placed');
  const dClr=dtc(dept,theme);
  const{assignments,failed}=result;
  const placedCount=assignments.length,failedCount=failed.length;
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,width:580,maxHeight:'85vh',display:'flex',flexDirection:'column',animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{padding:'20px 24px 16px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19}}>✨</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Pré-visualização da Alocação Automática</div>
              <div style={{...mono,fontSize:10,color:T.dim,marginTop:2}}>Revise antes de aplicar — a ação não pode ser desfeita automaticamente</div>
            </div>
            <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
          </div>
          <div style={{display:'flex',gap:8}}>
            <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,textAlign:'center'}}>
              <div style={{fontSize:23,fontWeight:700,color:theme==='light'?'#15803d':'#34D399',lineHeight:1}}>{placedCount}</div>
              <div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>PARA ALOCAR</div>
            </div>
            {failedCount>0&&(
              <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:7,textAlign:'center'}}>
                <div style={{fontSize:23,fontWeight:700,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1}}>{failedCount}</div>
                <div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>NÃO ALOCÁVEIS</div>
              </div>
            )}
          </div>
        </div>
        <div style={{display:'flex',gap:0,borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
          {[['placed',`✓ Proposto (${placedCount})`],['failed',`⚠ Não alocável (${failedCount})`]].map(([key,label])=>(
            failedCount===0&&key==='failed'?null:(
              <button key={key} onClick={()=>setTab(key)} style={{flex:1,padding:'9px',fontSize:12,fontWeight:500,cursor:'pointer',background:'transparent',border:'none',borderBottom:`2px solid ${tab===key?dept.clr:'transparent'}`,color:tab===key?dClr:T.muted,transition:'all .12s'}}>{label}</button>
            )
          ))}
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
          {tab==='placed'?(
            assignments.length===0?<div style={{textAlign:'center',padding:32,color:T.dim,fontSize:13}}>Nada para alocar.</div>
            :assignments.map(({course,room},i)=>{
              const cd=gRole(course.roleId),cdClr=dtc(cd,theme);
              const rd=gRole(room.roleId),rdClr=dtc(rd,theme);
              const crossRole=room.roleId!==course.roleId;
              return(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 20px',borderBottom:`1px solid ${T.bdr}`,background:i%2===0?'transparent':(theme==='light'?T.faint:T.inner+'88')}}>
                  <div style={{width:2,height:36,borderRadius:1,background:cd.clr,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      <span style={{...mono,fontSize:10,color:cdClr}}>{course.code}</span>
                      <span style={{fontSize:12,color:T.txt,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{course.name}</span>
                    </div>
                    <div style={{...mono,fontSize:10,color:T.dim}}>{fmtSchedule(course)} · {course.enroll} alunos</div>
                  </div>
                  <div style={{fontSize:15,color:T.dim,flexShrink:0}}>→</div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',marginBottom:2}}>
                      {crossRole&&<span style={{...mono,fontSize:8,color:theme==='light'?'#d97706':'#FBBF24',border:`1px solid ${theme==='light'?'#fcd34d':'#FBBF2444'}`,borderRadius:3,padding:'1px 4px'}}>outra função</span>}
                      <span style={{...mono,fontSize:12,fontWeight:600,color:rdClr}}>{room.label}</span>
                    </div>
                    <div style={{...mono,fontSize:10,color:T.dim}}>limite {room.cap} · {room.type}</div>
                  </div>
                </div>
              );
            })
          ):(
            failed.length===0?<div style={{textAlign:'center',padding:32,color:T.dim,fontSize:13}}>Todas as disciplinas foram alocadas!</div>
            :failed.map(({course,reason},i)=>{
              const cd=gRole(course.roleId),cdClr=dtc(cd,theme);
              return(
                <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 20px',borderBottom:`1px solid ${T.bdr}`}}>
                  <div style={{width:2,height:36,borderRadius:1,background:'#ef4444',flexShrink:0,marginTop:2}}/>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      <span style={{...mono,fontSize:10,color:cdClr}}>{course.code}</span>
                      <span style={{fontSize:12,color:T.txt,fontWeight:500}}>{course.name}</span>
                      <span style={{...mono,fontSize:10,color:T.dim}}>· {course.enroll} alunos</span>
                    </div>
                    <div style={{fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.4}}>{reason}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{padding:'16px 20px',borderTop:`1px solid ${T.bdr}`,flexShrink:0}}>
          {failedCount>0&&<div style={{fontSize:11,color:T.muted,marginBottom:12,lineHeight:1.5}}>ⓘ {failedCount} disciplina{failedCount!==1?'s':''} não {failedCount!==1?'puderam':'pôde'} ser alocada{failedCount!==1?'s':''} e permanecerá{failedCount!==1?'o':''} pendente{failedCount!==1?'s':''}. Você pode resolvê-{failedCount!==1?'las':'la'} manualmente após aplicar, ou deixar para o diretor resolver.</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            <button onClick={onApply} disabled={placedCount===0}
              style={{padding:'8px 22px',borderRadius:7,fontSize:12,fontWeight:700,cursor:placedCount===0?'not-allowed':'pointer',background:placedCount===0?T.inner:dept.clr,border:'none',color:placedCount===0?T.dim:(theme==='light'?'#fff':'#000'),transition:'all .15s'}}
              onMouseEnter={e=>{if(placedCount>0)e.currentTarget.style.filter='brightness(1.08)';}}
              onMouseLeave={e=>e.currentTarget.style.filter='none'}>
              ✨ Aplicar {placedCount} Alocaç{placedCount!==1?'ões':'ão'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de confirmação de conclusão ────────────────────────────────────────
function FinishConfirmModal({roleName,remaining,onConfirm,onCancel}){
  const{T,theme}=useT();
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:420,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19}}>✓</div>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Marcar Alocação como Concluída?</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim,marginTop:2}}>{roleName}</div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:8,padding:'12px 14px',marginBottom:16,border:`1px solid ${T.bdr}`,fontSize:13,color:T.txt2,lineHeight:1.6}}>
          {remaining>0?<>Você possui <strong style={{color:theme==='light'?'#b45309':'#FBBF24'}}>{remaining} disciplina{remaining!==1?'s':''} não alocada{remaining!==1?'s':''}</strong>. Elas serão tratadas pelo diretor para alocação em outros departamentos.</>:<>Todas as suas disciplinas estão alocadas.</>}
        </div>
        <div style={{background:theme==='light'?'#fef2f2':'#1a0505',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`,borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:12,color:theme==='light'?'#b91c1c':'#ef4444'}}>
          ⚠ Após o envio, você <strong>não poderá fazer alterações</strong> a menos que o diretor reabra sua alocação.
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button onClick={onConfirm} style={{padding:'8px 20px',borderRadius:7,fontSize:12,fontWeight:700,background:theme==='light'?'#059669':'#34D399',border:'none',color:'#fff',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
            ✓ Confirmar e Notificar o Diretor
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel de status das coordenações ────────────────────────────────────────
function CoordinationStatusPanel({roles,subUnits,coordinationStatuses,notifications,onReopen,onForceFinish,onClose}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const gRole=useMemo(()=>makeGRole(roles,subUnits),[roles,subUnits]);
  const coordinationRoles=useMemo(()=>roles.filter(r=>r.subUnitId),[roles]);
  const statusColor={[DS.ACTIVE]:theme==='light'?'#1d4ed8':'#60A5FA',[DS.FINISHED]:theme==='light'?'#059669':'#34D399',[DS.FORCE_FINISHED]:theme==='light'?'#b91c1c':'#ef4444'};
  const statusLabel={[DS.ACTIVE]:'Ativo',[DS.FINISHED]:'Concluído',[DS.FORCE_FINISHED]:'Bloqueado'};
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:520,animation:'scaleIn .18s ease',boxShadow:T.shadowMd,maxHeight:'80vh',overflow:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Status de Alocação das Coordenações</div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20}}>
          {coordinationRoles.map(role=>{
            const rd=gRole(role.id);
            const status=coordinationStatuses[role.id]||DS.ACTIVE;
            const lastFinish=notifications.filter(n=>n.roleId===role.id&&n.type==='FINISHED').slice(-1)[0];
            const cd=dtc(rd,theme);
            return(
              <div key={role.id} style={{padding:'12px 14px',background:T.card,border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:3,height:32,borderRadius:1,background:rd.clr}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:cd}}>{rd.subUnitFull} — {rd.full}</div>
                  {lastFinish&&<div style={{...mono,fontSize:10,color:T.dim,marginTop:2}}>{lastFinish.userName} · {new Date(lastFinish.timestamp).toLocaleString('pt-BR')}</div>}
                </div>
                <span style={{...mono,fontSize:10,padding:'2px 8px',borderRadius:4,background:`${statusColor[status]}${theme==='light'?'22':'18'}`,border:`1px solid ${statusColor[status]}44`,color:statusColor[status]}}>{statusLabel[status]}</span>
                <div style={{display:'flex',gap:6}}>
                  {status!==DS.ACTIVE&&<button onClick={()=>onReopen(role.id)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=theme==='light'?'#1d4ed8':'#60A5FA';e.currentTarget.style.color=theme==='light'?'#1d4ed8':'#60A5FA';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>Reabrir</button>}
                  {status===DS.ACTIVE&&<button onClick={()=>onForceFinish(role.id)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444444',borderRadius:5,color:theme==='light'?'#b91c1c':'#ef4444',fontSize:11,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.borderColor='#ef4444'} onMouseLeave={e=>e.currentTarget.style.borderColor='#ef444444'}>Forçar Conclusão</button>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{...mono,fontSize:10,color:T.dim,borderTop:`1px solid ${T.bdr}`,paddingTop:12,lineHeight:1.6}}>
          <strong>Reabrir</strong> — permite à coordenação fazer novas alterações.<br/>
          <strong>Forçar Conclusão</strong> — bloqueia a coordenação sem necessidade de ação dela.
        </div>
      </div>
    </div>
  );
}

// ─── Painel de notificações ───────────────────────────────────────────────────
function NotifPanel({notifications,onClose}){
  const{T,theme}=useT();
  const{gRole}=useRolesData();
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'transparent',display:'flex',alignItems:'flex-start',justifyContent:'flex-end',zIndex:150,paddingTop:52,paddingRight:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:10,width:340,animation:'slideIn .15s ease',boxShadow:T.shadowMd,overflow:'hidden',maxHeight:'70vh',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${T.bdr}`,display:'flex',alignItems:'center'}}>
          <span style={{fontSize:14,fontWeight:600,color:T.txt}}>Notificações</span>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:15,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {notifications.length===0?<div style={{padding:24,textAlign:'center',color:T.dim,fontSize:13}}>Nenhuma notificação ainda</div>
          :[...notifications].reverse().map(n=>{
            const role=gRole(n.roleId),dClr=role?dtc(role,theme):T.muted;
            return(
              <div key={n.id} style={{padding:'12px 16px',borderBottom:`1px solid ${T.bdr}`,background:n.read?'transparent':theme==='light'?'#eff6ff':'#0d1f3d22'}}>
                <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                  <div style={{width:3,height:36,borderRadius:1,background:role?.clr||T.muted,flexShrink:0,marginTop:2}}/>
                  <div>
                    <div style={{fontSize:13,color:T.txt,fontWeight:500,marginBottom:2}}>Alocação de {n.roleName} enviada</div>
                    <div style={{fontSize:12,color:T.muted,marginBottom:2}}>Por {n.userName}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{new Date(n.timestamp).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Modal de edição de disciplina ────────────────────────────────────────────
function CourseEditModal({course,isInstitutional,targetRoleId,courses,period,onSave,onCreate,onCancel}){
  const{T,theme}=useT();
  const{gRole,roles,subUnits}=useRolesData();
  const mono={fontFamily:"'DM Mono',monospace"};
  const[code,setCode]=useState(course?.code??'');
  const[sec,setSec]=useState(course?.sec!=null?String(course.sec):'');
  const[roleId,setRoleId]=useState(course?.roleId??targetRoleId);
  const effectiveRoleId=course?course.roleId:roleId;
  const cd=gRole(effectiveRoleId),cdClr=dtc(cd,theme);
  const[name,setName]=useState(course?.name??'');
  const[teacher,setTeacher]=useState(course?.teacher??'');
  const[blocks,setBlocks]=useState(()=>course?course.blocks.map(b=>({days:[...b.days],sh:b.sh,eh:b.eh})):[{days:[],sh:8,eh:9}]);
  const[enroll,setEnroll]=useState(course?.enroll??1);
  const[errors,setErrors]=useState({});
  const[blockErrors,setBlockErrors]=useState([]);
  const updateBlock=(i,patch)=>setBlocks(prev=>prev.map((b,bi)=>bi===i?{...b,...patch}:b));
  const toggleBlockDay=(i,d)=>setBlocks(prev=>prev.map((b,bi)=>bi!==i?b:{...b,days:b.days.includes(d)?b.days.filter(x=>x!==d):[...b.days,d].sort((a,c)=>DAYS.indexOf(a)-DAYS.indexOf(c))}));
  const addBlock=()=>setBlocks(prev=>[...prev,{days:[],sh:8,eh:9}]);
  const removeBlock=i=>setBlocks(prev=>prev.filter((_,bi)=>bi!==i));
  const validate=()=>{
    const e={};
    if(!code.trim())e.code='Obrigatório';
    const secNum=sec===''?null:Number(sec);
    if(sec!==''&&(!Number.isInteger(secNum)||secNum<1))e.sec='Deve ser um número inteiro ≥ 1';
    else if(courses.some(c=>(course?c.id!==course.id:true)&&c.roleId===effectiveRoleId&&c.period===period&&c.code.trim().toUpperCase()===code.trim().toUpperCase()&&c.sec===secNum))
      e.sec='Já existe uma disciplina com este código e turma nesta função e período';
    if(!name.trim())e.name='Obrigatório';
    if(enroll<1||enroll>1000)e.enroll='Entre 1 e 1000';
    const bErrs=blocks.map(b=>{
      const be={};
      if(b.days.length===0)be.days='Selecione ao menos um dia';
      if(b.eh<=b.sh)be.eh='O término deve ser após o início';
      return be;
    });
    const dayCounts={};
    blocks.forEach(b=>b.days.forEach(d=>{dayCounts[d]=(dayCounts[d]||0)+1;}));
    const dupDay=Object.entries(dayCounts).find(([,n])=>n>1)?.[0];
    if(dupDay)e.blocks=`O dia ${dupDay} aparece em mais de um horário desta disciplina`;
    setBlockErrors(bErrs);
    setErrors(e);
    return Object.keys(e).length===0&&bErrs.every(be=>Object.keys(be).length===0);
  };
  const handleSave=()=>{
    if(!validate())return;
    const secNum=sec===''?null:Number(sec);
    if(course){
      onSave(course.id,{code:code.trim(),sec:secNum,name:name.trim(),teacher:teacher.trim(),blocks,enroll:Number(enroll)});
    }else{
      onCreate({id:courseId(effectiveRoleId,code.trim(),secNum,period),code:code.trim(),name:name.trim(),sec:secNum,roleId:effectiveRoleId,period,teacher:teacher.trim(),blocks,enroll:Number(enroll)});
    }
  };
  const inp={width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:13,outline:'none'};
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:3,height:20,borderRadius:1,background:cd.clr}}/>
          {course&&<span style={{...mono,fontSize:11,color:cdClr,fontWeight:500}}>{course.code}</span>}
          <span style={{fontSize:15,fontWeight:700,color:T.txt}}>{course?'Editar Disciplina':'Nova Disciplina'}</span>
          {!course&&<span style={{...mono,fontSize:10,color:T.dim,border:`1px solid ${T.bdr2}`,borderRadius:4,padding:'2px 6px'}}>{period}</span>}
          {course&&hasAnyAllocation(course)&&<span style={{...mono,fontSize:10,color:theme==='light'?'#b45309':'#FBBF24',background:theme==='light'?'#fef3c7':'#3a1a0a',border:`1px solid ${theme==='light'?'#fcd34d':'#F59E0B44'}`,borderRadius:4,padding:'2px 6px',marginLeft:'auto'}}>⚠ Alteração de horário pode remover a sala de algum dia</span>}
          <button onClick={onCancel} style={{background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer',marginLeft:course&&hasAnyAllocation(course)?0:'auto'}}>✕</button>
        </div>
        {!course&&isInstitutional&&(
          <div style={{marginBottom:12}}>
            <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Função</label>
            <select value={roleId} onChange={e=>setRoleId(e.target.value)} style={{...inp,cursor:'pointer'}}>
              {subUnits.map(su=>(
                <optgroup key={su.id} label={su.fullName}>
                  {roles.filter(r=>r.subUnitId===su.id).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div style={{display:'flex',gap:10,marginBottom:12}}>
          <div style={{flex:2}}>
            <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Código</label>
            <input value={code} onChange={e=>setCode(e.target.value)} style={inp}/>
            {errors.code&&<div style={{fontSize:11,color:'#ef4444',marginTop:3}}>{errors.code}</div>}
          </div>
          <div style={{flex:1}}>
            <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Turma</label>
            <input type="number" min={1} value={sec} onChange={e=>setSec(e.target.value)} style={inp} placeholder="—"/>
            {errors.sec&&<div style={{fontSize:11,color:'#ef4444',marginTop:3}}>{errors.sec}</div>}
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Nome da Disciplina</label>
          <input value={name} onChange={e=>setName(e.target.value)} style={inp}/>
          {errors.name&&<div style={{fontSize:11,color:'#ef4444',marginTop:3}}>{errors.name}</div>}
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Docente(s)</label>
          <input value={teacher} onChange={e=>setTeacher(e.target.value)} placeholder="A definir" style={inp}/>
        </div>
        {errors.blocks&&<div style={{fontSize:11,color:'#ef4444',marginBottom:8}}>{errors.blocks}</div>}
        {blocks.map((block,i)=>(
          <div key={i} style={{border:`1px solid ${T.bdr}`,borderRadius:8,padding:10,marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',marginBottom:8}}>
              <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>Horário{blocks.length>1?` ${i+1}`:''}</label>
              {blocks.length>1&&<button type="button" onClick={()=>removeBlock(i)} title="Remover este horário" style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:14,cursor:'pointer'}}>✕</button>}
            </div>
            <div style={{marginBottom:8}}>
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {DAYS.map(day=>(
                  <button key={day} type="button" onClick={()=>toggleBlockDay(i,day)} style={{padding:'5px 8px',borderRadius:5,fontSize:11,fontWeight:500,cursor:'pointer',transition:'all .1s',background:block.days.includes(day)?cd.clr:'transparent',color:block.days.includes(day)?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${block.days.includes(day)?cd.clr:T.bdr2}`}}>{day.slice(0,3)}</button>
                ))}
              </div>
              {blockErrors[i]?.days&&<div style={{fontSize:11,color:'#ef4444',marginTop:3}}>{blockErrors[i].days}</div>}
            </div>
            <div style={{display:'flex',gap:10}}>
              <div style={{flex:1}}>
                <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Início</label>
                <select value={block.sh} onChange={e=>{const v=Number(e.target.value);updateBlock(i,{sh:v,eh:block.eh<=v?v+1:block.eh});}} style={{...inp,cursor:'pointer'}}>
                  {HOURS.map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Término</label>
                <select value={block.eh} onChange={e=>updateBlock(i,{eh:Number(e.target.value)})} style={{...inp,cursor:'pointer'}}>
                  {HOURS.filter(h=>h>block.sh).concat([22]).map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}
                </select>
                {blockErrors[i]?.eh&&<div style={{fontSize:11,color:'#ef4444',marginTop:3}}>{blockErrors[i].eh}</div>}
              </div>
            </div>
          </div>
        ))}
        <button type="button" onClick={addBlock} style={{width:'100%',padding:'8px',marginBottom:20,background:'transparent',border:`1px dashed ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>+ Adicionar outro horário</button>
        <div style={{marginBottom:20}}>
          <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Alunos Matriculados</label>
          <input type="number" min={1} max={1000} value={enroll} onChange={e=>setEnroll(e.target.value)} style={inp}/>
          {errors.enroll&&<div style={{fontSize:11,color:'#ef4444',marginTop:3}}>{errors.enroll}</div>}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button onClick={handleSave} style={{padding:'8px 20px',background:cd.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:12,fontWeight:700,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>{course?'Salvar Alterações':'Criar Disciplina'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de import de disciplinas (ODS) ─────────────────────────────────────
function CourseImportModal({targetRoleId,roleName,existingCourses,period,onConfirm,onCancel}){
  const{T,theme}=useT();
  const{gRole}=useRolesData();
  const mono={fontFamily:"'DM Mono',monospace"};
  const dept=gRole(targetRoleId),dClr=dtc(dept,theme);
  const[step,setStep]=useState('pick');
  const[rows,setRows]=useState([]);
  const[tab,setTab]=useState('valid');
  const[parseError,setParseError]=useState(null);

  const handleFile=async file=>{
    setParseError(null);
    try{
      const isSpreadsheet=/\.(ods|xlsx|xls)$/i.test(file.name);
      const tableRows=isSpreadsheet?await parseSheetRows(file):parseCsvRows(await file.text());
      if(tableRows.length<2){setParseError('Arquivo vazio ou sem linhas de dados.');return;}
      const parsed=groupSigaaRows(tableRows);
      const rowKey=r=>`${String(r.normalized.code??'').trim().toUpperCase()}__${r.normalized.sec}`;
      const groups={};
      parsed.forEach(r=>{if(Object.keys(r.errors).length===0)(groups[rowKey(r)]=groups[rowKey(r)]||[]).push(r);});
      parsed.forEach(r=>{
        if(Object.keys(r.errors).length>0)return;
        if(groups[rowKey(r)].length>1)r.errors.secao='Código + seção duplicados neste arquivo';
      });
      setRows(parsed);setTab('valid');setStep('preview');
    }catch(e){
      setParseError(`Falha ao ler o arquivo: ${e.message}`);
    }
  };

  const validRows=rows.filter(r=>Object.keys(r.errors).length===0);
  const invalidRows=rows.filter(r=>Object.keys(r.errors).length>0);
  const allocatedExisting=existingCourses.filter(c=>hasAnyAllocation(c)).length;

  const handleConfirmImport=()=>onConfirm(validRows.map(r=>({
    id:courseId(targetRoleId,r.normalized.code,r.normalized.sec,period),
    code:r.normalized.code,name:r.normalized.name,sec:r.normalized.sec,roleId:targetRoleId,period,
    teacher:r.normalized.teacher,blocks:r.normalized.blocks,enroll:r.normalized.enroll,
  })));

  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,width:600,maxHeight:'85vh',display:'flex',flexDirection:'column',animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>

        {step==='pick'&&(
          <>
            <div style={{padding:'20px 24px',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
                <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19}}>⇪</div>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Importar Disciplinas — {roleName} <span style={{color:T.dim,fontWeight:400}}>({period})</span></div>
                  <div style={{...mono,fontSize:10,color:T.dim,marginTop:2}}>Substitui as disciplinas do departamento neste período — outros períodos não são afetados</div>
                </div>
                <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
              </div>
              <div style={{background:T.inner,borderRadius:8,padding:'12px 14px',marginBottom:16,border:`1px solid ${T.bdr}`,fontSize:12,color:T.txt2,lineHeight:1.7}}>
                Arquivo <strong>.ods, .xlsx ou .csv</strong> no formato do relatório de oferta de turmas do SIGAA: uma linha de cabeçalho por disciplina (<span style={{...mono,background:T.faint,padding:'1px 4px',borderRadius:3}}>"CÓDIGO - NOME (NÍVEL)"</span>) seguida de uma linha por turma, com as colunas Ano Período, Turma, Docente(s), Tipo, Situação, Horário, Local e Mat./Cap.
                <br/>Ano Período, Tipo, Situação e Local do arquivo são ignorados — o período é o já selecionado nesta tela, e turmas sem professor definido ainda entram normalmente.
                <br/>Horário usa o código do SIGAA (ex.: <span style={mono}>35M34</span>, podendo ter mais de um bloco separado por espaço para dias com horários diferentes).
              </div>
              <a href={importTemplateXlsx} download="modelo-importacao-disciplinas.xlsx"
                style={{display:'inline-block',padding:'6px 12px',marginBottom:12,background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,textDecoration:'none',cursor:'pointer'}}>⬇ Baixar modelo (.xlsx)</a>
              <input type="file" accept=".csv,.ods,.xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}} style={{...mono,fontSize:12,color:T.txt,display:'block'}}/>
              {parseError&&<div style={{fontSize:12,color:'#ef4444',marginTop:10}}>{parseError}</div>}
            </div>
            <div style={{padding:'14px 20px',borderTop:`1px solid ${T.bdr}`,display:'flex',justifyContent:'flex-end'}}>
              <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            </div>
          </>
        )}

        {step==='preview'&&(
          <>
            <div style={{padding:'20px 24px 16px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19}}>⇪</div>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Pré-visualização do Import</div>
                  <div style={{...mono,fontSize:10,color:T.dim,marginTop:2}}>Revise antes de continuar — corrija o arquivo se houver erros</div>
                </div>
                <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
              </div>
              <div style={{display:'flex',gap:8}}>
                <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,textAlign:'center'}}>
                  <div style={{fontSize:23,fontWeight:700,color:theme==='light'?'#15803d':'#34D399',lineHeight:1}}>{validRows.length}</div>
                  <div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>VÁLIDAS</div>
                </div>
                {invalidRows.length>0&&(
                  <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:7,textAlign:'center'}}>
                    <div style={{fontSize:23,fontWeight:700,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1}}>{invalidRows.length}</div>
                    <div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>COM ERRO</div>
                  </div>
                )}
              </div>
            </div>
            <div style={{display:'flex',gap:0,borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
              {[['valid',`✓ Válidas (${validRows.length})`],['invalid',`⚠ Com erro (${invalidRows.length})`]].map(([key,label])=>(
                key!=='valid'&&invalidRows.length===0?null:(
                  <button key={key} onClick={()=>setTab(key)} style={{flex:1,padding:'9px',fontSize:12,fontWeight:500,cursor:'pointer',background:'transparent',border:'none',borderBottom:`2px solid ${tab===key?dept.clr:'transparent'}`,color:tab===key?dClr:T.muted,transition:'all .12s'}}>{label}</button>
                )
              ))}
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
              {tab==='valid'?(
                validRows.length===0?<div style={{textAlign:'center',padding:32,color:T.dim,fontSize:13}}>Nenhuma linha válida.</div>
                :validRows.map((r,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 20px',borderBottom:`1px solid ${T.bdr}`,background:i%2===0?'transparent':(theme==='light'?T.faint:T.inner+'88')}}>
                    <div style={{width:2,height:30,borderRadius:1,background:dept.clr,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                        <span style={{...mono,fontSize:10,color:dClr}}>{r.normalized.code}{r.normalized.sec!=null?` · Turma ${r.normalized.sec}`:''}</span>
                        <span style={{fontSize:12,color:T.txt,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.normalized.name}</span>
                      </div>
                      <div style={{...mono,fontSize:10,color:T.dim}}>{fmtSchedule({blocks:r.normalized.blocks})} · {r.normalized.enroll} alunos</div>
                      {r.normalized.teacher&&<div style={{fontSize:10,color:T.muted,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>👤 {r.normalized.teacher}</div>}
                    </div>
                  </div>
                ))
              ):(
                invalidRows.map((r,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 20px',borderBottom:`1px solid ${T.bdr}`}}>
                    <div style={{width:2,height:30,borderRadius:1,background:'#ef4444',flexShrink:0,marginTop:2}}/>
                    <div>
                      <div style={{fontSize:12,color:T.txt,fontWeight:500,marginBottom:2}}>{r.raw.codigo||'(sem código)'}{r.raw.nome?` · ${r.raw.nome}`:''} {r.raw.turma?`· Turma ${r.raw.turma}`:''}</div>
                      {Object.entries(r.errors).map(([field,msg])=>(
                        <div key={field} style={{fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.4}}>{field}: {msg}</div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div style={{padding:'16px 20px',borderTop:`1px solid ${T.bdr}`,flexShrink:0,display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setStep('pick')} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Voltar</button>
              <button onClick={()=>setStep('confirm')} disabled={invalidRows.length>0||validRows.length===0}
                style={{padding:'8px 22px',borderRadius:7,fontSize:12,fontWeight:700,cursor:(invalidRows.length>0||validRows.length===0)?'not-allowed':'pointer',background:(invalidRows.length>0||validRows.length===0)?T.inner:dept.clr,border:'none',color:(invalidRows.length>0||validRows.length===0)?T.dim:(theme==='light'?'#fff':'#000')}}>
                Continuar
              </button>
            </div>
          </>
        )}

        {step==='confirm'&&(
          <div style={{padding:28}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
              <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#fef2f2':'#1a0505',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:19}}>⚠</div>
              <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Substituir Disciplinas de {roleName}?</div>
              <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{background:theme==='light'?'#fef2f2':'#1a0505',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`,borderRadius:8,padding:'12px 14px',marginBottom:20,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.7}}>
              Isso vai <strong>excluir permanentemente {existingCourses.length} disciplina{existingCourses.length!==1?'s':''} existente{existingCourses.length!==1?'s':''}</strong> do {roleName} no período <strong>{period}</strong>{allocatedExisting>0?<>, incluindo <strong>{allocatedExisting} já alocada{allocatedExisting!==1?'s':''} em sala{allocatedExisting!==1?'s':''}</strong> (essas alocações serão perdidas)</>:''}. Outros períodos não são afetados. As <strong>{validRows.length} novas disciplinas</strong> do arquivo serão inseridas em seguida. Esta ação não pode ser desfeita.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setStep('preview')} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Voltar</button>
              <button onClick={handleConfirmImport} style={{padding:'8px 20px',borderRadius:7,fontSize:12,fontWeight:700,background:'#ef4444',border:'none',color:'#fff',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.1)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
                Excluir e Importar {validRows.length} Disciplina{validRows.length!==1?'s':''}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── Modal de mesclagem ───────────────────────────────────────────────────────
function MergeModal({room,incomingCourse,conflicts,totalEnroll,dept,day,onConfirm,onCancel}){
  const{T,theme}=useT();
  const{gRole,gBlockLabel}=useRolesData();
  const rd=gRole(room.roleId),dClr=dtc(dept,theme);
  const incomingBlock=blockForDay(incomingCourse,day);
  const over=totalEnroll>room.cap,existing=conflicts.reduce((s,c)=>s+c.enroll,0);
  const pctEx=Math.min(existing/room.cap,1)*100,pctNew=Math.min(incomingCourse.enroll/room.cap,Math.max(0,1-pctEx/100))*100;
  const[confirmed,setConfirmed]=useState(false);
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:34,height:34,borderRadius:8,background:theme==='light'?'#fffbeb':'#1a1400',border:`1px solid ${theme==='light'?'#f59e0b44':'#F59E0B44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17}}>⇄</div>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Mesclar Turmas?</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim,marginTop:2}}>{room.label} · {room.type} · {gBlockLabel(room.blockId)}</div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:10,padding:'14px 16px',marginBottom:16,border:`1px solid ${T.bdr}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>Capacidade da Sala</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:19,fontWeight:700,color:over?'#ef4444':totalEnroll/room.cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399'}}>{totalEnroll}<span style={{fontSize:12,color:T.dim}}> / {room.cap}</span></span>
          </div>
          <div style={{height:10,borderRadius:5,background:T.barTrack,overflow:'hidden',display:'flex',marginBottom:8}}>
            <div style={{width:`${pctEx}%`,background:T.barExist,transition:'width .4s',flexShrink:0}}/>
            <div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',transition:'width .4s',flexShrink:0}}/>
          </div>
          <div style={{display:'flex',gap:16}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.barExist}}>■ existente: {existing}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:over?'#ef4444':'#d97706'}}>■ entrante: {incomingCourse.enroll}</span>
          </div>
          {over&&<div style={{marginTop:10,padding:'7px 10px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:6,fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444'}}>⚠ A matrícula combinada excede a capacidade em <strong>{totalEnroll-room.cap} alunos</strong>.</div>}
        </div>
        <div style={{marginBottom:over?14:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Disciplinas compartilhando esta sala</div>
          <div style={{padding:'9px 12px',background:dbg(dept,theme),border:`1px solid ${dept.clr}44`,borderRadius:7,marginBottom:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:dClr,fontWeight:600}}>{incomingCourse.code}</span><span style={{fontSize:11,color:T.txt2,marginLeft:8}}>{incomingCourse.name}</span></div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{fmtHour(incomingBlock.sh)}–{fmtHour(incomingBlock.eh)}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:dClr,background:dbg(dept,theme),border:`1px solid ${dept.clr}55`,borderRadius:3,padding:'1px 5px'}}>NOVA</span>
              </div>
            </div>
          </div>
          {conflicts.map(c=>{const cd=gRole(c.roleId),cdClr=dtc(cd,theme),cBlock=blockForDay(c,day);return(
            <div key={c.id} style={{padding:'9px 12px',background:T.card,border:`1px solid ${T.bdr}`,borderRadius:7,marginBottom:4}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:cdClr}}>{c.code}</span><span style={{fontSize:11,color:T.muted,marginLeft:8}}>{c.name}</span></div>
                <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{fmtHour(cBlock.sh)}–{fmtHour(cBlock.eh)}</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.muted}}>{c.enroll} al.</span></div>
              </div>
            </div>
          );})}
        </div>
        {over&&<label style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,cursor:'pointer',userSelect:'none',padding:'8px 10px',background:theme==='light'?'#fef2f2':'#1a0505',borderRadius:6,border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`}}>
          <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} style={{accentColor:'#ef4444',width:14,height:14}}/>
          <span style={{fontSize:12,color:theme==='light'?'#b91c1c':'#ef4444'}}>Estou ciente de que isso excede a capacidade da sala e desejo continuar</span>
        </label>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background=T.inner} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>Cancelar</button>
          <button onClick={onConfirm} disabled={over&&!confirmed} style={{padding:'8px 20px',borderRadius:7,fontSize:12,fontWeight:700,transition:'all .15s',background:over?(confirmed?'#ef4444':theme==='light'?'#f3f4f6':'#1a0505'):'#F59E0B',border:over?`1px solid ${confirmed?'#ef4444':T.bdr}`:'none',color:over?(confirmed?'#fff':T.dim):'#000',cursor:over&&!confirmed?'not-allowed':'pointer'}} onMouseEnter={e=>{if(!(over&&!confirmed))e.currentTarget.style.filter='brightness(1.08)';}} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
            {over?'⚠ Confirmar Mesclagem':'⇄ Confirmar Mesclagem'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de escolha de dias (vista em Salas) ────────────────────────────────
// Só aparece quando a sala está livre pra disciplina inteira E ela ocorre em
// mais de um dia — pergunta se é pra alocar todos os dias nesta sala (o caso
// comum, um clique) ou só um subconjunto específico (marca os dias e confirma).
function DayPickerModal({room,course,dept,onConfirm,onCancel}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const dClr=dtc(dept,theme);
  const days=useMemo(()=>courseDays(course).sort((a,b)=>DAYS.indexOf(a)-DAYS.indexOf(b)),[course]);
  const[selectedDays,setSelectedDays]=useState(days);
  const toggleDay=d=>setSelectedDays(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d].sort((a,b)=>DAYS.indexOf(a)-DAYS.indexOf(b)));
  const allDays=selectedDays.length===days.length;
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:400,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
          <div style={{width:3,height:20,borderRadius:1,background:dept.clr}}/>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Em quais dias alocar?</div>
            <div style={{...mono,fontSize:10,color:dClr,marginTop:2}}>{course.code} → {room?.label}</div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{fontSize:12,color:T.txt2,lineHeight:1.6,marginBottom:16}}>
          Esta disciplina ocorre em mais de um dia ({days.map(d=>d.slice(0,3)).join('/')}). Esta sala está livre em todos eles — quer alocá-la para a semana toda, ou só para alguns dias (deixando o resto pendente, pra alocar em outra sala depois)?
        </div>
        <button onClick={()=>onConfirm(null)} style={{width:'100%',padding:'10px',marginBottom:14,background:dept.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:12,fontWeight:700,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
          Todos os dias ({days.map(d=>d.slice(0,3)).join('/')})
        </button>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{flex:1,height:1,background:T.bdr}}/>
          <span style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>ou escolha os dias</span>
          <div style={{flex:1,height:1,background:T.bdr}}/>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:18}}>
          {days.map(d=>(
            <button key={d} type="button" onClick={()=>toggleDay(d)}
              style={{padding:'6px 12px',borderRadius:6,fontSize:12,fontWeight:500,cursor:'pointer',transition:'all .1s',background:selectedDays.includes(d)?dept.clr:'transparent',color:selectedDays.includes(d)?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${selectedDays.includes(d)?dept.clr:T.bdr2}`}}>
              {d}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button onClick={()=>onConfirm(selectedDays)} disabled={selectedDays.length===0}
            style={{padding:'8px 20px',borderRadius:7,fontSize:12,fontWeight:700,cursor:selectedDays.length===0?'not-allowed':'pointer',background:selectedDays.length===0?T.inner:dept.clr,border:'none',color:selectedDays.length===0?T.dim:(theme==='light'?'#fff':'#000')}}>
            {allDays?'Confirmar (todos os dias)':`Confirmar (${selectedDays.length} dia${selectedDays.length!==1?'s':''})`}
          </button>
        </div>
      </div>
    </div>
  );
}
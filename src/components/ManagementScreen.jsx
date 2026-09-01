/**
 * components/ManagementScreen.jsx
 * Tela de gerenciamento institucional — usuários, funções, sub-unidades,
 * salas e blocos. Terceira opção da tela "O que você quer fazer?"
 * (classroom-allocation.jsx: ScreenSelector), visível a qualquer usuário com
 * permissão de gerenciamento (não hardcoded a um único role "Diretor" — ver
 * `canManage` em ScreenSelector). Autocontida como ScreenSelector/RoomMapScreen
 * (própria useAuth()/useT()), recebe só `{onBack}`.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT, dtc, dbg } from '../theme.jsx';
import { PERMS } from '../auth/permissions.js';
import { isInstitutionalRole } from '../auth/roles.js';
import { DEFAULT_PERIOD, PERIOD_RE, comparePeriods } from '../periods.js';
import * as db from '../db/allocations.js';
import * as mgmt from '../db/management.js';
import * as authApi from '../db/authApi.js';
import { formatDateTime } from '../auth/utils.js';

const PERM_LABELS = {
  [PERMS.VIEW_OWN_COURSES]: 'Ver disciplinas da própria função',
  [PERMS.VIEW_ALL_COURSES]: 'Ver disciplinas de todas as funções',
  [PERMS.EDIT_COURSES]: 'Editar disciplinas',
  [PERMS.VIEW_ALL_ROOMS]: 'Ver todas as salas',
  [PERMS.EDIT_ROOM_DESCRIPTION]: 'Editar descrição/recursos de sala',
  [PERMS.ALLOCATE_OWN_ROOMS]: 'Alocar salas da própria função',
  [PERMS.ALLOCATE_ALL_ROOMS]: 'Alocar qualquer sala (institucional)',
  [PERMS.DEALLOCATE_OWN_ROOMS]: 'Desalocar salas da própria função',
  [PERMS.DEALLOCATE_ALL_ROOMS]: 'Desalocar qualquer sala (institucional)',
  [PERMS.MERGE_GROUPS]: 'Mesclar turmas na mesma sala',
  [PERMS.FINISH_ALLOCATION]: 'Marcar alocação como concluída',
  [PERMS.MANAGE_COORDINATION_STATUS]: 'Reabrir/forçar conclusão de coordenações',
  [PERMS.VIEW_USERS]: 'Ver usuários',
  [PERMS.CREATE_ANY_USER]: 'Criar usuários',
  [PERMS.EDIT_ANY_USER]: 'Editar usuários',
  [PERMS.DEACTIVATE_USER]: 'Desativar usuários',
  [PERMS.DELETE_USER]:     'Excluir usuários permanentemente',
  [PERMS.ASSIGN_ROLES]: 'Atribuir funções a usuários',
  [PERMS.MANAGE_SUB_UNITS]: 'Gerenciar sub-unidades',
  [PERMS.MANAGE_ROLES]: 'Gerenciar funções',
  [PERMS.MANAGE_ROOMS]: 'Gerenciar salas',
  [PERMS.MANAGE_BLOCKS]: 'Gerenciar blocos',
};

const COORD_PERMS = [
  PERMS.VIEW_OWN_COURSES, PERMS.EDIT_COURSES,
  PERMS.ALLOCATE_OWN_ROOMS, PERMS.DEALLOCATE_OWN_ROOMS,
  PERMS.MERGE_GROUPS, PERMS.FINISH_ALLOCATION,
];
const DIRECTOR_PERMS = Object.values(PERMS);
const PERM_PRESETS = [
  { key:'coord',     label:'Coordenação',          perms: COORD_PERMS },
  { key:'dept_head', label:'Chefe de Departamento', perms: COORD_PERMS },
  { key:'director',  label:'Diretor',               perms: DIRECTOR_PERMS },
];
const sortedKey = arr => [...arr].sort().join(',');
const PRESET_KEYS = Object.fromEntries(PERM_PRESETS.map(p=>[sortedKey(p.perms), p.key]));
const presetActive = (key, permissions) => sortedKey(permissions) === sortedKey(PERM_PRESETS.find(p=>p.key===key)?.perms??[]);

const NEUTRAL = { clr:'#94A3B8', textClr:'#475569' };

function ptError(e) {
  const msg = e?.message ?? String(e);
  if (msg.includes('foreign key constraint'))  return 'Referência inválida: verifique se todos os campos obrigatórios foram selecionados.';
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) return 'Já existe um registro com esse valor (dado duplicado).';
  if (msg.includes('null value in column'))    return 'Campo obrigatório não preenchido.';
  if (msg.includes('value too long'))          return 'Um dos campos excede o tamanho máximo permitido.';
  if (msg.includes('invalid input syntax'))    return 'Formato de dado inválido em um dos campos.';
  return msg;
}

export default function ManagementScreen({ onBack, courses=[], onPeriodCreated, currentPeriodOverride=null }) {
  const { currentUser, logout, can } = useAuth();
  const { T, theme, toggleTheme } = useT();
  const mono = { fontFamily:"'DM Mono',monospace" };
  const isInstitutional = isInstitutionalRole(currentUser.role);

  const [subUnits, setSubUnits] = useState([]);
  const [roles, setRoles] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  // Períodos persistidos (tabela periods) — existem por conta própria, sem
  // depender de ter alguma disciplina cadastrada (ver PeriodsTab abaixo).
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  // Erros (ex.: "sub-unidade ainda tem funções vinculadas") costumam ser mais
  // longos e mais importantes de realmente ler do que uma confirmação de
  // sucesso — por isso ficam visíveis bem mais tempo (8s) do que um "ok"
  // (4s), que é só uma confirmação rápida do que o usuário acabou de fazer.
  // flashTimer guarda o timeout pendente pra poder cancelá-lo: sem isso, um
  // flash antigo (ex. um "ok" de 4s) podia apagar um flash novo e mais
  // importante (ex. um "err" de 8s) que apareceu logo em seguida, antes do
  // tempo dele terminar.
  const flashTimer = useRef(null);
  const flash = (type, msg) => {
    clearTimeout(flashTimer.current);
    setFeedback({ type, msg });
    flashTimer.current = setTimeout(() => setFeedback(null), type === 'err' ? 8000 : 4000);
  };

  const reloadDomain = () => db.fetchAll().then(d => {
    setSubUnits(d.subUnits); setRoles(d.roles); setBlocks(d.blocks); setRooms(d.rooms); setPeriods(d.periods);
  });
  const reloadUsers = () => authApi.getUsers().then(setUsers);

  useEffect(() => {
    let active = true;
    Promise.all([db.fetchAll(), authApi.getUsers()])
      .then(([d, u]) => {
        if (!active) return;
        setSubUnits(d.subUnits); setRoles(d.roles); setBlocks(d.blocks); setRooms(d.rooms); setUsers(u); setPeriods(d.periods);
      })
      .catch(e => { if (active) setLoadError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const tabs = [
    { key:'subunits',   label:'Sub-Unidades',       perm:PERMS.MANAGE_SUB_UNITS },
    { key:'usersroles', label:'Usuários e Funções', anyPerm:[PERMS.CREATE_ANY_USER, PERMS.MANAGE_ROLES] },
    { key:'rooms',      label:'Salas e Blocos',     perm:PERMS.MANAGE_ROOMS },
  ].filter(t => t.anyPerm ? t.anyPerm.some(p => can(p)) : can(t.perm));
  // "Períodos" não é gated por PERMS.* — segue o mesmo critério estrutural
  // (isInstitutional) que já valia pro antigo botão "+" de criar período em
  // Alocar Disciplinas, evitando exigir uma migração/concessão de permissão
  // nova pra uma função "Diretor" já existente usar isto de cara.
  if (isInstitutional) tabs.push({ key:'periods', label:'Períodos' });
  // "Usuários e Funções" continua abrindo direto na visão de Usuários por
  // padrão (mesma funcionalidade de antes), mesmo que essa aba não seja mais
  // a primeira da barra — daí o default explícito em vez de tabs[0].
  const [tab, setTab] = useState(() => tabs.some(t => t.key === 'usersroles') ? 'usersroles' : (tabs[0]?.key ?? 'subunits'));

  const gRole = id => {
    const role = roles.find(r => r.id === id);
    if (!role) return { full:'—', ...NEUTRAL };
    const su = role.subUnitId ? subUnits.find(s => s.id === role.subUnitId) : null;
    return su ? { full:role.name, clr:su.clr, textClr:su.textClr } : { full:role.name, ...NEUTRAL };
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button,select,input,textarea{font-family:inherit;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:${T.scrollTrack};}
        ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px;}
        .icon-btn:hover{background:${T.inner}!important;border-color:${T.muted}!important;}
        .mgmt-tab:hover{color:${T.txt}!important;}
      `}</style>

      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',background:T.surface,borderBottom:`1px solid ${T.bdr}`,flexShrink:0,boxShadow:T.shadowSm}}>
        <button className="icon-btn" onClick={onBack} title="Voltar ao menu" style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>☰</button>
        <span style={{fontSize:14,fontWeight:700,color:T.txt}}>⚙️ Gerenciamento</span>
        <div style={{width:1,height:16,background:T.bdr2}}/>
        {tabs.map(t => (
          <button key={t.key} className="mgmt-tab" onClick={() => setTab(t.key)}
            style={{padding:'5px 12px',borderRadius:6,fontSize:12,fontWeight:600,background:tab===t.key?T.inner:'transparent',border:`1px solid ${tab===t.key?T.bdr2:'transparent'}`,color:tab===t.key?T.txt:T.muted,cursor:'pointer'}}>
            {t.label}
          </button>
        ))}
        <div style={{flex:1}}/>
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <span style={{...mono,fontSize:10,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:9,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{currentUser.role.name}</span>
        </div>
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Sair</button>
      </div>

      {feedback && (
        <div style={{margin:'10px 18px 0',padding:'8px 12px',borderRadius:6,fontSize:13,flexShrink:0,
          background:feedback.type==='ok'?(theme==='light'?'#f0fdf4':'#0a2a0a'):(theme==='light'?'#fef2f2':'#2a0a0a'),
          border:`1px solid ${feedback.type==='ok'?(theme==='light'?'#86efac':'#34d39944'):(theme==='light'?'#fca5a5':'#ef444444')}`,
          color:feedback.type==='ok'?(theme==='light'?'#15803d':'#34d399'):(theme==='light'?'#b91c1c':'#ef4444')}}>
          {feedback.msg}
        </div>
      )}

      <div style={{flex:1,overflow:'auto'}}>
        {loading?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',...mono,fontSize:12,color:T.dim}}>Carregando…</div>
        ):loadError?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',...mono,fontSize:12,color:'#ef4444'}}>Erro ao carregar: {loadError}</div>
        ):(
          <>
            {tab==='usersroles'&&<UsersRolesTab users={users} roles={roles} subUnits={subUnits} rooms={rooms} blocks={blocks} can={can} currentUser={currentUser} reloadUsers={reloadUsers} reloadDomain={reloadDomain} flash={flash} gRole={gRole}/>}
            {tab==='subunits'&&<SubUnitsTab subUnits={subUnits} roles={roles} can={can} reloadDomain={reloadDomain} flash={flash}/>}
            {tab==='rooms'&&<RoomsBlocksTab rooms={rooms} blocks={blocks} roles={roles} subUnits={subUnits} courses={courses} can={can} reloadDomain={reloadDomain} flash={flash} gRole={gRole}/>}
            {tab==='periods'&&<PeriodsTab courses={courses} periods={periods} onPeriodCreated={onPeriodCreated} currentPeriodOverride={currentPeriodOverride} flash={flash} reloadDomain={reloadDomain}/>}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Layout comum: lista à esquerda + painel lateral de formulário ───────────
function PanelLayout({ T, list, panel }) {
  return (
    <div style={{display:'flex',height:'100%'}}>
      <div style={{flex:1,overflow:'auto',padding:18}}>{list}</div>
      {panel&&<div style={{width:340,borderLeft:`1px solid ${T.bdr}`,overflow:'auto',background:T.card,flexShrink:0,padding:20}}>{panel}</div>}
    </div>
  );
}

const inpStyle = T => ({width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:13,outline:'none'});
const lblStyle = T => ({fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4});

// ─── Aba Usuários e Funções ───────────────────────────────────────────────────
// Mescla as antigas abas "Usuários" e "Funções" numa aba só, com um sub-toggle
// interno igual ao de RoomsBlocksTab (Salas/Blocos) — cada sub-view continua
// sendo o mesmo componente autocontido de antes (UsersTab/RolesTab), só que
// selecionado por este estado local em vez de por abas separadas no topo.
// Abre em 'users' por padrão, preservando o comportamento de "Usuários é a
// visão inicial ao entrar no Gerenciamento".
function UsersRolesTab({ users, roles, subUnits, rooms, blocks, can, currentUser, reloadUsers, reloadDomain, flash, gRole }) {
  const { T } = useT();
  const [sub, setSub] = useState('users'); // 'users' | 'roles'

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
      <div style={{display:'flex',gap:6,padding:'14px 18px 0'}}>
        {[['users','Usuários'],['roles','Funções']].map(([k,l])=>(
          <button key={k} onClick={()=>setSub(k)}
            style={{padding:'6px 14px',borderRadius:6,fontSize:12,fontWeight:600,background:sub===k?T.inner:'transparent',border:`1px solid ${sub===k?T.bdr2:'transparent'}`,color:sub===k?T.txt:T.muted,cursor:'pointer'}}>
            {l}
          </button>
        ))}
      </div>
      <div style={{flex:1,overflow:'hidden'}}>
        {sub==='users'
          ? <UsersTab users={users} roles={roles} subUnits={subUnits} can={can} currentUser={currentUser} reloadUsers={reloadUsers} flash={flash} gRole={gRole}/>
          : <RolesTab roles={roles} subUnits={subUnits} rooms={rooms} blocks={blocks} users={users} can={can} reloadDomain={reloadDomain} flash={flash}/>}
      </div>
    </div>
  );
}

// ─── Aba Usuários ─────────────────────────────────────────────────────────────
function UsersTab({ users, roles, subUnits, can, currentUser, reloadUsers, flash, gRole }) {
  const { T, theme } = useT();
  const [editing, setEditing] = useState(null); // user object | 'new' | null
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // user | null
  const [deleting, setDeleting] = useState(false);
  // Já nasce em 'name' pois é a ordenação que já vem do backend (ver
  // list_app_users em schema.sql) — assim o indicador de coluna ativa reflete
  // a ordenação real desde a primeira renderização, em vez de nenhuma coluna
  // aparecer marcada enquanto a lista já está, de fato, ordenada por nome.
  const [sortKey, setSortKey] = useState('name'); // 'name'|'username'|'role'|'status'
  const [sortDir, setSortDir] = useState('asc');

  const isSystemUser = u => u.username === 'admin';

  const startCreate = () => { setEditing('new'); setForm({ name:'', username:'', email:'', roleId:'', password:'' }); setConfirmDelete(null); };
  const startEdit = u => { setEditing(u); setForm({ name:u.name, username:u.username, email:u.email, roleId:u.roleId, password:'', isActive:u.isActive }); setConfirmDelete(null); };
  const cancel = () => { setEditing(null); setForm(null); };

  const visible = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  }, [users, search]);

  const userSortValue = (u, key) => {
    switch (key) {
      case 'name': return u.name ?? '';
      case 'username': return u.username ?? '';
      case 'role': return gRole(u.roleId).full;
      case 'status': return u.isActive ? 1 : 0;
      default: return '';
    }
  };
  const toggleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  const sorted = useMemo(() => {
    if (!sortKey) return visible;
    const arr = [...visible];
    arr.sort((a, b) => {
      const va = userSortValue(a, sortKey), vb = userSortValue(b, sortKey);
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sortKey, sortDir, roles]);

  const save = async () => {
    if (!form.name.trim())     return flash('err', 'Informe o nome completo.');
    if (!form.username.trim()) return flash('err', 'Informe o nome de usuário.');
    if (!form.email.trim())    return flash('err', 'Informe o e-mail.');
    if (!form.roleId)          return flash('err', 'Selecione uma função para o usuário.');
    if (editing === 'new' && !form.password) return flash('err', 'Informe uma senha.');
    try {
      if (editing === 'new') {
        await authApi.createUser(form);
        flash('ok', `Usuário "${form.username}" criado.`);
      } else {
        const patch = { name:form.name, email:form.email, roleId:form.roleId, isActive:form.isActive };
        if (form.password) patch.password = form.password;
        await authApi.updateUser(editing.id, patch);
        flash('ok', 'Usuário atualizado.');
      }
      cancel(); reloadUsers();
    } catch (e) { flash('err', ptError(e)); }
  };
  const deactivate = async u => {
    try { await authApi.deactivateUser(u.id); flash('ok', `${u.name} foi desativado(a).`); reloadUsers(); }
    catch (e) { flash('err', e.message); }
  };
  const activate = async u => {
    try { await authApi.updateUser(u.id, { isActive:true }); flash('ok', `${u.name} foi reativado(a).`); reloadUsers(); }
    catch (e) { flash('err', e.message); }
  };
  const confirmDeleteNow = async () => {
    const u = confirmDelete;
    setDeleting(true);
    try {
      await authApi.deleteUser(u.id);
      flash('ok', `${u.name} foi excluído(a) permanentemente.`); setConfirmDelete(null); reloadUsers();
    } catch (e) { flash('err', e.message); }
    finally { setDeleting(false); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        <div style={{display:'flex',gap:8,marginBottom:14}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome ou usuário…" style={{...inpStyle(T),flex:1}}/>
          {can(PERMS.CREATE_ANY_USER)&&<button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>+ Novo Usuário</button>}
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr style={{borderBottom:`1px solid ${T.bdr}`}}>
            {[['Nome','name'],['Usuário','username'],['Função','role'],['Status','status'],['',null]].map(([h,key])=>(
              <th key={h||'actions'} onClick={key?()=>toggleSort(key):undefined}
                style={{padding:'6px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:9,color:sortKey===key?T.txt:T.dim,textTransform:'uppercase',cursor:key?'pointer':'default',userSelect:'none',whiteSpace:'nowrap'}}>
                {h}{sortKey===key?(sortDir==='asc'?' ▲':' ▼'):''}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {sorted.map(u=>{
              const role=gRole(u.roleId);
              return(
                <tr key={u.id} style={{borderBottom:`1px solid ${T.bdr}`,opacity:u.isActive?1:.55}}>
                  <td style={{padding:'8px 10px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>{u.name}{isSystemUser(u)&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:'#94a3b8',background:'#94a3b822',border:'1px solid #94a3b844',borderRadius:3,padding:'1px 5px'}}>sistema</span>}</div>
                    {!isSystemUser(u)&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{u.email}</div>}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:"'DM Mono',monospace",fontSize:12}}>{u.username}</td>
                  <td style={{padding:'8px 10px'}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:role.textClr,background:`${role.clr}22`,border:`1px solid ${role.clr}44`,borderRadius:4,padding:'2px 7px'}}>{role.full}</span></td>
                  <td style={{padding:'8px 10px',fontSize:11,color:u.isActive?(theme==='light'?'#15803d':'#34d399'):T.dim}}>{u.isActive?'Ativo':'Inativo'}</td>
                  <td style={{padding:'8px 10px'}}>
                    <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                      {can(PERMS.EDIT_ANY_USER)&&<button onClick={()=>startEdit(u)} style={{padding:'3px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:11,cursor:'pointer'}}>Editar</button>}
                      {can(PERMS.DEACTIVATE_USER)&&u.isActive&&u.id!==currentUser.id&&!isSystemUser(u)&&<button onClick={()=>deactivate(u)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Desativar</button>}
                      {can(PERMS.EDIT_ANY_USER)&&!u.isActive&&!isSystemUser(u)&&<button onClick={()=>activate(u)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #22c55e55',borderRadius:4,color:'#22c55e',fontSize:11,cursor:'pointer'}}>Ativar</button>}
                      {can(PERMS.DELETE_USER)&&!u.isActive&&u.id!==currentUser.id&&!isSystemUser(u)&&<button onClick={()=>{cancel();setConfirmDelete(u);}} style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Excluir</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    )} panel={confirmDelete?(
      <div>
        <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:T.txt}}>Confirmar exclusão</div>
        <div style={{padding:'12px 14px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:8,marginBottom:16,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.6}}>
          O usuário <strong>{confirmDelete.name}</strong> ({confirmDelete.username}) será excluído permanentemente.
        </div>
        <div style={{fontSize:13,color:T.muted,marginBottom:16}}>Esta ação não pode ser desfeita.</div>
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={()=>setConfirmDelete(null)} disabled={deleting} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:deleting?'wait':'pointer'}}>Cancelar</button>
          <button type="button" onClick={confirmDeleteNow} disabled={deleting} style={{flex:2,padding:'8px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:deleting?'wait':'pointer',opacity:deleting?.7:1}}>{deleting?'Excluindo…':'Excluir usuário'}</button>
        </div>
      </div>
    ):editing&&(
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:T.txt}}>{editing==='new'?'Novo Usuário':'Editar Usuário'}</div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome Completo</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Usuário</label><input value={form.username} readOnly={editing!=='new'} onChange={e=>setForm({...form,username:e.target.value})} style={{...inpStyle(T),opacity:editing!=='new'?.6:1}}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>E-mail</label><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>{editing==='new'?'Senha':'Nova Senha (deixe em branco para manter)'}</label><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}>
          <label style={lblStyle(T)}>Função</label>
          <select value={form.roleId} onChange={e=>setForm({...form,roleId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
            <option value="" disabled>— Selecione uma função —</option>
            {subUnits.map(su=>{
              const suRoles=roles.filter(r=>r.subUnitId===su.id);
              if(!suRoles.length) return null;
              return(<optgroup key={su.id} label={su.fullName}>{suRoles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>);
            })}
            {roles.filter(r=>!r.subUnitId).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {editing!=='new'&&!isSystemUser(editing)&&(
          <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,cursor:'pointer',fontSize:13,color:T.txt}}>
            <input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/> Conta ativa
          </label>
        )}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>{editing==='new'?'Criar Usuário':'Salvar'}</button>
        </div>
      </form>
    )}/>
  );
}

// ─── Aba Funções ──────────────────────────────────────────────────────────────
function RolesTab({ roles, subUnits, rooms, blocks, users, can, reloadDomain, flash }) {
  const { T, theme } = useT();
  const [editing, setEditing] = useState(null); // role | 'new' | null
  const [form, setForm] = useState(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // {role, blocked, courseCount} | null
  const [deleting, setDeleting] = useState(false);

  const startCreate = () => { setForm({ id:crypto.randomUUID(), name:'', subUnitId:subUnits[0]?.id??'', permissions:[] }); setEditing('new'); setAdvOpen(false); setConfirmDelete(null); };
  const startEdit = r => { setForm({ id:r.id, name:r.name, subUnitId:r.subUnitId??'', permissions:[...r.permissions] }); setEditing(r); setAdvOpen(false); setConfirmDelete(null); };
  const cancel = () => { setEditing(null); setForm(null); setAdvOpen(false); };
  const togglePerm = p => setForm(f=>({...f,permissions:f.permissions.includes(p)?f.permissions.filter(x=>x!==p):[...f.permissions,p]}));

  const save = async () => {
    if (!form.name.trim()) return flash('err', 'Informe o nome da função.');
    try {
      const payload = { name:form.name, subUnitId:form.subUnitId||null, permissions:form.permissions };
      if (editing==='new') await mgmt.createRole({ id:form.id, ...payload });
      else await mgmt.updateRole(editing.id, payload);
      flash('ok','Função salva.'); cancel(); reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const remove = async r => {
    if (r.isSystem) { flash('err','Esta função é protegida e não pode ser excluída.'); return; }
    cancel();
    const linkedRooms = rooms.filter(rm=>rm.roleId===r.id);
    if (linkedRooms.length) {
      setConfirmDelete({ role:r, blocked:`Ainda há ${linkedRooms.length} sala(s) vinculada(s) a esta função (${linkedRooms.map(x=>x.label).join(', ')}). Desvincule-as antes de excluir.` });
      return;
    }
    const linkedUsers = users.filter(u=>u.roleId===r.id);
    if (linkedUsers.length) {
      setConfirmDelete({ role:r, blocked:`Ainda há ${linkedUsers.length} usuário(s) vinculado(s) a esta função (incluindo desativados) (${linkedUsers.map(x=>x.name).join(', ')}). Edite cada um e atribua outra função antes de excluir.` });
      return;
    }
    try {
      const courseCount = await mgmt.countRoleCourses(r.id);
      setConfirmDelete({ role:r, blocked:null, courseCount });
    } catch (e) { flash('err', `Não foi possível verificar disciplinas: ${e.message}`); }
  };
  const confirmRemove = async () => {
    setDeleting(true);
    try {
      await mgmt.deleteRoleAndCourses(confirmDelete.role.id);
      flash('ok', confirmDelete.courseCount>0?'Função e disciplinas associadas excluídas.':'Função excluída.');
      setConfirmDelete(null); reloadDomain();
    } catch (e) { flash('err', `Não foi possível excluir: ${e.message}`); }
    finally { setDeleting(false); }
  };
  const roomsOfRole = id => rooms.filter(r=>r.roleId===id);
  const toggleRoom = async (room, checked) => {
    try { await mgmt.updateRoom(room.id, { roleId: checked?editing.id:null }); reloadDomain(); }
    catch (e) { flash('err', e.message); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        {can(PERMS.MANAGE_ROLES)&&<button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Nova Função</button>}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {roles.map(r=>{
            const su=subUnits.find(s=>s.id===r.subUnitId);
            return(
              <div key={r.id} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:3,height:28,borderRadius:1,background:su?.clr??'#94A3B8'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.txt}}>{r.name}{r.isSystem&&<span style={{...{fontFamily:"'DM Mono',monospace"},fontSize:9,color:T.dim,marginLeft:6}}>(sistema)</span>}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{su?su.fullName:'Institucional'} · {r.permissions.length} permissões · {roomsOfRole(r.id).length} salas</div>
                </div>
                <button onClick={()=>startEdit(r)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}}>Editar</button>
                {!r.isSystem&&<button onClick={()=>remove(r)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Excluir</button>}
              </div>
            );
          })}
        </div>
      </>
    )} panel={confirmDelete?(
      <div>
        <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:T.txt}}>Confirmar exclusão</div>
        <div style={{padding:'12px 14px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:8,marginBottom:16,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.6}}>
          {confirmDelete.blocked
            ? confirmDelete.blocked
            : confirmDelete.courseCount>0
              ? <>A função <strong>{confirmDelete.role.name}</strong> possui <strong>{confirmDelete.courseCount} disciplina(s)</strong> associada(s) em todos os períodos. Ao excluir, todas serão removidas permanentemente.</>
              : <>A função <strong>{confirmDelete.role.name}</strong> não tem nenhuma sala, usuário ou disciplina vinculada e pode ser excluída com segurança.</>}
        </div>
        {!confirmDelete.blocked&&<div style={{fontSize:13,color:T.muted,marginBottom:16}}>Esta ação não pode ser desfeita.</div>}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={()=>setConfirmDelete(null)} disabled={deleting} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:deleting?'wait':'pointer'}}>{confirmDelete.blocked?'Entendi':'Cancelar'}</button>
          {!confirmDelete.blocked&&<button type="button" onClick={confirmRemove} disabled={deleting} style={{flex:2,padding:'8px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:deleting?'wait':'pointer',opacity:deleting?.7:1}}>{deleting?'Excluindo…':confirmDelete.courseCount>0?'Excluir tudo':'Excluir função'}</button>}
        </div>
      </div>
    ):editing&&(
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:T.txt}}>{editing==='new'?'Nova Função':'Editar Função'}</div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}>
          <label style={lblStyle(T)}>Sub-unidade (vazio = institucional)</label>
          <select value={form.subUnitId} onChange={e=>setForm({...form,subUnitId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
            <option value="">— Institucional —</option>
            {subUnits.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <label style={lblStyle(T)}>Permissões</label>
        <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}>
          {PERM_PRESETS.map(({key,label})=>{
            const active=presetActive(key,form.permissions);
            return(
              <button key={key} type="button"
                onClick={()=>{setForm(f=>({...f,permissions:[...PERM_PRESETS.find(p=>p.key===key).perms]}));setAdvOpen(false);}}
                style={{padding:'5px 12px',borderRadius:5,fontSize:12,fontWeight:600,cursor:'pointer',border:`1px solid ${active?'#3b82f6':T.bdr2}`,background:active?'#3b82f618':'transparent',color:active?'#3b82f6':T.muted}}>
                {label}
              </button>
            );
          })}
          {!PERM_PRESETS.some(p=>presetActive(p.key,form.permissions))&&form.permissions.length>0&&(
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>Personalizado</span>
          )}
          <button type="button" onClick={()=>setAdvOpen(v=>!v)}
            style={{marginLeft:'auto',padding:'5px 10px',borderRadius:5,fontSize:11,border:`1px solid ${T.bdr2}`,background:'transparent',color:T.muted,cursor:'pointer'}}>
            {advOpen?'Ocultar avançado ↑':'Avançado ↓'}
          </button>
        </div>
        {advOpen&&(
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14,maxHeight:260,overflow:'auto'}}>
            {Object.values(PERMS).map(p=>(
              <label key={p} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:T.txt2,cursor:'pointer'}}>
                <input type="checkbox" checked={form.permissions.includes(p)} onChange={()=>togglePerm(p)}/> {PERM_LABELS[p]??p}
              </label>
            ))}
          </div>
        )}
        {editing!=='new'&&(
          <>
            <label style={lblStyle(T)}>Salas desta função</label>
            <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:14,maxHeight:160,overflow:'auto'}}>
              {blocks.map(b=>{
                const bRooms=rooms.filter(r=>r.blockId===b.id);
                if(!bRooms.length) return null;
                return(
                  <div key={b.id}>
                    <div style={{fontSize:10,fontWeight:600,color:T.dim,textTransform:'uppercase',padding:'4px 0 2px'}}>{b.local} — {b.name}</div>
                    {bRooms.map(room=>(
                      <label key={room.id} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:T.txt2,cursor:'pointer',paddingLeft:8}}>
                        <input type="checkbox" checked={room.roleId===editing.id} onChange={e=>toggleRoom(room,e.target.checked)}/> {room.label}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>Salvar</button>
        </div>
      </form>
    )}/>
  );
}

// ─── Aba Sub-unidades ─────────────────────────────────────────────────────────
function SubUnitsTab({ subUnits, roles, can, reloadDomain, flash }) {
  const { T, theme } = useT();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // {subUnit, blocked} | null
  const [deleting, setDeleting] = useState(false);
  const DEFAULT_COLORS = { clr:'#60A5FA', textClr:'#1d4ed8', bg:'#0d1f3d', lightBg:'#eff6ff' };

  const startCreate = () => { setForm({ id:crypto.randomUUID(), name:'', fullName:'', ...DEFAULT_COLORS }); setEditing('new'); setColorOpen(false); setConfirmDelete(null); };
  const startEdit = s => { setForm({ ...s }); setEditing(s); setConfirmDelete(null); };
  const cancel = () => { setEditing(null); setForm(null); };

  const save = async () => {
    if (!form.name.trim())     return flash('err', 'Informe o nome curto da sub-unidade.');
    if (!form.fullName.trim()) return flash('err', 'Informe o nome completo da sub-unidade.');
    try {
      if (editing==='new') await mgmt.createSubUnit(form);
      else await mgmt.updateSubUnit(editing.id, form);
      flash('ok','Sub-unidade salva.'); cancel(); reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const toggleActive = async s => {
    try {
      await mgmt.setSubUnitActive(s.id, !s.isActive);
      flash('ok', s.isActive ? `${s.fullName} foi desativada.` : `${s.fullName} foi reativada.`);
      reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const remove = s => {
    cancel();
    const linked = roles.filter(r=>r.subUnitId===s.id);
    setConfirmDelete({
      subUnit: s,
      blocked: linked.length ? `Ainda há ${linked.length} função(ões) vinculada(s) a esta sub-unidade (${linked.map(r=>r.name).join(', ')}). Remova-as ou reatribua-as antes de excluir.` : null,
    });
  };
  const confirmRemoveNow = async () => {
    setDeleting(true);
    try {
      await mgmt.deleteSubUnit(confirmDelete.subUnit.id);
      flash('ok','Sub-unidade excluída.'); setConfirmDelete(null); reloadDomain();
    } catch (e) { flash('err', `Não foi possível excluir: ${e.message}`); }
    finally { setDeleting(false); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        {can(PERMS.MANAGE_SUB_UNITS)&&<button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Nova Sub-unidade</button>}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {subUnits.map(s=>(
            <div key={s.id} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12,opacity:s.isActive?1:.55}}>
              <div style={{width:3,height:28,borderRadius:1,background:s.clr}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600,color:T.txt}}>{s.fullName}{!s.isActive&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginLeft:6}}>(inativa)</span>}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{s.name&&<span style={{marginRight:8}}>{s.name}</span>}{roles.filter(r=>r.subUnitId===s.id).length} funções</div>
              </div>
              <button onClick={()=>startEdit(s)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}}>Editar</button>
              {s.isActive
                ? <button onClick={()=>toggleActive(s)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Desativar</button>
                : <>
                    <button onClick={()=>toggleActive(s)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #22c55e55',borderRadius:5,color:'#22c55e',fontSize:11,cursor:'pointer'}}>Ativar</button>
                    <button onClick={()=>remove(s)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Excluir</button>
                  </>}
            </div>
          ))}
        </div>
      </>
    )} panel={confirmDelete?(
      <div>
        <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:T.txt}}>Confirmar exclusão</div>
        <div style={{padding:'12px 14px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:8,marginBottom:16,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.6}}>
          {confirmDelete.blocked
            ? confirmDelete.blocked
            : <>A sub-unidade <strong>{confirmDelete.subUnit.fullName}</strong> não tem nenhuma função vinculada e pode ser excluída com segurança.</>}
        </div>
        {!confirmDelete.blocked&&<div style={{fontSize:13,color:T.muted,marginBottom:16}}>Esta ação não pode ser desfeita.</div>}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={()=>setConfirmDelete(null)} disabled={deleting} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:deleting?'wait':'pointer'}}>{confirmDelete.blocked?'Entendi':'Cancelar'}</button>
          {!confirmDelete.blocked&&<button type="button" onClick={confirmRemoveNow} disabled={deleting} style={{flex:2,padding:'8px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:deleting?'wait':'pointer',opacity:deleting?.7:1}}>{deleting?'Excluindo…':'Excluir sub-unidade'}</button>}
        </div>
      </div>
    ):editing&&(
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:T.txt}}>{editing==='new'?'Nova Sub-unidade':'Editar Sub-unidade'}</div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome curto</label><input value={form.name} maxLength={20} onChange={e=>setForm({...form,name:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome completo</label><input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} style={inpStyle(T)}/></div>
        <button type="button" onClick={()=>setColorOpen(v=>!v)}
          style={{width:'100%',marginBottom:colorOpen?8:16,padding:'6px 10px',borderRadius:5,fontSize:11,border:`1px solid ${T.bdr2}`,background:'transparent',color:T.muted,cursor:'pointer',textAlign:'left'}}>
          {colorOpen?'Cores ↑':'Cores ↓'}
        </button>
        {colorOpen&&(
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[['clr','Cor principal'],['textClr','Cor do texto']].map(([k,label])=>(
              <div key={k} style={{flex:1}}>
                <label style={lblStyle(T)}>{label}</label>
                <input type="color" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} style={{width:'100%',height:30,border:`1px solid ${T.inputBdr}`,borderRadius:6,cursor:'pointer'}}/>
              </div>
            ))}
          </div>
        )}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
          <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>Salvar</button>
        </div>
      </form>
    )}/>
  );
}

// ─── Aba Salas e Blocos ───────────────────────────────────────────────────────
function RoomsBlocksTab({ rooms, blocks, roles, subUnits, courses, can, reloadDomain, flash, gRole }) {
  const { T, theme } = useT();
  const [sub, setSub] = useState('rooms'); // 'rooms' | 'blocks'
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [blockForm, setBlockForm] = useState(null);
  // Sala: sem FK real pra courses (room_by_day é jsonb — soft reference),
  // então excluir não é bloqueado pelo banco; mostramos quantas disciplinas
  // seriam desalocadas antes de confirmar. Bloco: TEM FK real
  // (rooms.block_id ... on delete restrict), então o próprio Postgres
  // rejeitaria a exclusão com sala vinculada — aqui só antecipamos isso de
  // forma amigável (contando as salas antes de tentar) em vez de deixar o
  // erro cru do banco aparecer.
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState(null);   // room | null
  const [confirmDeleteBlock, setConfirmDeleteBlock] = useState(null); // block | null
  const [deleting, setDeleting] = useState(false);
  const [sortKey, setSortKey] = useState('role'); // 'label'|'block'|'type'|'cap'|'role'|'subUnit'
  const [sortDir, setSortDir] = useState('asc');

  const blockLabel = id => { const b=blocks.find(x=>x.id===id); return b?`${b.local} — ${b.name}`:'—'; };
  const roomCoursesOf = r => courses.filter(c => Object.values(c.roomByDay).includes(r.id));
  const roomsOfBlock = b => rooms.filter(r => r.blockId === b.id);

  const roleLabelOf = r => r.roleId ? gRole(r.roleId).full : (roles.find(ro=>ro.isSystem)?.name??'Diretoria');
  const subUnitLabelOf = r => {
    const roleObj = roles.find(ro=>ro.id===r.roleId);
    const su = roleObj?.subUnitId ? subUnits.find(s=>s.id===roleObj.subUnitId) : null;
    return su ? su.fullName : '';
  };
  const roomSortValue = (r, key) => {
    switch (key) {
      case 'label': return r.label ?? '';
      case 'block': return blockLabel(r.blockId);
      case 'type': return r.type ?? '';
      case 'cap': return r.cap ?? 0;
      case 'role': return roleLabelOf(r);
      case 'subUnit': return subUnitLabelOf(r);
      default: return '';
    }
  };
  const toggleSort = key => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };
  // Desempate fixo, sempre nesta ordem (Sub-Unidade → Função → Bloco → Sala),
  // pulando a coluna já usada como critério principal — a coluna escolhida
  // manualmente vira o primeiro critério, o resto da hierarquia resolve os
  // empates na ordem acima.
  const TIEBREAK_HIERARCHY = ['subUnit', 'role', 'block', 'label'];
  const compareByKey = (a, b, key) => {
    const va = roomSortValue(a, key), vb = roomSortValue(b, key);
    return typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
  };
  const sortedRooms = useMemo(() => {
    const chain = [sortKey, ...TIEBREAK_HIERARCHY.filter(k => k !== sortKey)];
    const arr = [...rooms];
    arr.sort((a, b) => {
      for (let i = 0; i < chain.length; i++) {
        const cmp = compareByKey(a, b, chain[i]);
        if (cmp !== 0) return i === 0 && sortDir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, sortKey, sortDir, blocks, roles, subUnits]);

  const startCreateRoom = () => { setRoomForm({ id:crypto.randomUUID(), label:'', cap:30, type:'Sala de Aula', floor:1, blockId:blocks[0]?.id??'', roleId:'', features:[], description:'' }); setEditingRoom('new'); setConfirmDeleteRoom(null); };
  const startEditRoom = r => { setRoomForm({ ...r, roleId:r.roleId??'' }); setEditingRoom(r); setConfirmDeleteRoom(null); };
  const cancelRoom = () => { setEditingRoom(null); setRoomForm(null); };
  const saveRoom = async () => {
    if (!roomForm.label.trim()) return flash('err', 'Informe o nome/número da sala.');
    if (!roomForm.blockId)      return flash('err', 'Selecione um bloco para a sala.');
    try {
      const payload = { ...roomForm, roleId:roomForm.roleId||null, cap:Number(roomForm.cap), floor:Number(roomForm.floor) };
      if (editingRoom==='new') await mgmt.createRoom(payload);
      else await mgmt.updateRoom(editingRoom.id, payload);
      flash('ok','Sala salva.'); cancelRoom(); reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const toggleRoomActive = async r => {
    try {
      await mgmt.setRoomActive(r.id, !r.isActive);
      flash('ok', r.isActive ? `Sala ${r.label} foi desativada.` : `Sala ${r.label} foi reativada.`);
      reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const startDeleteRoom = r => { setConfirmDeleteRoom(r); cancelRoom(); setConfirmDeleteBlock(null); };
  const cancelDeleteRoom = () => setConfirmDeleteRoom(null);
  const confirmDeleteRoomNow = async () => {
    const r = confirmDeleteRoom;
    setDeleting(true);
    try {
      const unallocated = await mgmt.deleteRoomAndUnallocate(r.id);
      flash('ok', unallocated ? `Sala excluída — ${unallocated} disciplina(s) desalocada(s) nela.` : 'Sala excluída.');
      setConfirmDeleteRoom(null);
      reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
    finally { setDeleting(false); }
  };

  const startCreateBlock = () => { setBlockForm({ id:crypto.randomUUID(), local:'', name:'' }); setEditingBlock('new'); setConfirmDeleteBlock(null); };
  const startEditBlock = b => { setBlockForm({ ...b }); setEditingBlock(b); setConfirmDeleteBlock(null); };
  const cancelBlock = () => { setEditingBlock(null); setBlockForm(null); };
  const saveBlock = async () => {
    if (!blockForm.local.trim()) return flash('err', 'Informe o centro do bloco.');
    if (!blockForm.name.trim())  return flash('err', 'Informe o nome do bloco.');
    try {
      if (editingBlock==='new') await mgmt.createBlock(blockForm);
      else await mgmt.updateBlock(editingBlock.id, blockForm);
      flash('ok','Bloco salvo.'); cancelBlock(); reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const toggleBlockActive = async b => {
    try {
      await mgmt.setBlockActive(b.id, !b.isActive);
      flash('ok', b.isActive ? `Bloco ${b.local} — ${b.name} foi desativado.` : `Bloco ${b.local} — ${b.name} foi reativado.`);
      reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
  };
  const startDeleteBlock = b => { setConfirmDeleteBlock(b); cancelBlock(); setConfirmDeleteRoom(null); };
  const cancelDeleteBlock = () => setConfirmDeleteBlock(null);
  const confirmDeleteBlockNow = async () => {
    const b = confirmDeleteBlock;
    setDeleting(true);
    try {
      await mgmt.deleteBlock(b.id);
      flash('ok', 'Bloco excluído.');
      setConfirmDeleteBlock(null);
      reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
    finally { setDeleting(false); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          {[['rooms','Salas'],['blocks','Blocos']].map(([k,l])=>(
            <button key={k} onClick={()=>{setSub(k);cancelRoom();cancelBlock();cancelDeleteRoom();cancelDeleteBlock();}} style={{padding:'6px 14px',borderRadius:6,fontSize:12,fontWeight:600,background:sub===k?T.inner:'transparent',border:`1px solid ${sub===k?T.bdr2:'transparent'}`,color:sub===k?T.txt:T.muted,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        {sub==='rooms'?(
          <>
            {can(PERMS.MANAGE_ROOMS)&&<button onClick={startCreateRoom} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Nova Sala</button>}
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{borderBottom:`1px solid ${T.bdr}`}}>
                {[['Sala','label'],['Bloco','block'],['Tipo','type'],['Vagas','cap'],['Função','role'],['Sub-unidade','subUnit'],[ '',null]].map(([h,key])=>(
                  <th key={h||'actions'} onClick={key?()=>toggleSort(key):undefined}
                    style={{padding:'6px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:9,color:sortKey===key?T.txt:T.dim,textTransform:'uppercase',cursor:key?'pointer':'default',userSelect:'none',whiteSpace:'nowrap'}}>
                    {h}{sortKey===key?(sortDir==='asc'?' ▲':' ▼'):''}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {sortedRooms.map(r=>{
                  const role=gRole(r.roleId);
                  const roleObj=roles.find(ro=>ro.id===r.roleId);
                  const su=roleObj?.subUnitId?subUnits.find(s=>s.id===roleObj.subUnitId):null;
                  const roleLabel=roleLabelOf(r);
                  return(
                    <tr key={r.id} style={{borderBottom:`1px solid ${T.bdr}`,opacity:r.isActive?1:.55}}>
                      <td style={{padding:'7px 10px'}}>{r.label}{!r.isActive&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginLeft:6}}>(inativa)</span>}</td>
                      <td style={{padding:'7px 10px',fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>{blockLabel(r.blockId)}</td>
                      <td style={{padding:'7px 10px',fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>{r.type}</td>
                      <td style={{padding:'7px 10px'}}>{r.cap}</td>
                      <td style={{padding:'7px 10px'}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:role.textClr,background:`${role.clr}22`,borderRadius:4,padding:'2px 6px'}}>{roleLabel}</span></td>
                      <td style={{padding:'7px 10px',fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>{su?su.fullName:'—'}</td>
                      <td style={{padding:'7px 10px'}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          <button onClick={()=>startEditRoom(r)} style={{padding:'3px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:11,cursor:'pointer'}}>Editar</button>
                          {r.isActive
                            ? <button onClick={()=>toggleRoomActive(r)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Desativar</button>
                            : <>
                                <button onClick={()=>toggleRoomActive(r)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #22c55e55',borderRadius:4,color:'#22c55e',fontSize:11,cursor:'pointer'}}>Ativar</button>
                                <button onClick={()=>startDeleteRoom(r)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Excluir</button>
                              </>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ):(
          <>
            {can(PERMS.MANAGE_BLOCKS)&&<button onClick={startCreateBlock} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Novo Bloco</button>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {blocks.map(b=>(
                <div key={b.id} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12,opacity:b.isActive?1:.55}}>
                  <div style={{flex:1,fontSize:13,color:T.txt}}>{b.local} — {b.name}{!b.isActive&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginLeft:6}}>(inativo)</span>}</div>
                  <button onClick={()=>startEditBlock(b)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}}>Editar</button>
                  {b.isActive
                    ? <button onClick={()=>toggleBlockActive(b)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Desativar</button>
                    : <>
                        <button onClick={()=>toggleBlockActive(b)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #22c55e55',borderRadius:5,color:'#22c55e',fontSize:11,cursor:'pointer'}}>Ativar</button>
                        <button onClick={()=>startDeleteBlock(b)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Excluir</button>
                      </>}
                </div>
              ))}
            </div>
          </>
        )}
      </>
    )} panel={
      confirmDeleteRoom?(()=>{
        const affected = roomCoursesOf(confirmDeleteRoom);
        return (
          <div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:T.txt}}>Confirmar exclusão</div>
            <div style={{padding:'12px 14px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:8,marginBottom:16,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.6}}>
              {affected.length===0
                ? <>A sala <strong>{confirmDeleteRoom.label}</strong> não tem nenhuma disciplina alocada nela no momento.</>
                : <>A sala <strong>{confirmDeleteRoom.label}</strong> está alocada em <strong>{affected.length} disciplina(s)</strong>. Ao excluir a sala, essas disciplinas <strong>não</strong> serão apagadas — só ficarão sem sala nos dias em que usavam esta, e vão precisar ser realocadas.</>}
            </div>
            <div style={{fontSize:13,color:T.muted,marginBottom:16}}>Esta ação não pode ser desfeita.</div>
            <div style={{display:'flex',gap:8}}>
              <button type="button" onClick={cancelDeleteRoom} disabled={deleting} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:deleting?'wait':'pointer'}}>Cancelar</button>
              <button type="button" onClick={confirmDeleteRoomNow} disabled={deleting} style={{flex:2,padding:'8px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:deleting?'wait':'pointer',opacity:deleting?.7:1}}>{deleting?'Excluindo…':'Excluir sala'}</button>
            </div>
          </div>
        );
      })():confirmDeleteBlock?(()=>{
        const blockRooms = roomsOfBlock(confirmDeleteBlock);
        const blocked = blockRooms.length>0;
        return (
          <div>
            <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:T.txt}}>Confirmar exclusão</div>
            <div style={{padding:'12px 14px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:8,marginBottom:16,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.6}}>
              {blocked
                ? <>O bloco <strong>{confirmDeleteBlock.local} — {confirmDeleteBlock.name}</strong> ainda tem <strong>{blockRooms.length} sala(s)</strong> vinculada(s) ({blockRooms.map(r=>r.label).join(', ')}). Exclua ou mova essas salas para outro bloco antes de excluir este.</>
                : <>O bloco <strong>{confirmDeleteBlock.local} — {confirmDeleteBlock.name}</strong> não tem nenhuma sala vinculada e pode ser excluído com segurança.</>}
            </div>
            {!blocked&&<div style={{fontSize:13,color:T.muted,marginBottom:16}}>Esta ação não pode ser desfeita.</div>}
            <div style={{display:'flex',gap:8}}>
              <button type="button" onClick={cancelDeleteBlock} disabled={deleting} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:deleting?'wait':'pointer'}}>{blocked?'Entendi':'Cancelar'}</button>
              {!blocked&&<button type="button" onClick={confirmDeleteBlockNow} disabled={deleting} style={{flex:2,padding:'8px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:deleting?'wait':'pointer',opacity:deleting?.7:1}}>{deleting?'Excluindo…':'Excluir bloco'}</button>}
            </div>
          </div>
        );
      })():editingRoom?(
        <form onSubmit={e=>{e.preventDefault();saveRoom();}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:T.txt}}>{editingRoom==='new'?'Nova Sala':'Editar Sala'}</div>
          <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome/Número</label><input value={roomForm.label} onChange={e=>setRoomForm({...roomForm,label:e.target.value})} style={inpStyle(T)}/></div>
          <div style={{display:'flex',gap:8,marginBottom:12}}>
            <div style={{flex:1}}><label style={lblStyle(T)}>Capacidade</label><input type="number" min={1} value={roomForm.cap} onChange={e=>setRoomForm({...roomForm,cap:e.target.value})} style={inpStyle(T)}/></div>
            <div style={{flex:1}}><label style={lblStyle(T)}>Andar</label><input type="number" value={roomForm.floor} onChange={e=>setRoomForm({...roomForm,floor:e.target.value})} style={inpStyle(T)}/></div>
          </div>
          <div style={{marginBottom:12}}><label style={lblStyle(T)}>Tipo</label><input value={roomForm.type} onChange={e=>setRoomForm({...roomForm,type:e.target.value})} style={inpStyle(T)}/></div>
          <div style={{marginBottom:12}}>
            <label style={lblStyle(T)}>Bloco</label>
            <select value={roomForm.blockId} onChange={e=>setRoomForm({...roomForm,blockId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
              {blocks.map(b=><option key={b.id} value={b.id}>{b.local} — {b.name}</option>)}
            </select>
          </div>
          <div style={{marginBottom:16}}>
            <label style={lblStyle(T)}>Função Dona</label>
            <select value={roomForm.roleId} onChange={e=>setRoomForm({...roomForm,roleId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
              <option value="" style={{fontWeight:'bold'}}>{roles.find(r=>r.isSystem)?.name??'Diretoria'}</option>
              {subUnits.map(su=>{
                const suRoles=roles.filter(r=>r.subUnitId===su.id);
                if(!suRoles.length) return null;
                return(<optgroup key={su.id} label={su.fullName}>{suRoles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</optgroup>);
              })}
            </select>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={cancelRoom} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>Salvar</button>
          </div>
        </form>
      ):editingBlock?(
        <form onSubmit={e=>{e.preventDefault();saveBlock();}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:T.txt}}>{editingBlock==='new'?'Novo Bloco':'Editar Bloco'}</div>
          <div style={{marginBottom:12}}><label style={lblStyle(T)}>Centro (ex.: CCN1)</label><input value={blockForm.local} onChange={e=>setBlockForm({...blockForm,local:e.target.value})} style={inpStyle(T)}/></div>
          <div style={{marginBottom:16}}><label style={lblStyle(T)}>Nome do bloco (ex.: SG-04)</label><input value={blockForm.name} onChange={e=>setBlockForm({...blockForm,name:e.target.value})} style={inpStyle(T)}/></div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={cancelBlock} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>Salvar</button>
          </div>
        </form>
      ):null
    }/>
  );
}

// ─── Aba Períodos ─────────────────────────────────────────────────────────────
// Período tem tabela própria (periods, ver supabase/schema.sql) — existe por
// conta própria, sem depender de ter alguma disciplina cadastrada. "Criar"
// aqui valida formato/recência e persiste de verdade via mgmt.createPeriod,
// depois chama onPeriodCreated, que quem chamou (Dashboard) usa só pra
// selecioná-lo e levar de volta pra Alocar Disciplinas (navegação, não mais
// a única forma de "salvar" o período). Excluir um período (única forma de
// removê-lo do sistema) apaga a linha em periods E todas as disciplinas
// cadastradas nele, mediante confirmação explícita — nunca acontece de
// forma implícita só por ele ficar sem disciplinas.
function PeriodsTab({ courses, periods, onPeriodCreated, currentPeriodOverride, flash, reloadDomain }) {
  const { T, theme } = useT();
  const [creating, setCreating] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // período (string) | null
  const [deleting, setDeleting] = useState(false);

  // União com os períodos já referenciados por alguma disciplina (dados
  // legados cujo período ainda não tenha uma linha própria em `periods`).
  const allPeriods = useMemo(() => {
    const s = new Set([...periods, ...courses.map(c=>c.period)]);
    return [...s].sort(comparePeriods);
  }, [periods, courses]);
  const currentPeriod = currentPeriodOverride ?? (allPeriods[allPeriods.length-1] ?? DEFAULT_PERIOD);
  const courseCountOf = p => courses.filter(c=>c.period===p).length;

  const startCreate = () => { setCreating(true); setValue(''); setError(null); setConfirmDelete(null); };
  const cancel = () => { setCreating(false); setValue(''); setError(null); };
  const submit = async () => {
    const trimmed = value.trim();
    if (!PERIOD_RE.test(trimmed)) { setError('Use o formato AAAA.N, ex.: 2026.2.'); return; }
    if (comparePeriods(trimmed, currentPeriod) <= 0) { setError(`Precisa ser posterior ao período atual (${currentPeriod}).`); return; }
    try {
      await mgmt.createPeriod(trimmed);
      setCreating(false); setValue(''); setError(null);
      reloadDomain();
      onPeriodCreated(trimmed);
    } catch (e) { setError(ptError(e)); }
  };
  const setAsCurrent = async p => {
    try { await db.setCurrentPeriodOverride(p); flash('ok', `Período ${p} definido como atual.`); }
    catch (e) { flash('err', ptError(e)); }
  };
  const clearOverride = async () => {
    try { await db.setCurrentPeriodOverride(null); flash('ok', 'Período atual voltou a ser automático.'); }
    catch (e) { flash('err', ptError(e)); }
  };
  const startDelete = p => { setConfirmDelete(p); setCreating(false); };
  const cancelDelete = () => setConfirmDelete(null);
  const confirmDeleteNow = async () => {
    const p = confirmDelete;
    setDeleting(true);
    try {
      await mgmt.deletePeriodAndCourses(p);
      flash('ok', `Período ${p} e suas disciplinas foram excluídos.`);
      setConfirmDelete(null);
      reloadDomain();
    } catch (e) { flash('err', ptError(e)); }
    finally { setDeleting(false); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        <button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Novo Período</button>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[...allPeriods].reverse().map(p=>{
            const cnt = courseCountOf(p);
            return (
              <div key={p} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{flex:1,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:T.txt}}>{p}</span>
                  {p===currentPeriod&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:9,fontWeight:700,
                    color:theme==='light'?'#15803d':'#34d399',
                    background:theme==='light'?'#f0fdf4':'#0a2a0a',
                    border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,
                    borderRadius:4,padding:'2px 6px'}}>ATUAL</span>}
                </div>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{cnt} disciplina{cnt!==1?'s':''}</span>
                {p===currentPeriodOverride
                  ? <button onClick={clearOverride} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}}>Voltar ao automático</button>
                  : <button onClick={()=>setAsCurrent(p)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:11,cursor:'pointer'}}>Definir como atual</button>}
                <button onClick={()=>startDelete(p)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:11,cursor:'pointer'}}>Excluir</button>
              </div>
            );
          })}
          {allPeriods.length===0&&<div style={{...{fontFamily:"'DM Mono',monospace"},fontSize:12,color:T.dim}}>Nenhum período cadastrado ainda.</div>}
        </div>
      </>
    )} panel={
      confirmDelete?(
        <div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:12,color:T.txt}}>Confirmar exclusão</div>
          <div style={{padding:'12px 14px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:8,marginBottom:16,fontSize:13,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.6}}>
            O período <strong>{confirmDelete}</strong> possui <strong>{courseCountOf(confirmDelete)} disciplina(s)</strong> cadastrada(s) (em todas as funções). Ao excluir o período, todas serão removidas permanentemente junto com ele.
          </div>
          <div style={{fontSize:13,color:T.muted,marginBottom:16}}>Esta é a única forma de excluir um período, e a ação não pode ser desfeita.</div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={cancelDelete} disabled={deleting} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:deleting?'wait':'pointer'}}>Cancelar</button>
            <button type="button" onClick={confirmDeleteNow} disabled={deleting} style={{flex:2,padding:'8px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:deleting?'wait':'pointer',opacity:deleting?.7:1}}>{deleting?'Excluindo…':'Excluir período e disciplinas'}</button>
          </div>
        </div>
      ):creating&&(
        <form onSubmit={e=>{e.preventDefault();submit();}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:16,color:T.txt}}>Novo Período Letivo</div>
          <div style={{fontSize:12,color:T.txt2,lineHeight:1.6,marginBottom:14}}>
            O período atual ({currentPeriod}) vira somente leitura assim que um período posterior existir. O novo período já fica disponível para seleção (inclusive no Mapa de Salas) mesmo antes de ter qualquer disciplina cadastrada.
          </div>
          <div style={{marginBottom:12}}>
            <label style={lblStyle(T)}>Período (AAAA.N)</label>
            <input autoFocus value={value} onChange={e=>{setValue(e.target.value);setError(null);}}
              placeholder={`ex.: ${currentPeriod.split('.')[0]}.${Number(currentPeriod.split('.')[1]||1)+1}`}
              style={inpStyle(T)}/>
          </div>
          {error&&<div style={{fontSize:11,color:'#ef4444',marginBottom:10}}>{error}</div>}
          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>Cancelar</button>
            <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer'}}>Criar e Selecionar</button>
          </div>
        </form>
      )
    }/>
  );
}

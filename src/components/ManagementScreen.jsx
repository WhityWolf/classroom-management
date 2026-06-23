/**
 * components/ManagementScreen.jsx
 * Tela de gerenciamento institucional — usuários, funções, sub-unidades,
 * salas e blocos. Terceira opção da tela "O que você quer fazer?"
 * (classroom-allocation.jsx: ScreenSelector), visível a qualquer usuário com
 * permissão de gerenciamento (não hardcoded a um único role "Diretor" — ver
 * `canManage` em ScreenSelector). Autocontida como ScreenSelector/RoomMapScreen
 * (própria useAuth()/useT()), recebe só `{onBack}`.
 */
import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT, dtc, dbg } from '../theme.jsx';
import { PERMS } from '../auth/permissions.js';
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
  [PERMS.ASSIGN_ROLES]: 'Atribuir funções a usuários',
  [PERMS.MANAGE_SUB_UNITS]: 'Gerenciar sub-unidades',
  [PERMS.MANAGE_ROLES]: 'Gerenciar funções',
  [PERMS.MANAGE_ROOMS]: 'Gerenciar salas',
  [PERMS.MANAGE_BLOCKS]: 'Gerenciar blocos',
};

const NEUTRAL = { clr:'#94A3B8', textClr:'#475569' };

export default function ManagementScreen({ onBack }) {
  const { currentUser, logout, can } = useAuth();
  const { T, theme, toggleTheme } = useT();
  const mono = { fontFamily:"'DM Mono',monospace" };

  const [subUnits, setSubUnits] = useState([]);
  const [roles, setRoles] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const flash = (type, msg) => { setFeedback({ type, msg }); setTimeout(() => setFeedback(null), 3500); };

  const reloadDomain = () => db.fetchAll().then(d => {
    setSubUnits(d.subUnits); setRoles(d.roles); setBlocks(d.blocks); setRooms(d.rooms);
  });
  const reloadUsers = () => authApi.getUsers().then(setUsers);

  useEffect(() => {
    let active = true;
    Promise.all([db.fetchAll(), authApi.getUsers()])
      .then(([d, u]) => {
        if (!active) return;
        setSubUnits(d.subUnits); setRoles(d.roles); setBlocks(d.blocks); setRooms(d.rooms); setUsers(u);
      })
      .catch(e => { if (active) setLoadError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const tabs = [
    { key:'users',    label:'Usuários',       perm:PERMS.CREATE_ANY_USER },
    { key:'roles',    label:'Funções',        perm:PERMS.MANAGE_ROLES },
    { key:'subunits', label:'Sub-unidades',   perm:PERMS.MANAGE_SUB_UNITS },
    { key:'rooms',    label:'Salas e Blocos', perm:PERMS.MANAGE_ROOMS },
  ].filter(t => can(t.perm));
  const [tab, setTab] = useState(tabs[0]?.key ?? 'users');

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
        <button className="icon-btn" onClick={onBack} title="Voltar ao menu" style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>☰</button>
        <span style={{fontSize:13,fontWeight:700,color:T.txt}}>⚙️ Gerenciamento</span>
        <div style={{width:1,height:16,background:T.bdr2}}/>
        {tabs.map(t => (
          <button key={t.key} className="mgmt-tab" onClick={() => setTab(t.key)}
            style={{padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:600,background:tab===t.key?T.inner:'transparent',border:`1px solid ${tab===t.key?T.bdr2:'transparent'}`,color:tab===t.key?T.txt:T.muted,cursor:'pointer'}}>
            {t.label}
          </button>
        ))}
        <div style={{flex:1}}/>
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <span style={{...mono,fontSize:9,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:8,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{currentUser.role.name}</span>
        </div>
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>Sair</button>
      </div>

      {feedback && (
        <div style={{margin:'10px 18px 0',padding:'8px 12px',borderRadius:6,fontSize:12,flexShrink:0,
          background:feedback.type==='ok'?(theme==='light'?'#f0fdf4':'#0a2a0a'):(theme==='light'?'#fef2f2':'#2a0a0a'),
          border:`1px solid ${feedback.type==='ok'?(theme==='light'?'#86efac':'#34d39944'):(theme==='light'?'#fca5a5':'#ef444444')}`,
          color:feedback.type==='ok'?(theme==='light'?'#15803d':'#34d399'):(theme==='light'?'#b91c1c':'#ef4444')}}>
          {feedback.msg}
        </div>
      )}

      <div style={{flex:1,overflow:'auto'}}>
        {loading?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',...mono,fontSize:11,color:T.dim}}>Carregando…</div>
        ):loadError?(
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',...mono,fontSize:11,color:'#ef4444'}}>Erro ao carregar: {loadError}</div>
        ):(
          <>
            {tab==='users'&&<UsersTab users={users} roles={roles} subUnits={subUnits} can={can} currentUser={currentUser} reloadUsers={reloadUsers} flash={flash} gRole={gRole}/>}
            {tab==='roles'&&<RolesTab roles={roles} subUnits={subUnits} rooms={rooms} can={can} reloadDomain={reloadDomain} flash={flash}/>}
            {tab==='subunits'&&<SubUnitsTab subUnits={subUnits} roles={roles} can={can} reloadDomain={reloadDomain} flash={flash}/>}
            {tab==='rooms'&&<RoomsBlocksTab rooms={rooms} blocks={blocks} roles={roles} subUnits={subUnits} can={can} reloadDomain={reloadDomain} flash={flash} gRole={gRole}/>}
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

const inpStyle = T => ({width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:12,outline:'none'});
const lblStyle = T => ({fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4});

// ─── Aba Usuários ─────────────────────────────────────────────────────────────
function UsersTab({ users, roles, can, currentUser, reloadUsers, flash, gRole }) {
  const { T, theme } = useT();
  const [editing, setEditing] = useState(null); // user object | 'new' | null
  const [form, setForm] = useState(null);
  const [search, setSearch] = useState('');

  const startCreate = () => { setEditing('new'); setForm({ name:'', username:'', email:'', roleId:roles[0]?.id??'', password:'' }); };
  const startEdit = u => { setEditing(u); setForm({ name:u.name, username:u.username, email:u.email, roleId:u.roleId, password:'', isActive:u.isActive }); };
  const cancel = () => { setEditing(null); setForm(null); };

  const visible = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  }, [users, search]);

  const save = async () => {
    try {
      if (editing === 'new') {
        await authApi.createUser(form, currentUser.id);
        flash('ok', `Usuário "${form.username}" criado.`);
      } else {
        const patch = { name:form.name, email:form.email, roleId:form.roleId, isActive:form.isActive };
        if (form.password) patch.password = form.password;
        await authApi.updateUser(editing.id, patch);
        flash('ok', 'Usuário atualizado.');
      }
      cancel(); reloadUsers();
    } catch (e) { flash('err', e.message); }
  };
  const deactivate = async u => {
    try { await authApi.deactivateUser(u.id); flash('ok', `${u.name} foi desativado(a).`); reloadUsers(); }
    catch (e) { flash('err', e.message); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        <div style={{display:'flex',gap:8,marginBottom:14}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar por nome ou usuário…" style={{...inpStyle(T),flex:1}}/>
          {can(PERMS.CREATE_ANY_USER)&&<button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>+ Novo Usuário</button>}
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead><tr style={{borderBottom:`1px solid ${T.bdr}`}}>
            {['Nome','Usuário','Função','Status',''].map(h=><th key={h} style={{padding:'6px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase'}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {visible.map(u=>{
              const role=gRole(u.roleId);
              return(
                <tr key={u.id} style={{borderBottom:`1px solid ${T.bdr}`,opacity:u.isActive?1:.55}}>
                  <td style={{padding:'8px 10px'}}>{u.name}<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{u.email}</div></td>
                  <td style={{padding:'8px 10px',fontFamily:"'DM Mono',monospace",fontSize:11}}>{u.username}</td>
                  <td style={{padding:'8px 10px'}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:role.textClr,background:`${role.clr}22`,border:`1px solid ${role.clr}44`,borderRadius:4,padding:'2px 7px'}}>{role.full}</span></td>
                  <td style={{padding:'8px 10px',fontSize:10,color:u.isActive?(theme==='light'?'#15803d':'#34d399'):T.dim}}>{u.isActive?'Ativo':'Inativo'}</td>
                  <td style={{padding:'8px 10px'}}>
                    <div style={{display:'flex',gap:6}}>
                      {can(PERMS.EDIT_ANY_USER)&&<button onClick={()=>startEdit(u)} style={{padding:'3px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:10,cursor:'pointer'}}>Editar</button>}
                      {can(PERMS.DEACTIVATE_USER)&&u.isActive&&u.id!==currentUser.id&&<button onClick={()=>deactivate(u)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:'#ef4444',fontSize:10,cursor:'pointer'}}>Desativar</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    )} panel={editing&&(
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:T.txt}}>{editing==='new'?'Novo Usuário':'Editar Usuário'}</div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome Completo</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Usuário</label><input value={form.username} readOnly={editing!=='new'} onChange={e=>setForm({...form,username:e.target.value})} style={{...inpStyle(T),opacity:editing!=='new'?.6:1}}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>E-mail</label><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>{editing==='new'?'Senha':'Nova Senha (deixe em branco para manter)'}</label><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}>
          <label style={lblStyle(T)}>Função</label>
          <select value={form.roleId} onChange={e=>setForm({...form,roleId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
            {roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {editing!=='new'&&(
          <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,cursor:'pointer',fontSize:12,color:T.txt}}>
            <input type="checkbox" checked={form.isActive} onChange={e=>setForm({...form,isActive:e.target.checked})}/> Conta ativa
          </label>
        )}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
          <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>{editing==='new'?'Criar Usuário':'Salvar'}</button>
        </div>
      </form>
    )}/>
  );
}

// ─── Aba Funções ──────────────────────────────────────────────────────────────
function RolesTab({ roles, subUnits, rooms, can, reloadDomain, flash }) {
  const { T } = useT();
  const [editing, setEditing] = useState(null); // role | 'new' | null
  const [form, setForm] = useState(null);

  const startCreate = () => setForm({ id:'', name:'', subUnitId:subUnits[0]?.id??'', permissions:[] }) || setEditing('new');
  const startEdit = r => { setForm({ id:r.id, name:r.name, subUnitId:r.subUnitId??'', permissions:[...r.permissions] }); setEditing(r); };
  const cancel = () => { setEditing(null); setForm(null); };
  const togglePerm = p => setForm(f=>({...f,permissions:f.permissions.includes(p)?f.permissions.filter(x=>x!==p):[...f.permissions,p]}));

  const save = async () => {
    try {
      const payload = { name:form.name, subUnitId:form.subUnitId||null, permissions:form.permissions };
      if (editing==='new') await mgmt.createRole({ id:form.id, ...payload });
      else await mgmt.updateRole(editing.id, payload);
      flash('ok','Função salva.'); cancel(); reloadDomain();
    } catch (e) { flash('err', e.message); }
  };
  const remove = async r => {
    if (r.isSystem) { flash('err','Esta função é protegida e não pode ser excluída.'); return; }
    try { await mgmt.deleteRole(r.id); flash('ok','Função excluída.'); reloadDomain(); }
    catch (e) { flash('err', `Não foi possível excluir: ${e.message}`); }
  };
  const roomsOfRole = id => rooms.filter(r=>r.roleId===id);
  const toggleRoom = async (room, checked) => {
    try { await mgmt.updateRoom(room.id, { roleId: checked?editing.id:null }); reloadDomain(); }
    catch (e) { flash('err', e.message); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        {can(PERMS.MANAGE_ROLES)&&<button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Nova Função</button>}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {roles.map(r=>{
            const su=subUnits.find(s=>s.id===r.subUnitId);
            return(
              <div key={r.id} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:3,height:28,borderRadius:1,background:su?.clr??'#94A3B8'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:T.txt}}>{r.name}{r.isSystem&&<span style={{...{fontFamily:"'DM Mono',monospace"},fontSize:8,color:T.dim,marginLeft:6}}>(sistema)</span>}</div>
                  <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{su?su.fullName:'Institucional'} · {r.permissions.length} permissões · {roomsOfRole(r.id).length} salas</div>
                </div>
                <button onClick={()=>startEdit(r)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:10,cursor:'pointer'}}>Editar</button>
                {!r.isSystem&&<button onClick={()=>remove(r)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:10,cursor:'pointer'}}>Excluir</button>}
              </div>
            );
          })}
        </div>
      </>
    )} panel={editing&&(
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:T.txt}}>{editing==='new'?'Nova Função':'Editar Função'}</div>
        {editing==='new'&&<div style={{marginBottom:12}}><label style={lblStyle(T)}>Identificador (slug, ex.: MATH_GRAD_COORD)</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'_')})} style={inpStyle(T)}/></div>}
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}>
          <label style={lblStyle(T)}>Sub-unidade (vazio = institucional)</label>
          <select value={form.subUnitId} onChange={e=>setForm({...form,subUnitId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
            <option value="">— Institucional —</option>
            {subUnits.map(s=><option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </div>
        <label style={lblStyle(T)}>Permissões</label>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14,maxHeight:260,overflow:'auto'}}>
          {Object.values(PERMS).map(p=>(
            <label key={p} style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:T.txt2,cursor:'pointer'}}>
              <input type="checkbox" checked={form.permissions.includes(p)} onChange={()=>togglePerm(p)}/> {PERM_LABELS[p]??p}
            </label>
          ))}
        </div>
        {editing!=='new'&&(
          <>
            <label style={lblStyle(T)}>Salas desta função</label>
            <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:14,maxHeight:160,overflow:'auto'}}>
              {rooms.map(room=>(
                <label key={room.id} style={{display:'flex',alignItems:'center',gap:8,fontSize:11,color:T.txt2,cursor:'pointer'}}>
                  <input type="checkbox" checked={room.roleId===editing.id} onChange={e=>toggleRoom(room,e.target.checked)}/> {room.label}
                </label>
              ))}
            </div>
          </>
        )}
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
          <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>Salvar</button>
        </div>
      </form>
    )}/>
  );
}

// ─── Aba Sub-unidades ─────────────────────────────────────────────────────────
function SubUnitsTab({ subUnits, roles, can, reloadDomain, flash }) {
  const { T } = useT();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(null);
  const DEFAULT_COLORS = { clr:'#60A5FA', textClr:'#1d4ed8', bg:'#0d1f3d', lightBg:'#eff6ff' };

  const startCreate = () => { setForm({ id:'', name:'', fullName:'', ...DEFAULT_COLORS }); setEditing('new'); };
  const startEdit = s => { setForm({ ...s }); setEditing(s); };
  const cancel = () => { setEditing(null); setForm(null); };

  const save = async () => {
    try {
      if (editing==='new') await mgmt.createSubUnit(form);
      else await mgmt.updateSubUnit(editing.id, form);
      flash('ok','Sub-unidade salva.'); cancel(); reloadDomain();
    } catch (e) { flash('err', e.message); }
  };
  const remove = async s => {
    try { await mgmt.deleteSubUnit(s.id); flash('ok','Sub-unidade excluída.'); reloadDomain(); }
    catch (e) { flash('err', `Não foi possível excluir: ${e.message} (verifique se ainda há funções vinculadas)`); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        {can(PERMS.MANAGE_SUB_UNITS)&&<button onClick={startCreate} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Nova Sub-unidade</button>}
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {subUnits.map(s=>(
            <div key={s.id} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:3,height:28,borderRadius:1,background:s.clr}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:T.txt}}>{s.fullName}</div>
                <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{roles.filter(r=>r.subUnitId===s.id).length} funções</div>
              </div>
              <button onClick={()=>startEdit(s)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:10,cursor:'pointer'}}>Editar</button>
              <button onClick={()=>remove(s)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:10,cursor:'pointer'}}>Excluir</button>
            </div>
          ))}
        </div>
      </>
    )} panel={editing&&(
      <form onSubmit={e=>{e.preventDefault();save();}}>
        <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:T.txt}}>{editing==='new'?'Nova Sub-unidade':'Editar Sub-unidade'}</div>
        {editing==='new'&&<div style={{marginBottom:12}}><label style={lblStyle(T)}>Identificador (slug, ex.: ARQ)</label><input value={form.id} onChange={e=>setForm({...form,id:e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,'_')})} style={inpStyle(T)}/></div>}
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome curto</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{marginBottom:12}}><label style={lblStyle(T)}>Nome completo</label><input value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})} style={inpStyle(T)}/></div>
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {['clr','textClr','bg','lightBg'].map(k=>(
            <div key={k} style={{flex:1}}>
              <label style={lblStyle(T)}>{k}</label>
              <input type="color" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} style={{width:'100%',height:30,border:`1px solid ${T.inputBdr}`,borderRadius:6,cursor:'pointer'}}/>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button type="button" onClick={cancel} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
          <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>Salvar</button>
        </div>
      </form>
    )}/>
  );
}

// ─── Aba Salas e Blocos ───────────────────────────────────────────────────────
function RoomsBlocksTab({ rooms, blocks, roles, can, reloadDomain, flash, gRole }) {
  const { T } = useT();
  const [sub, setSub] = useState('rooms'); // 'rooms' | 'blocks'
  const [editingRoom, setEditingRoom] = useState(null);
  const [roomForm, setRoomForm] = useState(null);
  const [editingBlock, setEditingBlock] = useState(null);
  const [blockForm, setBlockForm] = useState(null);

  const blockLabel = id => { const b=blocks.find(x=>x.id===id); return b?`${b.local} — ${b.name}`:'—'; };

  const startCreateRoom = () => { setRoomForm({ id:'', label:'', cap:30, type:'Sala de Aula', floor:1, blockId:blocks[0]?.id??'', roleId:'', features:[], description:'' }); setEditingRoom('new'); };
  const startEditRoom = r => { setRoomForm({ ...r, roleId:r.roleId??'' }); setEditingRoom(r); };
  const cancelRoom = () => { setEditingRoom(null); setRoomForm(null); };
  const saveRoom = async () => {
    try {
      const payload = { ...roomForm, roleId:roomForm.roleId||null, cap:Number(roomForm.cap), floor:Number(roomForm.floor) };
      if (editingRoom==='new') await mgmt.createRoom(payload);
      else await mgmt.updateRoom(editingRoom.id, payload);
      flash('ok','Sala salva.'); cancelRoom(); reloadDomain();
    } catch (e) { flash('err', e.message); }
  };
  const removeRoom = async r => {
    try { await mgmt.deleteRoom(r.id); flash('ok','Sala excluída.'); reloadDomain(); }
    catch (e) { flash('err', `Não foi possível excluir: ${e.message}`); }
  };

  const startCreateBlock = () => { setBlockForm({ id:'', local:'', name:'' }); setEditingBlock('new'); };
  const startEditBlock = b => { setBlockForm({ ...b }); setEditingBlock(b); };
  const cancelBlock = () => { setEditingBlock(null); setBlockForm(null); };
  const saveBlock = async () => {
    try {
      if (editingBlock==='new') await mgmt.createBlock(blockForm);
      else await mgmt.updateBlock(editingBlock.id, blockForm);
      flash('ok','Bloco salvo.'); cancelBlock(); reloadDomain();
    } catch (e) { flash('err', e.message); }
  };
  const removeBlock = async b => {
    try { await mgmt.deleteBlock(b.id); flash('ok','Bloco excluído.'); reloadDomain(); }
    catch (e) { flash('err', `Não foi possível excluir: ${e.message} (verifique se ainda há salas vinculadas)`); }
  };

  return (
    <PanelLayout T={T} list={(
      <>
        <div style={{display:'flex',gap:6,marginBottom:14}}>
          {[['rooms','Salas'],['blocks','Blocos']].map(([k,l])=>(
            <button key={k} onClick={()=>setSub(k)} style={{padding:'6px 14px',borderRadius:6,fontSize:11,fontWeight:600,background:sub===k?T.inner:'transparent',border:`1px solid ${sub===k?T.bdr2:'transparent'}`,color:sub===k?T.txt:T.muted,cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        {sub==='rooms'?(
          <>
            {can(PERMS.MANAGE_ROOMS)&&<button onClick={startCreateRoom} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Nova Sala</button>}
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr style={{borderBottom:`1px solid ${T.bdr}`}}>
                {['Sala','Bloco','Cap.','Função',''].map(h=><th key={h} style={{padding:'6px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase'}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rooms.map(r=>{
                  const role=gRole(r.roleId);
                  return(
                    <tr key={r.id} style={{borderBottom:`1px solid ${T.bdr}`}}>
                      <td style={{padding:'7px 10px'}}>{r.label}</td>
                      <td style={{padding:'7px 10px',fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim}}>{blockLabel(r.blockId)}</td>
                      <td style={{padding:'7px 10px'}}>{r.cap}</td>
                      <td style={{padding:'7px 10px'}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:role.textClr,background:`${role.clr}22`,borderRadius:4,padding:'2px 6px'}}>{role.full}</span></td>
                      <td style={{padding:'7px 10px'}}>
                        <div style={{display:'flex',gap:6}}>
                          <button onClick={()=>startEditRoom(r)} style={{padding:'3px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:10,cursor:'pointer'}}>Editar</button>
                          <button onClick={()=>removeRoom(r)} style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:'#ef4444',fontSize:10,cursor:'pointer'}}>Excluir</button>
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
            {can(PERMS.MANAGE_BLOCKS)&&<button onClick={startCreateBlock} style={{padding:'7px 16px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer',marginBottom:14}}>+ Novo Bloco</button>}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {blocks.map(b=>(
                <div key={b.id} style={{padding:'10px 14px',border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
                  <div style={{flex:1,fontSize:12,color:T.txt}}>{b.local} — {b.name}</div>
                  <button onClick={()=>startEditBlock(b)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:10,cursor:'pointer'}}>Editar</button>
                  <button onClick={()=>removeBlock(b)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:5,color:'#ef4444',fontSize:10,cursor:'pointer'}}>Excluir</button>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    )} panel={
      editingRoom?(
        <form onSubmit={e=>{e.preventDefault();saveRoom();}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:T.txt}}>{editingRoom==='new'?'Nova Sala':'Editar Sala'}</div>
          {editingRoom==='new'&&<div style={{marginBottom:12}}><label style={lblStyle(T)}>Identificador (id)</label><input value={roomForm.id} onChange={e=>setRoomForm({...roomForm,id:e.target.value})} style={inpStyle(T)}/></div>}
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
            <label style={lblStyle(T)}>Função dona (vazio = compartilhada)</label>
            <select value={roomForm.roleId} onChange={e=>setRoomForm({...roomForm,roleId:e.target.value})} style={{...inpStyle(T),cursor:'pointer'}}>
              <option value="">— Compartilhada/institucional —</option>
              {roles.filter(r=>r.subUnitId).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={cancelRoom} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
            <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>Salvar</button>
          </div>
        </form>
      ):editingBlock?(
        <form onSubmit={e=>{e.preventDefault();saveBlock();}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:T.txt}}>{editingBlock==='new'?'Novo Bloco':'Editar Bloco'}</div>
          {editingBlock==='new'&&<div style={{marginBottom:12}}><label style={lblStyle(T)}>Identificador (id)</label><input value={blockForm.id} onChange={e=>setBlockForm({...blockForm,id:e.target.value})} style={inpStyle(T)}/></div>}
          <div style={{marginBottom:12}}><label style={lblStyle(T)}>Local/Prédio (ex.: CCN1)</label><input value={blockForm.local} onChange={e=>setBlockForm({...blockForm,local:e.target.value})} style={inpStyle(T)}/></div>
          <div style={{marginBottom:16}}><label style={lblStyle(T)}>Nome do bloco (ex.: SG-04)</label><input value={blockForm.name} onChange={e=>setBlockForm({...blockForm,name:e.target.value})} style={inpStyle(T)}/></div>
          <div style={{display:'flex',gap:8}}>
            <button type="button" onClick={cancelBlock} style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
            <button type="submit" style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>Salvar</button>
          </div>
        </form>
      ):null
    }/>
  );
}

import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT, dtc, dbg } from '../theme.jsx';
import { getUsers, updateUser, deactivateUser } from '../db/authApi.js';
import { PERMS } from '../auth/permissions.js';
import { formatDateTime } from '../auth/utils.js';

const NEUTRAL = { clr:'#94A3B8', textClr:'#475569', bg:'#1e293b', lightBg:'#f1f5f9' };

// Criação de usuário não acontece mais aqui — é modular, feita na tela de
// Gerenciamento (ManagementScreen.jsx), acessível a quem tem permissão
// institucional (Diretor e seus secretários). Esta tela mantém só
// listagem/busca/edição/desativação, reaproveitando as mesmas funções de
// src/db/authApi.js.
export default function UserManagement({ onClose, roles, subUnits }) {
  const { currentUser, can, refreshUser } = useAuth();
  const { T, theme } = useT();
  const mono = { fontFamily:"'DM Mono',monospace" };

  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [editUser,  setEditUser]  = useState(null);
  const [deactConf, setDeactConf] = useState(null);
  const [feedback,  setFeedback]  = useState(null);

  const reload = () => getUsers().then(setUsers);
  useEffect(() => { reload().finally(() => setLoading(false)); }, []);

  const flash = (type, msg) => { setFeedback({type,msg}); setTimeout(()=>setFeedback(null),3000); };

  const roleOf = id => roles.find(r => r.id === id) ?? null;
  const roleDisplay = id => {
    const role = roleOf(id);
    if (!role) return { name:'—', ...NEUTRAL };
    const su = role.subUnitId ? subUnits.find(s => s.id === role.subUnitId) : null;
    return su ? { name:role.name, ...su } : { name:role.name, ...NEUTRAL };
  };

  const visible = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        roleDisplay(u.roleId).name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, search, roles, subUnits]);

  const handleDeactivate = async (user) => {
    try { await deactivateUser(user.id); reload(); flash('ok', `${user.name} foi desativado(a).`); }
    catch(e) { flash('err', e.message); }
    setDeactConf(null);
  };

  const fdbkBg  = feedback?.type==='ok'?(theme==='light'?'#f0fdf4':'#0a2a0a'):(theme==='light'?'#fef2f2':'#2a0a0a');
  const fdbkBdr = feedback?.type==='ok'?(theme==='light'?'#86efac':'#34d39944'):(theme==='light'?'#fca5a5':'#ef444444');
  const fdbkClr = feedback?.type==='ok'?(theme==='light'?'#15803d':'#34d399'):(theme==='light'?'#b91c1c':'#ef4444');

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%'}}>
      {/* Cabeçalho */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 20px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Gerenciamento de Usuários</div>
          <div style={{...mono,fontSize:12,color:T.dim}}>{visible.length} usuário{visible.length!==1?'s':''} exibido{visible.length!==1?'s':''}</div>
        </div>
        <div style={{flex:1}}/>
        <button onClick={onClose}
          style={{padding:'6px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:13,cursor:'pointer'}}>
          ✕ Fechar
        </button>
      </div>

      {feedback&&(
        <div style={{margin:'10px 20px 0',padding:'8px 12px',borderRadius:6,fontSize:14,
                     background:fdbkBg,border:`1px solid ${fdbkBdr}`,color:fdbkClr}}>
          {feedback.msg}
        </div>
      )}

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        {/* Lista de usuários */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{padding:'10px 20px',borderBottom:`1px solid ${T.bdr}`}}>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Buscar por nome, usuário ou função…"
              style={{width:'100%',padding:'6px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:14,outline:'none'}}/>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            {loading?(
              <div style={{padding:32,textAlign:'center',color:T.dim,fontSize:14}}>Carregando…</div>
            ):(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
              <thead>
                <tr style={{position:'sticky',top:0,background:T.surface,borderBottom:`1px solid ${T.bdr}`,zIndex:2}}>
                  {['Nome','Usuário','Função','Último Acesso','Status',''].map(h=>(
                    <th key={h} style={{padding:'8px 14px',textAlign:'left',...mono,fontSize:11,color:T.dim,fontWeight:400,textTransform:'uppercase',letterSpacing:1}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(user=>{
                  const role   = roleDisplay(user.roleId);
                  const isSelf = user.id===currentUser.id;
                  const canEdit  = can(PERMS.EDIT_ANY_USER);
                  const canDeact = can(PERMS.DEACTIVATE_USER)&&!isSelf;
                  return(
                    <tr key={user.id}
                      style={{borderBottom:`1px solid ${T.bdr}`,background:!user.isActive?T.faint:'transparent',opacity:user.isActive?1:0.55}}>
                      <td style={{padding:'10px 14px'}}>
                        <div style={{fontWeight:500,color:T.txt}}>{user.name}</div>
                        <div style={{...mono,fontSize:12,color:T.dim}}>{user.email}</div>
                      </td>
                      <td style={{padding:'10px 14px',...mono,fontSize:13,color:T.muted}}>
                        {user.username}
                        {isSelf&&<span style={{marginLeft:6,fontSize:11,color:'#3b82f6',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:3,padding:'1px 4px'}}>você</span>}
                      </td>
                      <td style={{padding:'10px 14px'}}>
                        <span style={{...mono,fontSize:12,color:role.textClr,background:`${role.clr}22`,border:`1px solid ${role.clr}44`,borderRadius:4,padding:'2px 7px'}}>{role.name}</span>
                      </td>
                      <td style={{padding:'10px 14px',...mono,fontSize:12,color:T.dim}}>{formatDateTime(user.lastLogin)}</td>
                      <td style={{padding:'10px 14px'}}>
                        <span style={{...mono,fontSize:12,borderRadius:4,padding:'2px 7px',
                          background:user.isActive?(theme==='light'?'#f0fdf4':'#0a2a0a'):T.faint,
                          border:`1px solid ${user.isActive?(theme==='light'?'#86efac':'#34d39933'):T.bdr}`,
                          color:user.isActive?(theme==='light'?'#15803d':'#34d399'):T.dim}}>
                          {user.isActive?'Ativo':'Inativo'}
                        </span>
                      </td>
                      <td style={{padding:'10px 14px'}}>
                        <div style={{display:'flex',gap:6}}>
                          {canEdit&&user.isActive&&(
                            <button onClick={()=>setEditUser(user)}
                              style={{padding:'3px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:12,cursor:'pointer'}}
                              onMouseEnter={e=>e.currentTarget.style.borderColor=T.muted}
                              onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>Editar</button>
                          )}
                          {canDeact&&user.isActive&&(
                            <button onClick={()=>setDeactConf(user)}
                              style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:theme==='light'?'#b91c1c':'#ef4444',fontSize:12,cursor:'pointer'}}
                              onMouseEnter={e=>e.currentTarget.style.borderColor='#ef4444'}
                              onMouseLeave={e=>e.currentTarget.style.borderColor='#ef444455'}>Desativar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>
        </div>

        {/* Formulário lateral */}
        {editUser&&(
          <div style={{width:320,borderLeft:`1px solid ${T.bdr}`,overflow:'auto',background:T.card,flexShrink:0}}>
            <UserForm T={T} theme={theme} mono={mono} roles={roles}
              existing={editUser} currentUser={currentUser}
              onSave={async(data)=>{
                try{
                  await updateUser(editUser.id,data);
                  if(editUser.id===currentUser.id)refreshUser();
                  flash('ok','Usuário atualizado.');
                  reload();setEditUser(null);
                }catch(e){flash('err',e.message);}
              }}
              onCancel={()=>setEditUser(null)}/>
          </div>
        )}
      </div>

      {/* Confirmação de desativação */}
      {deactConf&&(
        <div onClick={()=>setDeactConf(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:12,padding:24,width:340,boxShadow:T.shadowMd}}>
            <div style={{fontSize:15,fontWeight:700,color:T.txt,marginBottom:8}}>Desativar usuário?</div>
            <div style={{fontSize:14,color:T.muted,marginBottom:20}}>
              <strong>{deactConf.name}</strong> perderá todo o acesso imediatamente. Os dados são preservados.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setDeactConf(null)}
                style={{padding:'7px 16px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:13,cursor:'pointer'}}>Cancelar</button>
              <button onClick={()=>handleDeactivate(deactConf)}
                style={{padding:'7px 16px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                Desativar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserForm({T, theme, mono, roles, existing, currentUser, onSave, onCancel}) {
  const [form, setForm] = useState({
    name:     existing.name,
    username: existing.username,
    email:    existing.email,
    roleId:   existing.roleId,
    password: '',
    isActive: existing.isActive,
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:null})); };

  const validate = () => {
    const e = {};
    if (!form.name.trim())                             e.name     = 'Obrigatório';
    if (!form.email.trim()||!form.email.includes('@')) e.email    = 'E-mail válido obrigatório';
    if (form.password && form.password.length < 6)    e.password = 'Mínimo 6 caracteres';
    if (!form.roleId)                                   e.roleId   = 'Obrigatório';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    const payload = {...form};
    if (!payload.password) delete payload.password;
    onSave(payload);
  };

  const inp = {width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:14,outline:'none'};
  const lbl = {...mono,fontSize:11,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4};

  const field = (label, key, type='text', placeholder='') => (
    <div style={{marginBottom:12}}>
      <label style={lbl}>{label}</label>
      <input type={type} value={form[key]} placeholder={placeholder}
        onChange={e=>set(key,e.target.value)}
        readOnly={key==='username'}
        style={{...inp,opacity:key==='username'?.6:1}}/>
      {errors[key]&&<div style={{fontSize:12,color:'#ef4444',marginTop:3}}>{errors[key]}</div>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{padding:20}}>
      <div style={{fontSize:15,fontWeight:700,marginBottom:16,color:T.txt}}>Editar Usuário</div>
      {field('Nome Completo',   'name',     'text',     'Dr. João Silva')}
      {field('Usuário',         'username', 'text',     '')}
      {field('E-mail',          'email',    'email',    'joao.silva@ufpi.edu.br')}
      {field('Nova Senha (deixe em branco para manter)', 'password', 'password', '(sem alteração)')}

      <div style={{marginBottom:12}}>
        <label style={lbl}>Função</label>
        <select value={form.roleId} onChange={e=>set('roleId',e.target.value)}
          style={{...inp,cursor:'pointer'}}>
          {roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {errors.roleId&&<div style={{fontSize:12,color:'#ef4444',marginTop:3}}>{errors.roleId}</div>}
      </div>

      <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,cursor:'pointer',fontSize:14,color:T.txt}}>
        <input type="checkbox" checked={form.isActive} onChange={e=>set('isActive',e.target.checked)} style={{accentColor:'#3b82f6',width:14,height:14}}/>
        Conta ativa
      </label>

      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button type="button" onClick={onCancel}
          style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:13,cursor:'pointer'}}>Cancelar</button>
        <button type="submit"
          style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>
          Salvar Alterações
        </button>
      </div>
    </form>
  );
}

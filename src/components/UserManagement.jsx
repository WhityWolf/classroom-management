import { useState, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT, dtc, dbg } from '../theme.jsx';
import { getUsers, createUser, updateUser, deactivateUser } from '../auth/mockDb.js';
import { ROLES, ROLE_LABELS, DEPT_SCOPED_ROLES, ASSIGNABLE_BY } from '../auth/roles.js';
import { PERMS } from '../auth/permissions.js';
import { formatDateTime } from '../auth/utils.js';

const DEPTS_LIST = [
  { id:'MATH', name:'Matemática',           clr:'#60A5FA', textClr:'#1d4ed8', lightBg:'#eff6ff', bg:'#0d1f3d' },
  { id:'PHYS', name:'Física',               clr:'#FBBF24', textClr:'#92400e', lightBg:'#fffbeb', bg:'#2c1f06' },
  { id:'CS',   name:'Computação',           clr:'#34D399', textClr:'#065f46', lightBg:'#ecfdf5', bg:'#062c1d' },
  { id:'CHEM', name:'Química',              clr:'#A78BFA', textClr:'#5b21b6', lightBg:'#f5f3ff', bg:'#1c0d3d' },
  { id:'BIO',  name:'Biologia',             clr:'#2DD4BF', textClr:'#0f766e', lightBg:'#f0fdfa', bg:'#042f2e' },
];
const DEPT_MAP = Object.fromEntries(DEPTS_LIST.map(d => [d.id, d]));

export default function UserManagement({ onClose }) {
  const { currentUser, can, refreshUser } = useAuth();
  const { T, theme } = useT();
  const mono = { fontFamily:"'DM Mono',monospace" };

  const [users,     setUsers]     = useState(() => getUsers());
  const [search,    setSearch]    = useState('');
  const [editUser,  setEditUser]  = useState(null);
  const [creating,  setCreating]  = useState(false);
  const [deactConf, setDeactConf] = useState(null);
  const [feedback,  setFeedback]  = useState(null);

  const reload = () => setUsers(getUsers());
  const flash  = (type, msg) => { setFeedback({type,msg}); setTimeout(()=>setFeedback(null),3000); };

  const visible = useMemo(() => {
    let list = users;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        ROLE_LABELS[u.role]?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, search]);

  const handleDeactivate = (user) => {
    try { deactivateUser(user.id); reload(); flash('ok', `${user.name} foi desativado(a).`); }
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
          <div style={{fontSize:14,fontWeight:700,color:T.txt}}>Gerenciamento de Usuários</div>
          <div style={{...mono,fontSize:9,color:T.dim}}>{visible.length} usuário{visible.length!==1?'s':''} exibido{visible.length!==1?'s':''}</div>
        </div>
        <div style={{flex:1}}/>
        {can(PERMS.CREATE_ANY_USER)&&(
          <button onClick={()=>{setCreating(true);setEditUser(null);}}
            style={{padding:'6px 14px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
            + Novo Usuário
          </button>
        )}
        <button onClick={onClose}
          style={{padding:'6px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>
          ✕ Fechar
        </button>
      </div>

      {feedback&&(
        <div style={{margin:'10px 20px 0',padding:'8px 12px',borderRadius:6,fontSize:12,
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
              style={{width:'100%',padding:'6px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:12,outline:'none'}}/>
          </div>

          <div style={{flex:1,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{position:'sticky',top:0,background:T.surface,borderBottom:`1px solid ${T.bdr}`,zIndex:2}}>
                  {['Nome','Usuário','Função','Departamento','Último Acesso','Status',''].map(h=>(
                    <th key={h} style={{padding:'8px 14px',textAlign:'left',...mono,fontSize:8,color:T.dim,fontWeight:400,textTransform:'uppercase',letterSpacing:1}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(user=>{
                  const dept   = DEPT_MAP[user.deptId];
                  const isSelf = user.id===currentUser.id;
                  const canEdit  = can(PERMS.EDIT_ANY_USER);
                  const canDeact = can(PERMS.DEACTIVATE_USER)&&!isSelf;
                  return(
                    <tr key={user.id}
                      style={{borderBottom:`1px solid ${T.bdr}`,background:!user.isActive?T.faint:'transparent',opacity:user.isActive?1:0.55}}>
                      <td style={{padding:'10px 14px'}}>
                        <div style={{fontWeight:500,color:T.txt}}>{user.name}</div>
                        <div style={{...mono,fontSize:9,color:T.dim}}>{user.email}</div>
                      </td>
                      <td style={{padding:'10px 14px',...mono,fontSize:11,color:T.muted}}>
                        {user.username}
                        {isSelf&&<span style={{marginLeft:6,fontSize:8,color:'#3b82f6',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:3,padding:'1px 4px'}}>você</span>}
                      </td>
                      <td style={{padding:'10px 14px'}}><RoleBadge role={user.role} theme={theme}/></td>
                      <td style={{padding:'10px 14px'}}>
                        {dept?(
                          <span style={{...mono,fontSize:10,color:dtc(dept,theme),background:dbg(dept,theme),border:`1px solid ${dept.clr}44`,borderRadius:4,padding:'2px 7px'}}>
                            {dept.id}
                          </span>
                        ):<span style={{color:T.dim,fontSize:11}}>—</span>}
                      </td>
                      <td style={{padding:'10px 14px',...mono,fontSize:10,color:T.dim}}>{formatDateTime(user.lastLogin)}</td>
                      <td style={{padding:'10px 14px'}}>
                        <span style={{...mono,fontSize:9,borderRadius:4,padding:'2px 7px',
                          background:user.isActive?(theme==='light'?'#f0fdf4':'#0a2a0a'):T.faint,
                          border:`1px solid ${user.isActive?(theme==='light'?'#86efac':'#34d39933'):T.bdr}`,
                          color:user.isActive?(theme==='light'?'#15803d':'#34d399'):T.dim}}>
                          {user.isActive?'Ativo':'Inativo'}
                        </span>
                      </td>
                      <td style={{padding:'10px 14px'}}>
                        <div style={{display:'flex',gap:6}}>
                          {canEdit&&user.isActive&&(
                            <button onClick={()=>{setEditUser(user);setCreating(false);}}
                              style={{padding:'3px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:10,cursor:'pointer'}}
                              onMouseEnter={e=>e.currentTarget.style.borderColor=T.muted}
                              onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>Editar</button>
                          )}
                          {canDeact&&user.isActive&&(
                            <button onClick={()=>setDeactConf(user)}
                              style={{padding:'3px 10px',background:'transparent',border:'1px solid #ef444455',borderRadius:4,color:theme==='light'?'#b91c1c':'#ef4444',fontSize:10,cursor:'pointer'}}
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
          </div>
        </div>

        {/* Formulário lateral */}
        {(creating||editUser)&&(
          <div style={{width:320,borderLeft:`1px solid ${T.bdr}`,overflow:'auto',background:T.card,flexShrink:0}}>
            <UserForm T={T} theme={theme} mono={mono}
              existing={editUser} currentUser={currentUser}
              onSave={(data)=>{
                try{
                  if(editUser){updateUser(editUser.id,data);if(editUser.id===currentUser.id)refreshUser();flash('ok','Usuário atualizado.');}
                  else{createUser(data,currentUser.id);flash('ok',`Usuário "${data.username}" criado.`);}
                  reload();setEditUser(null);setCreating(false);
                }catch(e){flash('err',e.message);}
              }}
              onCancel={()=>{setEditUser(null);setCreating(false);}}/>
          </div>
        )}
      </div>

      {/* Confirmação de desativação */}
      {deactConf&&(
        <div onClick={()=>setDeactConf(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:12,padding:24,width:340,boxShadow:T.shadowMd}}>
            <div style={{fontSize:14,fontWeight:700,color:T.txt,marginBottom:8}}>Desativar usuário?</div>
            <div style={{fontSize:12,color:T.muted,marginBottom:20}}>
              <strong>{deactConf.name}</strong> perderá todo o acesso imediatamente. Os dados são preservados.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setDeactConf(null)}
                style={{padding:'7px 16px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
              <button onClick={()=>handleDeactivate(deactConf)}
                style={{padding:'7px 16px',background:'#ef4444',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                Desativar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UserForm({T, theme, mono, existing, currentUser, onSave, onCancel}) {
  const assignable = ASSIGNABLE_BY[currentUser.role] || [];
  const [form, setForm] = useState({
    name:     existing?.name     ?? '',
    username: existing?.username ?? '',
    email:    existing?.email    ?? '',
    role:     existing?.role     ?? (assignable[0] || ROLES.DEPT_HEAD),
    deptId:   existing?.deptId   ?? '',
    password: '',
    isActive: existing?.isActive ?? true,
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => { setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:null})); };
  const needsDept = DEPT_SCOPED_ROLES.has(form.role);

  const validate = () => {
    const e = {};
    if (!form.name.trim())                             e.name     = 'Obrigatório';
    if (!form.username.trim())                         e.username = 'Obrigatório';
    if (!form.email.trim()||!form.email.includes('@')) e.email    = 'E-mail válido obrigatório';
    if (!existing && !form.password)                   e.password = 'Obrigatório para novos usuários';
    if (form.password && form.password.length < 6)    e.password = 'Mínimo 6 caracteres';
    if (!form.role)                                    e.role     = 'Obrigatório';
    if (needsDept && !form.deptId)                     e.deptId   = 'Obrigatório para esta função';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validate()) return;
    const payload = {...form};
    if (!payload.password) delete payload.password;
    if (!needsDept) payload.deptId = null;
    onSave(payload);
  };

  const inp = {width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:12,outline:'none'};
  const lbl = {...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4};

  const field = (label, key, type='text', placeholder='') => (
    <div style={{marginBottom:12}}>
      <label style={lbl}>{label}</label>
      <input type={type} value={form[key]} placeholder={placeholder}
        onChange={e=>set(key,e.target.value)}
        readOnly={key==='username'&&!!existing}
        style={{...inp,opacity:key==='username'&&!!existing?.6:1}}/>
      {errors[key]&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors[key]}</div>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} style={{padding:20}}>
      <div style={{fontSize:13,fontWeight:700,marginBottom:16,color:T.txt}}>{existing?'Editar Usuário':'Novo Usuário'}</div>
      {field('Nome Completo',   'name',     'text',     'Dr. João Silva')}
      {field('Usuário',         'username', 'text',     'joao.silva')}
      {field('E-mail',          'email',    'email',    'joao.silva@westmore.edu')}
      {field(existing?'Nova Senha (deixe em branco para manter)':'Senha', 'password', 'password', existing?'(sem alteração)':'mínimo 6 caracteres')}

      <div style={{marginBottom:12}}>
        <label style={lbl}>Função</label>
        <select value={form.role} onChange={e=>set('role',e.target.value)}
          style={{...inp,cursor:'pointer'}}>
          {assignable.map(r=><option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
        {errors.role&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.role}</div>}
      </div>

      {needsDept&&(
        <div style={{marginBottom:12}}>
          <label style={lbl}>Departamento</label>
          <select value={form.deptId} onChange={e=>set('deptId',e.target.value)}
            style={{...inp,cursor:'pointer'}}>
            <option value="">— Selecionar —</option>
            {DEPTS_LIST.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {errors.deptId&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.deptId}</div>}
        </div>
      )}

      {existing&&(
        <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,cursor:'pointer',fontSize:12,color:T.txt}}>
          <input type="checkbox" checked={form.isActive} onChange={e=>set('isActive',e.target.checked)} style={{accentColor:'#3b82f6',width:14,height:14}}/>
          Conta ativa
        </label>
      )}

      <div style={{display:'flex',gap:8,marginTop:4}}>
        <button type="button" onClick={onCancel}
          style={{flex:1,padding:'8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
        <button type="submit"
          style={{flex:2,padding:'8px',background:'#3b82f6',border:'none',borderRadius:6,color:'#fff',fontSize:11,fontWeight:600,cursor:'pointer'}}>
          {existing?'Salvar Alterações':'Criar Usuário'}
        </button>
      </div>
    </form>
  );
}

function RoleBadge({role, theme}) {
  const styles = {
    [ROLES.CHIEF]:     {bg:theme==='light'?'#f5f3ff':'#1c0d3d',clr:theme==='light'?'#5b21b6':'#a78bfa',bdr:'#a78bfa44'},
    [ROLES.DEPT_HEAD]: {bg:theme==='light'?'#ecfdf5':'#062c1d',clr:theme==='light'?'#065f46':'#34d399',bdr:'#34d39944'},
  };
  const s = styles[role] || styles[ROLES.DEPT_HEAD];
  return (
    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,padding:'2px 7px',borderRadius:4,background:s.bg,color:s.clr,border:`1px solid ${s.bdr}`}}>
      {ROLE_LABELS[role]??role}
    </span>
  );
}
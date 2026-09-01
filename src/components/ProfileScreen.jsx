/**
 * src/components/ProfileScreen.jsx
 * Self-service "Perfil" screen, reachable from every other screen's top bar
 * (ScreenSelector, the allocation Dashboard, Mapa de Salas, Gerenciamento).
 * Any logged-in user can view their own account info and change their own
 * name/password here — everything else (usuário, e-mail, função,
 * sub-unidade) still requires EDIT_ANY_USER server-side (update_app_user in
 * supabase/schema.sql) and is explicitly routed to the Diretoria instead of
 * exposed as an editable field here.
 *
 * ChangePasswordModal moved here from classroom-allocation.jsx — this is
 * now its only caller (previously triggered by a "Trocar Senha" button in
 * ScreenSelector, which has been removed in favor of this screen).
 */
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT } from '../theme.jsx';
import * as authApi from '../db/authApi.js';

const lblStyle = T => ({ fontFamily:"'DM Mono',monospace", fontSize:9, color:T.dim, textTransform:'uppercase', letterSpacing:1, display:'block', marginBottom:4 });
const inpStyle = T => ({ width:'100%', padding:'7px 10px', background:T.inputBg, border:`1px solid ${T.inputBdr}`, borderRadius:6, color:T.txt, fontSize:13, outline:'none' });

export default function ProfileScreen({ onBack, subUnits=[] }) {
  const { currentUser, logout, refreshUser } = useAuth();
  const { T, theme, toggleTheme } = useT();
  const mono = { fontFamily:"'DM Mono',monospace" };
  const [name, setName] = useState(currentUser.name);
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState(null); // {type,text} | null
  const [showChangePassword, setShowChangePassword] = useState(false);

  const su = subUnits.find(s => s.id === currentUser.role?.subUnitId);

  const saveName = async () => {
    if (!name.trim()) { setNameMsg({ type:'err', text:'Informe um nome.' }); return; }
    setSavingName(true); setNameMsg(null);
    try {
      await authApi.changeOwnName(name.trim());
      await refreshUser();
      setNameMsg({ type:'ok', text:'Nome atualizado.' });
    } catch (e) { setNameMsg({ type:'err', text:e.message }); }
    finally { setSavingName(false); }
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button,input{font-family:inherit;}
        .icon-btn:hover{background:${T.inner}!important;border-color:${T.muted}!important;}
        @keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
      `}</style>

      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',background:T.surface,borderBottom:`1px solid ${T.bdr}`,flexShrink:0,boxShadow:T.shadowSm}}>
        <button className="icon-btn" onClick={onBack} title="Voltar ao menu" style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>☰</button>
        <span style={{fontSize:14,fontWeight:700,color:T.txt}}>👤 Perfil</span>
        <div style={{flex:1}}/>
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:12,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Sair</button>
      </div>

      <div style={{flex:1,overflow:'auto',display:'flex',justifyContent:'center',padding:'40px 20px'}}>
        <div style={{width:440}}>
          <div style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:12,padding:24,marginBottom:20,boxShadow:T.shadowSm}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:16,color:T.txt}}>Informações da Conta</div>

            <div style={{marginBottom:14}}>
              <label style={lblStyle(T)}>Nome Completo</label>
              <input value={name} onChange={e=>{setName(e.target.value);setNameMsg(null);}} style={inpStyle(T)}/>
            </div>

            <div style={{display:'flex',gap:14,marginBottom:14}}>
              <div style={{flex:1}}>
                <label style={lblStyle(T)}>Usuário</label>
                <div style={{...mono,fontSize:13,color:T.muted,padding:'7px 0'}}>{currentUser.username}</div>
              </div>
              <div style={{flex:1}}>
                <label style={lblStyle(T)}>E-mail</label>
                <div style={{fontSize:13,color:T.muted,padding:'7px 0',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{currentUser.email}</div>
              </div>
            </div>

            <div style={{display:'flex',gap:14,marginBottom:18}}>
              <div style={{flex:1}}>
                <label style={lblStyle(T)}>Função</label>
                <div style={{fontSize:13,color:T.muted,padding:'7px 0'}}>{currentUser.role?.name}</div>
              </div>
              {su&&(
                <div style={{flex:1}}>
                  <label style={lblStyle(T)}>Sub-unidade</label>
                  <div style={{fontSize:13,color:T.muted,padding:'7px 0'}}>{su.fullName}</div>
                </div>
              )}
            </div>

            <div style={{fontSize:12,color:T.dim,lineHeight:1.6,marginBottom:16}}>
              Usuário, e-mail, função e sub-unidade só podem ser alterados pela Diretoria.
            </div>

            {nameMsg&&<div style={{fontSize:12,marginBottom:12,color:nameMsg.type==='err'?'#ef4444':(theme==='light'?'#15803d':'#34d399')}}>{nameMsg.text}</div>}
            <button onClick={saveName} disabled={savingName||name.trim()===currentUser.name}
              style={{padding:'8px 18px',background:'#3b82f6',border:'none',borderRadius:7,color:'#fff',fontSize:12,fontWeight:600,
                cursor:savingName?'wait':(name.trim()===currentUser.name?'default':'pointer'),opacity:(savingName||name.trim()===currentUser.name)?.5:1}}>
              {savingName?'Salvando…':'Salvar Nome'}
            </button>
          </div>

          <div style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:12,padding:24,boxShadow:T.shadowSm}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6,color:T.txt}}>Segurança</div>
            <div style={{fontSize:12,color:T.dim,marginBottom:16,lineHeight:1.6}}>Altere sua senha de acesso ao sistema.</div>
            <button onClick={()=>setShowChangePassword(true)} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,fontWeight:600,cursor:'pointer'}}>Trocar Senha</button>
          </div>
        </div>
      </div>

      {showChangePassword&&<ChangePasswordModal onClose={()=>setShowChangePassword(false)}/>}
    </div>
  );
}

function ChangePasswordModal({onClose}){
  const{T,theme}=useT();
  const[current,setCurrent]=useState('');
  const[next,setNext]=useState('');
  const[confirm,setConfirm]=useState('');
  const[error,setError]=useState(null);
  const[saving,setSaving]=useState(false);
  const[done,setDone]=useState(false);
  const lbl={fontFamily:"'DM Mono',monospace",fontSize:10,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:5};
  const inp={width:'100%',padding:'9px 11px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.txt,fontSize:13,outline:'none'};

  const submit=async e=>{
    e.preventDefault();
    setError(null);
    if(next.length<6){setError('A nova senha deve ter pelo menos 6 caracteres.');return;}
    if(next!==confirm){setError('A confirmação não bate com a nova senha.');return;}
    setSaving(true);
    try{
      await authApi.changeOwnPassword(current,next);
      setDone(true);
    }catch(e){setError(e.message);}
    finally{setSaving(false);}
  };

  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:380,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:700,color:T.txt}}>Trocar Senha</div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:17,cursor:'pointer'}}>✕</button>
        </div>
        {done?(
          <>
            <div style={{background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:8,padding:'12px 14px',marginBottom:20,fontSize:13,color:theme==='light'?'#15803d':'#34d399'}}>
              ✓ Senha alterada com sucesso.
            </div>
            <button onClick={onClose} style={{width:'100%',padding:'9px',background:'#3b82f6',border:'none',borderRadius:7,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer'}}>Fechar</button>
          </>
        ):(
          <form onSubmit={submit}>
            <div style={{marginBottom:12}}>
              <label style={lbl}>Senha Atual</label>
              <input autoFocus type="password" value={current} onChange={e=>{setCurrent(e.target.value);setError(null);}} style={inp}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={lbl}>Nova Senha</label>
              <input type="password" value={next} onChange={e=>{setNext(e.target.value);setError(null);}} style={inp}/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={lbl}>Confirmar Nova Senha</label>
              <input type="password" value={confirm} onChange={e=>{setConfirm(e.target.value);setError(null);}} style={inp}/>
            </div>
            {error&&<div style={{fontSize:11,color:'#ef4444',marginBottom:12}}>{error}</div>}
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button type="button" onClick={onClose} disabled={saving} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:12,cursor:saving?'wait':'pointer'}}>Cancelar</button>
              <button type="submit" disabled={saving} style={{padding:'8px 20px',borderRadius:7,fontSize:12,fontWeight:700,background:'#3b82f6',border:'none',color:'#fff',cursor:saving?'wait':'pointer',opacity:saving?.7:1}}>{saving?'Salvando…':'Salvar Nova Senha'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT } from '../theme.jsx';

// Reflete o seed inicial fornecido junto com o schema (ver Fase 2 da
// reformulação de usuários) — puramente ilustrativo para facilitar testes
// manuais; não é mais lido de nenhum "banco" mock, os usuários reais agora
// vêm do Postgres e podem não bater com esta lista se o seed for alterado.
const DEMO_CREDENTIALS = [
  { username: 'chief',         password: 'chief123', roleName: 'Diretor' },
  { username: 'math.grad',     password: 'math123',  roleName: 'Coordenador de Graduação · Matemática' },
  { username: 'math.pos',      password: 'math123',  roleName: 'Coordenador de Pós-Graduação · Matemática' },
  { username: 'math.profmat',  password: 'math123',  roleName: 'Coordenador PROFMAT · Matemática' },
];

export default function LoginPage() {
  const { login, authError } = useAuth();
  const { T, theme, toggleTheme } = useT();

  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [localError, setLocalError] = useState('');
  const [showDemo,   setShowDemo]   = useState(false);

  const error = localError || authError;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    if (!username.trim()) { setLocalError('Por favor, insira seu usuário.'); return; }
    if (!password)        { setLocalError('Por favor, insira sua senha.');   return; }
    setBusy(true);
    await login(username.trim(), password);
    setBusy(false);
  };

  const fillDemo = (cred) => { setUsername(cred.username); setPassword(cred.password); setLocalError(''); };

  const mono = { fontFamily:"'DM Mono',monospace" };
  const inp  = {
    width:'100%', boxSizing:'border-box', padding:'9px 12px',
    background:T.inputBg, border:`1px solid ${error ? '#ef4444' : T.inputBdr}`,
    borderRadius:7, color:T.txt, fontSize:13, outline:'none', transition:'border-color .15s',
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,
                 minHeight:'100vh',boxSizing:'border-box',display:'flex',alignItems:'center',
                 justifyContent:'center',padding:'24px 16px',position:'relative'}}>

      <button onClick={toggleTheme}
        style={{position:'absolute',top:16,right:20,padding:'5px 12px',
                background:T.surface,border:`1px solid ${T.bdr2}`,borderRadius:6,
                color:T.muted,fontSize:11,boxShadow:T.shadowSm,cursor:'pointer'}}>
        {theme==='light'?'🌙 Escuro':'☀ Claro'}
      </button>

      <div style={{width:'100%',maxWidth:860,display:'flex',gap:0,
                   borderRadius:14,overflow:'hidden',boxShadow:T.shadowMd,border:`1px solid ${T.bdr}`}}>

        {/* Painel esquerdo */}
        <div style={{width:290,flexShrink:0,position:'relative',overflow:'hidden',
                     background:theme==='light'
                       ?'linear-gradient(160deg,#1e293b 0%,#0f172a 100%)'
                       :'linear-gradient(160deg,#0a1424 0%,#040810 100%)',
                     padding:'40px 28px',display:'flex',flexDirection:'column'}}>
          <div aria-hidden style={{position:'absolute',inset:0,opacity:.5,
            backgroundImage:'radial-gradient(circle at 1px 1px, rgba(255,255,255,.06) 1px, transparent 0)',
            backgroundSize:'18px 18px'}}/>
          <div aria-hidden style={{position:'absolute',top:-60,right:-60,width:220,height:220,borderRadius:'50%',
            background:'radial-gradient(circle, rgba(96,165,250,.16), transparent 70%)'}}/>

          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:24,position:'relative'}}>
            <div style={{width:34,height:34,borderRadius:8,flexShrink:0,
              background:'linear-gradient(135deg,#60A5FA,#A78BFA)',
              display:'flex',alignItems:'center',justifyContent:'center',
              boxShadow:'0 2px 10px rgba(96,165,250,.35)'}}>
              <span style={{...mono,fontSize:11,fontWeight:700,color:'#0b1220',letterSpacing:.5}}>UFPI</span>
            </div>
            <div style={{...mono,fontSize:9,letterSpacing:3,color:'#94a3b8',textTransform:'uppercase',lineHeight:1.4}}>
              Universidade Federal<br/>do Piauí
            </div>
          </div>
          <div style={{fontSize:22,fontWeight:700,color:'#f1f5f9',lineHeight:1.25,marginBottom:8,position:'relative'}}>
            Sistema de Alocação de Salas
          </div>
          <div style={{fontSize:12,color:'#64748b',lineHeight:1.6,marginBottom:32,position:'relative'}}>
            Agendamento centralizado de salas e coordenação interdepartamental — Centro de Ciências da Natureza (CCN).
          </div>

          <div style={{...mono,fontSize:8,color:'#475569',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>
            Níveis de Acesso
          </div>

          <div style={{padding:'10px 12px',background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.2)',borderRadius:8,marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'#A78BFA'}}/>
              <span style={{fontSize:12,fontWeight:600,color:'#c4b5fd'}}>Diretor</span>
            </div>
            <div style={{fontSize:10,color:'#64748b',lineHeight:1.5}}>
              Acesso institucional completo — aloca excedentes interdepartamentais, gerencia o status dos departamentos, edita detalhes das salas e administra usuários.
            </div>
          </div>

          <div style={{padding:'10px 12px',background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.2)',borderRadius:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'#34D399'}}/>
              <span style={{fontSize:12,fontWeight:600,color:'#6ee7b7'}}>Chefe de Departamento</span>
            </div>
            <div style={{fontSize:10,color:'#64748b',lineHeight:1.5}}>
              Aloca disciplinas nas salas do próprio departamento e envia ao chefe ao concluir.
            </div>
          </div>

          <div style={{flex:1}}/>
          <div style={{...mono,fontSize:9,color:'#334155',marginTop:24,position:'relative'}}>Período 2026.1</div>
        </div>

        {/* Painel direito */}
        <div style={{flex:1,background:T.surface,padding:'40px 36px',display:'flex',
                     flexDirection:'column',overflowY:'auto',overflowX:'hidden'}}>

          <div style={{marginBottom:28}}>
            <div style={{fontSize:20,fontWeight:700,marginBottom:4}}>Entrar</div>
            <div style={{fontSize:13,color:T.muted}}>Insira suas credenciais universitárias para continuar.</div>
          </div>

          <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:14,marginBottom:24}}>
            <div>
              <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:5}}>Usuário</label>
              <input type="text" value={username} autoComplete="username"
                onChange={e=>{setUsername(e.target.value);setLocalError('');}}
                placeholder="ex.: math.head"
                style={inp}
                onFocus={e=>e.target.style.borderColor='#60a5fa'}
                onBlur={e=>e.target.style.borderColor=error?'#ef4444':T.inputBdr}/>
            </div>
            <div>
              <label style={{...mono,fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:5}}>Senha</label>
              <div style={{position:'relative'}}>
                <input type={showPass?'text':'password'} value={password} autoComplete="current-password"
                  onChange={e=>{setPassword(e.target.value);setLocalError('');}}
                  placeholder="••••••••"
                  style={{...inp,paddingRight:54}}
                  onFocus={e=>e.target.style.borderColor='#60a5fa'}
                  onBlur={e=>e.target.style.borderColor=error?'#ef4444':T.inputBdr}/>
                <button type="button" onClick={()=>setShowPass(v=>!v)}
                  style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',
                          background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:11,padding:'2px 4px'}}>
                  {showPass?'ocultar':'exibir'}
                </button>
              </div>
            </div>

            {error&&(
              <div style={{padding:'8px 12px',
                background:theme==='light'?'#fef2f2':'#2a0a0a',
                border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,
                borderRadius:6,fontSize:12,
                color:theme==='light'?'#b91c1c':'#ef4444'}}>
                {error}
              </div>
            )}

            <button type="submit" disabled={busy}
              style={{padding:'10px',background:'linear-gradient(135deg,#60A5FA,#A78BFA)',border:'none',borderRadius:7,
                      color:'#0b1220',fontSize:13,fontWeight:700,cursor:busy?'wait':'pointer',
                      boxShadow:'0 2px 10px rgba(96,165,250,.25)',
                      opacity:busy?0.7:1,transition:'opacity .15s, filter .15s',marginTop:4}}
              onMouseEnter={e=>{if(!busy)e.currentTarget.style.filter='brightness(1.06)';}}
              onMouseLeave={e=>e.currentTarget.style.filter='none'}>
              {busy?'Entrando…':'Entrar'}
            </button>
          </form>

          {/* Credenciais de demonstração */}
          <div style={{borderTop:`1px solid ${T.bdr}`,paddingTop:16}}>
            <button type="button" onClick={()=>setShowDemo(v=>!v)}
              style={{display:'flex',alignItems:'center',gap:6,width:'100%',background:'none',border:'none',
                      cursor:'pointer',padding:0,...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>
              <span style={{display:'inline-block',transition:'transform .15s',transform:showDemo?'rotate(90deg)':'none'}}>›</span>
              Credenciais de demonstração
            </button>
            {showDemo&&(
              <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:10}}>
                {DEMO_CREDENTIALS.map(cred=>(
                  <button key={cred.username} onClick={()=>fillDemo(cred)}
                    style={{display:'flex',alignItems:'center',gap:10,padding:'6px 10px',
                            background:'transparent',border:`1px solid ${T.bdr}`,
                            borderRadius:6,cursor:'pointer',textAlign:'left',transition:'all .1s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background=T.hover;e.currentTarget.style.borderColor=T.bdr2;}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor=T.bdr;}}>
                    <span style={{...mono,fontSize:10,color:T.txt,fontWeight:500,minWidth:100}}>{cred.username}</span>
                    <span style={{...mono,fontSize:10,color:T.muted,minWidth:72}}>{cred.password}</span>
                    <span style={{fontSize:10,color:T.dim,flex:1}}>{cred.roleName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
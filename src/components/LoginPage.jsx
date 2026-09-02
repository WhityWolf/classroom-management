import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useT } from '../theme.jsx';
import ufpiLogo from '../assets/ufpi-logo.png';

const GITHUB_REPO_URL = 'https://github.com/WhityWolf/classroom-management';

export default function LoginPage() {
  const { login, authError } = useAuth();
  const { T, theme, toggleTheme } = useT();

  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [localError, setLocalError] = useState('');

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

  const mono = { fontFamily:"'DM Mono',monospace" };
  const inp  = {
    width:'100%', boxSizing:'border-box', padding:'9px 12px',
    background:T.inputBg, border:`1px solid ${error ? '#ef4444' : T.inputBdr}`,
    borderRadius:7, color:T.txt, fontSize:14, outline:'none', transition:'border-color .15s',
  };

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,
                 height:'100vh',boxSizing:'border-box',overflowY:'auto',display:'flex',alignItems:'center',
                 justifyContent:'center',padding:'24px 16px',position:'relative'}}>

      <button onClick={toggleTheme}
        style={{position:'absolute',top:16,right:20,padding:'5px 12px',
                background:T.surface,border:`1px solid ${T.bdr2}`,borderRadius:6,
                color:T.muted,fontSize:12,boxShadow:T.shadowSm,cursor:'pointer'}}>
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
            <img src={ufpiLogo} alt="UFPI" style={{width:42,height:'auto',flexShrink:0}}/>
            <div style={{...mono,fontSize:10,letterSpacing:3,color:'#94a3b8',textTransform:'uppercase',lineHeight:1.4}}>
              Universidade Federal<br/>do Piauí
            </div>
          </div>
          <div style={{fontSize:23,fontWeight:700,color:'#f1f5f9',lineHeight:1.25,marginBottom:8,position:'relative'}}>
            Sistema de Gerenciamento de Salas de Aula — CCN/UFPI
          </div>
          <div style={{fontSize:13,color:'#94a3b8',lineHeight:1.6,marginBottom:32,position:'relative'}}>
            Gerenciamento centralizado de salas do Centro de Ciências da Natureza (CCN)
          </div>

          <div style={{...mono,fontSize:9,color:'#94a3b8',textTransform:'uppercase',letterSpacing:1,marginBottom:12}}>
            Níveis de Acesso
          </div>

          <div style={{padding:'10px 12px',background:'rgba(167,139,250,.08)',border:'1px solid rgba(167,139,250,.2)',borderRadius:8,marginBottom:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'#A78BFA'}}/>
              <span style={{fontSize:13,fontWeight:600,color:'#c4b5fd'}}>Diretoria</span>
            </div>
            <div style={{fontSize:11,color:'#94a3b8',lineHeight:1.5}}>
              Acesso institucional completo — gerencia todos os departamentos, salas e usuários do sistema.
            </div>
          </div>

          <div style={{padding:'10px 12px',background:'rgba(52,211,153,.08)',border:'1px solid rgba(52,211,153,.2)',borderRadius:8}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:'#34D399'}}/>
              <span style={{fontSize:13,fontWeight:600,color:'#6ee7b7'}}>Chefia / Coordenação</span>
            </div>
            <div style={{fontSize:10,color:'#6ee7b7',lineHeight:1.6,marginBottom:3}}>
              Chefe de Departamento · Coordenador de Graduação · Coordenador de Pós-Graduação
            </div>
            <div style={{fontSize:11,color:'#94a3b8',lineHeight:1.5}}>
              Aloca disciplinas nas salas do próprio departamento ou curso e envia ao diretor ao concluir.
            </div>
          </div>

          <div style={{flex:1}}/>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer"
            title="Repositório no GitHub"
            style={{marginTop:24,position:'relative',opacity:.85,display:'inline-block',color:'#94a3b8',lineHeight:0,transition:'opacity .15s'}}
            onMouseEnter={e=>{e.currentTarget.style.opacity=1;}}
            onMouseLeave={e=>{e.currentTarget.style.opacity=.85;}}>
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07
                -1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82
                .64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
                .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
                0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
        </div>

        {/* Painel direito */}
        <div style={{flex:1,background:T.surface,padding:'40px 36px',display:'flex',
                     flexDirection:'column',overflowY:'auto',overflowX:'hidden'}}>

          <div style={{marginBottom:28}}>
            <div style={{fontSize:21,fontWeight:700,marginBottom:4}}>Entrar</div>
            <div style={{fontSize:14,color:T.muted}}>Insira suas credenciais universitárias para continuar.</div>
          </div>

          <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:14,marginBottom:24}}>
            <div>
              <label style={{...mono,fontSize:10,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:5}}>Usuário</label>
              <input type="text" value={username} autoComplete="username"
                onChange={e=>{setUsername(e.target.value);setLocalError('');}}
                placeholder="ex.: math.head"
                style={inp}
                onFocus={e=>e.target.style.borderColor='#60a5fa'}
                onBlur={e=>e.target.style.borderColor=error?'#ef4444':T.inputBdr}/>
            </div>
            <div>
              <label style={{...mono,fontSize:10,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:5}}>Senha</label>
              <div style={{position:'relative'}}>
                <input type={showPass?'text':'password'} value={password} autoComplete="current-password"
                  onChange={e=>{setPassword(e.target.value);setLocalError('');}}
                  placeholder="••••••••"
                  style={{...inp,paddingRight:54}}
                  onFocus={e=>e.target.style.borderColor='#60a5fa'}
                  onBlur={e=>e.target.style.borderColor=error?'#ef4444':T.inputBdr}/>
                <button type="button" onClick={()=>setShowPass(v=>!v)}
                  style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',
                          background:'none',border:'none',color:T.dim,cursor:'pointer',fontSize:12,padding:'2px 4px'}}>
                  {showPass?'ocultar':'exibir'}
                </button>
              </div>
            </div>

            {error&&(
              <div style={{padding:'8px 12px',
                background:theme==='light'?'#fef2f2':'#2a0a0a',
                border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,
                borderRadius:6,fontSize:13,
                color:theme==='light'?'#b91c1c':'#ef4444'}}>
                {error}
              </div>
            )}

            <button type="submit" disabled={busy}
              style={{padding:'10px',background:'linear-gradient(135deg,#60A5FA,#A78BFA)',border:'none',borderRadius:7,
                      color:'#0b1220',fontSize:14,fontWeight:700,cursor:busy?'wait':'pointer',
                      boxShadow:'0 2px 10px rgba(96,165,250,.25)',
                      opacity:busy?0.7:1,transition:'opacity .15s, filter .15s',marginTop:4}}
              onMouseEnter={e=>{if(!busy)e.currentTarget.style.filter='brightness(1.06)';}}
              onMouseLeave={e=>e.currentTarget.style.filter='none'}>
              {busy?'Entrando…':'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
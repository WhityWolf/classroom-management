import { useState, useMemo, Fragment, useRef, useEffect } from 'react';
import { ThemeCtx, LIGHT, DARK, useT, dtc, dbg } from './theme.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ROLES } from './auth/roles.js';
import { PERMS } from './auth/permissions.js';
import LoginPage from './components/LoginPage.jsx';
import UserManagement from './components/UserManagement.jsx';
import * as db from './db/allocations.js';
import { useRealtimeSync } from './db/useRealtimeSync.js';
import { supabaseConfigured } from './db/supabaseClient.js';

// ─── Departamentos ────────────────────────────────────────────────────────────
const DEPTS = [
  { id:'MATH', full:'Departamento de Matemática',          clr:'#60A5FA', textClr:'#1d4ed8', bg:'#0d1f3d', lightBg:'#eff6ff' },
  { id:'PHYS', full:'Departamento de Física',              clr:'#FBBF24', textClr:'#92400e', bg:'#2c1f06', lightBg:'#fffbeb' },
  { id:'CS',   full:'Departamento de Ciência da Computação', clr:'#34D399', textClr:'#065f46', bg:'#062c1d', lightBg:'#ecfdf5' },
  { id:'CHEM', full:'Departamento de Química',             clr:'#A78BFA', textClr:'#5b21b6', bg:'#1c0d3d', lightBg:'#f5f3ff' },
  { id:'BIO',  full:'Departamento de Biologia',            clr:'#2DD4BF', textClr:'#0f766e', bg:'#042f2e', lightBg:'#f0fdfa' },
];
const DAYS  = ['Segunda','Terça','Quarta','Quinta','Sexta'];
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19];

// Salas reais sem departamento dono (ex.: Espaço Integrado, blocos do CCN2) têm
// dept_id null no banco — só o Diretor aloca/edita essas salas. gDept cai aqui
// para que o restante do código (badges, cores) não precise tratar null à parte.
const SHARED_ROOM_DEPT = { id:null, full:'Sala Compartilhada (gerida pelo Diretor)', clr:'#94A3B8', textClr:'#475569', bg:'#1e293b', lightBg:'#f1f5f9' };

// ─── Opções de recursos das salas ─────────────────────────────────────────────
const FEATURE_OPTIONS = [
  { group:'Exibição',        items:['Projetor','Quadro Inteligente','Quadro Branco','Lousa','Câmera de Documentos','Tela de TV'] },
  { group:'Tecnologia',      items:['Computadores','Equipamento de Gravação','Videoconferência','Wi-Fi','Sistema de Som'] },
  { group:'Conforto',        items:['Ar-condicionado','Aquecimento','Luz Natural','Isolamento Acústico'] },
  { group:'Acessibilidade',  items:['Acesso para Cadeirantes','Acesso por Elevador','Saída de Emergência'] },
  { group:'Lab / Especial',  items:['Equipamento de Lab','Bancadas de Lab','Capela de Exaustão','Equipamento de Segurança','Câmara Escura','Mesas de Desenho'] },
];

const DS = { ACTIVE:'active', FINISHED:'finished', FORCE_FINISHED:'force_finished' };

// ─── Auxiliares ───────────────────────────────────────────────────────────────
const gDept=id=>DEPTS.find(d=>d.id===id)||SHARED_ROOM_DEPT;
function buildAlloc(courses){const m={};courses.forEach(c=>{if(!c.room)return;c.days.forEach(day=>{for(let h=c.sh;h<c.eh;h++){const k=`${c.room}|${day}|${h}`;if(!m[k])m[k]=[];m[k].push(c);}});});return m;}
function roomFree(rid,course,alloc){for(const day of course.days)for(let h=course.sh;h<course.eh;h++)if((alloc[`${rid}|${day}|${h}`]||[]).length)return false;return true;}
function getConflicts(rid,course,alloc,courses){const ids=new Set();for(const day of course.days)for(let h=course.sh;h<course.eh;h++)(alloc[`${rid}|${day}|${h}`]||[]).forEach(c=>{if(c.id!==course.id)ids.add(c.id);});return[...ids].map(id=>courses.find(c=>c.id===id)).filter(Boolean);}
function rowSlots(rid,day,alloc){const slots=[];let h=8;while(h<20){const arr=alloc[`${rid}|${day}|${h}`]||[];if(arr.length){const c=arr[0];if(c.sh===h){slots.push({h,span:c.eh-c.sh,c,merged:arr.length-1});h=c.eh;}else h++;}else{slots.push({h,span:1,c:null,merged:0});h++;}}return slots;}
function fmtHour(h){return`${String(h).padStart(2,'0')}:00`;}

// ─── Algoritmo de alocação automática ────────────────────────────────────────
function autoAllocate(unplacedCourses, rooms, existingAlloc) {
  const sorted=[...unplacedCourses].sort((a,b)=>{
    if(b.enroll!==a.enroll)return b.enroll-a.enroll;
    return(b.days.length*(b.eh-b.sh))-(a.days.length*(a.eh-a.sh));
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
      const s=r=>(r.deptId===course.deptId?10000:0)-(r.cap-course.enroll);
      return s(curr)>s(prev)?curr:prev;
    });
    assignments.push({course,room:best});
    course.days.forEach(day=>{
      for(let h=course.sh;h<course.eh;h++){
        const k=`${best.id}|${day}|${h}`;
        if(!tempAlloc[k])tempAlloc[k]=[];
        tempAlloc[k].push(course);
      }
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
  if(isLoading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>Carregando…</div>;
  if(!currentUser)return<LoginPage/>;
  return<Dashboard/>;
}

// ─── Painel principal ─────────────────────────────────────────────────────────
function Dashboard(){
  const{currentUser,logout,can}=useAuth();
  const{T,theme,toggleTheme}=useT();

  const isChief   =currentUser.role===ROLES.CHIEF;
  const isDeptHead=currentUser.role===ROLES.DEPT_HEAD;

  const[activeDeptId,setActiveDeptId]=useState(isChief?DEPTS[0].id:currentUser.deptId);
  const[rooms,setRooms]              =useState([]);
  const[courses,setCourses]          =useState([]);
  const[deptStatuses,setDeptStatuses]=useState(Object.fromEntries(DEPTS.map(d=>[d.id,DS.ACTIVE])));
  const[notifications,setNotifs]     =useState([]);
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
      .then(({rooms,courses,deptStatuses,notifications})=>{
        if(!active)return;
        setRooms(rooms);setCourses(courses);setDeptStatuses(deptStatuses);setNotifs(notifications);
      })
      .catch(e=>{if(active)setLoadError(e.message);})
      .finally(()=>{if(active)setDataLoading(false);});
    return()=>{active=false;};
  },[]);

  useRealtimeSync({setRooms,setCourses,setDeptStatuses,setNotifs});

  const[selId,          setSelId]          =useState(null);
  const[day,            setDay]            =useState('Segunda');
  const[viewMode,       setViewMode]       =useState('list');
  const[search,         setSearch]         =useState('');
  const[sidebarTab,     setSidebarTab]     =useState('pending');
  const[finishConfirm,  setFinishConfirm]  =useState(false);
  const[editingCourse,  setEditingCourse]  =useState(null);
  const[featuresModal,  setFeaturesModal]  =useState(null);
  const[autoAllocResult,setAutoAllocResult]=useState(null);
  const[deptPanel,      setDeptPanel]      =useState(false);
  const[notifPanel,     setNotifPanel]     =useState(false);
  const[mergeModal,     setMergeModal]     =useState(null);
  const[showUsers,      setShowUsers]      =useState(false);
  const[toast,          setToast]          =useState(null);

  const showToast=(msg,type='ok')=>{setToast({msg,type});setTimeout(()=>setToast(null),3200);};

  const d         =gDept(activeDeptId);
  const alloc     =useMemo(()=>buildAlloc(courses),[courses]);
  const sel       =useMemo(()=>selId?courses.find(c=>c.id===selId):null,[selId,courses]);
  const ROOMS     =rooms;
  const myStatus  =isDeptHead?deptStatuses[currentUser.deptId]:null;
  const isLocked  =isDeptHead&&myStatus!==DS.ACTIVE;
  const unreadCount=notifications.filter(n=>!n.read).length;

  const visRooms=useMemo(()=>
    isChief
      ?[...ROOMS.filter(r=>r.deptId===activeDeptId),...ROOMS.filter(r=>r.deptId!==activeDeptId)]
      :ROOMS.filter(r=>r.deptId===currentUser.deptId)
  ,[ROOMS,activeDeptId,isChief,currentUser.deptId]);

  const allUnallocated=useMemo(()=>courses.filter(c=>!c.room),[courses]);
  const sidebarCourses=useMemo(()=>{
    const base=isDeptHead?allUnallocated.filter(c=>c.deptId===currentUser.deptId):allUnallocated;
    if(!search.trim())return base;
    const q=search.toLowerCase();
    return base.filter(c=>c.name.toLowerCase().includes(q)||c.code.toLowerCase().includes(q));
  },[allUnallocated,isDeptHead,currentUser.deptId,search]);

  const allAllocated=useMemo(()=>courses.filter(c=>c.room),[courses]);
  const allocatedSidebarCourses=useMemo(()=>{
    const base=isDeptHead?allAllocated.filter(c=>c.deptId===currentUser.deptId):allAllocated;
    if(!search.trim())return base;
    const q=search.toLowerCase();
    return base.filter(c=>c.name.toLowerCase().includes(q)||c.code.toLowerCase().includes(q));
  },[allAllocated,isDeptHead,currentUser.deptId,search]);
  const visibleSidebarCourses=sidebarTab==='pending'?sidebarCourses:allocatedSidebarCourses;

  const autoAllocInput=useMemo(()=>
    isDeptHead?allUnallocated.filter(c=>c.deptId===currentUser.deptId):allUnallocated
  ,[allUnallocated,isDeptHead,currentUser.deptId]);

  const stats=useMemo(()=>{
    const mine=courses.filter(c=>c.deptId===activeDeptId),done=mine.filter(c=>c.room);
    return{total:mine.length,done:done.length,pend:mine.length-done.length,cross:done.filter(c=>!c.room.startsWith(activeDeptId)).length};
  },[courses,activeDeptId]);

  const canAllocate   =isChief||(isDeptHead&&!isLocked);
  const canDealloc    =isChief||(isDeptHead&&!isLocked);
  const canMerge      =canAllocate&&can(PERMS.MERGE_GROUPS);
  const canEditFeatures=isChief;
  const canEditCourse =canAllocate;

  const tryAllocate=rid=>{
    if(!canAllocate||!sel)return;
    if(roomFree(rid,sel,alloc))forceAllocate(rid);
    else if(canMerge)setMergeModal({roomId:rid});
  };
  const forceAllocate=async rid=>{
    if(!sel)return;
    const course=sel,room=ROOMS.find(r=>r.id===rid);
    setSelId(null);setMergeModal(null);
    if(isChief)setActiveDeptId(course.deptId);
    try{
      await db.allocateCourse(course.id,rid);
      showToast(`${course.code} alocada em ${room?.label??rid}.`,'ok');
    }catch(e){
      showToast(`Falha ao alocar: ${e.message}`,'err');
    }
  };
  const deallocate=async cid=>{
    if(!canDealloc)return;
    const course=courses.find(c=>c.id===cid);
    const roomLabel=course?.room?ROOMS.find(r=>r.id===course.room)?.label:null;
    try{
      await db.deallocateCourse(cid);
      showToast(`${course?.code??cid} desalocada${roomLabel?` (estava em ${roomLabel})`:''}.`,'warn');
    }catch(e){
      showToast(`Falha ao desalocar: ${e.message}`,'err');
    }
  };
  const saveFeatures=async(rid,feats,desc)=>{
    if(!canEditFeatures)return;
    setFeaturesModal(null);
    try{
      await db.saveRoomFeatures(rid,feats,desc);
    }catch(e){
      showToast(`Falha ao salvar sala: ${e.message}`,'err');
    }
  };
  const selectCourse=c=>{
    if(!canAllocate)return;
    if(selId===c.id){setSelId(null);return;}
    setSelId(c.id);
    if(isChief)setActiveDeptId(c.deptId);
  };
  const handleEditCourse=async(courseId,changes)=>{
    setEditingCourse(null);
    const original=courses.find(c=>c.id===courseId);
    if(!original)return;
    const updated={...original,...changes};
    let finalRoom=updated.room;
    // TODO (production): conflict check reads from local realtime-synced state,
    // not a fresh DB read — acceptable race window for this prototype's scale.
    if(finalRoom&&(changes.sh!==undefined||changes.eh!==undefined||changes.days!==undefined)){
      const others=courses.filter(c=>c.room===finalRoom&&c.id!==courseId);
      if(!roomFree(finalRoom,updated,buildAlloc(others))){
        finalRoom=null;
        showToast('Horário alterado — sala removida. Por favor, realoque.','warn');
      }
    }
    try{
      await db.editCourse(courseId,{...changes,room:finalRoom});
    }catch(e){
      showToast(`Falha ao salvar disciplina: ${e.message}`,'err');
    }
  };

  const handleAutoAllocate=()=>{
    if(autoAllocInput.length===0){showToast('Não há disciplinas para alocar.','warn');return;}
    setAutoAllocResult(autoAllocate(autoAllocInput,visRooms,alloc));
  };
  const handleApplyAllocation=async()=>{
    if(!autoAllocResult)return;
    const{assignments}=autoAllocResult;
    setAutoAllocResult(null);setSelId(null);
    try{
      await db.applyAllocations(assignments);
      showToast(`✨ ${assignments.length} disciplina${assignments.length!==1?'s':''} alocada${assignments.length!==1?'s':''} automaticamente.`,'ok');
    }catch(e){
      showToast(`Falha ao aplicar alocação automática: ${e.message}`,'err');
    }
  };

  const handleFinish=async()=>{
    setSelId(null);setFinishConfirm(false);
    try{
      await db.finishDept(currentUser.deptId,gDept(currentUser.deptId)?.full,currentUser.name);
      showToast('Alocação enviada. O diretor foi notificado.','ok');
    }catch(e){
      showToast(`Falha ao enviar alocação: ${e.message}`,'err');
    }
  };
  const handleReopen=async deptId=>{
    try{await db.setDeptStatus(deptId,DS.ACTIVE);showToast(`${gDept(deptId)?.full} reaberto.`,'ok');}
    catch(e){showToast(`Falha: ${e.message}`,'err');}
  };
  const handleForceFinish=async deptId=>{
    try{await db.setDeptStatus(deptId,DS.FORCE_FINISHED);showToast(`${gDept(deptId)?.full} bloqueado.`,'ok');}
    catch(e){showToast(`Falha: ${e.message}`,'err');}
  };
  const markNotifsRead=()=>{db.markAllNotificationsRead().catch(()=>{});};

  const mergeRoom  =mergeModal?ROOMS.find(r=>r.id===mergeModal.roomId):null;
  const mergeCons  =(mergeModal&&sel)?getConflicts(mergeModal.roomId,sel,alloc,courses):[];
  const mergeTotal =sel?mergeCons.reduce((s,c)=>s+c.enroll,0)+sel.enroll:0;
  const dClr       =dtc(d,theme);
  const selBannerBg=dbg(d,theme);
  const mono       ={fontFamily:"'DM Mono',monospace"};

  if(dataLoading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>Carregando dados…</div>;
  if(loadError)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:11,color:'#ef4444',padding:20,textAlign:'center'}}>Erro ao carregar dados: {loadError}</div>;

  return(
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
        {isChief?(
          <select value={activeDeptId} onChange={e=>{setActiveDeptId(e.target.value);setSelId(null);}}
            style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,borderRadius:6,color:dClr,fontSize:12,fontWeight:600,outline:'none',cursor:'pointer'}}>
            {DEPTS.map(dep=><option key={dep.id} value={dep.id}>{dep.full}</option>)}
          </select>
        ):(
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:d.clr,boxShadow:`0 0 8px ${d.clr}99`}}/>
            <span style={{fontSize:12,fontWeight:600,color:dClr}}>{d.full}</span>
          </div>
        )}
        <div style={{flex:1}}/>
        {[['Total',stats.total,T.muted],['Alocadas',stats.done,theme==='light'?'#059669':'#34D399'],['Pendentes',stats.pend,theme==='light'?'#b45309':'#FBBF24'],['Outro Depto',stats.cross,theme==='light'?'#5b21b6':'#A78BFA']].map(([l,v,c])=>(
          <div key={l} style={{textAlign:'center',padding:'0 12px',borderLeft:`1px solid ${T.bdr}`}}>
            <div style={{fontSize:17,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
            <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginTop:2}}>{l}</div>
          </div>
        ))}
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:isChief?(theme==='light'?'#5b21b6':'#A78BFA'):dClr}}/>
          <span style={{...mono,fontSize:9,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:8,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{isChief?'Diretor':'Chefe de Depto.'}</span>
        </div>
        {isChief&&(
          <>
            <button className="icon-btn" onClick={()=>{setDeptPanel(true);setNotifPanel(false);}} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>Departamentos</button>
            <button className="icon-btn" onClick={()=>{setNotifPanel(v=>!v);markNotifsRead();}} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:unreadCount>0?(theme==='light'?'#b45309':'#FBBF24'):T.muted,fontSize:10,cursor:'pointer'}}>
              🔔{unreadCount>0&&<span style={{marginLeft:4,background:'#ef4444',color:'#fff',borderRadius:10,padding:'0 5px',fontSize:8}}>{unreadCount}</span>}
            </button>
            <button className="icon-btn" onClick={()=>setShowUsers(true)} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>👥 Usuários</button>
          </>
        )}
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>Sair</button>
      </div>

      {/* Corpo */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* Barra lateral */}
        <aside style={{width:274,borderRight:`1px solid ${T.bdr}`,display:'flex',flexDirection:'column',overflow:'hidden',background:theme==='light'?T.surface:T.card}}>
          <div style={{padding:'10px 12px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
            <div style={{display:'flex',gap:2,border:`1px solid ${T.bdr2}`,borderRadius:6,overflow:'hidden',marginBottom:8}}>
              {[['pending','Pendentes'],['allocated','Alocadas']].map(([k,lbl])=>(
                <button key={k} className={`viewbtn${sidebarTab===k?' active':''}`} onClick={()=>setSidebarTab(k)}
                  style={{flex:1,padding:'4px 8px',fontSize:10,fontWeight:500,background:'transparent',border:'none',color:sidebarTab===k?dClr:T.muted,transition:'all .12s',cursor:'pointer'}}>{lbl}</button>
              ))}
            </div>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Buscar disciplinas…" disabled={isLocked}
              style={{width:'100%',padding:'5px 9px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:11,outline:'none',opacity:isLocked?.6:1}}/>
            <div style={{fontSize:10,color:T.muted,marginTop:5}}>
              {sidebarTab==='pending'
                ?<>{sidebarCourses.length} pendentes · {autoAllocInput.length} total não alocadas</>
                :<>{allocatedSidebarCourses.length} alocadas</>}
            </div>
          </div>

          {isLocked&&(
            <div style={{padding:'10px 14px',background:myStatus===DS.FORCE_FINISHED?(theme==='light'?'#fef2f2':'#1a0505'):(theme==='light'?'#f0fdf4':'#0a2a0a'),borderBottom:`1px solid ${myStatus===DS.FORCE_FINISHED?'#ef444433':'#34d39933'}`,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:600,color:myStatus===DS.FORCE_FINISHED?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#15803d':'#34d399'),marginBottom:2}}>
                {myStatus===DS.FORCE_FINISHED?'🔒 Bloqueado pelo Diretor':'✓ Envio Concluído'}
              </div>
              <div style={{fontSize:10,color:T.muted,lineHeight:1.4}}>
                {myStatus===DS.FORCE_FINISHED?'Sua alocação foi bloqueada pelo diretor institucional.':'Você enviou suas alocações.'}
              </div>
            </div>
          )}

          <div style={{flex:1,overflowY:'auto',padding:'5px'}}>
            {visibleSidebarCourses.length===0?(
              <div style={{textAlign:'center',padding:32,color:T.dim}}>
                <div style={{fontSize:24,marginBottom:8}}>{search?'∅':sidebarTab==='pending'?'✓':'—'}</div>
                <div style={{fontSize:12}}>{search?'Nenhum resultado':sidebarTab==='pending'?'Todas as disciplinas alocadas':'Nenhuma disciplina alocada ainda'}</div>
              </div>
            ):visibleSidebarCourses.map(c=>(
              <CourseCard key={c.id} course={c} activeDept={gDept(activeDeptId)} showDeptBadge={isChief}
                selected={selId===c.id} locked={isLocked}
                roomLabel={sidebarTab==='allocated'?ROOMS.find(r=>r.id===c.room)?.label:undefined}
                onSelect={sidebarTab==='pending'?()=>selectCourse(c):undefined}
                onEdit={canEditCourse?()=>setEditingCourse(c):null}
                onRemove={sidebarTab==='allocated'&&canDealloc&&!isLocked?()=>deallocate(c.id):null}/>
            ))}
          </div>

          {!isLocked&&(isDeptHead||isChief)&&(
            <div style={{padding:'10px 12px',borderTop:`1px solid ${T.bdr}`,flexShrink:0,display:'flex',flexDirection:'column',gap:6}}>
              {autoAllocInput.length>0&&(
                <button onClick={handleAutoAllocate}
                  style={{width:'100%',padding:'8px',background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,borderRadius:7,color:theme==='light'?'#1d4ed8':'#60A5FA',fontSize:11,fontWeight:600,cursor:'pointer',transition:'all .15s',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}
                  onMouseEnter={e=>{e.currentTarget.style.background=theme==='light'?'#dbeafe':'#1e3a5f';}}
                  onMouseLeave={e=>{e.currentTarget.style.background=theme==='light'?'#eff6ff':'#0d1f3d';}}>
                  ✨ Alocar Automaticamente
                </button>
              )}
              {isDeptHead&&(
                <button onClick={()=>setFinishConfirm(true)}
                  style={{width:'100%',padding:'8px',background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,color:theme==='light'?'#15803d':'#34d399',fontSize:11,fontWeight:600,cursor:'pointer',transition:'all .15s'}}
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
              {[['grid','⊞ Grade'],['list','≡ Lista']].map(([m,lbl])=>(
                <button key={m} className={`viewbtn${viewMode===m?' active':''}`} onClick={()=>setViewMode(m)}
                  style={{padding:'4px 12px',fontSize:10,fontWeight:500,background:'transparent',border:'none',color:viewMode===m?dClr:T.muted,transition:'all .12s',cursor:'pointer'}}>{lbl}</button>
              ))}
            </div>
            <div style={{width:1,height:16,background:T.bdr2}}/>
            {viewMode==='grid'&&DAYS.map(dy=>(
              <button key={dy} onClick={()=>setDay(dy)} style={{padding:'4px 10px',borderRadius:5,fontSize:10,fontWeight:500,background:day===dy?d.clr:'transparent',color:day===dy?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${day===dy?d.clr:T.bdr2}`,transition:'all .12s',cursor:'pointer'}}>{dy.slice(0,3)}</button>
            ))}
            <div style={{flex:1}}/>
            <span style={{...mono,fontSize:9,color:T.dim}}>{isChief?'Visão do diretor — todas as salas visíveis':`Exibindo apenas salas do ${gDept(currentUser.deptId)?.full}`}</span>
          </div>

          {sel&&canAllocate&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',background:selBannerBg,borderBottom:`1px solid ${d.clr}44`,flexShrink:0}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:d.clr,animation:'blink 1.5s infinite'}}/>
              <span style={{...mono,fontSize:10,color:dClr,fontWeight:600}}>{sel.code}</span>
              <span style={{fontSize:11,color:T.txt2,maxWidth:200,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sel.name}</span>
              <span style={{...mono,fontSize:10,color:T.muted}}>{sel.days.map(x=>x.slice(0,3)).join('/')} · {fmtHour(sel.sh)}–{fmtHour(sel.eh)} · {sel.enroll} alunos</span>
              <div style={{flex:1}}/>
              {viewMode==='grid'&&!sel.days.includes(day)&&<span style={{fontSize:9,color:theme==='light'?'#b45309':'#FBBF24'}}>Não ocorre na {day} — mude para {sel.days[0].slice(0,3)}</span>}
              {viewMode==='grid'&&sel.days.includes(day)&&<span style={{fontSize:9,color:T.muted}}><span style={{color:d.clr}}>●</span> livre {canMerge&&<><span style={{color:'#F59E0B'}}>●</span> mesclar</>}</span>}
              <button onClick={()=>setSelId(null)} style={{padding:'2px 8px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:9,cursor:'pointer'}}>✕</button>
            </div>
          )}

          <div style={{flex:1,overflow:'auto',background:T.bg}}>
            {viewMode==='grid'?(
              <Grid rooms={visRooms} day={day} alloc={alloc} courses={courses} sel={sel} deptId={activeDeptId} dept={d}
                canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse}
                onTryAlloc={tryAllocate} onDealloc={deallocate} onEditFeatures={setFeaturesModal} onEditCourse={setEditingCourse}/>
            ):(
              <ListView rooms={visRooms} alloc={alloc} courses={courses} sel={sel} deptId={activeDeptId} dept={d}
                canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse}
                onTryAlloc={tryAllocate} onDealloc={deallocate} onEditFeatures={setFeaturesModal} onEditCourse={setEditingCourse}/>
            )}
          </div>
        </div>
      </div>

      {/* Modais */}
      {finishConfirm&&<FinishConfirmModal deptName={gDept(currentUser.deptId)?.full} remaining={autoAllocInput.length} onConfirm={handleFinish} onCancel={()=>setFinishConfirm(false)}/>}
      {deptPanel&&<DeptStatusPanel deptStatuses={deptStatuses} notifications={notifications} onReopen={handleReopen} onForceFinish={handleForceFinish} onClose={()=>setDeptPanel(false)}/>}
      {notifPanel&&<NotifPanel notifications={notifications} onClose={()=>setNotifPanel(false)}/>}
      {editingCourse&&<CourseEditModal course={editingCourse} onSave={handleEditCourse} onCancel={()=>setEditingCourse(null)}/>}
      {featuresModal&&canEditFeatures&&<RoomFeaturesModal room={ROOMS.find(r=>r.id===featuresModal)} dept={d} onSave={saveFeatures} onClose={()=>setFeaturesModal(null)}/>}
      {autoAllocResult&&<AutoAllocModal result={autoAllocResult} dept={d} onApply={handleApplyAllocation} onCancel={()=>setAutoAllocResult(null)}/>}
      {mergeModal&&sel&&mergeRoom&&<MergeModal room={mergeRoom} incomingCourse={sel} conflicts={mergeCons} totalEnroll={mergeTotal} dept={d} onConfirm={()=>forceAllocate(mergeModal.roomId)} onCancel={()=>setMergeModal(null)}/>}
      {showUsers&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'stretch',justifyContent:'flex-end',zIndex:200}}>
          <div style={{width:'min(900px,95vw)',background:T.surface,borderLeft:`1px solid ${T.bdr}`,display:'flex',flexDirection:'column',animation:'slideIn .2s ease'}}>
            <UserManagement onClose={()=>setShowUsers(false)}/>
          </div>
        </div>
      )}
      {toast&&(
        <div style={{position:'fixed',bottom:20,right:20,padding:'10px 16px',borderRadius:8,fontFamily:"'DM Mono',monospace",fontSize:11,zIndex:300,animation:'fadeIn .2s ease',boxShadow:T.shadowMd,
          background:toast.type==='warn'?(theme==='light'?'#fffbeb':'#2a1a00'):toast.type==='err'?(theme==='light'?'#fef2f2':'#2a0a0a'):(theme==='light'?'#f0fdf4':'#0a2a0a'),
          border:`1px solid ${toast.type==='warn'?'#F59E0B44':toast.type==='err'?'#ef444444':'#34d39944'}`,
          color:toast.type==='warn'?(theme==='light'?'#92400e':'#FBBF24'):toast.type==='err'?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#15803d':'#34d399')}}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Card de disciplina ───────────────────────────────────────────────────────
function CourseCard({course,activeDept,showDeptBadge,selected,locked,roomLabel,onSelect,onEdit,onRemove}){
  const{T,theme}=useT();
  const cd=gDept(course.deptId),badgeClr=dtc(cd,theme);
  return(
    <div className={`cc${selected?' sel':''}${locked?' locked':''}`}
      style={{padding:'8px 10px',borderRadius:6,marginBottom:2,cursor:(locked||!onSelect)?'default':'pointer',background:'transparent',border:`1px solid ${selected?activeDept.clr:T.bdr}`,transition:'background .1s, border-color .1s'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          {showDeptBadge&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:badgeClr,background:`${cd.clr}${theme==='light'?'22':'14'}`,border:`1px solid ${cd.clr}44`,borderRadius:3,padding:'1px 4px'}}>{cd.id}</span>}
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:showDeptBadge?badgeClr:dtc(activeDept,theme)}} onClick={onSelect}>{course.code}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{course.enroll} alunos</span>
          {onEdit&&!locked&&(
            <button onClick={e=>{e.stopPropagation();onEdit();}} title="Editar disciplina"
              style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 4px',cursor:'pointer',lineHeight:1.3,transition:'all .1s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;e.currentTarget.style.color=T.txt;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✏</button>
          )}
          {onRemove&&(
            <button onClick={e=>{e.stopPropagation();onRemove();}} title="Remover alocação"
              style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 4px',cursor:'pointer',lineHeight:1.3,transition:'all .1s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✕</button>
          )}
        </div>
      </div>
      <div style={{fontSize:11,fontWeight:500,color:T.txt,marginBottom:2,lineHeight:1.3}} onClick={onSelect}>{course.name}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}} onClick={onSelect}>{course.days.map(x=>x.slice(0,3)).join('/')} · {fmtHour(course.sh)}–{fmtHour(course.eh)}</div>
      {roomLabel&&<div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:badgeClr,marginTop:2}}>📍 {roomLabel}</div>}
    </div>
  );
}

// ─── Grade ────────────────────────────────────────────────────────────────────
function Grid({rooms,day,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const CW=76,RH=33,LW=130;
  const byBuildingThenLabel=(a,b)=>a.building.localeCompare(b.building)||a.label.localeCompare(b.label,undefined,{numeric:true});
  const sorted=useMemo(()=>[
    ...rooms.filter(r=>r.deptId===deptId).sort(byBuildingThenLabel),
    ...rooms.filter(r=>r.deptId!==deptId).sort(byBuildingThenLabel),
  ],[rooms,deptId]);
  return(
    <table style={{borderCollapse:'collapse',tableLayout:'fixed',minWidth:LW+CW*12}}>
      <colgroup><col style={{width:LW}}/>{HOURS.map(h=><col key={h} style={{width:CW}}/>)}</colgroup>
      <thead>
        <tr style={{position:'sticky',top:0,zIndex:5,background:T.surface,boxShadow:theme==='light'?'0 1px 2px rgba(0,0,0,.06)':'none'}}>
          <th style={{padding:'7px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>Sala / Cap</th>
          {HOURS.map(h=><th key={h} style={{padding:'7px 0',textAlign:'center',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`}}>{h}:00</th>)}
        </tr>
      </thead>
      <tbody>
        {sorted.map((room,idx)=>{
          const isOwn=room.deptId===deptId,rd=gDept(room.deptId),rdClr=dtc(rd,theme);
          const free=canAllocate&&sel?roomFree(room.id,sel,alloc):false;
          const hasCon=canAllocate&&sel?!free:false;
          const slots=rowSlots(room.id,day,alloc);
          const dayOk=sel?sel.days.includes(day):false;
          const showSep=!isOwn&&sorted[idx-1]?.deptId===deptId;
          const showBuildingSep=idx===0||sorted[idx-1]?.building!==room.building;
          const capWarn=sel&&room.cap<sel.enroll;
          const rowBg=isOwn?(theme==='light'?'#ffffff':T.bg):(theme==='light'?T.faint:T.inner);
          return(
            <Fragment key={room.id}>
              {showSep&&<tr><td colSpan={13} style={{padding:'5px 10px',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,background:T.faint,borderTop:`1px solid ${T.bdr}`,borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>Outros Departamentos ↓</td></tr>}
              {showBuildingSep&&<tr><td colSpan={13} style={{padding:'4px 10px 4px 18px',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,opacity:.8,background:T.faint,letterSpacing:.5}}>{room.building}</td></tr>}
              <tr style={{borderBottom:`1px solid ${T.bdr}`,background:rowBg}}>
                <td style={{padding:'0 6px 0 10px',height:RH}}>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:2,height:18,borderRadius:1,background:rd.clr,opacity:isOwn?1:0.4}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:isOwn?rdClr:T.muted,whiteSpace:'nowrap'}}>{room.label}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:capWarn&&sel?'#d97706':T.dim}}>{room.cap}{capWarn&&sel?'⚠':''}</span>
                    {room.features.length>0&&<span title={room.features.join(', ')} style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.dim,opacity:.7}}>⚙{room.features.length}</span>}
                    {room.desc&&<span title={room.desc} style={{fontSize:9,color:T.dim,opacity:.7}}>💬</span>}
                    {canEditFeatures&&<button onClick={()=>onEditFeatures(room.id)} title="Editar recursos"
                      style={{background:'none',border:'none',color:T.dim,fontSize:9,padding:'0 1px',lineHeight:1,opacity:0,transition:'opacity .1s',cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>✏</button>}
                  </div>
                </td>
                {slots.map((slot,si)=>{
                  if(slot.c){
                    const cd=gDept(slot.c.deptId),cdClr=dtc(cd,theme),isMine=slot.c.deptId===deptId;
                    const isMergeZone=canAllocate&&canMerge&&sel&&dayOk&&hasCon&&slot.h>=sel.sh&&slot.h<sel.eh;
                    return(
                      <td key={si} colSpan={slot.span} style={{padding:'2px 2px',height:RH,verticalAlign:'middle',background:isMergeZone?(theme==='light'?'#fffbeb':'#F59E0B0f'):'transparent',cursor:isMergeZone?'pointer':'default',transition:'background .1s'}} className={isMergeZone?'gridcell-merge':''} onClick={()=>isMergeZone&&onTryAlloc(room.id)}>
                        <div onClick={e=>{if(isMine&&canDealloc&&!isMergeZone){e.stopPropagation();onDealloc(slot.c.id);}}} className={isMine&&canDealloc?'chip-own':''}
                          title={`${slot.c.name} · ${slot.c.sh}:00–${slot.c.eh}:00 · ${slot.c.enroll} alunos${isMine&&canDealloc?'\nClique para desalocar':''}${isMergeZone?'\nClique para mesclar':''}`}
                          style={{height:'100%',padding:'0 5px',borderRadius:3,background:isMine?`${cd.clr}${theme==='light'?'28':'22'}`:`${cd.clr}${theme==='light'?'18':'0e'}`,borderLeft:`2px solid ${isMergeZone?'#F59E0B':cd.clr}`,display:'flex',alignItems:'center',gap:4,overflow:'hidden',cursor:isMergeZone?'pointer':isMine&&canDealloc?'pointer':'default',transition:'filter .12s'}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:isMergeZone?'#d97706':cdClr,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>{slot.c.code}</span>
                          {slot.merged>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:'#d97706',background:'#F59E0B22',borderRadius:2,padding:'0 3px',flexShrink:0}}>+{slot.merged}</span>}
                          {isMergeZone&&<span style={{fontSize:9,flexShrink:0}}>⇄</span>}
                          {isMine&&canEditCourse&&<button onClick={e=>{e.stopPropagation();onEditCourse(slot.c);}} title="Editar" style={{background:'none',border:'none',color:cdClr,fontSize:8,padding:0,cursor:'pointer',opacity:.7,flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.7}>✏</button>}
                        </div>
                      </td>
                    );
                  }
                  const hlFree=canAllocate&&free&&dayOk&&slot.h>=sel?.sh&&slot.h<sel?.eh;
                  return(
                    <td key={si} style={{padding:'2px 2px',height:RH,verticalAlign:'middle',background:hlFree?`${dept.clr}${theme==='light'?'22':'1a'}`:'transparent',cursor:hlFree?'pointer':'default',transition:'background .1s'}} className={hlFree?'gridcell-hl':''} onClick={()=>hlFree&&onTryAlloc(room.id)}>
                      {hlFree&&<div style={{height:'100%',borderRadius:3,border:`1px dashed ${dept.clr}${theme==='light'?'88':'44'}`,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:11,color:`${dept.clr}${theme==='light'?'aa':'66'}`}}>+</span></div>}
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
function ListView({rooms,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T}=useT();
  const sorted=useMemo(()=>[...rooms.filter(r=>r.deptId===deptId),...rooms.filter(r=>r.deptId!==deptId)],[rooms,deptId]);
  if(!sel)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}>
      <div style={{fontSize:36,opacity:.12}}>≡</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>{canAllocate?'Selecione uma disciplina à esquerda para ver a disponibilidade das salas':'Vista somente leitura'}</div>
    </div>
  );
  const own=sorted.filter(r=>r.deptId===deptId),oth=sorted.filter(r=>r.deptId!==deptId);
  return(
    <div style={{padding:16,display:'flex',flexDirection:'column',gap:20,animation:'fadeIn .2s ease'}}>
      <RoomSection title={`${gDept(deptId).full} — Salas Próprias`} rooms={own} alloc={alloc} courses={courses} sel={sel} deptId={deptId} dept={dept} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>
      {oth.length>0&&<RoomSection title="Outros Departamentos — Alocação Cruzada" rooms={oth} alloc={alloc} courses={courses} sel={sel} deptId={deptId} dept={dept} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>}
    </div>
  );
}

function RoomSection({title,rooms,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const free=rooms.filter(r=>roomFree(r.id,sel,alloc)),busy=rooms.filter(r=>!roomFree(r.id,sel,alloc));
  const freeSet=new Set(free.map(r=>r.id));
  const byBuilding=useMemo(()=>{
    const groups={};
    rooms.forEach(r=>{(groups[r.building]=groups[r.building]||[]).push(r);});
    return Object.entries(groups).sort(([a],[b])=>a.localeCompare(b));
  },[rooms]);
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>{title}</span>
        <div style={{flex:1,height:1,background:T.bdr}}/>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:theme==='light'?'#059669':'#34D399'}}>{free.length} livres</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>/</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:theme==='light'?'#d97706':'#F59E0B'}}>{busy.length} {canMerge?'disponíveis para mescla':'ocupadas'}</span>
      </div>
      {byBuilding.map(([building,bRooms])=>{
        const bSorted=[...bRooms].sort((a,b)=>(freeSet.has(b.id)?1:0)-(freeSet.has(a.id)?1:0));
        return(
          <div key={building} style={{marginBottom:14}}>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,marginBottom:6,paddingLeft:2,letterSpacing:.5}}>{building}</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',gap:8}}>
              {bSorted.map(r=><RoomCard key={r.id} room={r} sel={sel} alloc={alloc} courses={courses} deptId={deptId} dept={dept} status={freeSet.has(r.id)?'available':'busy'} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoomCard({room,sel,alloc,courses,deptId,dept,status,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const rd=gDept(room.deptId),rdClr=dtc(rd,theme);
  const isOwn=room.deptId===deptId,avail=status==='available';
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
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:isOwn?rdClr:T.muted}}>{room.label}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:capWarn?'#d97706':T.dim,marginLeft:'auto'}}>cap {room.cap}{capWarn?'⚠':''}</span>
        {canEditFeatures&&(
          <button onClick={e=>{e.stopPropagation();onEditFeatures(room.id);}} className="feat-btn"
            title="Editar recursos da sala"
            style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 5px',opacity:0,transition:'opacity .15s',cursor:'pointer'}}
            onMouseEnter={e=>{e.stopPropagation();e.currentTarget.style.borderColor=T.muted;}}
            onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>⚙ editar</button>
        )}
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,marginBottom:6}}>{room.type} · Andar {room.floor}</div>
      {room.features.length>0&&(
        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:6}}>
          {room.features.map(f=><span key={f} style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,border:`1px solid ${T.bdr}`,borderRadius:3,padding:'1px 4px',background:T.inner}}>{f}</span>)}
        </div>
      )}
      {room.desc&&(
        <div style={{fontSize:10,color:T.muted,lineHeight:1.5,marginBottom:8,fontStyle:'italic',borderLeft:`2px solid ${rd.clr}44`,paddingLeft:6}}>{room.desc}</div>
      )}
      <CapacityBar cap={room.cap} enroll={sel?.enroll||0} conflicts={avail?[]:conflicts} avail={avail}/>
      {avail?(
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:theme==='light'?'#059669':'#34D399'}}/>
          <span style={{fontSize:9,color:theme==='light'?'#059669':'#34D399',fontFamily:"'DM Mono',monospace"}}>Disponível</span>
          {capWarn&&<span style={{fontSize:8,color:'#d97706',marginLeft:'auto'}}>⚠ abaixo da capacidade</span>}
          {hov&&clickable&&!capWarn&&<span style={{fontSize:8,color:dtc(dept,theme),marginLeft:'auto'}}>Clique para alocar →</span>}
        </div>
      ):(
        <div style={{marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:6}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#F59E0B'}}/>
            <span style={{fontSize:9,color:theme==='light'?'#d97706':'#F59E0B',fontFamily:"'DM Mono',monospace"}}>{conflicts.length} conflito{conflicts.length!==1?'s':''}</span>
          </div>
          {conflicts.map(c=>{
            const cd=gDept(c.deptId),cdClr=dtc(cd,theme),isMine=c.deptId===deptId;
            return(
              <div key={c.id} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 6px',background:`${cd.clr}${theme==='light'?'18':'0e'}`,borderRadius:4,marginBottom:2}}>
                <div style={{width:2,height:10,borderRadius:1,background:cd.clr}}/>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:cdClr,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.code}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>{c.enroll} al.</span>
                {isMine&&canDealloc&&<button onClick={e=>{e.stopPropagation();onDealloc(c.id);}} style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:7,padding:'1px 4px',cursor:'pointer',lineHeight:1.2}} onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✕</button>}
                {isMine&&canEditCourse&&<button onClick={e=>{e.stopPropagation();onEditCourse(c);}} style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:7,padding:'1px 4px',cursor:'pointer',lineHeight:1.2}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.muted} onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>✏</button>}
              </div>
            );
          })}
          {canMerge&&canAllocate&&(
            <button onClick={e=>{e.stopPropagation();onTryAlloc(room.id);}} style={{width:'100%',marginTop:8,padding:'6px',borderRadius:5,background:overCap?(theme==='light'?'#fef3c7':'#3a1a0a'):(theme==='light'?'#fefce8':'#1a1400'),border:`1px solid ${overCap?'#F59E0B':'#F59E0B88'}`,color:theme==='light'?overCap?'#92400e':'#78350f':'#d4a017',fontSize:10,fontWeight:600,transition:'all .12s',cursor:'pointer'}}>
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
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim}}>{avail?`${enroll} / ${cap} vagas`:`${total} / ${cap} vagas${over?' (acima da cap.)':''}`}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:pctColor}}>{Math.round(total/cap*100)}%</span>
      </div>
      <div style={{height:5,borderRadius:3,background:T.barTrack,overflow:'hidden',display:'flex'}}>
        {avail?<div style={{width:`${pctTotal}%`,background:pctColor,borderRadius:3,transition:'width .3s'}}/>:
          <><div style={{width:`${pctEx}%`,background:T.barExist,borderRadius:'3px 0 0 3px',flexShrink:0}}/><div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',flexShrink:0}}/></>}
      </div>
      {!avail&&<div style={{display:'flex',gap:10,marginTop:3}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.barExist}}>■ existente {existing}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:over?'#ef4444':'#d97706'}}>■ entrante {enroll}</span>
      </div>}
    </div>
  );
}

// ─── Modal de recursos da sala ────────────────────────────────────────────────
function RoomFeaturesModal({room,dept,onSave,onClose}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const rd=gDept(room.deptId),rdClr=dtc(rd,theme);
  const[selected,setSelected]=useState(new Set(room.features));
  const[desc,setDesc]        =useState(room.desc||'');
  const toggle=f=>setSelected(prev=>{const s=new Set(prev);s.has(f)?s.delete(f):s.add(f);return s;});
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:540,maxHeight:'85vh',display:'flex',flexDirection:'column',animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        {/* Cabeçalho */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20,flexShrink:0}}>
          <div style={{width:3,height:20,borderRadius:1,background:rd.clr}}/>
          <span style={{...mono,fontSize:11,color:rdClr,fontWeight:500}}>{room.label}</span>
          <span style={{...mono,fontSize:9,color:T.dim}}>{room.type} · Cap {room.cap} · Andar {room.floor}</span>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>

        <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
          {/* Descrição */}
          <div style={{marginBottom:20}}>
            <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Descrição da Sala</div>
            <textarea
              value={desc}
              onChange={e=>setDesc(e.target.value)}
              placeholder="Observações sobre o espaço, instruções de acesso, particularidades…"
              rows={3}
              style={{width:'100%',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,
                color:T.txt,fontSize:12,padding:'9px 12px',outline:'none',resize:'vertical',
                lineHeight:1.6,fontFamily:"'DM Sans',sans-serif"}}/>
          </div>

          {/* Recursos */}
          <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:14}}>
            Recursos e Equipamentos — {selected.size} selecionados
          </div>
          {FEATURE_OPTIONS.map(({group,items})=>(
            <div key={group} style={{marginBottom:16}}>
              <div style={{...mono,fontSize:9,color:T.muted,marginBottom:8,letterSpacing:.5}}>{group}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {items.map(f=>{
                  const active=selected.has(f);
                  return(
                    <button key={f} onClick={()=>toggle(f)} style={{padding:'5px 10px',borderRadius:6,fontSize:11,cursor:'pointer',transition:'all .12s',background:active?(theme==='light'?`${rd.clr}22`:`${rd.clr}18`):'transparent',color:active?rdClr:T.muted,border:`1px solid ${active?rd.clr:T.bdr2}`,fontWeight:active?600:400}}>
                      {active?'✓ ':''}{f}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,flexShrink:0,borderTop:`1px solid ${T.bdr}`,paddingTop:16}}>
          <button onClick={onClose} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
          <button onClick={()=>onSave(room.id,[...selected],desc.trim())} style={{padding:'8px 20px',background:dept.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:11,fontWeight:700,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de pré-visualização da alocação automática ────────────────────────
function AutoAllocModal({result,dept,onApply,onCancel}){
  const{T,theme}=useT();
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
            <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>✨</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Pré-visualização da Alocação Automática</div>
              <div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>Revise antes de aplicar — a ação não pode ser desfeita automaticamente</div>
            </div>
            <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
          </div>
          <div style={{display:'flex',gap:8}}>
            <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,textAlign:'center'}}>
              <div style={{fontSize:22,fontWeight:700,color:theme==='light'?'#15803d':'#34D399',lineHeight:1}}>{placedCount}</div>
              <div style={{...mono,fontSize:8,color:T.dim,marginTop:2}}>PARA ALOCAR</div>
            </div>
            {failedCount>0&&(
              <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:7,textAlign:'center'}}>
                <div style={{fontSize:22,fontWeight:700,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1}}>{failedCount}</div>
                <div style={{...mono,fontSize:8,color:T.dim,marginTop:2}}>NÃO ALOCÁVEIS</div>
              </div>
            )}
          </div>
        </div>
        <div style={{display:'flex',gap:0,borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
          {[['placed',`✓ Proposto (${placedCount})`],['failed',`⚠ Não alocável (${failedCount})`]].map(([key,label])=>(
            failedCount===0&&key==='failed'?null:(
              <button key={key} onClick={()=>setTab(key)} style={{flex:1,padding:'9px',fontSize:11,fontWeight:500,cursor:'pointer',background:'transparent',border:'none',borderBottom:`2px solid ${tab===key?dept.clr:'transparent'}`,color:tab===key?dClr:T.muted,transition:'all .12s'}}>{label}</button>
            )
          ))}
        </div>
        <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
          {tab==='placed'?(
            assignments.length===0?<div style={{textAlign:'center',padding:32,color:T.dim,fontSize:12}}>Nada para alocar.</div>
            :assignments.map(({course,room},i)=>{
              const cd=gDept(course.deptId),cdClr=dtc(cd,theme);
              const rd=gDept(room.deptId),rdClr=dtc(rd,theme);
              const crossDept=room.deptId!==course.deptId;
              return(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 20px',borderBottom:`1px solid ${T.bdr}`,background:i%2===0?'transparent':(theme==='light'?T.faint:T.inner+'88')}}>
                  <div style={{width:2,height:36,borderRadius:1,background:cd.clr,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      <span style={{...mono,fontSize:9,color:cdClr}}>{course.code}</span>
                      <span style={{fontSize:11,color:T.txt,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{course.name}</span>
                    </div>
                    <div style={{...mono,fontSize:9,color:T.dim}}>{course.days.map(d=>d.slice(0,3)).join('/')} · {fmtHour(course.sh)}–{fmtHour(course.eh)} · {course.enroll} alunos</div>
                  </div>
                  <div style={{fontSize:14,color:T.dim,flexShrink:0}}>→</div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',marginBottom:2}}>
                      {crossDept&&<span style={{...mono,fontSize:7,color:theme==='light'?'#d97706':'#FBBF24',border:`1px solid ${theme==='light'?'#fcd34d':'#FBBF2444'}`,borderRadius:3,padding:'1px 4px'}}>outro depto</span>}
                      <span style={{...mono,fontSize:11,fontWeight:600,color:rdClr}}>{room.label}</span>
                    </div>
                    <div style={{...mono,fontSize:9,color:T.dim}}>cap {room.cap} · {room.type}</div>
                  </div>
                </div>
              );
            })
          ):(
            failed.length===0?<div style={{textAlign:'center',padding:32,color:T.dim,fontSize:12}}>Todas as disciplinas foram alocadas!</div>
            :failed.map(({course,reason},i)=>{
              const cd=gDept(course.deptId),cdClr=dtc(cd,theme);
              return(
                <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 20px',borderBottom:`1px solid ${T.bdr}`}}>
                  <div style={{width:2,height:36,borderRadius:1,background:'#ef4444',flexShrink:0,marginTop:2}}/>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      <span style={{...mono,fontSize:9,color:cdClr}}>{course.code}</span>
                      <span style={{fontSize:11,color:T.txt,fontWeight:500}}>{course.name}</span>
                      <span style={{...mono,fontSize:9,color:T.dim}}>· {course.enroll} alunos</span>
                    </div>
                    <div style={{fontSize:10,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.4}}>{reason}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{padding:'16px 20px',borderTop:`1px solid ${T.bdr}`,flexShrink:0}}>
          {failedCount>0&&<div style={{fontSize:10,color:T.muted,marginBottom:12,lineHeight:1.5}}>ⓘ {failedCount} disciplina{failedCount!==1?'s':''} não {failedCount!==1?'puderam':'pôde'} ser alocada{failedCount!==1?'s':''} e permanecerá{failedCount!==1?'o':''} pendente{failedCount!==1?'s':''}. Você pode resolvê-{failedCount!==1?'las':'la'} manualmente após aplicar.</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
            <button onClick={onApply} disabled={placedCount===0}
              style={{padding:'8px 22px',borderRadius:7,fontSize:11,fontWeight:700,cursor:placedCount===0?'not-allowed':'pointer',background:placedCount===0?T.inner:dept.clr,border:'none',color:placedCount===0?T.dim:(theme==='light'?'#fff':'#000'),transition:'all .15s'}}
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
function FinishConfirmModal({deptName,remaining,onConfirm,onCancel}){
  const{T,theme}=useT();
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:420,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>✓</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Marcar Alocação como Concluída?</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginTop:2}}>{deptName}</div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:8,padding:'12px 14px',marginBottom:16,border:`1px solid ${T.bdr}`,fontSize:12,color:T.txt2,lineHeight:1.6}}>
          {remaining>0?<>Você possui <strong style={{color:theme==='light'?'#b45309':'#FBBF24'}}>{remaining} disciplina{remaining!==1?'s':''} não alocada{remaining!==1?'s':''}</strong>. Elas serão tratadas pelo diretor para alocação em outros departamentos.</>:<>Todas as suas disciplinas estão alocadas.</>}
        </div>
        <div style={{background:theme==='light'?'#fef2f2':'#1a0505',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`,borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444'}}>
          ⚠ Após o envio, você <strong>não poderá fazer alterações</strong> a menos que o diretor reabra sua alocação.
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
          <button onClick={onConfirm} style={{padding:'8px 20px',borderRadius:7,fontSize:11,fontWeight:700,background:theme==='light'?'#059669':'#34D399',border:'none',color:'#fff',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
            ✓ Confirmar e Notificar o Diretor
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Painel de status dos departamentos ──────────────────────────────────────
function DeptStatusPanel({deptStatuses,notifications,onReopen,onForceFinish,onClose}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const statusColor={[DS.ACTIVE]:theme==='light'?'#1d4ed8':'#60A5FA',[DS.FINISHED]:theme==='light'?'#059669':'#34D399',[DS.FORCE_FINISHED]:theme==='light'?'#b91c1c':'#ef4444'};
  const statusLabel={[DS.ACTIVE]:'Ativo',[DS.FINISHED]:'Concluído',[DS.FORCE_FINISHED]:'Bloqueado'};
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:520,animation:'scaleIn .18s ease',boxShadow:T.shadowMd,maxHeight:'80vh',overflow:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Status de Alocação dos Departamentos</div>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:20}}>
          {DEPTS.map(dept=>{
            const status=deptStatuses[dept.id]||DS.ACTIVE;
            const lastFinish=notifications.filter(n=>n.deptId===dept.id&&n.type==='FINISHED').slice(-1)[0];
            const cd=dtc(dept,theme);
            return(
              <div key={dept.id} style={{padding:'12px 14px',background:T.card,border:`1px solid ${T.bdr}`,borderRadius:8,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:3,height:32,borderRadius:1,background:dept.clr}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:600,color:cd}}>{dept.full}</div>
                  {lastFinish&&<div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>{lastFinish.userName} · {new Date(lastFinish.timestamp).toLocaleString('pt-BR')}</div>}
                </div>
                <span style={{...mono,fontSize:9,padding:'2px 8px',borderRadius:4,background:`${statusColor[status]}${theme==='light'?'22':'18'}`,border:`1px solid ${statusColor[status]}44`,color:statusColor[status]}}>{statusLabel[status]}</span>
                <div style={{display:'flex',gap:6}}>
                  {status!==DS.ACTIVE&&<button onClick={()=>onReopen(dept.id)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:10,cursor:'pointer'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=theme==='light'?'#1d4ed8':'#60A5FA';e.currentTarget.style.color=theme==='light'?'#1d4ed8':'#60A5FA';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>Reabrir</button>}
                  {status===DS.ACTIVE&&<button onClick={()=>onForceFinish(dept.id)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444444',borderRadius:5,color:theme==='light'?'#b91c1c':'#ef4444',fontSize:10,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.borderColor='#ef4444'} onMouseLeave={e=>e.currentTarget.style.borderColor='#ef444444'}>Forçar Conclusão</button>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{...mono,fontSize:9,color:T.dim,borderTop:`1px solid ${T.bdr}`,paddingTop:12,lineHeight:1.6}}>
          <strong>Reabrir</strong> — permite ao chefe de departamento fazer novas alterações.<br/>
          <strong>Forçar Conclusão</strong> — bloqueia o chefe de departamento sem necessidade de ação dele.
        </div>
      </div>
    </div>
  );
}

// ─── Painel de notificações ───────────────────────────────────────────────────
function NotifPanel({notifications,onClose}){
  const{T,theme}=useT();
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'transparent',display:'flex',alignItems:'flex-start',justifyContent:'flex-end',zIndex:150,paddingTop:52,paddingRight:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:10,width:340,animation:'slideIn .15s ease',boxShadow:T.shadowMd,overflow:'hidden',maxHeight:'70vh',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${T.bdr}`,display:'flex',alignItems:'center'}}>
          <span style={{fontSize:13,fontWeight:600,color:T.txt}}>Notificações</span>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:14,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {notifications.length===0?<div style={{padding:24,textAlign:'center',color:T.dim,fontSize:12}}>Nenhuma notificação ainda</div>
          :[...notifications].reverse().map(n=>{
            const dept=gDept(n.deptId),dClr=dept?dtc(dept,theme):T.muted;
            return(
              <div key={n.id} style={{padding:'12px 16px',borderBottom:`1px solid ${T.bdr}`,background:n.read?'transparent':theme==='light'?'#eff6ff':'#0d1f3d22'}}>
                <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                  <div style={{width:3,height:36,borderRadius:1,background:dept?.clr||T.muted,flexShrink:0,marginTop:2}}/>
                  <div>
                    <div style={{fontSize:12,color:T.txt,fontWeight:500,marginBottom:2}}>Alocação do {n.deptName} enviada</div>
                    <div style={{fontSize:11,color:T.muted,marginBottom:2}}>Por {n.userName}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{new Date(n.timestamp).toLocaleString('pt-BR')}</div>
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
function CourseEditModal({course,onSave,onCancel}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const cd=gDept(course.deptId),cdClr=dtc(cd,theme);
  const[name,setName]=useState(course.name);
  const[days,setDays]=useState([...course.days]);
  const[sh,setSh]=useState(course.sh);
  const[eh,setEh]=useState(course.eh);
  const[enroll,setEnroll]=useState(course.enroll);
  const[errors,setErrors]=useState({});
  const toggleDay=d=>setDays(prev=>prev.includes(d)?prev.filter(x=>x!==d):[...prev,d].sort((a,b)=>DAYS.indexOf(a)-DAYS.indexOf(b)));
  const validate=()=>{const e={};if(!name.trim())e.name='Obrigatório';if(days.length===0)e.days='Selecione ao menos um dia';if(eh<=sh)e.eh='O término deve ser após o início';if(enroll<1||enroll>1000)e.enroll='Entre 1 e 1000';setErrors(e);return Object.keys(e).length===0;};
  const handleSave=()=>{if(!validate())return;onSave(course.id,{name:name.trim(),days,sh,eh,enroll:Number(enroll)});};
  const inp={width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:12,outline:'none'};
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:3,height:20,borderRadius:1,background:cd.clr}}/>
          <span style={{...mono,fontSize:10,color:cdClr,fontWeight:500}}>{course.code}</span>
          <span style={{fontSize:14,fontWeight:700,color:T.txt}}>Editar Disciplina</span>
          {course.room&&<span style={{...mono,fontSize:9,color:theme==='light'?'#b45309':'#FBBF24',background:theme==='light'?'#fef3c7':'#3a1a0a',border:`1px solid ${theme==='light'?'#fcd34d':'#F59E0B44'}`,borderRadius:4,padding:'2px 6px',marginLeft:'auto'}}>⚠ Alteração de horário remove a sala</span>}
          <button onClick={onCancel} style={{background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer',marginLeft:course.room?0:'auto'}}>✕</button>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Nome da Disciplina</label>
          <input value={name} onChange={e=>setName(e.target.value)} style={inp}/>
          {errors.name&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.name}</div>}
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:6}}>Dias</label>
          <div style={{display:'flex',gap:5}}>
            {DAYS.map(day=>(
              <button key={day} type="button" onClick={()=>toggleDay(day)} style={{padding:'5px 8px',borderRadius:5,fontSize:10,fontWeight:500,cursor:'pointer',transition:'all .1s',background:days.includes(day)?cd.clr:'transparent',color:days.includes(day)?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${days.includes(day)?cd.clr:T.bdr2}`}}>{day.slice(0,3)}</button>
            ))}
          </div>
          {errors.days&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.days}</div>}
        </div>
        <div style={{display:'flex',gap:10,marginBottom:12}}>
          <div style={{flex:1}}>
            <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Início</label>
            <select value={sh} onChange={e=>{const v=Number(e.target.value);setSh(v);if(eh<=v)setEh(v+1);}} style={{...inp,cursor:'pointer'}}>
              {HOURS.map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}
            </select>
          </div>
          <div style={{flex:1}}>
            <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Término</label>
            <select value={eh} onChange={e=>setEh(Number(e.target.value))} style={{...inp,cursor:'pointer'}}>
              {HOURS.filter(h=>h>sh).concat([20]).map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}
            </select>
            {errors.eh&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.eh}</div>}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Alunos Matriculados</label>
          <input type="number" min={1} max={1000} value={enroll} onChange={e=>setEnroll(e.target.value)} style={inp}/>
          {errors.enroll&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.enroll}</div>}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancelar</button>
          <button onClick={handleSave} style={{padding:'8px 20px',background:cd.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:11,fontWeight:700,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Salvar Alterações</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de mesclagem ───────────────────────────────────────────────────────
function MergeModal({room,incomingCourse,conflicts,totalEnroll,dept,onConfirm,onCancel}){
  const{T,theme}=useT();
  const rd=gDept(room.deptId),dClr=dtc(dept,theme);
  const over=totalEnroll>room.cap,existing=conflicts.reduce((s,c)=>s+c.enroll,0);
  const pctEx=Math.min(existing/room.cap,1)*100,pctNew=Math.min(incomingCourse.enroll/room.cap,Math.max(0,1-pctEx/100))*100;
  const[confirmed,setConfirmed]=useState(false);
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:34,height:34,borderRadius:8,background:theme==='light'?'#fffbeb':'#1a1400',border:`1px solid ${theme==='light'?'#f59e0b44':'#F59E0B44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⇄</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Mesclar Turmas?</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginTop:2}}>{room.label} · {room.type} · {room.building}</div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:10,padding:'14px 16px',marginBottom:16,border:`1px solid ${T.bdr}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>Capacidade da Sala</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:over?'#ef4444':totalEnroll/room.cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399'}}>{totalEnroll}<span style={{fontSize:11,color:T.dim}}> / {room.cap}</span></span>
          </div>
          <div style={{height:10,borderRadius:5,background:T.barTrack,overflow:'hidden',display:'flex',marginBottom:8}}>
            <div style={{width:`${pctEx}%`,background:T.barExist,transition:'width .4s',flexShrink:0}}/>
            <div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',transition:'width .4s',flexShrink:0}}/>
          </div>
          <div style={{display:'flex',gap:16}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.barExist}}>■ existente: {existing}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:over?'#ef4444':'#d97706'}}>■ entrante: {incomingCourse.enroll}</span>
          </div>
          {over&&<div style={{marginTop:10,padding:'7px 10px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:6,fontSize:10,color:theme==='light'?'#b91c1c':'#ef4444'}}>⚠ A matrícula combinada excede a capacidade em <strong>{totalEnroll-room.cap} alunos</strong>.</div>}
        </div>
        <div style={{marginBottom:over?14:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Disciplinas compartilhando esta sala</div>
          <div style={{padding:'9px 12px',background:dbg(dept,theme),border:`1px solid ${dept.clr}44`,borderRadius:7,marginBottom:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:dClr,fontWeight:600}}>{incomingCourse.code}</span><span style={{fontSize:10,color:T.txt2,marginLeft:8}}>{incomingCourse.name}</span></div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{incomingCourse.sh}:00–{incomingCourse.eh}:00</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:dClr,background:dbg(dept,theme),border:`1px solid ${dept.clr}55`,borderRadius:3,padding:'1px 5px'}}>NOVA</span>
              </div>
            </div>
          </div>
          {conflicts.map(c=>{const cd=gDept(c.deptId),cdClr=dtc(cd,theme);return(
            <div key={c.id} style={{padding:'9px 12px',background:T.card,border:`1px solid ${T.bdr}`,borderRadius:7,marginBottom:4}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:cdClr}}>{c.code}</span><span style={{fontSize:10,color:T.muted,marginLeft:8}}>{c.name}</span></div>
                <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{c.sh}:00–{c.eh}:00</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{c.enroll} al.</span></div>
              </div>
            </div>
          );})}
        </div>
        {over&&<label style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,cursor:'pointer',userSelect:'none',padding:'8px 10px',background:theme==='light'?'#fef2f2':'#1a0505',borderRadius:6,border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`}}>
          <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} style={{accentColor:'#ef4444',width:14,height:14}}/>
          <span style={{fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444'}}>Estou ciente de que isso excede a capacidade da sala e desejo continuar</span>
        </label>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background=T.inner} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>Cancelar</button>
          <button onClick={onConfirm} disabled={over&&!confirmed} style={{padding:'8px 20px',borderRadius:7,fontSize:11,fontWeight:700,transition:'all .15s',background:over?(confirmed?'#ef4444':theme==='light'?'#f3f4f6':'#1a0505'):'#F59E0B',border:over?`1px solid ${confirmed?'#ef4444':T.bdr}`:'none',color:over?(confirmed?'#fff':T.dim):'#000',cursor:over&&!confirmed?'not-allowed':'pointer'}} onMouseEnter={e=>{if(!(over&&!confirmed))e.currentTarget.style.filter='brightness(1.08)';}} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
            {over?'⚠ Confirmar Mesclagem':'⇄ Confirmar Mesclagem'}
          </button>
        </div>
      </div>
    </div>
  );
}
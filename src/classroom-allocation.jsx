import { useState, useMemo, Fragment, useRef, useEffect } from 'react';
import { ThemeCtx, LIGHT, DARK, useT, dtc, dbg } from './theme.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ROLES } from './auth/roles.js';
import { PERMS } from './auth/permissions.js';
import LoginPage from './components/LoginPage.jsx';
import UserManagement from './components/UserManagement.jsx';

// ─── Department definitions ───────────────────────────────────────────────────
const DEPTS = [
  { id:'MATH', full:'Department of Mathematics',      clr:'#60A5FA', textClr:'#1d4ed8', bg:'#0d1f3d', lightBg:'#eff6ff' },
  { id:'PHYS', full:'Department of Physics',          clr:'#FBBF24', textClr:'#92400e', bg:'#2c1f06', lightBg:'#fffbeb' },
  { id:'CS',   full:'Department of Computer Science', clr:'#34D399', textClr:'#065f46', bg:'#062c1d', lightBg:'#ecfdf5' },
  { id:'CHEM', full:'Department of Chemistry',        clr:'#A78BFA', textClr:'#5b21b6', bg:'#1c0d3d', lightBg:'#f5f3ff' },
];
const DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
const HOURS = [8,9,10,11,12,13,14,15,16,17,18,19];
const ROOM_TYPES = ['Lecture Hall','Lab','Seminar Room','Computer Lab','Tutorial Room','Amphitheater'];
const ROOM_FEATS = [['Projector','Whiteboard'],['Projector','Smart Board'],['Whiteboard','AC'],['Projector','AC','Whiteboard'],['Smart Board','Lab Equipment'],['Computers','Projector','AC']];
const COURSE_NAMES = {
  MATH:['Calculus I','Calculus II','Linear Algebra','Statistics','Differential Equations','Number Theory','Abstract Algebra','Real Analysis','Complex Analysis','Topology','Probability','Discrete Mathematics','Numerical Analysis','Graph Theory','Optimization','Geometry','Logic','Set Theory','Mathematical Modeling','Game Theory'],
  PHYS:['Classical Mechanics','Electromagnetism','Thermodynamics','Quantum Mechanics','Optics','Special Relativity','Astrophysics','Nuclear Physics','Fluid Dynamics','Wave Theory','Solid State Physics','Particle Physics','Biophysics','Acoustics','Plasma Physics','Atomic Physics','Photonics','Computational Physics','Medical Physics','Geophysics'],
  CS:  ['Algorithms','Data Structures','Operating Systems','Computer Networks','Databases','Artificial Intelligence','Machine Learning','Compilers','Software Engineering','Computer Graphics','Cybersecurity','Web Development','Cloud Computing','Distributed Systems','Computer Vision','NLP','Robotics','HCI','Parallel Computing','Game Development'],
  CHEM:['Organic Chemistry','Inorganic Chemistry','Physical Chemistry','Biochemistry','Analytical Chemistry','Polymer Chemistry','Electrochemistry','Spectroscopy','Thermochemistry','Kinetics','Catalysis','Environmental Chemistry','Medicinal Chemistry','Computational Chemistry','Green Chemistry','Nanochemistry','Surface Chemistry','Crystallography','Radiochemistry','Chemical Biology'],
};

// ─── Room feature options (organised by category) ────────────────────────────
const FEATURE_OPTIONS = [
  { group:'Display',      items:['Projector','Smart Board','Whiteboard','Chalkboard','Document Camera','TV Screen'] },
  { group:'Technology',   items:['Computers','Recording Equipment','Video Conferencing','Wi-Fi','PA System'] },
  { group:'Comfort',      items:['AC','Heating','Natural Light','Soundproofing'] },
  { group:'Access',       items:['Wheelchair Access','Elevator Access','Emergency Exit'] },
  { group:'Lab / Special',items:['Lab Equipment','Lab Benches','Fume Hood','Safety Equipment','Darkroom'] },
];

const DS = { ACTIVE:'active', FINISHED:'finished', FORCE_FINISHED:'force_finished' };

// ─── Data generation ──────────────────────────────────────────────────────────
function mkRng(s){s=s>>>0;return()=>{s^=s<<13;s^=s>>17;s^=s<<5;return(s>>>0)/4294967296;};}
const {ROOMS_BASE,INIT_COURSES}=(()=>{
  const r=mkRng(31415),r2=mkRng(99991);
  const ROOMS_BASE=DEPTS.flatMap(d=>Array.from({length:30},(_,i)=>({
    id:`${d.id}-R${String(i+1).padStart(2,'0')}`,deptId:d.id,label:`${d.id[0]}${200+i+1}`,
    cap:[20,30,40,50,60,80,100,120][Math.floor(r()*8)],
    type:ROOM_TYPES[Math.floor(r2()*ROOM_TYPES.length)],
    features:ROOM_FEATS[Math.floor(r2()*ROOM_FEATS.length)],
    building:`${d.id[0]}-Building`,floor:Math.floor(r2()*4)+1,
  })));
  const INIT_COURSES=[];let n=1;
  DEPTS.forEach(d=>{
    const ns=COURSE_NAMES[d.id];
    for(let i=0;i<175;i++){
      const p=r();
      const days=p<.35?['Monday','Wednesday','Friday']:p<.65?['Tuesday','Thursday']:p<.80?['Monday','Wednesday']:p<.92?['Monday','Thursday']:[DAYS[Math.floor(r()*5)]];
      const sh=Math.floor(r()*10)+8,dur=r()<.5?1:r()<.75?2:3,eh=Math.min(sh+dur,20);
      INIT_COURSES.push({id:`${d.id}-C${n++}`,code:`${d.id}${(Math.floor(i/ns.length)+1)*100+(i%ns.length)+1}`,
        name:ns[i%ns.length]+(Math.floor(i/ns.length)>0?` ${Math.floor(i/ns.length)+1}`:''),
        sec:Math.floor(r()*4)+1,deptId:d.id,days,sh,eh,enroll:Math.floor(r()*90)+10,room:null});
    }
  });
  return{ROOMS_BASE,INIT_COURSES};
})();

// ─── Allocation helpers ───────────────────────────────────────────────────────
const gDept=id=>DEPTS.find(d=>d.id===id);
function buildAlloc(courses){const m={};courses.forEach(c=>{if(!c.room)return;c.days.forEach(day=>{for(let h=c.sh;h<c.eh;h++){const k=`${c.room}|${day}|${h}`;if(!m[k])m[k]=[];m[k].push(c);}});});return m;}
function roomFree(rid,course,alloc){for(const day of course.days)for(let h=course.sh;h<course.eh;h++)if((alloc[`${rid}|${day}|${h}`]||[]).length)return false;return true;}
function getConflicts(rid,course,alloc,courses){const ids=new Set();for(const day of course.days)for(let h=course.sh;h<course.eh;h++)(alloc[`${rid}|${day}|${h}`]||[]).forEach(c=>{if(c.id!==course.id)ids.add(c.id);});return[...ids].map(id=>courses.find(c=>c.id===id)).filter(Boolean);}
function rowSlots(rid,day,alloc){const slots=[];let h=8;while(h<20){const arr=alloc[`${rid}|${day}|${h}`]||[];if(arr.length){const c=arr[0];if(c.sh===h){slots.push({h,span:c.eh-c.sh,c,merged:arr.length-1});h=c.eh;}else h++;}else{slots.push({h,span:1,c:null,merged:0});h++;}}return slots;}
function fmtHour(h){return`${String(h).padStart(2,'0')}:00`;}

// ─── Auto-allocation algorithm ────────────────────────────────────────────────
// Greedy scheduler: sorts courses hardest-to-place first, then picks the best
// available room (own-dept preference + minimal capacity waste).
function autoAllocate(unplacedCourses, rooms, existingAlloc) {
  // Sort by hardest-to-place first:
  //   1. Largest enrollment  → fewest rooms can accommodate them
  //   2. Most "slot pressure" (days × duration) → create most conflicts
  const sorted = [...unplacedCourses].sort((a, b) => {
    if (b.enroll !== a.enroll) return b.enroll - a.enroll;
    return (b.days.length*(b.eh-b.sh)) - (a.days.length*(a.eh-a.sh));
  });

  // Work on a shallow clone of the alloc map so we don't mutate React state
  const tempAlloc = {};
  Object.entries(existingAlloc).forEach(([k,arr]) => { tempAlloc[k] = [...arr]; });

  const assignments = []; // { course, room }
  const failed      = []; // { course, reason }

  for (const course of sorted) {
    // Rooms that can fit the enrollment and have no time conflict
    const candidates = rooms.filter(r =>
      r.cap >= course.enroll && roomFree(r.id, course, tempAlloc)
    );

    if (candidates.length === 0) {
      const bestCap = rooms.reduce((m,r)=>Math.max(m,r.cap),0);
      const reason = bestCap < course.enroll
        ? `No room has sufficient capacity (need ${course.enroll}, max available ${bestCap})`
        : 'All compatible rooms are occupied during this time slot';
      failed.push({ course, reason });
      continue;
    }

    // Score: strong preference for own-dept room, then minimise wasted seats
    const best = candidates.reduce((prev, curr) => {
      const s = r => (r.deptId === course.deptId ? 10000 : 0) - (r.cap - course.enroll);
      return s(curr) > s(prev) ? curr : prev;
    });

    assignments.push({ course, room: best });

    // Mark slots as occupied in our simulation
    course.days.forEach(day => {
      for (let h = course.sh; h < course.eh; h++) {
        const k = `${best.id}|${day}|${h}`;
        if (!tempAlloc[k]) tempAlloc[k] = [];
        tempAlloc[k].push(course);
      }
    });
  }

  return { assignments, failed };
}

// ─── localStorage helpers ─────────────────────────────────────────────────────
const LS = {
  get:(k,def)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):def;}catch{return def;}},
  set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
};

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [theme,setTheme]=useState('light');
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
  if(isLoading)return<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>Loading…</div>;
  if(!currentUser)return<LoginPage/>;
  return<Dashboard/>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard(){
  const{currentUser,logout,can}=useAuth();
  const{T,theme,toggleTheme}=useT();

  const isChief   =currentUser.role===ROLES.CHIEF;
  const isDeptHead=currentUser.role===ROLES.DEPT_HEAD;

  const [activeDeptId,setActiveDeptId]=useState(isChief?DEPTS[0].id:currentUser.deptId);
  const [courses,setCourses]          =useState(INIT_COURSES);
  const [roomFeatures,setRoomFeatures]=useState({});            // roomId → string[]

  const [deptStatuses,setDeptStatusesRaw]=useState(()=>LS.get('cas_dept_statuses',Object.fromEntries(DEPTS.map(d=>[d.id,DS.ACTIVE]))));
  const [notifications,setNotifsRaw]    =useState(()=>LS.get('cas_notifications',[]));
  const setDeptStatuses=next=>{LS.set('cas_dept_statuses',next);setDeptStatusesRaw(next);};
  const setNotifs      =next=>{LS.set('cas_notifications',next);setNotifsRaw(next);};

  const [selId,         setSelId]         =useState(null);
  const [day,           setDay]           =useState('Monday');
  const [viewMode,      setViewMode]      =useState('list');
  const [search,        setSearch]        =useState('');
  const [finishConfirm, setFinishConfirm] =useState(false);
  const [editingCourse, setEditingCourse] =useState(null);
  const [featuresModal, setFeaturesModal] =useState(null);  // roomId
  const [autoAllocResult,setAutoAllocResult]=useState(null);// { assignments, failed }
  const [deptPanel,     setDeptPanel]     =useState(false);
  const [notifPanel,    setNotifPanel]    =useState(false);
  const [mergeModal,    setMergeModal]    =useState(null);
  const [showUsers,     setShowUsers]     =useState(false);
  const [toast,         setToast]         =useState(null);

  const showToast=(msg,type='ok')=>{setToast({msg,type});setTimeout(()=>setToast(null),3200);};

  const d         = gDept(activeDeptId);
  const alloc     = useMemo(()=>buildAlloc(courses),[courses]);
  const sel       = useMemo(()=>selId?courses.find(c=>c.id===selId):null,[selId,courses]);
  // Merge generated features with any chief-edited overrides
  const ROOMS     = useMemo(()=>ROOMS_BASE.map(r=>({...r,features:roomFeatures[r.id]??r.features})),[roomFeatures]);
  const myStatus  = isDeptHead?deptStatuses[currentUser.deptId]:null;
  const isLocked  = isDeptHead&&myStatus!==DS.ACTIVE;
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

  // Courses fed to the auto-allocator (unfiltered by search)
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

  // Allocation actions
  const tryAllocate=rid=>{
    if(!canAllocate||!sel)return;
    if(roomFree(rid,sel,alloc))forceAllocate(rid);
    else if(canMerge)setMergeModal({roomId:rid});
  };
  const forceAllocate=rid=>{
    setCourses(p=>p.map(c=>c.id===selId?{...c,room:rid}:c));
    setSelId(null);setMergeModal(null);
    if(isChief&&sel)setActiveDeptId(courses.find(c=>c.id===selId)?.deptId??activeDeptId);
  };
  const deallocate=cid=>{if(canDealloc)setCourses(p=>p.map(c=>c.id===cid?{...c,room:null}:c));};
  const saveFeatures=(rid,feats)=>{if(canEditFeatures){setRoomFeatures(p=>({...p,[rid]:feats}));setFeaturesModal(null);}};
  const selectCourse=c=>{
    if(!canAllocate)return;
    if(selId===c.id){setSelId(null);return;}
    setSelId(c.id);
    if(isChief)setActiveDeptId(c.deptId);
  };
  const handleEditCourse=(courseId,changes)=>{
    setCourses(prev=>{
      const original=prev.find(c=>c.id===courseId);
      if(!original)return prev;
      const updated={...original,...changes};
      let finalRoom=updated.room;
      if(finalRoom&&(changes.sh!==undefined||changes.eh!==undefined||changes.days!==undefined)){
        const others=prev.filter(c=>c.room===finalRoom&&c.id!==courseId);
        if(!roomFree(finalRoom,updated,buildAlloc(others))){
          finalRoom=null;
          showToast('Schedule changed — room cleared. Please re-allocate.','warn');
        }
      }
      return prev.map(c=>c.id===courseId?{...updated,room:finalRoom}:c);
    });
    setEditingCourse(null);
  };

  // Auto-allocation
  const handleAutoAllocate=()=>{
    if(autoAllocInput.length===0){showToast('No unallocated courses to assign.','warn');return;}
    const result=autoAllocate(autoAllocInput,visRooms,alloc);
    setAutoAllocResult(result);
  };
  const handleApplyAllocation=()=>{
    if(!autoAllocResult)return;
    setCourses(prev=>{
      let updated=[...prev];
      autoAllocResult.assignments.forEach(({course,room})=>{
        updated=updated.map(c=>c.id===course.id?{...c,room:room.id}:c);
      });
      return updated;
    });
    showToast(`✨ ${autoAllocResult.assignments.length} course${autoAllocResult.assignments.length!==1?'s':''} allocated automatically.`,'ok');
    setAutoAllocResult(null);setSelId(null);
  };

  // Finish workflow
  const handleFinish=()=>{
    setDeptStatuses({...deptStatuses,[currentUser.deptId]:DS.FINISHED});
    setNotifs([...notifications,{id:Date.now(),deptId:currentUser.deptId,deptName:gDept(currentUser.deptId)?.full,type:'FINISHED',userName:currentUser.name,timestamp:new Date().toISOString(),read:false}]);
    setSelId(null);setFinishConfirm(false);
    showToast('Allocation submitted. The chief has been notified.','ok');
  };
  const handleReopen     =deptId=>{setDeptStatuses({...deptStatuses,[deptId]:DS.ACTIVE});showToast(`${gDept(deptId)?.full} reopened.`,'ok');};
  const handleForceFinish=deptId=>{setDeptStatuses({...deptStatuses,[deptId]:DS.FORCE_FINISHED});showToast(`${gDept(deptId)?.full} locked.`,'ok');};
  const markNotifsRead=()=>setNotifs(notifications.map(n=>({...n,read:true})));

  const mergeRoom  =mergeModal?ROOMS.find(r=>r.id===mergeModal.roomId):null;
  const mergeCons  =(mergeModal&&sel)?getConflicts(mergeModal.roomId,sel,alloc,courses):[];
  const mergeTotal =sel?mergeCons.reduce((s,c)=>s+c.enroll,0)+sel.enroll:0;
  const dClr       =dtc(d,theme);
  const selBannerBg=dbg(d,theme);
  const mono       ={fontFamily:"'DM Mono',monospace"};

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

      {/* Header */}
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
        {[['Total',stats.total,T.muted],['Allocated',stats.done,theme==='light'?'#059669':'#34D399'],['Pending',stats.pend,theme==='light'?'#b45309':'#FBBF24'],['Cross‑Dept',stats.cross,theme==='light'?'#5b21b6':'#A78BFA']].map(([l,v,c])=>(
          <div key={l} style={{textAlign:'center',padding:'0 12px',borderLeft:`1px solid ${T.bdr}`}}>
            <div style={{fontSize:17,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
            <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginTop:2}}>{l}</div>
          </div>
        ))}
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:20,display:'flex',alignItems:'center',gap:6}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:isChief?(theme==='light'?'#5b21b6':'#A78BFA'):dClr}}/>
          <span style={{...mono,fontSize:9,color:T.muted}}>{currentUser.name}</span>
          <span style={{...mono,fontSize:8,color:T.dim,borderLeft:`1px solid ${T.bdr2}`,paddingLeft:6}}>{isChief?'Chief':'Dept Head'}</span>
        </div>
        {isChief&&(
          <>
            <button className="icon-btn" onClick={()=>{setDeptPanel(true);setNotifPanel(false);}} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>Departments</button>
            <button className="icon-btn" onClick={()=>{setNotifPanel(v=>!v);markNotifsRead();}} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:unreadCount>0?(theme==='light'?'#b45309':'#FBBF24'):T.muted,fontSize:10,cursor:'pointer',position:'relative'}}>
              🔔{unreadCount>0&&<span style={{marginLeft:4,background:'#ef4444',color:'#fff',borderRadius:10,padding:'0 5px',fontSize:8}}>{unreadCount}</span>}
            </button>
            <button className="icon-btn" onClick={()=>setShowUsers(true)} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>👥 Users</button>
          </>
        )}
        <button className="icon-btn" onClick={toggleTheme} style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>{theme==='light'?'🌙':'☀'}</button>
        <button className="icon-btn" onClick={logout} style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:6,color:T.muted,fontSize:10,cursor:'pointer'}}>Sign out</button>
      </div>

      {/* Body */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* Sidebar */}
        <aside style={{width:274,borderRight:`1px solid ${T.bdr}`,display:'flex',flexDirection:'column',overflow:'hidden',background:theme==='light'?T.surface:T.card}}>
          <div style={{padding:'10px 12px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
            <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>
              {isChief?'All Unallocated Courses':'Unallocated Courses'}
            </div>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search courses…" disabled={isLocked}
              style={{width:'100%',padding:'5px 9px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:11,outline:'none',opacity:isLocked?.6:1}}/>
            <div style={{fontSize:10,color:T.muted,marginTop:5}}>
              {sidebarCourses.length} pending · {autoAllocInput.length} total unallocated
            </div>
          </div>

          {isLocked&&(
            <div style={{padding:'10px 14px',background:myStatus===DS.FORCE_FINISHED?(theme==='light'?'#fef2f2':'#1a0505'):(theme==='light'?'#f0fdf4':'#0a2a0a'),borderBottom:`1px solid ${myStatus===DS.FORCE_FINISHED?'#ef444433':'#34d39933'}`,flexShrink:0}}>
              <div style={{fontSize:11,fontWeight:600,color:myStatus===DS.FORCE_FINISHED?(theme==='light'?'#b91c1c':'#ef4444'):(theme==='light'?'#15803d':'#34d399'),marginBottom:2}}>
                {myStatus===DS.FORCE_FINISHED?'🔒 Locked by Chief':'✓ Submission Complete'}
              </div>
              <div style={{fontSize:10,color:T.muted,lineHeight:1.4}}>
                {myStatus===DS.FORCE_FINISHED?'Your allocation has been locked by the institutional chief.':'You have submitted your allocations.'}
              </div>
            </div>
          )}

          <div style={{flex:1,overflowY:'auto',padding:'5px'}}>
            {sidebarCourses.length===0?(
              <div style={{textAlign:'center',padding:32,color:T.dim}}>
                <div style={{fontSize:24,marginBottom:8}}>{search?'∅':'✓'}</div>
                <div style={{fontSize:12}}>{search?'No matches':'All courses allocated'}</div>
              </div>
            ):sidebarCourses.map(c=>(
              <CourseCard key={c.id} course={c} activeDept={gDept(activeDeptId)} showDeptBadge={isChief}
                selected={selId===c.id} locked={isLocked}
                onSelect={()=>selectCourse(c)}
                onEdit={canEditCourse?()=>setEditingCourse(c):null}/>
            ))}
          </div>

          {/* Bottom action area */}
          {!isLocked&&(isDeptHead||isChief)&&(
            <div style={{padding:'10px 12px',borderTop:`1px solid ${T.bdr}`,flexShrink:0,display:'flex',flexDirection:'column',gap:6}}>
              {/* Magic auto-allocate button */}
              {autoAllocInput.length>0&&(
                <button onClick={handleAutoAllocate}
                  style={{width:'100%',padding:'8px',background:theme==='light'?'#eff6ff':'#0d1f3d',
                    border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,borderRadius:7,
                    color:theme==='light'?'#1d4ed8':'#60A5FA',fontSize:11,fontWeight:600,cursor:'pointer',
                    transition:'all .15s',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}
                  onMouseEnter={e=>{e.currentTarget.style.background=theme==='light'?'#dbeafe':'#1e3a5f';}}
                  onMouseLeave={e=>{e.currentTarget.style.background=theme==='light'?'#eff6ff':'#0d1f3d';}}>
                  ✨ Auto-Allocate Remaining
                </button>
              )}
              {/* Finish button (dept head only) */}
              {isDeptHead&&(
                <button onClick={()=>setFinishConfirm(true)}
                  style={{width:'100%',padding:'8px',background:theme==='light'?'#f0fdf4':'#0a2a0a',
                    border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,
                    color:theme==='light'?'#15803d':'#34d399',fontSize:11,fontWeight:600,cursor:'pointer',transition:'all .15s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background=theme==='light'?'#dcfce7':'#0d3321';}}
                  onMouseLeave={e=>{e.currentTarget.style.background=theme==='light'?'#f0fdf4':'#0a2a0a';}}>
                  ✓ Mark as Finished
                </button>
              )}
            </div>
          )}
        </aside>

        {/* Main */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',borderBottom:`1px solid ${T.bdr}`,background:theme==='light'?T.surface:T.card,flexShrink:0}}>
            <div style={{display:'flex',gap:2,border:`1px solid ${T.bdr2}`,borderRadius:6,overflow:'hidden'}}>
              {[['grid','⊞ Grid'],['list','≡ List']].map(([m,lbl])=>(
                <button key={m} className={`viewbtn${viewMode===m?' active':''}`} onClick={()=>setViewMode(m)}
                  style={{padding:'4px 12px',fontSize:10,fontWeight:500,background:'transparent',border:'none',color:viewMode===m?dClr:T.muted,transition:'all .12s',cursor:'pointer'}}>{lbl}</button>
              ))}
            </div>
            <div style={{width:1,height:16,background:T.bdr2}}/>
            {viewMode==='grid'&&DAYS.map(dy=>(
              <button key={dy} onClick={()=>setDay(dy)} style={{padding:'4px 10px',borderRadius:5,fontSize:10,fontWeight:500,background:day===dy?d.clr:'transparent',color:day===dy?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${day===dy?d.clr:T.bdr2}`,transition:'all .12s',cursor:'pointer'}}>{dy.slice(0,3)}</button>
            ))}
            <div style={{flex:1}}/>
            <span style={{...mono,fontSize:9,color:T.dim}}>{isChief?'Chief view — all rooms visible':`Showing ${gDept(currentUser.deptId)?.full} rooms only`}</span>
          </div>

          {sel&&canAllocate&&(
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',background:selBannerBg,borderBottom:`1px solid ${d.clr}44`,flexShrink:0}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:d.clr,animation:'blink 1.5s infinite'}}/>
              <span style={{...mono,fontSize:10,color:dClr,fontWeight:600}}>{sel.code}</span>
              <span style={{fontSize:11,color:T.txt2,maxWidth:200,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sel.name}</span>
              <span style={{...mono,fontSize:10,color:T.muted}}>{sel.days.map(x=>x.slice(0,2)).join('/')} · {fmtHour(sel.sh)}–{fmtHour(sel.eh)} · {sel.enroll} students</span>
              <div style={{flex:1}}/>
              {viewMode==='grid'&&!sel.days.includes(day)&&<span style={{fontSize:9,color:theme==='light'?'#b45309':'#FBBF24'}}>Not on {day} — switch to {sel.days[0].slice(0,3)}</span>}
              {viewMode==='grid'&&sel.days.includes(day)&&<span style={{fontSize:9,color:T.muted}}><span style={{color:d.clr}}>●</span> free {canMerge&&<><span style={{color:'#F59E0B'}}>●</span> merge</>}</span>}
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

      {/* Modals */}
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

// ─── Course Card ──────────────────────────────────────────────────────────────
function CourseCard({course,activeDept,showDeptBadge,selected,locked,onSelect,onEdit}){
  const{T,theme}=useT();
  const cd=gDept(course.deptId),badgeClr=dtc(cd,theme);
  return(
    <div className={`cc${selected?' sel':''}${locked?' locked':''}`}
      style={{padding:'8px 10px',borderRadius:6,marginBottom:2,cursor:locked?'default':'pointer',
        background:'transparent',border:`1px solid ${selected?activeDept.clr:T.bdr}`,transition:'background .1s, border-color .1s',position:'relative'}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <div style={{display:'flex',alignItems:'center',gap:5}}>
          {showDeptBadge&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:badgeClr,background:`${cd.clr}${theme==='light'?'22':'14'}`,border:`1px solid ${cd.clr}44`,borderRadius:3,padding:'1px 4px'}}>{cd.id}</span>}
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:showDeptBadge?badgeClr:dtc(activeDept,theme)}} onClick={onSelect}>{course.code}</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{course.enroll} stu</span>
          {onEdit&&!locked&&(
            <button onClick={e=>{e.stopPropagation();onEdit();}} title="Edit course"
              style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 4px',cursor:'pointer',lineHeight:1.3,transition:'all .1s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;e.currentTarget.style.color=T.txt;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✏</button>
          )}
        </div>
      </div>
      <div style={{fontSize:11,fontWeight:500,color:T.txt,marginBottom:2,lineHeight:1.3}} onClick={onSelect}>{course.name}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}} onClick={onSelect}>{course.days.map(x=>x.slice(0,2)).join('/')} · {fmtHour(course.sh)}–{fmtHour(course.eh)}</div>
    </div>
  );
}

// ─── Grid View ────────────────────────────────────────────────────────────────
function Grid({rooms,day,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const dClr=dtc(dept,theme);
  const CW=76,RH=33,LW=130;
  const sorted=useMemo(()=>[...rooms.filter(r=>r.deptId===deptId),...rooms.filter(r=>r.deptId!==deptId)],[rooms,deptId]);
  return(
    <table style={{borderCollapse:'collapse',tableLayout:'fixed',minWidth:LW+CW*12}}>
      <colgroup><col style={{width:LW}}/>{HOURS.map(h=><col key={h} style={{width:CW}}/>)}</colgroup>
      <thead>
        <tr style={{position:'sticky',top:0,zIndex:5,background:T.surface,boxShadow:theme==='light'?'0 1px 2px rgba(0,0,0,.06)':'none'}}>
          <th style={{padding:'7px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>Room / Cap</th>
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
          const capWarn=sel&&room.cap<sel.enroll;
          const rowBg=isOwn?(theme==='light'?'#ffffff':T.bg):(theme==='light'?T.faint:T.inner);
          return(
            <Fragment key={room.id}>
              {showSep&&<tr><td colSpan={13} style={{padding:'5px 10px',fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,background:T.faint,borderTop:`1px solid ${T.bdr}`,borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>Other Departments ↓</td></tr>}
              <tr style={{borderBottom:`1px solid ${T.bdr}`,background:rowBg}}>
                <td style={{padding:'0 6px 0 10px',height:RH}}>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:2,height:18,borderRadius:1,background:rd.clr,opacity:isOwn?1:0.4}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:isOwn?rdClr:T.muted,whiteSpace:'nowrap'}}>{room.label}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:capWarn&&sel?'#d97706':T.dim}}>{room.cap}{capWarn&&sel?'⚠':''}</span>
                    {room.features.length>0&&<span title={room.features.join(', ')} style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.dim,opacity:.7}}>⚙{room.features.length}</span>}
                    {canEditFeatures&&<button onClick={()=>onEditFeatures(room.id)} title="Edit features"
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
                          title={`${slot.c.name} · ${slot.c.sh}:00–${slot.c.eh}:00 · ${slot.c.enroll} students${isMine&&canDealloc?'\nClick to unassign':''}${isMergeZone?'\nClick to merge':''}` }
                          style={{height:'100%',padding:'0 5px',borderRadius:3,background:isMine?`${cd.clr}${theme==='light'?'28':'22'}`:`${cd.clr}${theme==='light'?'18':'0e'}`,borderLeft:`2px solid ${isMergeZone?'#F59E0B':cd.clr}`,display:'flex',alignItems:'center',gap:4,overflow:'hidden',cursor:isMergeZone?'pointer':isMine&&canDealloc?'pointer':'default',transition:'filter .12s'}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:isMergeZone?'#d97706':cdClr,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>{slot.c.code}</span>
                          {slot.merged>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:'#d97706',background:'#F59E0B22',borderRadius:2,padding:'0 3px',flexShrink:0}}>+{slot.merged}</span>}
                          {isMergeZone&&<span style={{fontSize:9,flexShrink:0}}>⇄</span>}
                          {isMine&&canEditCourse&&<button onClick={e=>{e.stopPropagation();onEditCourse(slot.c);}} title="Edit" style={{background:'none',border:'none',color:cdClr,fontSize:8,padding:0,cursor:'pointer',opacity:.7,flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=.7}>✏</button>}
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

// ─── List View ────────────────────────────────────────────────────────────────
function ListView({rooms,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T}=useT();
  const sorted=useMemo(()=>[...rooms.filter(r=>r.deptId===deptId),...rooms.filter(r=>r.deptId!==deptId)],[rooms,deptId]);
  if(!sel)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}>
      <div style={{fontSize:36,opacity:.12}}>≡</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>{canAllocate?'Select a course from the left to see room availability':'Read-only view'}</div>
    </div>
  );
  const own=sorted.filter(r=>r.deptId===deptId),oth=sorted.filter(r=>r.deptId!==deptId);
  return(
    <div style={{padding:16,display:'flex',flexDirection:'column',gap:20,animation:'fadeIn .2s ease'}}>
      <RoomSection title={`${gDept(deptId).full} — Own Rooms`} rooms={own} alloc={alloc} courses={courses} sel={sel} deptId={deptId} dept={dept} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>
      {oth.length>0&&<RoomSection title="Other Departments — Cross-Allocation" rooms={oth} alloc={alloc} courses={courses} sel={sel} deptId={deptId} dept={dept} canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>}
    </div>
  );
}

function RoomSection({title,rooms,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditFeatures,canEditCourse,onTryAlloc,onDealloc,onEditFeatures,onEditCourse}){
  const{T,theme}=useT();
  const free=rooms.filter(r=>roomFree(r.id,sel,alloc)),busy=rooms.filter(r=>!roomFree(r.id,sel,alloc));
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>{title}</span>
        <div style={{flex:1,height:1,background:T.bdr}}/>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:theme==='light'?'#059669':'#34D399'}}>{free.length} free</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>/</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:theme==='light'?'#d97706':'#F59E0B'}}>{busy.length} {canMerge?'merge possible':'busy'}</span>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',gap:8}}>
        {free.map(r=><RoomCard key={r.id} room={r} sel={sel} alloc={alloc} courses={courses} deptId={deptId} dept={dept} status="available" canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>)}
        {busy.map(r=><RoomCard key={r.id} room={r} sel={sel} alloc={alloc} courses={courses} deptId={deptId} dept={dept} status="busy" canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditFeatures={canEditFeatures} canEditCourse={canEditCourse} onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditFeatures={onEditFeatures} onEditCourse={onEditCourse}/>)}
      </div>
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
            title="Edit room features"
            style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:8,padding:'1px 5px',opacity:0,transition:'opacity .15s',cursor:'pointer'}}
            onMouseEnter={e=>{e.stopPropagation();e.currentTarget.style.borderColor=T.muted;}}
            onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>⚙ edit</button>
        )}
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,marginBottom:6}}>{room.type} · Floor {room.floor}</div>
      {/* Feature chips */}
      {room.features.length>0&&(
        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:8}}>
          {room.features.map(f=><span key={f} style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,border:`1px solid ${T.bdr}`,borderRadius:3,padding:'1px 4px',background:T.inner}}>{f}</span>)}
        </div>
      )}
      <CapacityBar cap={room.cap} enroll={sel?.enroll||0} conflicts={avail?[]:conflicts} avail={avail}/>
      {avail?(
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:theme==='light'?'#059669':'#34D399'}}/>
          <span style={{fontSize:9,color:theme==='light'?'#059669':'#34D399',fontFamily:"'DM Mono',monospace"}}>Available</span>
          {capWarn&&<span style={{fontSize:8,color:'#d97706',marginLeft:'auto'}}>⚠ under capacity</span>}
          {hov&&clickable&&!capWarn&&<span style={{fontSize:8,color:dtc(dept,theme),marginLeft:'auto'}}>Click to assign →</span>}
        </div>
      ):(
        <div style={{marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:6}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#F59E0B'}}/>
            <span style={{fontSize:9,color:theme==='light'?'#d97706':'#F59E0B',fontFamily:"'DM Mono',monospace"}}>{conflicts.length} conflict{conflicts.length!==1?'s':''}</span>
          </div>
          {conflicts.map(c=>{
            const cd=gDept(c.deptId),cdClr=dtc(cd,theme),isMine=c.deptId===deptId;
            return(
              <div key={c.id} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 6px',background:`${cd.clr}${theme==='light'?'18':'0e'}`,borderRadius:4,marginBottom:2}}>
                <div style={{width:2,height:10,borderRadius:1,background:cd.clr}}/>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:cdClr,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.code}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>{c.enroll} stu</span>
                {isMine&&canDealloc&&<button onClick={e=>{e.stopPropagation();onDealloc(c.id);}} style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:7,padding:'1px 4px',cursor:'pointer',lineHeight:1.2}} onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✕</button>}
                {isMine&&canEditCourse&&<button onClick={e=>{e.stopPropagation();onEditCourse(c);}} style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,fontSize:7,padding:'1px 4px',cursor:'pointer',lineHeight:1.2}} onMouseEnter={e=>e.currentTarget.style.borderColor=T.muted} onMouseLeave={e=>e.currentTarget.style.borderColor=T.bdr2}>✏</button>}
              </div>
            );
          })}
          {canMerge&&canAllocate&&(
            <button onClick={e=>{e.stopPropagation();onTryAlloc(room.id);}} style={{width:'100%',marginTop:8,padding:'6px',borderRadius:5,background:overCap?(theme==='light'?'#fef3c7':'#3a1a0a'):(theme==='light'?'#fefce8':'#1a1400'),border:`1px solid ${overCap?'#F59E0B':'#F59E0B88'}`,color:theme==='light'?overCap?'#92400e':'#78350f':'#d4a017',fontSize:10,fontWeight:600,transition:'all .12s',cursor:'pointer'}}>
              ⇄ Merge Groups{overCap?' ⚠':''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Capacity Bar ─────────────────────────────────────────────────────────────
function CapacityBar({cap,enroll,conflicts,avail}){
  const{T,theme}=useT();
  const existing=conflicts.reduce((s,c)=>s+c.enroll,0),total=existing+enroll,over=total>cap;
  const pctEx=Math.min(existing/cap,1)*100,pctNew=Math.min(enroll/cap,Math.max(0,1-pctEx/100))*100;
  const pctTotal=Math.min(total/cap,1)*100;
  const pctColor=over?'#ef4444':total/cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399';
  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim}}>{avail?`${enroll} / ${cap} seats`:`${total} / ${cap} seats${over?' (over cap)':''}`}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:pctColor}}>{Math.round(total/cap*100)}%</span>
      </div>
      <div style={{height:5,borderRadius:3,background:T.barTrack,overflow:'hidden',display:'flex'}}>
        {avail?<div style={{width:`${pctTotal}%`,background:pctColor,borderRadius:3,transition:'width .3s'}}/>:
          <><div style={{width:`${pctEx}%`,background:T.barExist,borderRadius:'3px 0 0 3px',flexShrink:0}}/><div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',flexShrink:0}}/></>}
      </div>
      {!avail&&<div style={{display:'flex',gap:10,marginTop:3}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.barExist}}>■ existing {existing}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:over?'#ef4444':'#d97706'}}>■ incoming {enroll}</span>
      </div>}
    </div>
  );
}

// ─── Room Features Modal ──────────────────────────────────────────────────────
function RoomFeaturesModal({room,dept,onSave,onClose}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const rd=gDept(room.deptId),rdClr=dtc(rd,theme);
  const [selected,setSelected]=useState(new Set(room.features));
  const toggle=f=>setSelected(prev=>{const s=new Set(prev);s.has(f)?s.delete(f):s.add(f);return s;});
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:520,maxHeight:'80vh',display:'flex',flexDirection:'column',animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20,flexShrink:0}}>
          <div style={{width:3,height:20,borderRadius:1,background:rd.clr}}/>
          <span style={{...mono,fontSize:11,color:rdClr,fontWeight:500}}>{room.label}</span>
          <span style={{...mono,fontSize:9,color:T.dim}}>{room.type} · Cap {room.cap} · Floor {room.floor}</span>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:14,flexShrink:0}}>
          Room Features &amp; Equipment — {selected.size} selected
        </div>
        <div style={{flex:1,overflowY:'auto',paddingRight:4}}>
          {FEATURE_OPTIONS.map(({group,items})=>(
            <div key={group} style={{marginBottom:16}}>
              <div style={{...mono,fontSize:9,color:T.muted,marginBottom:8,letterSpacing:.5}}>{group}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {items.map(f=>{
                  const active=selected.has(f);
                  return(
                    <button key={f} onClick={()=>toggle(f)} style={{
                      padding:'5px 10px',borderRadius:6,fontSize:11,cursor:'pointer',transition:'all .12s',
                      background:active?(theme==='light'?`${rd.clr}22`:`${rd.clr}18`):'transparent',
                      color:active?rdClr:T.muted,
                      border:`1px solid ${active?rd.clr:T.bdr2}`,
                      fontWeight:active?600:400}}>
                      {active?'✓ ':''}{f}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,flexShrink:0,borderTop:`1px solid ${T.bdr}`,paddingTop:16}}>
          <button onClick={onClose} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancel</button>
          <button onClick={()=>onSave(room.id,[...selected])}
            style={{padding:'8px 20px',background:dept.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:11,fontWeight:700,cursor:'pointer'}}
            onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'}
            onMouseLeave={e=>e.currentTarget.style.filter='none'}>Save Features</button>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-Allocation Preview Modal ────────────────────────────────────────────
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

        {/* Header */}
        <div style={{padding:'20px 24px 16px',borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
            <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#eff6ff':'#0d1f3d',border:`1px solid ${theme==='light'?'#bfdbfe':'#60a5fa44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>✨</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Auto-Allocation Preview</div>
              <div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>Review before applying — this cannot be undone automatically</div>
            </div>
            <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
          </div>

          {/* Stats */}
          <div style={{display:'flex',gap:8}}>
            <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,borderRadius:7,textAlign:'center'}}>
              <div style={{fontSize:22,fontWeight:700,color:theme==='light'?'#15803d':'#34D399',lineHeight:1}}>{placedCount}</div>
              <div style={{...mono,fontSize:8,color:T.dim,marginTop:2}}>TO BE ALLOCATED</div>
            </div>
            {failedCount>0&&(
              <div style={{flex:1,padding:'8px 12px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:7,textAlign:'center'}}>
                <div style={{fontSize:22,fontWeight:700,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1}}>{failedCount}</div>
                <div style={{...mono,fontSize:8,color:T.dim,marginTop:2}}>UNPLACEABLE</div>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:0,borderBottom:`1px solid ${T.bdr}`,flexShrink:0}}>
          {[['placed',`✓ Proposed (${placedCount})`],['failed',`⚠ Unplaceable (${failedCount})`]].map(([key,label])=>(
            failedCount===0&&key==='failed'?null:(
              <button key={key} onClick={()=>setTab(key)} style={{
                flex:1,padding:'9px',fontSize:11,fontWeight:500,cursor:'pointer',background:'transparent',
                border:'none',borderBottom:`2px solid ${tab===key?dept.clr:'transparent'}`,
                color:tab===key?dClr:T.muted,transition:'all .12s'}}>
                {label}
              </button>
            )
          ))}
        </div>

        {/* List */}
        <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
          {tab==='placed'?(
            assignments.length===0?(
              <div style={{textAlign:'center',padding:32,color:T.dim,fontSize:12}}>Nothing to allocate.</div>
            ):assignments.map(({course,room},i)=>{
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
                    <div style={{...mono,fontSize:9,color:T.dim}}>{course.days.map(d=>d.slice(0,2)).join('/')} · {fmtHour(course.sh)}–{fmtHour(course.eh)} · {course.enroll} students</div>
                  </div>
                  <div style={{fontSize:14,color:T.dim,flexShrink:0}}>→</div>
                  <div style={{textAlign:'right',flexShrink:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:5,justifyContent:'flex-end',marginBottom:2}}>
                      {crossDept&&<span style={{...mono,fontSize:7,color:theme==='light'?'#d97706':'#FBBF24',border:`1px solid ${theme==='light'?'#fcd34d':'#FBBF2444'}`,borderRadius:3,padding:'1px 4px'}}>cross-dept</span>}
                      <span style={{...mono,fontSize:11,fontWeight:600,color:rdClr}}>{room.label}</span>
                    </div>
                    <div style={{...mono,fontSize:9,color:T.dim}}>cap {room.cap} · {room.type}</div>
                  </div>
                </div>
              );
            })
          ):(
            failed.length===0?(
              <div style={{textAlign:'center',padding:32,color:T.dim,fontSize:12}}>All courses were placed successfully!</div>
            ):failed.map(({course,reason},i)=>{
              const cd=gDept(course.deptId),cdClr=dtc(cd,theme);
              return(
                <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 20px',borderBottom:`1px solid ${T.bdr}`}}>
                  <div style={{width:2,height:36,borderRadius:1,background:'#ef4444',flexShrink:0,marginTop:2}}/>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                      <span style={{...mono,fontSize:9,color:cdClr}}>{course.code}</span>
                      <span style={{fontSize:11,color:T.txt,fontWeight:500}}>{course.name}</span>
                      <span style={{...mono,fontSize:9,color:T.dim}}>· {course.enroll} students</span>
                    </div>
                    <div style={{fontSize:10,color:theme==='light'?'#b91c1c':'#ef4444',lineHeight:1.4}}>{reason}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{padding:'16px 20px',borderTop:`1px solid ${T.bdr}`,flexShrink:0}}>
          {failedCount>0&&(
            <div style={{fontSize:10,color:T.muted,marginBottom:12,lineHeight:1.5}}>
              ⓘ {failedCount} course{failedCount!==1?'s':''} could not be placed and will remain unallocated. You can handle them manually after applying.
            </div>
          )}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancel</button>
            <button onClick={onApply} disabled={placedCount===0}
              style={{padding:'8px 22px',borderRadius:7,fontSize:11,fontWeight:700,cursor:placedCount===0?'not-allowed':'pointer',
                background:placedCount===0?T.inner:dept.clr,border:'none',
                color:placedCount===0?T.dim:(theme==='light'?'#fff':'#000'),transition:'all .15s'}}
              onMouseEnter={e=>{if(placedCount>0)e.currentTarget.style.filter='brightness(1.08)';}}
              onMouseLeave={e=>e.currentTarget.style.filter='none'}>
              ✨ Apply {placedCount} Allocation{placedCount!==1?'s':''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Finish Confirm Modal ─────────────────────────────────────────────────────
function FinishConfirmModal({deptName,remaining,onConfirm,onCancel}){
  const{T,theme}=useT();
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:420,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:36,height:36,borderRadius:8,background:theme==='light'?'#f0fdf4':'#0a2a0a',border:`1px solid ${theme==='light'?'#86efac':'#34d39944'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>✓</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Mark Allocation as Finished?</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginTop:2}}>{deptName}</div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:8,padding:'12px 14px',marginBottom:16,border:`1px solid ${T.bdr}`,fontSize:12,color:T.txt2,lineHeight:1.6}}>
          {remaining>0?<>You have <strong style={{color:theme==='light'?'#b45309':'#FBBF24'}}>{remaining} unallocated course{remaining!==1?'s':''}</strong>. These will be handled by the chief for cross-department allocation.</>:<>All your courses are allocated.</>}
        </div>
        <div style={{background:theme==='light'?'#fef2f2':'#1a0505',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`,borderRadius:8,padding:'10px 14px',marginBottom:20,fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444'}}>
          ⚠ After submitting, you will <strong>not be able to make changes</strong> unless the chief reopens your allocation.
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancel</button>
          <button onClick={onConfirm} style={{padding:'8px 20px',borderRadius:7,fontSize:11,fontWeight:700,background:theme==='light'?'#059669':'#34D399',border:'none',color:'#fff',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
            ✓ Confirm &amp; Notify Chief
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dept Status Panel ────────────────────────────────────────────────────────
function DeptStatusPanel({deptStatuses,notifications,onReopen,onForceFinish,onClose}){
  const{T,theme}=useT();
  const mono={fontFamily:"'DM Mono',monospace"};
  const statusColor={[DS.ACTIVE]:theme==='light'?'#1d4ed8':'#60A5FA',[DS.FINISHED]:theme==='light'?'#059669':'#34D399',[DS.FORCE_FINISHED]:theme==='light'?'#b91c1c':'#ef4444'};
  const statusLabel={[DS.ACTIVE]:'Active',[DS.FINISHED]:'Finished',[DS.FORCE_FINISHED]:'Force-Finished'};
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:520,animation:'scaleIn .18s ease',boxShadow:T.shadowMd,maxHeight:'80vh',overflow:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Department Allocation Status</div>
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
                  {lastFinish&&<div style={{...mono,fontSize:9,color:T.dim,marginTop:2}}>{lastFinish.userName} · {new Date(lastFinish.timestamp).toLocaleString()}</div>}
                </div>
                <span style={{...mono,fontSize:9,padding:'2px 8px',borderRadius:4,background:`${statusColor[status]}${theme==='light'?'22':'18'}`,border:`1px solid ${statusColor[status]}44`,color:statusColor[status]}}>{statusLabel[status]}</span>
                <div style={{display:'flex',gap:6}}>
                  {status!==DS.ACTIVE&&<button onClick={()=>onReopen(dept.id)} style={{padding:'4px 10px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:5,color:T.muted,fontSize:10,cursor:'pointer'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=theme==='light'?'#1d4ed8':'#60A5FA';e.currentTarget.style.color=theme==='light'?'#1d4ed8':'#60A5FA';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>Reopen</button>}
                  {status===DS.ACTIVE&&<button onClick={()=>onForceFinish(dept.id)} style={{padding:'4px 10px',background:'transparent',border:'1px solid #ef444444',borderRadius:5,color:theme==='light'?'#b91c1c':'#ef4444',fontSize:10,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.borderColor='#ef4444'} onMouseLeave={e=>e.currentTarget.style.borderColor='#ef444444'}>Force Finish</button>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{...mono,fontSize:9,color:T.dim,borderTop:`1px solid ${T.bdr}`,paddingTop:12,lineHeight:1.6}}>
          <strong>Reopen</strong> — allows the dept head to make further changes.<br/>
          <strong>Force Finish</strong> — locks the dept head without their action.
        </div>
      </div>
    </div>
  );
}

// ─── Notifications Panel ──────────────────────────────────────────────────────
function NotifPanel({notifications,onClose}){
  const{T,theme}=useT();
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'transparent',display:'flex',alignItems:'flex-start',justifyContent:'flex-end',zIndex:150,paddingTop:52,paddingRight:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:10,width:340,animation:'slideIn .15s ease',boxShadow:T.shadowMd,overflow:'hidden',maxHeight:'70vh',display:'flex',flexDirection:'column'}}>
        <div style={{padding:'12px 16px',borderBottom:`1px solid ${T.bdr}`,display:'flex',alignItems:'center'}}>
          <span style={{fontSize:13,fontWeight:600,color:T.txt}}>Notifications</span>
          <button onClick={onClose} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:14,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{flex:1,overflowY:'auto'}}>
          {notifications.length===0?<div style={{padding:24,textAlign:'center',color:T.dim,fontSize:12}}>No notifications yet</div>
          :[...notifications].reverse().map(n=>{
            const dept=gDept(n.deptId),dClr=dept?dtc(dept,theme):T.muted;
            return(
              <div key={n.id} style={{padding:'12px 16px',borderBottom:`1px solid ${T.bdr}`,background:n.read?'transparent':theme==='light'?'#eff6ff':'#0d1f3d22'}}>
                <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                  <div style={{width:3,height:36,borderRadius:1,background:dept?.clr||T.muted,flexShrink:0,marginTop:2}}/>
                  <div>
                    <div style={{fontSize:12,color:T.txt,fontWeight:500,marginBottom:2}}>{n.deptName} allocation submitted</div>
                    <div style={{fontSize:11,color:T.muted,marginBottom:2}}>By {n.userName}</div>
                    <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{new Date(n.timestamp).toLocaleString()}</div>
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

// ─── Course Edit Modal ────────────────────────────────────────────────────────
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
  const validate=()=>{const e={};if(!name.trim())e.name='Required';if(days.length===0)e.days='Select at least one day';if(eh<=sh)e.eh='End must be after start';if(enroll<1||enroll>1000)e.enroll='1–1000';setErrors(e);return Object.keys(e).length===0;};
  const handleSave=()=>{if(!validate())return;onSave(course.id,{name:name.trim(),days,sh,eh,enroll:Number(enroll)});};
  const inp={width:'100%',padding:'7px 10px',background:T.inputBg,border:`1px solid ${T.inputBdr}`,borderRadius:6,color:T.txt,fontSize:12,outline:'none'};
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:3,height:20,borderRadius:1,background:cd.clr}}/>
          <span style={{...mono,fontSize:10,color:cdClr,fontWeight:500}}>{course.code}</span>
          <span style={{fontSize:14,fontWeight:700,color:T.txt}}>Edit Course</span>
          {course.room&&<span style={{...mono,fontSize:9,color:theme==='light'?'#b45309':'#FBBF24',background:theme==='light'?'#fef3c7':'#3a1a0a',border:`1px solid ${theme==='light'?'#fcd34d':'#F59E0B44'}`,borderRadius:4,padding:'2px 6px',marginLeft:'auto'}}>⚠ Time changes clear room</span>}
          <button onClick={onCancel} style={{background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer',marginLeft:course.room?0:'auto'}}>✕</button>
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Course Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} style={inp}/>
          {errors.name&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.name}</div>}
        </div>
        <div style={{marginBottom:12}}>
          <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:6}}>Days</label>
          <div style={{display:'flex',gap:5}}>
            {DAYS.map(day=>(
              <button key={day} type="button" onClick={()=>toggleDay(day)} style={{padding:'5px 8px',borderRadius:5,fontSize:10,fontWeight:500,cursor:'pointer',transition:'all .1s',background:days.includes(day)?cd.clr:'transparent',color:days.includes(day)?(theme==='light'?'#fff':'#000'):T.muted,border:`1px solid ${days.includes(day)?cd.clr:T.bdr2}`}}>{day.slice(0,3)}</button>
            ))}
          </div>
          {errors.days&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.days}</div>}
        </div>
        <div style={{display:'flex',gap:10,marginBottom:12}}>
          <div style={{flex:1}}>
            <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Start Time</label>
            <select value={sh} onChange={e=>{const v=Number(e.target.value);setSh(v);if(eh<=v)setEh(v+1);}} style={{...inp,cursor:'pointer'}}>
              {HOURS.map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}
            </select>
          </div>
          <div style={{flex:1}}>
            <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>End Time</label>
            <select value={eh} onChange={e=>setEh(Number(e.target.value))} style={{...inp,cursor:'pointer'}}>
              {HOURS.filter(h=>h>sh).concat([20]).map(h=><option key={h} value={h}>{fmtHour(h)}</option>)}
            </select>
            {errors.eh&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.eh}</div>}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,display:'block',marginBottom:4}}>Enrolled Students</label>
          <input type="number" min={1} max={1000} value={enroll} onChange={e=>setEnroll(e.target.value)} style={inp}/>
          {errors.enroll&&<div style={{fontSize:10,color:'#ef4444',marginTop:3}}>{errors.enroll}</div>}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancel</button>
          <button onClick={handleSave} style={{padding:'8px 20px',background:cd.clr,border:'none',borderRadius:7,color:theme==='light'?'#fff':'#000',fontSize:11,fontWeight:700,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.08)'} onMouseLeave={e=>e.currentTarget.style.filter='none'}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ─── Merge Modal ──────────────────────────────────────────────────────────────
function MergeModal({room,incomingCourse,conflicts,totalEnroll,dept,onConfirm,onCancel}){
  const{T,theme}=useT();
  const rd=gDept(room.deptId),rdClr=dtc(rd,theme),dClr=dtc(dept,theme);
  const over=totalEnroll>room.cap,existing=conflicts.reduce((s,c)=>s+c.enroll,0);
  const pctEx=Math.min(existing/room.cap,1)*100,pctNew=Math.min(incomingCourse.enroll/room.cap,Math.max(0,1-pctEx/100))*100;
  const[confirmed,setConfirmed]=useState(false);
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:34,height:34,borderRadius:8,background:theme==='light'?'#fffbeb':'#1a1400',border:`1px solid ${theme==='light'?'#f59e0b44':'#F59E0B44'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⇄</div>
          <div><div style={{fontSize:15,fontWeight:700,color:T.txt}}>Merge Course Groups?</div><div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginTop:2}}>{room.label} · {room.type} · {room.building}</div></div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:10,padding:'14px 16px',marginBottom:16,border:`1px solid ${T.bdr}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>Room Capacity</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,color:over?'#ef4444':totalEnroll/room.cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399'}}>{totalEnroll}<span style={{fontSize:11,color:T.dim}}> / {room.cap}</span></span>
          </div>
          <div style={{height:10,borderRadius:5,background:T.barTrack,overflow:'hidden',display:'flex',marginBottom:8}}>
            <div style={{width:`${pctEx}%`,background:T.barExist,transition:'width .4s',flexShrink:0}}/>
            <div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',transition:'width .4s',flexShrink:0}}/>
          </div>
          <div style={{display:'flex',gap:16}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.barExist}}>■ existing: {existing}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:over?'#ef4444':'#d97706'}}>■ incoming: {incomingCourse.enroll}</span>
          </div>
          {over&&<div style={{marginTop:10,padding:'7px 10px',background:theme==='light'?'#fef2f2':'#2a0a0a',border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,borderRadius:6,fontSize:10,color:theme==='light'?'#b91c1c':'#ef4444'}}>⚠ Combined enrollment exceeds capacity by <strong>{totalEnroll-room.cap} students</strong>.</div>}
        </div>
        <div style={{marginBottom:over?14:20}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Courses sharing this room</div>
          <div style={{padding:'9px 12px',background:dbg(dept,theme),border:`1px solid ${dept.clr}44`,borderRadius:7,marginBottom:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:dClr,fontWeight:600}}>{incomingCourse.code}</span><span style={{fontSize:10,color:T.txt2,marginLeft:8}}>{incomingCourse.name}</span></div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{incomingCourse.sh}:00–{incomingCourse.eh}:00</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:dClr,background:dbg(dept,theme),border:`1px solid ${dept.clr}55`,borderRadius:3,padding:'1px 5px'}}>NEW</span>
              </div>
            </div>
          </div>
          {conflicts.map(c=>{const cd=gDept(c.deptId),cdClr=dtc(cd,theme);return(
            <div key={c.id} style={{padding:'9px 12px',background:T.card,border:`1px solid ${T.bdr}`,borderRadius:7,marginBottom:4}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:cdClr}}>{c.code}</span><span style={{fontSize:10,color:T.muted,marginLeft:8}}>{c.name}</span></div>
                <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{c.sh}:00–{c.eh}:00</span><span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{c.enroll} stu</span></div>
              </div>
            </div>
          );})}
        </div>
        {over&&<label style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,cursor:'pointer',userSelect:'none',padding:'8px 10px',background:theme==='light'?'#fef2f2':'#1a0505',borderRadius:6,border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`}}>
          <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} style={{accentColor:'#ef4444',width:14,height:14}}/>
          <span style={{fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444'}}>I understand this exceeds room capacity and wish to proceed</span>
        </label>}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel} style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background=T.inner} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>Cancel</button>
          <button onClick={onConfirm} disabled={over&&!confirmed} style={{padding:'8px 20px',borderRadius:7,fontSize:11,fontWeight:700,transition:'all .15s',background:over?(confirmed?'#ef4444':theme==='light'?'#f3f4f6':'#1a0505'):'#F59E0B',border:over?`1px solid ${confirmed?'#ef4444':T.bdr}`:'none',color:over?(confirmed?'#fff':T.dim):'#000',cursor:over&&!confirmed?'not-allowed':'pointer'}} onMouseEnter={e=>{if(!(over&&!confirmed))e.currentTarget.style.filter='brightness(1.08)';}} onMouseLeave={e=>e.currentTarget.style.filter='none'}>
            {over?'⚠ Confirm Merge':'⇄ Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
/**
 * classroom-allocation.jsx — Application entry point.
 *
 * Provides ThemeCtx and AuthProvider, then routes to either LoginPage or the
 * main Dashboard based on the current auth state.
 *
 * File map:
 *   theme.jsx                         Theme tokens + context
 *   auth/roles.js                     Role constants + hierarchy
 *   auth/permissions.js               Permission constants + role mappings
 *   auth/utils.js                     Hashing, tokens, IDs
 *   auth/mockDb.js                    localStorage mock database
 *   auth/AuthContext.jsx              React auth context + useAuth hook
 *   components/LoginPage.jsx          Login form
 *   components/UserManagement.jsx     Admin user panel
 *   components/PermissionGate.jsx     Declarative permission wrapper
 */

import { useState, useMemo, Fragment, useRef, useEffect } from 'react';
import { ThemeCtx, LIGHT, DARK, useT, dtc, dbg } from './theme.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ROLES, DEPT_SCOPED_ROLES } from './auth/roles.js';
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
const ROOM_FEATS = [
  ['Projector','Whiteboard'],['Projector','Smart Board'],
  ['Whiteboard','AC'],['Projector','AC','Whiteboard'],
  ['Smart Board','Lab Equipment'],['Computers','Projector','AC'],
];
const COURSE_NAMES = {
  MATH:['Calculus I','Calculus II','Linear Algebra','Statistics','Differential Equations','Number Theory','Abstract Algebra','Real Analysis','Complex Analysis','Topology','Probability','Discrete Mathematics','Numerical Analysis','Graph Theory','Optimization','Geometry','Logic','Set Theory','Mathematical Modeling','Game Theory'],
  PHYS:['Classical Mechanics','Electromagnetism','Thermodynamics','Quantum Mechanics','Optics','Special Relativity','Astrophysics','Nuclear Physics','Fluid Dynamics','Wave Theory','Solid State Physics','Particle Physics','Biophysics','Acoustics','Plasma Physics','Atomic Physics','Photonics','Computational Physics','Medical Physics','Geophysics'],
  CS:  ['Algorithms','Data Structures','Operating Systems','Computer Networks','Databases','Artificial Intelligence','Machine Learning','Compilers','Software Engineering','Computer Graphics','Cybersecurity','Web Development','Cloud Computing','Distributed Systems','Computer Vision','NLP','Robotics','HCI','Parallel Computing','Game Development'],
  CHEM:['Organic Chemistry','Inorganic Chemistry','Physical Chemistry','Biochemistry','Analytical Chemistry','Polymer Chemistry','Electrochemistry','Spectroscopy','Thermochemistry','Kinetics','Catalysis','Environmental Chemistry','Medicinal Chemistry','Computational Chemistry','Green Chemistry','Nanochemistry','Surface Chemistry','Crystallography','Radiochemistry','Chemical Biology'],
};

// ─── Seeded RNG + Data generation ────────────────────────────────────────────

function mkRng(s){s=s>>>0;return()=>{s^=s<<13;s^=s>>17;s^=s<<5;return(s>>>0)/4294967296;};}

const {ROOMS_BASE,INIT_COURSES}=(()=>{
  const r=mkRng(31415),r2=mkRng(99991);
  const ROOMS_BASE=DEPTS.flatMap(d=>Array.from({length:30},(_,i)=>({
    id:`${d.id}-R${String(i+1).padStart(2,'00')}`,deptId:d.id,
    label:`${d.id[0]}${200+i+1}`,cap:[20,30,40,50,60,80,100,120][Math.floor(r()*8)],
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

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [theme, setTheme] = useState('light');
  const T = theme === 'light' ? LIGHT : DARK;
  const ctxVal = { T, theme, toggleTheme: () => setTheme(t => t==='light'?'dark':'light') };
  return (
    <ThemeCtx.Provider value={ctxVal}>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </ThemeCtx.Provider>
  );
}

function AppRouter() {
  const { currentUser, isLoading } = useAuth();
  const { T, theme } = useT();
  if (isLoading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',
                 height:'100vh',background:T.bg,fontFamily:"'DM Mono',monospace",
                 fontSize:11,color:T.dim}}>Loading…</div>
  );
  if (!currentUser) return <LoginPage />;
  return <Dashboard />;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const { currentUser, logout, can, canForDept } = useAuth();
  const { T, theme, toggleTheme } = useT();

  // For institution-wide roles (DIRECTOR, SYSTEM_ADMIN), allow switching active dept
  const isGlobal = !DEPT_SCOPED_ROLES.has(currentUser.role);
  const [activeDeptId, setActiveDeptId] = useState(
    isGlobal ? (DEPTS[0].id) : currentUser.deptId
  );

  const [courses,    setCourses]    = useState(INIT_COURSES);
  const [selId,      setSelId]      = useState(null);
  const [day,        setDay]        = useState('Monday');
  const [showAll,    setShowAll]    = useState(isGlobal);
  const [search,     setSearch]     = useState('');
  const [viewMode,   setViewMode]   = useState('grid');
  const [descs,      setDescs]      = useState({});
  const [descModal,  setDescModal]  = useState(null);
  const [mergeModal, setMergeModal] = useState(null);
  const [showUsers,  setShowUsers]  = useState(false);

  const d      = gDept(activeDeptId);
  const alloc  = useMemo(()=>buildAlloc(courses),[courses]);
  const sel    = useMemo(()=>selId?courses.find(c=>c.id===selId):null,[selId,courses]);
  const ROOMS  = useMemo(()=>ROOMS_BASE.map(r=>({...r,desc:descs[r.id]||''})),[descs]);
  const visRooms = useMemo(()=>showAll?ROOMS:ROOMS.filter(r=>r.deptId===activeDeptId),[activeDeptId,showAll,ROOMS]);

  const canAllocate = canForDept(PERMS.ALLOCATE_OWN_DEPT, activeDeptId) || can(PERMS.ALLOCATE_ALL_DEPTS);
  const canDealloc  = canForDept(PERMS.DEALLOCATE_OWN_DEPT, activeDeptId) || can(PERMS.DEALLOCATE_ALL_DEPTS);
  const canEditDesc = can(PERMS.EDIT_ROOM_DESCRIPTION);
  const canMerge    = can(PERMS.MERGE_GROUPS);
  const canSeeAll   = can(PERMS.VIEW_ALL_ROOMS);
  const canManageUsers = can(PERMS.VIEW_USERS);

  const pending = useMemo(()=>{
    const base=courses.filter(c=>c.deptId===activeDeptId&&!c.room);
    if(!search.trim())return base;
    const q=search.toLowerCase();
    return base.filter(c=>c.name.toLowerCase().includes(q)||c.code.toLowerCase().includes(q));
  },[courses,activeDeptId,search]);

  const stats = useMemo(()=>{
    const mine=courses.filter(c=>c.deptId===activeDeptId);
    const done=mine.filter(c=>c.room);
    return{total:mine.length,done:done.length,pend:mine.length-done.length,
           cross:done.filter(c=>!c.room.startsWith(activeDeptId)).length};
  },[courses,activeDeptId]);

  const tryAllocate = rid => {
    if (!canAllocate) return;
    if (!sel) return;
    if (roomFree(rid,sel,alloc)) { forceAllocate(rid); }
    else if (canMerge)           { setMergeModal({roomId:rid}); }
  };
  const forceAllocate = rid => { setCourses(p=>p.map(c=>c.id===selId?{...c,room:rid}:c)); setSelId(null); setMergeModal(null); };
  const deallocate = cid => { if(canDealloc) setCourses(p=>p.map(c=>c.id===cid?{...c,room:null}:c)); };
  const saveDesc = (rid,txt) => { if(canEditDesc){setDescs(p=>({...p,[rid]:txt}));setDescModal(null);} };

  const mergeRoom    = mergeModal ? ROOMS.find(r=>r.id===mergeModal.roomId) : null;
  const mergeCons    = (mergeModal&&sel) ? getConflicts(mergeModal.roomId,sel,alloc,courses) : [];
  const mergeTotal   = sel ? mergeCons.reduce((s,c)=>s+c.enroll,0)+sel.enroll : 0;
  const dClr         = dtc(d,theme);
  const selBannerBg  = dbg(d,theme);
  const mono         = {fontFamily:"'DM Mono',monospace"};

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:T.bg,color:T.txt,
                 height:'100vh',display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        button,select,input,textarea{font-family:inherit;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:${T.scrollTrack};}
        ::-webkit-scrollbar-thumb{background:${T.scrollThumb};border-radius:4px;}
        .cc:hover{background:${T.hover}!important;}
        .cc.sel{background:${selBannerBg}!important;border-color:${d.clr}!important;}
        .gridcell-hl:hover{background:${d.clr}44!important;}
        .gridcell-merge:hover{background:#F59E0B33!important;}
        .chip-own:hover{filter:brightness(${theme==='light'?'.92':'1.15'});}
        .room-card:hover .desc-btn{opacity:1!important;}
        .viewbtn:hover{background:${T.faint}!important;}
        .viewbtn.active{background:${selBannerBg}!important;border-color:${d.clr}!important;color:${dClr}!important;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scaleIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
      `}</style>

      {/* ── Header ── */}
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 18px',
                   background:T.surface,borderBottom:`1px solid ${T.bdr}`,
                   flexShrink:0,boxShadow:T.shadowSm}}>
        {/* Dept indicator / selector */}
        {isGlobal ? (
          <select value={activeDeptId} onChange={e=>{setActiveDeptId(e.target.value);setSelId(null);}}
            style={{padding:'4px 8px',background:T.inputBg,border:`1px solid ${T.bdr2}`,
                    borderRadius:6,color:dClr,fontSize:12,fontWeight:600,outline:'none',cursor:'pointer'}}>
            {DEPTS.map(dep=>(
              <option key={dep.id} value={dep.id}>{dep.full}</option>
            ))}
          </select>
        ) : (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{width:7,height:7,borderRadius:'50%',background:d.clr,boxShadow:`0 0 8px ${d.clr}99`}}/>
            <span style={{fontSize:12,fontWeight:600,color:dClr}}>{d.full}</span>
          </div>
        )}

        <div style={{flex:1}}/>

        {/* Stats */}
        {[['Total',stats.total,T.muted],['Allocated',stats.done,theme==='light'?'#059669':'#34D399'],
          ['Pending',stats.pend,theme==='light'?'#b45309':'#FBBF24'],
          ['Cross‑Dept',stats.cross,theme==='light'?'#5b21b6':'#A78BFA']].map(([l,v,c])=>(
          <div key={l} style={{textAlign:'center',padding:'0 12px',borderLeft:`1px solid ${T.bdr}`}}>
            <div style={{fontSize:17,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
            <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginTop:2}}>{l}</div>
          </div>
        ))}

        {/* Role pill */}
        <div style={{padding:'3px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,
                     borderRadius:20,display:'flex',alignItems:'center',gap:6,marginLeft:4}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:dClr}}/>
          <span style={{...mono,fontSize:9,color:T.muted}}>{currentUser.name}</span>
        </div>

        {/* User management */}
        {canManageUsers && (
          <button onClick={()=>setShowUsers(true)}
            style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,
                    borderRadius:6,color:T.muted,fontSize:10,transition:'all .15s'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;}}>
            👥 Users
          </button>
        )}

        {/* Theme toggle */}
        <button onClick={toggleTheme}
          style={{padding:'5px 10px',background:T.inner,border:`1px solid ${T.bdr2}`,
                  borderRadius:6,color:T.muted,fontSize:11,transition:'all .15s'}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;}}>
          {theme==='light'?'🌙':'☀'}
        </button>

        {/* Logout */}
        <button onClick={logout}
          style={{padding:'5px 12px',background:'transparent',border:`1px solid ${T.bdr2}`,
                  borderRadius:6,color:T.muted,fontSize:10,transition:'all .15s'}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.muted;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;}}>
          Sign out
        </button>
      </div>

      {/* ── Body ── */}
      <div style={{flex:1,display:'flex',overflow:'hidden'}}>

        {/* Sidebar */}
        <aside style={{width:268,borderRight:`1px solid ${T.bdr}`,display:'flex',
                       flexDirection:'column',overflow:'hidden',
                       background:theme==='light'?T.surface:T.card}}>
          <div style={{padding:'10px 12px',borderBottom:`1px solid ${T.bdr}`}}>
            <div style={{...mono,fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>
              {canAllocate ? 'Unallocated Courses' : 'Courses (read-only)'}
            </div>
            <input type="text" value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search courses…"
              style={{width:'100%',padding:'5px 9px',background:T.inputBg,
                      border:`1px solid ${T.inputBdr}`,borderRadius:6,
                      color:T.txt,fontSize:11,outline:'none'}}/>
            <div style={{fontSize:10,color:T.muted,marginTop:5}}>
              {pending.length} {canAllocate?'pending assignment':'courses'}
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto',padding:'5px'}}>
            {pending.length===0?(
              <div style={{textAlign:'center',padding:32,color:T.dim}}>
                <div style={{fontSize:24,marginBottom:8}}>✓</div>
                <div style={{fontSize:12}}>{search?'No matches':'All courses allocated'}</div>
              </div>
            ):pending.map(c=>(
              <CourseCard key={c.id} course={c} dept={d} selected={selId===c.id}
                onClick={()=>canAllocate&&setSelId(selId===c.id?null:c.id)}
                canSelect={canAllocate}/>
            ))}
          </div>
        </aside>

        {/* Main */}
        <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* Toolbar */}
          <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',
                       borderBottom:`1px solid ${T.bdr}`,
                       background:theme==='light'?T.surface:T.card,flexShrink:0}}>
            <div style={{display:'flex',gap:2,border:`1px solid ${T.bdr2}`,borderRadius:6,overflow:'hidden'}}>
              {[['grid','⊞ Grid'],['list','≡ List']].map(([m,lbl])=>(
                <button key={m} className={`viewbtn${viewMode===m?' active':''}`}
                  onClick={()=>setViewMode(m)}
                  style={{padding:'4px 12px',fontSize:10,fontWeight:500,background:'transparent',
                          border:'none',color:viewMode===m?dClr:T.muted,transition:'all .12s'}}>
                  {lbl}
                </button>
              ))}
            </div>
            <div style={{width:1,height:16,background:T.bdr2}}/>
            {viewMode==='grid'&&DAYS.map(dy=>(
              <button key={dy} onClick={()=>setDay(dy)} style={{
                padding:'4px 10px',borderRadius:5,fontSize:10,fontWeight:500,
                background:day===dy?d.clr:'transparent',
                color:day===dy?(theme==='light'?'#fff':'#000'):T.muted,
                border:`1px solid ${day===dy?d.clr:T.bdr2}`,transition:'all .12s'}}>
                {dy.slice(0,3)}
              </button>
            ))}
            <div style={{flex:1}}/>
            {canSeeAll && (
              <label style={{display:'flex',alignItems:'center',gap:5,fontSize:10,
                             color:T.muted,cursor:'pointer',userSelect:'none'}}>
                <input type="checkbox" checked={showAll}
                  onChange={e=>setShowAll(e.target.checked)} style={{accentColor:d.clr}}/>
                Show all departments
              </label>
            )}
          </div>

          {/* Selection banner */}
          {sel && canAllocate && (
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 16px',
                         background:selBannerBg,borderBottom:`1px solid ${d.clr}44`,flexShrink:0}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:d.clr,animation:'blink 1.5s infinite'}}/>
              <span style={{...mono,fontSize:10,color:dClr,fontWeight:600}}>{sel.code}</span>
              <span style={{fontSize:11,color:T.txt2,maxWidth:180,whiteSpace:'nowrap',
                            overflow:'hidden',textOverflow:'ellipsis'}}>{sel.name}</span>
              <span style={{...mono,fontSize:10,color:T.muted}}>
                {sel.days.map(x=>x.slice(0,2)).join('/')} · {sel.sh}:00–{sel.eh}:00 · {sel.enroll} students
              </span>
              <div style={{flex:1}}/>
              {viewMode==='grid'&&!sel.days.includes(day)&&(
                <span style={{fontSize:9,color:theme==='light'?'#b45309':'#FBBF24'}}>
                  Not on {day} — switch to {sel.days[0].slice(0,3)}
                </span>
              )}
              {viewMode==='grid'&&sel.days.includes(day)&&(
                <span style={{fontSize:9,color:T.muted}}>
                  <span style={{color:d.clr}}>●</span> free &nbsp;
                  {canMerge&&<><span style={{color:'#F59E0B'}}>●</span> merge</>}
                </span>
              )}
              <button onClick={()=>setSelId(null)}
                style={{padding:'2px 8px',background:'transparent',
                        border:`1px solid ${T.bdr2}`,borderRadius:4,color:T.muted,fontSize:9,cursor:'pointer'}}>
                ✕
              </button>
            </div>
          )}

          {/* Content */}
          <div style={{flex:1,overflow:'auto',background:T.bg}}>
            {viewMode==='grid'?(
              <Grid rooms={visRooms} day={day} alloc={alloc} courses={courses} sel={sel}
                deptId={activeDeptId} dept={d}
                canAllocate={canAllocate} canDealloc={canDealloc}
                canMerge={canMerge} canEditDesc={canEditDesc}
                onTryAlloc={tryAllocate} onDealloc={deallocate} onEditDesc={setDescModal}/>
            ):(
              <ListView rooms={visRooms} alloc={alloc} courses={courses} sel={sel}
                deptId={activeDeptId} dept={d}
                canAllocate={canAllocate} canDealloc={canDealloc}
                canMerge={canMerge} canEditDesc={canEditDesc}
                onTryAlloc={tryAllocate} onDealloc={deallocate} onEditDesc={setDescModal}/>
            )}
          </div>
        </div>
      </div>

      {/* Merge modal */}
      {mergeModal&&sel&&mergeRoom&&(
        <MergeModal room={mergeRoom} incomingCourse={sel} conflicts={mergeCons}
          totalEnroll={mergeTotal} dept={d}
          onConfirm={()=>forceAllocate(mergeModal.roomId)}
          onCancel={()=>setMergeModal(null)}/>
      )}

      {/* Description modal */}
      {descModal&&canEditDesc&&(
        <DescModal room={ROOMS.find(r=>r.id===descModal)} onSave={saveDesc}
          onClose={()=>setDescModal(null)} dept={d}/>
      )}

      {/* User management modal */}
      {showUsers&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',
                     display:'flex',alignItems:'stretch',justifyContent:'flex-end',zIndex:200}}>
          <div style={{width:'min(900px,95vw)',background:T.surface,
                       borderLeft:`1px solid ${T.bdr}`,display:'flex',
                       flexDirection:'column',animation:'fadeIn .2s ease'}}>
            <UserManagement onClose={()=>setShowUsers(false)}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Course Card ─────────────────────────────────────────────────────────────

function CourseCard({course,dept,selected,onClick,canSelect}){
  const{T,theme}=useT();
  const dClr=dtc(dept,theme);
  return(
    <div onClick={onClick} className={`cc${selected?' sel':''}`}
      style={{padding:'8px 10px',borderRadius:6,marginBottom:2,
              cursor:canSelect?'pointer':'default',background:'transparent',
              border:`1px solid ${selected?dept.clr:T.bdr}`,
              transition:'background .1s, border-color .1s',
              opacity:canSelect?1:0.75}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:dClr}}>{course.code}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{course.enroll} stu</span>
      </div>
      <div style={{fontSize:11,fontWeight:500,color:T.txt,marginBottom:2,lineHeight:1.3}}>{course.name}</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>
        {course.days.map(x=>x.slice(0,2)).join('/')} · {course.sh}:00–{course.eh}:00
      </div>
    </div>
  );
}

// ─── Grid View ────────────────────────────────────────────────────────────────

function Grid({rooms,day,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditDesc,onTryAlloc,onDealloc,onEditDesc}){
  const{T,theme}=useT();
  const dClr=dtc(dept,theme);
  const CW=76,RH=33,LW=120;
  const sorted=useMemo(()=>[...rooms.filter(r=>r.deptId===deptId),...rooms.filter(r=>r.deptId!==deptId)],[rooms,deptId]);

  return(
    <table style={{borderCollapse:'collapse',tableLayout:'fixed',minWidth:LW+CW*12}}>
      <colgroup><col style={{width:LW}}/>{HOURS.map(h=><col key={h} style={{width:CW}}/>)}</colgroup>
      <thead>
        <tr style={{position:'sticky',top:0,zIndex:5,background:T.surface,
                    boxShadow:theme==='light'?'0 1px 2px rgba(0,0,0,.06)':'none'}}>
          <th style={{padding:'7px 10px',textAlign:'left',fontFamily:"'DM Mono',monospace",
                      fontSize:8,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`,
                      letterSpacing:1,textTransform:'uppercase'}}>Room / Cap</th>
          {HOURS.map(h=>(
            <th key={h} style={{padding:'7px 0',textAlign:'center',fontFamily:"'DM Mono',monospace",
                                fontSize:8,color:T.dim,fontWeight:400,borderBottom:`1px solid ${T.bdr}`}}>
              {h}:00
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((room,idx)=>{
          const isOwn=room.deptId===deptId;
          const rd=gDept(room.deptId);
          const rdClr=dtc(rd,theme);
          const free=canAllocate&&sel?roomFree(room.id,sel,alloc):false;
          const hasCon=canAllocate&&sel?!free:false;
          const slots=rowSlots(room.id,day,alloc);
          const dayOk=sel?sel.days.includes(day):false;
          const showSep=!isOwn&&sorted[idx-1]?.deptId===deptId;
          const capWarn=sel&&room.cap<sel.enroll;
          const rowBg=isOwn?(theme==='light'?'#ffffff':T.bg):(theme==='light'?T.faint:T.inner);

          return(
            <Fragment key={room.id}>
              {showSep&&(
                <tr><td colSpan={13} style={{padding:'5px 10px',fontFamily:"'DM Mono',monospace",
                  fontSize:8,color:T.dim,background:T.faint,borderTop:`1px solid ${T.bdr}`,
                  borderBottom:`1px solid ${T.bdr}`,letterSpacing:1,textTransform:'uppercase'}}>
                  Other Departments ↓</td></tr>
              )}
              <tr style={{borderBottom:`1px solid ${T.bdr}`,background:rowBg}}>
                <td style={{padding:'0 6px 0 10px',height:RH}}>
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <div style={{width:2,height:18,borderRadius:1,background:rd.clr,opacity:isOwn?1:0.4}}/>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,
                                  color:isOwn?rdClr:T.muted,whiteSpace:'nowrap'}}>{room.label}</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,
                                  color:capWarn&&sel?'#d97706':T.dim}}>{room.cap}{capWarn&&sel?'⚠':''}</span>
                    {room.desc&&<span title={room.desc} style={{fontSize:8,color:T.muted}}>💬</span>}
                    {canEditDesc&&(
                      <button onClick={()=>onEditDesc(room.id)} title="Edit description"
                        style={{background:'none',border:'none',color:T.dim,fontSize:9,
                                padding:'0 1px',lineHeight:1,opacity:0,transition:'opacity .1s',cursor:'pointer'}}
                        onMouseEnter={e=>e.currentTarget.style.opacity=1}
                        onMouseLeave={e=>e.currentTarget.style.opacity=0}>✏</button>
                    )}
                  </div>
                </td>
                {slots.map((slot,si)=>{
                  if(slot.c){
                    const cd=gDept(slot.c.deptId);
                    const cdClr=dtc(cd,theme);
                    const isMine=slot.c.deptId===deptId;
                    const isMergeZone=canAllocate&&canMerge&&sel&&dayOk&&hasCon&&slot.h>=sel.sh&&slot.h<sel.eh;
                    return(
                      <td key={si} colSpan={slot.span}
                        style={{padding:'2px 2px',height:RH,verticalAlign:'middle',
                          background:isMergeZone?(theme==='light'?'#fffbeb':'#F59E0B0f'):'transparent',
                          cursor:isMergeZone?'pointer':'default',transition:'background .1s'}}
                        className={isMergeZone?'gridcell-merge':''}
                        onClick={()=>isMergeZone&&onTryAlloc(room.id)}>
                        <div onClick={e=>{if(isMine&&canDealloc&&!isMergeZone){e.stopPropagation();onDealloc(slot.c.id);}}}
                          className={isMine&&canDealloc?'chip-own':''}
                          title={`${slot.c.name} · ${slot.c.sh}:00–${slot.c.eh}:00 · ${slot.c.enroll} students${isMine&&canDealloc?'\nClick to unassign':''}${isMergeZone?'\nClick to merge groups':''}`}
                          style={{height:'100%',padding:'0 5px',borderRadius:3,
                            background:isMine?`${cd.clr}${theme==='light'?'28':'22'}`:`${cd.clr}${theme==='light'?'18':'0e'}`,
                            borderLeft:`2px solid ${isMergeZone?'#F59E0B':cd.clr}`,
                            display:'flex',alignItems:'center',gap:4,overflow:'hidden',
                            cursor:isMergeZone?'pointer':isMine&&canDealloc?'pointer':'default',
                            transition:'filter .12s'}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,
                                        color:isMergeZone?'#d97706':cdClr,
                                        whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:1}}>
                            {slot.c.code}
                          </span>
                          {slot.merged>0&&<span style={{fontFamily:"'DM Mono',monospace",fontSize:7,
                            color:'#d97706',background:'#F59E0B22',borderRadius:2,padding:'0 3px',flexShrink:0}}>
                            +{slot.merged}</span>}
                          {isMergeZone&&<span style={{fontSize:9,flexShrink:0}}>⇄</span>}
                        </div>
                      </td>
                    );
                  }
                  const hlFree=canAllocate&&free&&dayOk&&slot.h>=sel?.sh&&slot.h<sel?.eh;
                  return(
                    <td key={si} style={{padding:'2px 2px',height:RH,verticalAlign:'middle',
                        background:hlFree?`${dept.clr}${theme==='light'?'22':'1a'}`:'transparent',
                        cursor:hlFree?'pointer':'default',transition:'background .1s'}}
                      className={hlFree?'gridcell-hl':''}
                      onClick={()=>hlFree&&onTryAlloc(room.id)}>
                      {hlFree&&<div style={{height:'100%',borderRadius:3,
                        border:`1px dashed ${dept.clr}${theme==='light'?'88':'44'}`,
                        display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <span style={{fontSize:11,color:`${dept.clr}${theme==='light'?'aa':'66'}`}}>+</span>
                      </div>}
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

function ListView({rooms,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditDesc,onTryAlloc,onDealloc,onEditDesc}){
  const{T}=useT();
  const sorted=useMemo(()=>[...rooms.filter(r=>r.deptId===deptId),...rooms.filter(r=>r.deptId!==deptId)],[rooms,deptId]);
  if(!sel)return(
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',flexDirection:'column',gap:12}}>
      <div style={{fontSize:36,opacity:.12}}>≡</div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:T.dim}}>
        {canAllocate?'Select a course on the left to see room availability':'Read-only view — no allocation permissions'}
      </div>
    </div>
  );
  const ownRooms=sorted.filter(r=>r.deptId===deptId);
  const othRooms=sorted.filter(r=>r.deptId!==deptId);
  return(
    <div style={{padding:16,display:'flex',flexDirection:'column',gap:20,animation:'fadeIn .2s ease'}}>
      <RoomSection title={`${gDept(deptId).full} — Own Rooms`}
        rooms={ownRooms} alloc={alloc} courses={courses} sel={sel}
        deptId={deptId} dept={dept}
        canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditDesc={canEditDesc}
        onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditDesc={onEditDesc}/>
      {othRooms.length>0&&(
        <RoomSection title="Other Departments — Available for Cross-Allocation"
          rooms={othRooms} alloc={alloc} courses={courses} sel={sel}
          deptId={deptId} dept={dept}
          canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditDesc={canEditDesc}
          onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditDesc={onEditDesc}/>
      )}
    </div>
  );
}

function RoomSection({title,rooms,alloc,courses,sel,deptId,dept,canAllocate,canDealloc,canMerge,canEditDesc,onTryAlloc,onDealloc,onEditDesc}){
  const{T,theme}=useT();
  const free=rooms.filter(r=>roomFree(r.id,sel,alloc));
  const busy=rooms.filter(r=>!roomFree(r.id,sel,alloc));
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
        {free.map(r=><RoomCard key={r.id} room={r} sel={sel} alloc={alloc} courses={courses}
          deptId={deptId} dept={dept} status="available"
          canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditDesc={canEditDesc}
          onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditDesc={onEditDesc}/>)}
        {busy.map(r=><RoomCard key={r.id} room={r} sel={sel} alloc={alloc} courses={courses}
          deptId={deptId} dept={dept} status="busy"
          canAllocate={canAllocate} canDealloc={canDealloc} canMerge={canMerge} canEditDesc={canEditDesc}
          onTryAlloc={onTryAlloc} onDealloc={onDealloc} onEditDesc={onEditDesc}/>)}
      </div>
    </div>
  );
}

function RoomCard({room,sel,alloc,courses,deptId,dept,status,canAllocate,canDealloc,canMerge,canEditDesc,onTryAlloc,onDealloc,onEditDesc}){
  const{T,theme}=useT();
  const rd=gDept(room.deptId),rdClr=dtc(rd,theme);
  const isOwn=room.deptId===deptId;
  const avail=status==='available';
  const capWarn=sel&&room.cap<sel.enroll;
  const conflicts=avail?[]:getConflicts(room.id,sel,alloc,courses);
  const mergeTotal=avail?(sel?.enroll||0):conflicts.reduce((s,c)=>s+c.enroll,0)+(sel?.enroll||0);
  const overCap=mergeTotal>room.cap;
  const[hov,setHov]=useState(false);
  const clickable=avail&&canAllocate;
  return(
    <div className="room-card" onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={()=>clickable&&onTryAlloc(room.id)}
      style={{borderRadius:8,padding:'12px 14px',
        background:avail?(hov&&clickable?`${dept.clr}18`:T.surface):(theme==='light'?T.card:T.inner),
        border:`1px solid ${avail?(hov&&clickable?dept.clr:`${dept.clr}33`):T.bdr}`,
        cursor:clickable?'pointer':'default',transition:'all .15s',
        boxShadow:avail&&hov&&clickable?`0 4px 12px ${dept.clr}22`:T.shadowSm}}>

      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
        <div style={{width:2,height:16,borderRadius:1,background:rd.clr,opacity:isOwn?1:0.5}}/>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:500,color:isOwn?rdClr:T.muted}}>{room.label}</span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:capWarn?'#d97706':T.dim,marginLeft:'auto'}}>
          cap {room.cap}{capWarn?'⚠':''}
        </span>
        {canEditDesc&&(
          <button onClick={e=>{e.stopPropagation();onEditDesc(room.id);}} className="desc-btn"
            title="Edit description"
            style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,color:T.muted,
                    fontSize:8,padding:'1px 4px',opacity:0,transition:'opacity .15s',cursor:'pointer'}}
            onMouseEnter={e=>{e.stopPropagation();e.currentTarget.style.borderColor=T.muted;}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;}}>✏ edit</button>
        )}
      </div>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,marginBottom:4}}>{room.type} · Floor {room.floor}</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:8}}>
        {room.features.map(f=>(
          <span key={f} style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.muted,
            border:`1px solid ${T.bdr}`,borderRadius:3,padding:'1px 4px',background:T.inner}}>{f}</span>
        ))}
      </div>
      {room.desc?(
        <div style={{fontSize:10,color:T.muted,lineHeight:1.5,marginBottom:8,
                     fontStyle:'italic',borderLeft:`2px solid ${rd.clr}44`,paddingLeft:6}}>{room.desc}</div>
      ):(
        <div style={{fontSize:9,color:T.dim,marginBottom:8,fontStyle:'italic'}}>No description — click ✏ to add</div>
      )}
      <CapacityBar cap={room.cap} enroll={sel?.enroll||0} conflicts={avail?[]:conflicts} avail={avail}/>
      {avail?(
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:theme==='light'?'#059669':'#34D399'}}/>
          <span style={{fontSize:9,color:theme==='light'?'#059669':'#34D399',fontFamily:"'DM Mono',monospace"}}>Available</span>
          {capWarn&&<span style={{fontSize:8,color:'#d97706',marginLeft:'auto'}}>⚠ under capacity</span>}
          {hov&&clickable&&!capWarn&&<span style={{fontSize:8,color:dtc(dept,theme),marginLeft:'auto'}}>Click to assign →</span>}
          {!canAllocate&&<span style={{fontSize:8,color:T.dim,marginLeft:'auto'}}>Read-only</span>}
        </div>
      ):(
        <div style={{marginTop:8}}>
          <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:6}}>
            <div style={{width:5,height:5,borderRadius:'50%',background:'#F59E0B'}}/>
            <span style={{fontSize:9,color:theme==='light'?'#d97706':'#F59E0B',fontFamily:"'DM Mono',monospace"}}>
              {conflicts.length} conflict{conflicts.length!==1?'s':''}
            </span>
          </div>
          {conflicts.map(c=>{
            const cd=gDept(c.deptId),cdClr=dtc(cd,theme),isMine=c.deptId===deptId;
            return(
              <div key={c.id} style={{display:'flex',alignItems:'center',gap:5,padding:'3px 6px',
                background:`${cd.clr}${theme==='light'?'18':'0e'}`,borderRadius:4,marginBottom:2}}>
                <div style={{width:2,height:10,borderRadius:1,background:cd.clr}}/>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:cdClr,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.code}</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.muted}}>{c.enroll} stu</span>
                {isMine&&canDealloc&&(
                  <button onClick={e=>{e.stopPropagation();onDealloc(c.id);}}
                    style={{background:'none',border:`1px solid ${T.bdr2}`,borderRadius:3,
                            color:T.muted,fontSize:7,padding:'1px 4px',cursor:'pointer',
                            lineHeight:1.2,transition:'all .1s'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=T.bdr2;e.currentTarget.style.color=T.muted;}}>✕
                  </button>
                )}
              </div>
            );
          })}
          {canMerge&&canAllocate&&(
            <button onClick={e=>{e.stopPropagation();onTryAlloc(room.id);}}
              style={{width:'100%',marginTop:8,padding:'6px',borderRadius:5,
                background:overCap?(theme==='light'?'#fef3c7':'#3a1a0a'):(theme==='light'?'#fefce8':'#1a1400'),
                border:`1px solid ${overCap?'#F59E0B':'#F59E0B88'}`,
                color:theme==='light'?overCap?'#92400e':'#78350f':'#d4a017',
                fontSize:10,fontWeight:600,transition:'all .12s',cursor:'pointer'}}>
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
  const existing=conflicts.reduce((s,c)=>s+c.enroll,0);
  const total=existing+enroll,over=total>cap;
  const pctEx=Math.min(existing/cap,1)*100,pctNew=Math.min(enroll/cap,Math.max(0,1-pctEx/100))*100;
  const pctTotal=Math.min(total/cap,1)*100;
  const pctColor=over?'#ef4444':total/cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399';
  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim}}>
          {avail?`${enroll} / ${cap} seats`:`${total} / ${cap} seats${over?' (over cap)':''}`}
        </span>
        <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:pctColor}}>{Math.round(total/cap*100)}%</span>
      </div>
      <div style={{height:5,borderRadius:3,background:T.barTrack,overflow:'hidden',display:'flex'}}>
        {avail?<div style={{width:`${pctTotal}%`,background:pctColor,borderRadius:3,transition:'width .3s'}}/>:
          <><div style={{width:`${pctEx}%`,background:T.barExist,borderRadius:'3px 0 0 3px',flexShrink:0}}/>
            <div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',flexShrink:0}}/></>}
      </div>
      {!avail&&(
        <div style={{display:'flex',gap:10,marginTop:3}}>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:T.barExist}}>■ existing {existing}</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:7,color:over?'#ef4444':'#d97706'}}>■ incoming {enroll}</span>
        </div>
      )}
    </div>
  );
}

// ─── Merge Modal ──────────────────────────────────────────────────────────────

function MergeModal({room,incomingCourse,conflicts,totalEnroll,dept,onConfirm,onCancel}){
  const{T,theme}=useT();
  const rd=gDept(room.deptId),rdClr=dtc(rd,theme),dClr=dtc(dept,theme);
  const over=totalEnroll>room.cap;
  const existing=conflicts.reduce((s,c)=>s+c.enroll,0);
  const pctEx=Math.min(existing/room.cap,1)*100;
  const pctNew=Math.min(incomingCourse.enroll/room.cap,Math.max(0,1-pctEx/100))*100;
  const[confirmed,setConfirmed]=useState(false);
  return(
    <div onClick={onCancel} style={{position:'fixed',inset:0,
      background:theme==='light'?'rgba(15,23,42,.4)':'rgba(0,0,0,.75)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:14,padding:28,
                width:440,animation:'scaleIn .18s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:20}}>
          <div style={{width:34,height:34,borderRadius:8,
            background:theme==='light'?'#fffbeb':'#1a1400',
            border:`1px solid ${theme==='light'?'#f59e0b44':'#F59E0B44'}`,
            display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⇄</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:T.txt}}>Merge Course Groups?</div>
            <div style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,marginTop:2}}>
              {room.label} · {room.type} · {room.building}
            </div>
          </div>
          <button onClick={onCancel} style={{marginLeft:'auto',background:'none',border:'none',color:T.muted,fontSize:16,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{background:T.inner,borderRadius:10,padding:'14px 16px',marginBottom:16,border:`1px solid ${T.bdr}`}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:8}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim,textTransform:'uppercase',letterSpacing:1}}>Room Capacity</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:18,fontWeight:700,
              color:over?'#ef4444':totalEnroll/room.cap>0.85?'#d97706':theme==='light'?'#059669':'#34D399'}}>
              {totalEnroll}<span style={{fontSize:11,color:T.dim}}> / {room.cap}</span>
            </span>
          </div>
          <div style={{height:10,borderRadius:5,background:T.barTrack,overflow:'hidden',display:'flex',marginBottom:8}}>
            <div style={{width:`${pctEx}%`,background:T.barExist,transition:'width .4s',flexShrink:0}}/>
            <div style={{width:`${pctNew}%`,background:over?'#ef4444':'#F59E0B',transition:'width .4s',flexShrink:0}}/>
          </div>
          <div style={{display:'flex',gap:16}}>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.barExist}}>■ currently enrolled: {existing}</span>
            <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:over?'#ef4444':'#d97706'}}>■ incoming: {incomingCourse.enroll}</span>
          </div>
          {over&&(
            <div style={{marginTop:10,padding:'7px 10px',
              background:theme==='light'?'#fef2f2':'#2a0a0a',
              border:`1px solid ${theme==='light'?'#fca5a5':'#ef444444'}`,
              borderRadius:6,fontSize:10,color:theme==='light'?'#b91c1c':'#ef4444'}}>
              ⚠ Combined enrollment exceeds capacity by <strong>{totalEnroll-room.cap} students</strong>.
            </div>
          )}
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:8}}>Courses sharing this room</div>
          <div style={{padding:'9px 12px',background:dbg(dept,theme),border:`1px solid ${dept.clr}44`,borderRadius:7,marginBottom:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:dClr,fontWeight:600}}>{incomingCourse.code}</span>
                <span style={{fontSize:10,color:T.txt2,marginLeft:8}}>{incomingCourse.name}</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.muted}}>{incomingCourse.sh}:00–{incomingCourse.eh}:00</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:dClr,fontWeight:600}}>{incomingCourse.enroll} stu</span>
                <span style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:dClr,
                  background:dbg(dept,theme),border:`1px solid ${dept.clr}55`,borderRadius:3,padding:'1px 5px'}}>NEW</span>
              </div>
            </div>
          </div>
          {conflicts.map(c=>{
            const cd=gDept(c.deptId),cdClr=dtc(cd,theme);
            return(
              <div key={c.id} style={{padding:'9px 12px',background:T.card,border:`1px solid ${T.bdr}`,borderRadius:7,marginBottom:4}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:cdClr}}>{c.code}</span>
                    <span style={{fontSize:10,color:T.muted,marginLeft:8}}>{c.name}</span>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{c.sh}:00–{c.eh}:00</span>
                    <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,color:T.muted}}>{c.enroll} stu</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {over&&(
          <label style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,cursor:'pointer',
            userSelect:'none',padding:'8px 10px',
            background:theme==='light'?'#fef2f2':'#1a0505',borderRadius:6,
            border:`1px solid ${theme==='light'?'#fca5a5':'#ef444433'}`}}>
            <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}
              style={{accentColor:'#ef4444',width:14,height:14}}/>
            <span style={{fontSize:11,color:theme==='light'?'#b91c1c':'#ef4444'}}>
              I understand this exceeds room capacity and wish to proceed
            </span>
          </label>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onCancel}
            style={{padding:'8px 18px',background:'transparent',border:`1px solid ${T.bdr2}`,
                    borderRadius:7,color:T.muted,fontSize:11,cursor:'pointer',transition:'all .12s'}}
            onMouseEnter={e=>{e.currentTarget.style.background=T.inner;}}
            onMouseLeave={e=>{e.currentTarget.style.background='transparent';}}>Cancel</button>
          <button onClick={onConfirm} disabled={over&&!confirmed}
            style={{padding:'8px 20px',borderRadius:7,fontSize:11,fontWeight:700,transition:'all .15s',
              background:over?(confirmed?'#ef4444':theme==='light'?'#f3f4f6':'#1a0505'):'#F59E0B',
              border:over?`1px solid ${confirmed?'#ef4444':T.bdr}`:'none',
              color:over?(confirmed?'#fff':T.dim):'#000',
              cursor:over&&!confirmed?'not-allowed':'pointer'}}
            onMouseEnter={e=>{if(!(over&&!confirmed))e.currentTarget.style.filter='brightness(1.08)';}}
            onMouseLeave={e=>{e.currentTarget.style.filter='none';}}>
            {over?'⚠ Confirm Merge':'⇄ Confirm Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Description Modal ────────────────────────────────────────────────────────

function DescModal({room,onSave,onClose,dept}){
  const{T,theme}=useT();
  const[txt,setTxt]=useState(room?.desc||'');
  const ref=useRef();
  const rd=room?gDept(room.deptId):null,rdClr=rd?dtc(rd,theme):null;
  useEffect(()=>{setTimeout(()=>ref.current?.focus(),50);},[]);
  if(!room||!rd)return null;
  const dClr=dtc(dept,theme);
  return(
    <div onClick={onClose} style={{position:'fixed',inset:0,
      background:theme==='light'?'rgba(15,23,42,.35)':'rgba(0,0,0,.75)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:150,backdropFilter:'blur(2px)'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:T.surface,border:`1px solid ${T.bdr}`,borderRadius:12,padding:24,
                width:400,animation:'fadeIn .15s ease',boxShadow:T.shadowMd}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
          <div style={{width:3,height:18,borderRadius:1,background:rd.clr}}/>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:rdClr,fontWeight:500}}>{room.label}</span>
          <span style={{fontFamily:"'DM Mono',monospace",fontSize:9,color:T.dim}}>{room.type} · Cap {room.cap}</span>
          <div style={{flex:1}}/>
          <button onClick={onClose} style={{background:'none',border:'none',color:T.muted,fontSize:14,cursor:'pointer'}}>✕</button>
        </div>
        <div style={{fontFamily:"'DM Mono',monospace",fontSize:8,color:T.dim,textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>Room Description</div>
        <textarea ref={ref} value={txt} onChange={e=>setTxt(e.target.value)}
          placeholder="Add a description — equipment notes, access instructions, special features…"
          rows={4}
          style={{width:'100%',background:T.inner,border:`1px solid ${T.bdr2}`,borderRadius:6,
                  color:T.txt,fontSize:12,padding:'10px 12px',outline:'none',resize:'vertical',lineHeight:1.6}}/>
        <div style={{display:'flex',gap:8,marginTop:12,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{padding:'6px 14px',background:'transparent',border:`1px solid ${T.bdr2}`,
                    borderRadius:6,color:T.muted,fontSize:11,cursor:'pointer'}}>Cancel</button>
          <button onClick={()=>onSave(room.id,txt.trim())}
            style={{padding:'6px 14px',background:dept.clr,border:'none',borderRadius:6,
                    color:theme==='light'?'#fff':'#000',fontSize:11,fontWeight:600,cursor:'pointer'}}>Save</button>
        </div>
      </div>
    </div>
  );
}

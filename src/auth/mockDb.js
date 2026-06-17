/**
 * auth/mockDb.js — localStorage mock database.
 * TODO (production): replace every function body with a fetch() to your API.
 */

import { hashPassword, verifyPassword, generateToken, generateId,
         SESSION_TTL_MS, isSessionExpired } from './utils.js';
import { ROLES } from './roles.js';

export const DB_KEYS = Object.freeze({
  USERS:    'cas_db_users',
  SESSIONS: 'cas_db_sessions',
});

export const DEMO_CREDENTIALS = Object.freeze([
  { username:'chief',     password:'chief123',  role:ROLES.CHIEF,     deptId:null,   name:'Dr. Richard Ashford'  },
  { username:'math.head', password:'math123',   role:ROLES.DEPT_HEAD, deptId:'MATH', name:'Prof. Eleanor Chen'   },
  { username:'phys.head', password:'phys123',   role:ROLES.DEPT_HEAD, deptId:'PHYS', name:'Prof. Marcus Webb'    },
  { username:'cs.head',   password:'cs123',     role:ROLES.DEPT_HEAD, deptId:'CS',   name:'Prof. Aisha Rahman'   },
  { username:'chem.head', password:'chem123',   role:ROLES.DEPT_HEAD, deptId:'CHEM', name:'Prof. David Santos'   },
  { username:'bio.head',  password:'bio123',    role:ROLES.DEPT_HEAD, deptId:'BIO',  name:'Profa. Larissa Nunes' },
]);

function readUsers()      { return JSON.parse(localStorage.getItem(DB_KEYS.USERS)    || '[]'); }
function readSessions()   { return JSON.parse(localStorage.getItem(DB_KEYS.SESSIONS) || '[]'); }
function writeUsers(u)    { localStorage.setItem(DB_KEYS.USERS,    JSON.stringify(u)); }
function writeSessions(s) { localStorage.setItem(DB_KEYS.SESSIONS, JSON.stringify(s)); }
function sanitize({ passwordHash:_, ...u }) { return u; }

export function initDb() {
  if (!localStorage.getItem(DB_KEYS.USERS)) {
    const now = new Date().toISOString();
    writeUsers(DEMO_CREDENTIALS.map((u, i) => ({
      id: `usr_seed_${String(i+1).padStart(4,'0')}`,
      username: u.username, name: u.name,
      email: `${u.username.replace('.','_')}@westmore.edu`,
      role: u.role, deptId: u.deptId,
      passwordHash: hashPassword(u.password),
      isActive: true, createdAt: now, createdBy: null, lastLogin: null,
    })));
  }
  if (!localStorage.getItem(DB_KEYS.SESSIONS)) writeSessions([]);
}

export function resetDb() {
  localStorage.removeItem(DB_KEYS.USERS);
  localStorage.removeItem(DB_KEYS.SESSIONS);
  initDb();
}

export function getUsers()            { return readUsers().map(sanitize); }
export function getUserById(id)       { const u=readUsers().find(u=>u.id===id); return u?sanitize(u):null; }
export function getUserByUsername(un) { const u=readUsers().find(u=>u.username===un.toLowerCase().trim()); return u?sanitize(u):null; }

export function createUser(data, createdById) {
  const users = readUsers();
  const uname = data.username.toLowerCase().trim();
  const email = data.email.toLowerCase().trim();
  if (users.some(u=>u.username===uname)) throw new Error(`Username "${uname}" is already taken.`);
  if (users.some(u=>u.email===email))    throw new Error(`Email "${email}" is already registered.`);
  if (!data.password||data.password.length<6) throw new Error('Password must be at least 6 characters.');
  const user = {
    id:generateId('usr'), username:uname, name:data.name.trim(), email,
    role:data.role, deptId:data.deptId||null,
    passwordHash:hashPassword(data.password),
    isActive:true, createdAt:new Date().toISOString(), createdBy:createdById, lastLogin:null,
  };
  writeUsers([...users, user]);
  return sanitize(user);
}

export function updateUser(id, updates) {
  const users=readUsers(), idx=users.findIndex(u=>u.id===id);
  if(idx<0) throw new Error('User not found.');
  const patch={...updates};
  if(patch.password!==undefined){
    if(patch.password&&patch.password.length<6) throw new Error('Password must be at least 6 characters.');
    patch.passwordHash=patch.password?hashPassword(patch.password):users[idx].passwordHash;
    delete patch.password;
  }
  if(patch.username) patch.username=patch.username.toLowerCase().trim();
  if(patch.email)    patch.email=patch.email.toLowerCase().trim();
  users[idx]={...users[idx],...patch,updatedAt:new Date().toISOString()};
  writeUsers(users);
  return sanitize(users[idx]);
}

export function deactivateUser(id) {
  updateUser(id,{isActive:false});
  writeSessions(readSessions().filter(s=>s.userId!==id));
}

export function loginUser(username, password) {
  const raw=readUsers().find(u=>u.username===username.toLowerCase().trim());
  if(!raw||!raw.isActive) return null;
  if(!verifyPassword(password,raw.passwordHash)) return null;
  const token=generateToken();
  writeSessions([...readSessions().filter(s=>s.userId!==raw.id),{
    token, userId:raw.id,
    createdAt:new Date().toISOString(),
    expiresAt:new Date(Date.now()+SESSION_TTL_MS).toISOString(),
  }]);
  const users=readUsers(),idx=users.findIndex(u=>u.id===raw.id);
  if(idx>=0){users[idx].lastLogin=new Date().toISOString();writeUsers(users);}
  return {user:sanitize(raw),token};
}

export function validateSession(token) {
  if(!token) return null;
  const session=readSessions().find(s=>s.token===token);
  if(!session) return null;
  if(isSessionExpired(session)){revokeSession(token);return null;}
  return getUserById(session.userId);
}

export function revokeSession(token) {
  writeSessions(readSessions().filter(s=>s.token!==token));
}
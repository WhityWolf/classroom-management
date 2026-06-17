/**
 * src/db/useRealtimeSync.js
 * Subscribes to Supabase Realtime changes on the four shared tables and
 * applies them to local state. This is the single path that mutates
 * rooms/courses/deptStatuses/notifications state — mutation functions in
 * allocations.js intentionally don't update state themselves, so a
 * department head's write and the director's view of it both flow through
 * the same code path (no optimistic-update/realtime-echo double-apply).
 */
import { useEffect } from 'react';
import { supabase, supabaseConfigured } from './supabaseClient.js';
import { mapRoom, mapCourse, mapNotification } from './allocations.js';

function upsertById(list, row) {
  const idx = list.findIndex(x => x.id === row.id);
  if (idx === -1) return [...list, row];
  const next = [...list];
  next[idx] = row;
  return next;
}

export function useRealtimeSync({ setRooms, setCourses, setDeptStatuses, setNotifs }) {
  useEffect(() => {
    if (!supabaseConfigured) return;
    const channel = supabase
      .channel('cas-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, ({ eventType, new: row, old }) => {
        setRooms(prev => eventType === 'DELETE' ? prev.filter(r => r.id !== old.id) : upsertById(prev, mapRoom(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, ({ eventType, new: row, old }) => {
        setCourses(prev => eventType === 'DELETE' ? prev.filter(c => c.id !== old.id) : upsertById(prev, mapCourse(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dept_statuses' }, ({ new: row }) => {
        setDeptStatuses(prev => ({ ...prev, [row.dept_id]: row.status }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, ({ eventType, new: row, old }) => {
        setNotifs(prev => eventType === 'DELETE' ? prev.filter(n => n.id !== old.id) : upsertById(prev, mapNotification(row)));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [setRooms, setCourses, setDeptStatuses, setNotifs]);
}

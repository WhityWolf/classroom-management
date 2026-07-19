/**
 * src/db/useRealtimeSync.js
 * Subscribes to Supabase Realtime changes on the shared tables and applies
 * them to local state. This is the single path that mutates
 * subUnits/roles/blocks/rooms/courses/coordinationStatuses/notifications/
 * periods state — mutation functions in allocations.js/management.js intentionally
 * don't update state themselves, so a coordinator's write and the
 * director's view of it both flow through the same code path (no
 * optimistic-update/realtime-echo double-apply).
 */
import { useEffect } from 'react';
import { supabase, supabaseConfigured } from './supabaseClient.js';
import { mapRoom, mapCourse, mapNotification } from './allocations.js';
import { mapSubUnit, mapRole, mapBlock } from './management.js';

function upsertById(list, row) {
  const idx = list.findIndex(x => x.id === row.id);
  if (idx === -1) return [...list, row];
  const next = [...list];
  next[idx] = row;
  return next;
}

export function useRealtimeSync({
  setSubUnits, setRoles, setBlocks, setRooms, setCourses,
  setCoordinationStatuses, setNotifs, setFeatureOptions, setCurrentPeriodOverride, setPeriods,
}) {
  useEffect(() => {
    if (!supabaseConfigured) return;
    const channel = supabase
      .channel('cas-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sub_units' }, ({ eventType, new: row, old }) => {
        setSubUnits(prev => eventType === 'DELETE' ? prev.filter(s => s.id !== old.id) : upsertById(prev, mapSubUnit(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roles' }, ({ eventType, new: row, old }) => {
        setRoles(prev => eventType === 'DELETE' ? prev.filter(r => r.id !== old.id) : upsertById(prev, mapRole(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' }, ({ eventType, new: row, old }) => {
        setBlocks(prev => eventType === 'DELETE' ? prev.filter(b => b.id !== old.id) : upsertById(prev, mapBlock(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, ({ eventType, new: row, old }) => {
        setRooms(prev => eventType === 'DELETE' ? prev.filter(r => r.id !== old.id) : upsertById(prev, mapRoom(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, ({ eventType, new: row, old }) => {
        setCourses(prev => eventType === 'DELETE' ? prev.filter(c => c.id !== old.id) : upsertById(prev, mapCourse(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coordination_statuses' }, ({ new: row }) => {
        setCoordinationStatuses(prev => ({ ...prev, [row.role_id]: row.status }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, ({ eventType, new: row, old }) => {
        setNotifs(prev => eventType === 'DELETE' ? prev.filter(n => n.id !== old.id) : upsertById(prev, mapNotification(row)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_features' }, ({ eventType, new: row, old }) => {
        setFeatureOptions(prev => eventType === 'DELETE'
          ? prev.filter(name => name !== old.name)
          : prev.includes(row.name) ? prev : [...prev, row.name].sort());
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, ({ new: row }) => {
        setCurrentPeriodOverride(row.current_period_override);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'periods' }, ({ eventType, new: row, old }) => {
        setPeriods(prev => eventType === 'DELETE'
          ? prev.filter(id => id !== old.id)
          : prev.includes(row.id) ? prev : [...prev, row.id]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [setSubUnits, setRoles, setBlocks, setRooms, setCourses, setCoordinationStatuses, setNotifs, setFeatureOptions, setCurrentPeriodOverride, setPeriods]);
}

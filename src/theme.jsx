/**
 * theme.jsx
 * Shared theme context, tokens, and helpers.
 * Kept separate so any component can import useT() without circular deps.
 */

import { createContext, useContext } from 'react';

export const LIGHT = {
  bg: '#f4f6fb', surface: '#ffffff', card: '#f9fafb', inner: '#f1f3f8',
  bdr: '#e2e8f0', bdr2: '#cbd5e1',
  txt: '#0f172a', txt2: '#334155', muted: '#475569', dim: '#64748b',
  faint: '#eef2f7', hover: '#e8edf5',
  barTrack: '#e2e8f0', barExist: '#94a3b8',
  scrollThumb: '#cbd5e1', scrollTrack: '#f4f6fb',
  inputBg: '#ffffff', inputBdr: '#d1d5db',
  shadowSm: '0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.05)',
  shadowMd: '0 4px 12px rgba(0,0,0,.10),0 2px 4px rgba(0,0,0,.06)',
};

export const DARK = {
  bg: '#070e1c', surface: '#060c18', card: '#0a1424', inner: '#040810',
  bdr: '#0f1c30', bdr2: '#18263d',
  txt: '#e2e8f0', txt2: '#94a3b8', muted: '#8ea0b8', dim: '#64768e',
  faint: '#040810', hover: '#0d1829',
  barTrack: '#0f1c30', barExist: '#3d5a80',
  scrollThumb: '#18263d', scrollTrack: 'transparent',
  inputBg: '#0a1424', inputBdr: '#18263d',
  shadowSm: 'none',
  shadowMd: '0 4px 24px rgba(0,0,0,.5)',
};

export const ThemeCtx = createContext({});

/** Access theme tokens + toggle from any component inside ThemeProvider. */
export function useT() {
  return useContext(ThemeCtx);
}

/** Dept text colour — high contrast on background. */
export const dtc = (d, theme) => theme === 'light' ? d.textClr : d.clr;

/** Dept banner/card background. */
export const dbg = (d, theme) => theme === 'light' ? d.lightBg : d.bg;

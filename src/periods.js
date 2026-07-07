/**
 * periods.js
 * Shared academic-period primitives. Kept separate so both
 * classroom-allocation.jsx (Dashboard/RoomMapScreen) and
 * components/ManagementScreen.jsx can create/compare periods without
 * duplicating this logic — the format regex and comparator gate what
 * counts as "editable" vs "historical" data, so drift between copies
 * would be a correctness bug, not just a style inconsistency.
 */

// "2026.1" — ano.período; "o período mais recente" é só o maior valor em
// allPeriods.sort(comparePeriods) — não existe uma tabela/flag separada pra
// "período atual". Comparação numérica, não lexical: "2026.10" > "2026.2"
// lexicalmente (compara caractere a caractere) mas é "2026.2" que vem depois
// numericamente — comparePeriods evita essa pegadinha mesmo sendo um caso
// raro na prática (a maioria dos calendários acadêmicos não passa de .1/.2/.3).
export const DEFAULT_PERIOD = '2026.1';
export const PERIOD_RE = /^\d{4}\.\d+$/;

export const comparePeriods = (a, b) => {
  const [ay, an] = a.split('.').map(Number), [by, bn] = b.split('.').map(Number);
  return ay !== by ? ay - by : an - bn;
};

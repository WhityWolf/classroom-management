/**
 * src/responsive.js
 * Base para a Fase 1 do trabalho de responsividade (mobile) — um único hook
 * de breakpoint, sem depender de theme.jsx nem de classroom-allocation.jsx,
 * justamente para poder ser importado tanto dali quanto de src/components/*
 * sem risco de import circular (mesmo motivo que mantém theme.jsx separado).
 *
 * Uso: `const narrow = useIsNarrow(700)` — true quando a viewport tem no
 * máximo 700px de largura, atualizado ao vivo (resize, rotação de tela,
 * DevTools) via matchMedia, não apenas na montagem do componente.
 */
import { useEffect, useState } from 'react';

// Breakpoints padrão do app — ver plano de responsividade combinado com o
// usuário: ~480px cobre celular em pé, ~768px cobre celular deitado/tablet
// pequeno. Cada tela escolhe qual dos dois (ou um valor próprio) faz sentido
// pro seu próprio ponto de quebra de layout.
export const MOBILE_BP = 480;
export const TABLET_BP = 768;

// Compartilhado pelos dois hooks abaixo — só troca a query observada.
function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // a query pode ter mudado entre renders (ex.: breakpoint por parâmetro)
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function useIsNarrow(maxWidthPx = TABLET_BP) {
  return useMediaQuery(`(max-width: ${maxWidthPx}px)`);
}

// true em telas sensíveis ao toque sem mouse/trackpad de precisão (celular,
// tablet) — via `pointer: coarse`, não largura de viewport: um tablet largo
// usado por toque também se beneficia de alvo de toque maior, e um notebook
// estreito com mouse não precisa disso. Usado pra decidir célula/linha
// maior na Grade (Fase 3), não pra decidir layout/estrutura — isso continua
// sendo trabalho do useIsNarrow.
export function useIsCoarsePointer() {
  return useMediaQuery('(pointer: coarse)');
}

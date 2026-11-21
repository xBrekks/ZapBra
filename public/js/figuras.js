'use strict';

/*
 * Ilustraciones de producto (se usan mientras no haya fotos reales).
 * Compartido por la tienda y el panel de administración.
 */
function figura(tipo, c) {
  const osc = '#1f2937', suela = '#f9fafb';
  const formas = {
    tenis: `
      <path d="M18 88 C18 70 28 60 44 57 L78 41 C88 36 100 39 106 49 L114 62 C136 64 160 70 174 80 C182 85 182 88 178 88 Z" fill="${c}" stroke="rgba(0,0,0,.15)"/>
      <path d="M58 78 Q110 66 160 76" stroke="rgba(255,255,255,.7)" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M76 50 l10 12 M86 45 l10 12 M96 42 l9 12" stroke="rgba(0,0,0,.35)" stroke-width="3" stroke-linecap="round"/>
      <rect x="14" y="86" width="172" height="14" rx="7" fill="${suela}" stroke="#d1d5db"/>`,
    bota: `
      <path d="M48 14 L104 14 L106 60 C140 64 166 72 176 82 C182 88 180 92 176 92 L40 92 L42 54 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <path d="M46 30 L104 30" stroke="rgba(0,0,0,.25)" stroke-width="2" stroke-dasharray="4 3"/>
      <path d="M104 30 l-12 6 M104 40 l-12 6 M104 50 l-12 6" stroke="rgba(255,255,255,.5)" stroke-width="3" stroke-linecap="round"/>
      <rect x="36" y="90" width="146" height="12" rx="3" fill="${osc}"/>`,
    botin: `
      <path d="M52 36 L102 36 L104 62 C140 66 164 74 174 84 C180 90 178 94 174 94 L44 94 L46 60 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <path d="M60 40 L60 86" stroke="rgba(0,0,0,.3)" stroke-width="2"/>
      <rect x="40" y="92" width="140" height="8" rx="3" fill="${osc}"/>
      <rect x="42" y="96" width="26" height="12" rx="2" fill="${osc}"/>`,
    oxford: `
      <path d="M20 90 C20 74 30 66 46 64 L96 56 C130 54 160 64 176 76 C184 84 182 90 176 90 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <path d="M86 60 l14 -2 M88 66 l14 -2 M90 72 l14 -2" stroke="rgba(255,255,255,.55)" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M120 62 C140 62 150 70 154 80" stroke="rgba(0,0,0,.25)" stroke-width="2" fill="none"/>
      <rect x="16" y="88" width="166" height="8" rx="4" fill="${osc}"/>
      <rect x="18" y="92" width="30" height="12" rx="2" fill="${osc}"/>`,
    mocasin: `
      <path d="M20 90 C20 76 30 68 46 66 L96 60 C130 58 160 66 176 78 C184 84 182 90 176 90 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <path d="M104 62 C124 56 152 62 164 76" stroke="rgba(255,255,255,.6)" stroke-width="2" stroke-dasharray="3 3" fill="none"/>
      <rect x="96" y="66" width="34" height="7" rx="3" fill="rgba(0,0,0,.25)"/>
      <rect x="16" y="88" width="166" height="8" rx="4" fill="${osc}"/>`,
    tacon: `
      <path d="M28 46 C30 36 44 34 52 44 L92 78 C120 78 150 80 168 86 C178 90 176 96 170 96 L96 96 C80 92 66 82 56 74 L44 62 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <path d="M30 52 L46 62 L44 106 L38 106 Z" fill="${osc}"/>
      <path d="M56 74 C66 82 80 92 96 96 L170 96 C176 96 176 100 170 100 L96 100 C78 96 62 86 52 78 Z" fill="${osc}"/>`,
    sandalia: `
      <path d="M20 92 C20 84 30 82 40 82 L168 84 C182 86 182 98 170 98 L30 98 C22 98 20 96 20 92 Z" fill="#d6b98c" stroke="rgba(0,0,0,.2)"/>
      <path d="M62 84 C72 58 104 56 120 84" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="M138 84 C144 68 160 66 166 84" stroke="${c}" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M32 84 C30 62 50 56 58 70" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <rect x="20" y="98" width="160" height="6" rx="3" fill="${osc}"/>`,
    frasco: `
      <rect x="86" y="14" width="28" height="18" rx="3" fill="${osc}"/>
      <rect x="72" y="30" width="56" height="78" rx="12" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <rect x="80" y="54" width="40" height="32" rx="4" fill="rgba(255,255,255,.88)"/>
      <path d="M86 64 h28 M86 72 h20" stroke="#002776" stroke-width="3" stroke-linecap="round"/>`,
    spray: `
      <rect x="96" y="8" width="10" height="10" rx="2" fill="${osc}"/>
      <rect x="84" y="18" width="32" height="16" rx="4" fill="${osc}"/>
      <rect x="72" y="32" width="56" height="76" rx="8" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <rect x="78" y="54" width="44" height="30" rx="4" fill="rgba(255,255,255,.88)"/>
      <path d="M84 64 h32 M84 72 h22" stroke="#009C3B" stroke-width="3" stroke-linecap="round"/>`,
    cepillo: `
      <rect x="36" y="48" width="128" height="28" rx="14" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <path d="${Array.from({ length: 18 }, (_, i) => `M${48 + i * 6} 76 v20`).join(' ')}" stroke="#78350f" stroke-width="3"/>`,
    kit: `
      <rect x="60" y="22" width="24" height="34" rx="5" fill="#FFDF00" stroke="rgba(0,0,0,.2)"/>
      <rect x="96" y="34" width="56" height="14" rx="7" fill="#a16207"/>
      <rect x="36" y="50" width="128" height="56" rx="8" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <rect x="36" y="50" width="128" height="10" rx="4" fill="rgba(0,0,0,.18)"/>
      <circle cx="100" cy="82" r="12" fill="#002776"/>`,
    plantilla: `
      <path d="M36 62 C36 40 70 34 104 38 C144 42 172 46 176 62 C180 80 150 86 108 84 C76 82 36 86 36 62 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <circle cx="62" cy="62" r="10" fill="rgba(255,255,255,.5)"/>
      <ellipse cx="146" cy="60" rx="18" ry="12" fill="rgba(255,255,255,.5)"/>`,
    agujetas: `
      <path d="M20 46 C50 16 80 78 110 46 S170 16 184 46" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M20 74 C50 44 80 106 110 74 S170 44 184 74" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <rect x="10" y="42" width="14" height="7" rx="2" fill="#9ca3af"/>
      <rect x="10" y="70" width="14" height="7" rx="2" fill="#9ca3af"/>`,
    calcetin: `
      <path d="M80 14 L122 14 L124 70 C126 92 110 106 90 106 L52 106 C36 106 32 88 46 82 L82 68 Z" fill="${c}" stroke="rgba(0,0,0,.2)"/>
      <rect x="80" y="14" width="42" height="12" fill="rgba(0,0,0,.12)"/>
      <path d="M40 92 C44 100 52 106 60 106 L52 106 C42 106 36 100 40 92 Z" fill="rgba(0,0,0,.15)"/>`,
  };
  return `<svg viewBox="0 0 200 120" aria-hidden="true">${formas[tipo] || formas.tenis}</svg>`;
}

const TIPOS_FIGURA = {
  tenis: 'Tenis', bota: 'Bota', botin: 'Botín', oxford: 'Zapato formal', mocasin: 'Mocasín',
  tacon: 'Zapatilla de tacón', sandalia: 'Sandalia', frasco: 'Frasco / lata', spray: 'Spray',
  cepillo: 'Cepillo', kit: 'Kit', plantilla: 'Plantilla', agujetas: 'Agujetas', calcetin: 'Calcetín',
};

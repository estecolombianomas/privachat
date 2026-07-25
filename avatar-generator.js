/**
 * Generador dinámico de avatares SVG con estética premium para PrivaChat.
 * Utiliza el nickname del usuario para generar un hash determinista y asignar
 * una paleta de colores, degradados y patrones únicos.
 */

// Paleta de gradientes modernos y elegantes
const GRADIENTS = [
  { from: '#6366f1', to: '#a855f7' }, // Indigo a Púrpura (Cosmic)
  { from: '#10b981', to: '#3b82f6' }, // Esmeralda a Azul (Aurora)
  { from: '#f43f5e', to: '#fb923c' }, // Rosa a Naranja (Sunset)
  { from: '#06b6d4', to: '#3b82f6' }, // Cyan a Azul (Ocean)
  { from: '#f59e0b', to: '#ef4444' }, // Ámbar a Rojo (Fire)
  { from: '#ec4899', to: '#8b5cf6' }, // Rosa a Violeta (Cyberpunk)
  { from: '#14b8a6', to: '#059669' }, // Teal a Verde (Mint)
  { from: '#475569', to: '#1e293b' }  // Slate a Charcoal (Classic)
];

// Patrones geométricos sutiles para el fondo del avatar
const PATTERNS = [
  // 1. Círculos concéntricos
  (color) => `<circle cx="50" cy="50" r="35" fill="none" stroke="${color}" stroke-width="4" opacity="0.15" />
              <circle cx="50" cy="50" r="20" fill="none" stroke="${color}" stroke-width="3" opacity="0.2" />`,
  // 2. Cuadrícula de puntos
  (color) => `<circle cx="25" cy="25" r="3" fill="${color}" opacity="0.25" />
              <circle cx="50" cy="25" r="3" fill="${color}" opacity="0.25" />
              <circle cx="75" cy="25" r="3" fill="${color}" opacity="0.25" />
              <circle cx="25" cy="50" r="3" fill="${color}" opacity="0.25" />
              <circle cx="75" cy="50" r="3" fill="${color}" opacity="0.25" />
              <circle cx="25" cy="75" r="3" fill="${color}" opacity="0.25" />
              <circle cx="50" cy="75" r="3" fill="${color}" opacity="0.25" />
              <circle cx="75" cy="75" r="3" fill="${color}" opacity="0.25" />`,
  // 3. Rayas diagonales
  (color) => `<path d="M-10,30 L30,-10 M10,50 L50,10 M30,70 L70,30 M50,90 L90,50 M70,110 L110,70" stroke="${color}" stroke-width="4" stroke-linecap="round" opacity="0.15" />`,
  // 4. Anillos cruzados
  (color) => `<ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="${color}" stroke-width="3" transform="rotate(45 50 50)" opacity="0.2" />
              <ellipse cx="50" cy="50" rx="35" ry="15" fill="none" stroke="${color}" stroke-width="3" transform="rotate(-45 50 50)" opacity="0.2" />`,
  // 5. Sin patrón (solo gradiente limpio)
  () => ''
];

/**
 * Genera un número hash determinista a partir de un string
 */
function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return Math.abs(hash);
}

/**
 * Genera el SVG de un avatar para un nickname dado
 * @param {string} nickname - Nombre del usuario
 * @returns {string} - SVG en formato Data URL listo para usarse en src
 */
export function generateAvatar(nickname) {
  const name = (nickname || 'U').trim();
  const hash = djb2Hash(name);
  
  // Elegir gradiente y patrón usando el hash
  const gradient = GRADIENTS[hash % GRADIENTS.length];
  const patternFn = PATTERNS[hash % PATTERNS.length];
  
  // Obtener iniciales (hasta 2 letras)
  const words = name.split(/\s+/);
  let initials = '';
  if (words.length >= 2) {
    initials = (words[0][0] + words[1][0]).toUpperCase();
  } else {
    initials = name.substring(0, Math.min(2, name.length)).toUpperCase();
  }

  // Generar ID único para el degradado en el SVG
  const gradientId = `avatar-grad-${hash}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <defs>
      <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${gradient.from}" />
        <stop offset="100%" stop-color="${gradient.to}" />
      </linearGradient>
    </defs>
    
    <!-- Fondo del avatar -->
    <rect width="100" height="100" rx="24" fill="url(#${gradientId})" />
    
    <!-- Patrón sutil del fondo -->
    ${patternFn('#ffffff')}
    
    <!-- Texto de Iniciales -->
    <text x="50%" y="54%" 
          dominant-baseline="middle" 
          text-anchor="middle" 
          font-family="'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" 
          font-size="38" 
          font-weight="700" 
          fill="#ffffff"
          style="text-shadow: 0 2px 4px rgba(0,0,0,0.15)">
      ${initials}
    </text>
  </svg>`;

  // Convertir a Data URL Base64 para que pueda cargarse en cualquier etiqueta img sin problema
  const base64Svg = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64Svg}`;
}

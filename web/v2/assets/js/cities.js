// City name labels for every deck.gl map (atlas-sen shows basemap place names; v2 maps have no tiles, so labels are drawn here).
// [name, lon, lat, tier]. Tier 1 always, tier 2 from zoom 4.6, tier 3 from zoom 5.8. Coordinates are city centres, rounded to 2 decimals.
export const CITIES = [
  ['Ciudad de México', -99.13, 19.43, 1], ['Guadalajara', -103.35, 20.67, 1], ['Monterrey', -100.32, 25.67, 1], ['Tijuana', -117.03, 32.52, 1],
  ['Mérida', -89.62, 20.97, 1], ['Puebla', -98.2, 19.04, 1], ['León', -101.68, 21.12, 1], ['Chihuahua', -106.09, 28.63, 1],
  ['Hermosillo', -110.96, 29.07, 1], ['Veracruz', -96.13, 19.18, 1], ['Cancún', -86.85, 21.16, 1], ['La Paz', -110.31, 24.14, 1],
  ['Mexicali', -115.47, 32.66, 1], ['Tuxtla Gutiérrez', -93.12, 16.75, 1], ['Oaxaca', -96.73, 17.06, 1], ['Culiacán', -107.39, 24.81, 1],
  ['Torreón', -103.43, 25.54, 1], ['San Luis Potosí', -100.98, 22.15, 1], ['Saltillo', -101.0, 25.42, 1], ['Villahermosa', -92.93, 17.99, 1],
  ['Querétaro', -100.39, 20.59, 2], ['Aguascalientes', -102.3, 21.88, 2], ['Morelia', -101.19, 19.7, 2], ['Durango', -104.65, 24.02, 2],
  ['Zacatecas', -102.57, 22.77, 2], ['Tampico', -97.86, 22.23, 2], ['Reynosa', -98.28, 26.09, 2], ['Ciudad Juárez', -106.49, 31.69, 2],
  ['Acapulco', -99.89, 16.85, 2], ['Toluca', -99.66, 19.29, 2], ['Cuernavaca', -99.23, 18.92, 2], ['Pachuca', -98.74, 20.12, 2],
  ['Xalapa', -96.92, 19.54, 2], ['Campeche', -90.53, 19.85, 2], ['Chetumal', -88.3, 18.5, 2], ['Colima', -103.73, 19.24, 2],
  ['Tepic', -104.89, 21.51, 2], ['Mazatlán', -106.42, 23.22, 2], ['Ciudad Obregón', -109.93, 27.49, 2], ['Nogales', -110.94, 31.31, 2],
  ['Ensenada', -116.62, 31.87, 2], ['Los Cabos', -109.91, 22.89, 2], ['Tlaxcala', -98.24, 19.32, 2], ['Chilpancingo', -99.5, 17.55, 2],
  ['Tapachula', -92.26, 14.91, 2], ['Coatzacoalcos', -94.42, 18.15, 2], ['Matamoros', -97.5, 25.87, 2], ['Nuevo Laredo', -99.51, 27.48, 2],
  ['Ciudad Victoria', -99.14, 23.74, 2], ['Manzanillo', -104.34, 19.05, 2], ['Puerto Vallarta', -105.23, 20.65, 2], ['Irapuato', -101.35, 20.68, 3],
  ['Celaya', -100.82, 20.52, 3], ['Piedras Negras', -100.52, 28.7, 3], ['Monclova', -101.42, 26.91, 3], ['Guaymas', -110.9, 27.92, 3],
  ['Los Mochis', -108.99, 25.79, 3], ['Guerrero Negro', -114.06, 27.97, 3], ['Santa Rosalía', -112.27, 27.34, 3], ['Ciudad del Carmen', -91.84, 18.65, 3],
  ['Salina Cruz', -95.2, 16.17, 3], ['Uruapan', -102.06, 19.42, 3], ['Tehuacán', -97.4, 18.46, 3], ['Valladolid', -88.2, 20.69, 3],
  ['Ciudad Valles', -99.01, 21.99, 3], ['Poza Rica', -97.46, 20.53, 3], ['Córdoba', -96.93, 18.89, 3], ['Fresnillo', -102.87, 23.18, 3],
  ['Parral', -105.67, 26.93, 3], ['Cuauhtémoc', -106.87, 28.41, 3], ['Playa del Carmen', -87.07, 20.63, 3], ['Tecate', -116.63, 32.57, 3],
  ['San Quintín', -115.94, 30.56, 3], ['Ciudad Constitución', -111.67, 25.03, 3], ['Loreto', -111.34, 26.01, 3], ['Agua Prieta', -109.55, 31.33, 3],
];
const CHARS = [...new Set(CITIES.map((c) => c[0]).join('') + ' ')];
/** which tiers show at this zoom (0 none, 1, 2, 3 = all): the layer is rebuilt only when this number changes. */
export const tierAt = (zoom) => (zoom >= 5.8 ? 3 : zoom >= 4.6 ? 2 : 1);

export function cityLayer(deck, zoom, { color = [240, 232, 210, 205], halo = [11, 16, 13, 235] } = {}) {
  const t = tierAt(zoom);
  return new deck.TextLayer({
    id: 'cities', data: CITIES.filter((c) => c[3] <= t), getPosition: (c) => [c[1], c[2]], getText: (c) => c[0], getSize: (c) => (c[3] === 1 ? 13 : 11),
    sizeUnits: 'pixels', getColor: color, fontFamily: 'Geist, system-ui, sans-serif', fontWeight: 450, characterSet: CHARS, background: false,
    fontSettings: { sdf: true }, outlineWidth: 2, outlineColor: halo, getTextAnchor: 'middle', getAlignmentBaseline: 'bottom', getPixelOffset: [0, -4], pickable: false,
    updateTriggers: { getSize: [t] },
  });
}

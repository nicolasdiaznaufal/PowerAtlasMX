// Names shared by every section: control regions, CENACE state keys -> display names / abbreviations.
export const REGIONS = ['PENINSULAR', 'ORIENTAL', 'CENTRAL', 'OCCIDENTAL', 'NORESTE', 'NORTE', 'NOROESTE'];
export const RN = { CENTRAL: 'Central', ORIENTAL: 'Oriental', OCCIDENTAL: 'Occidental', NOROESTE: 'Noroeste', NORTE: 'Norte', NORESTE: 'Noreste',
  PENINSULAR: 'Peninsular', 'BAJA CALIFORNIA': 'Baja California', 'BAJA CALIFORNIA SUR': 'Baja California Sur', BAJA: 'Baja California' };
export const ST = {
  AGUASCALIENTES: ['Aguascalientes', 'AGS'], CAMPECHE: ['Campeche', 'CAM'], CHIAPAS: ['Chiapas', 'CHS'], CHIHUAHUA: ['Chihuahua', 'CHH'],
  'CIUDAD DE MEXICO': ['Ciudad de México', 'CDMX'], 'COAHUILA DE ZARAGOZA': ['Coahuila', 'COA'], COLIMA: ['Colima', 'COL'], DURANGO: ['Durango', 'DGO'],
  GUANAJUATO: ['Guanajuato', 'GTO'], GUERRERO: ['Guerrero', 'GRO'], HIDALGO: ['Hidalgo', 'HGO'], JALISCO: ['Jalisco', 'JAL'],
  MEXICO: ['Estado de México', 'MEX'], 'MICHOACAN DE OCAMPO': ['Michoacán', 'MICH'], MORELOS: ['Morelos', 'MOR'], NAYARIT: ['Nayarit', 'NAY'],
  'NUEVO LEON': ['Nuevo León', 'NL'], OAXACA: ['Oaxaca', 'OAX'], PUEBLA: ['Puebla', 'PUE'], QUERETARO: ['Querétaro', 'QRO'],
  'QUINTANA ROO': ['Quintana Roo', 'QROO'], 'SAN LUIS POTOSI': ['San Luis Potosí', 'SLP'], SINALOA: ['Sinaloa', 'SIN'], SONORA: ['Sonora', 'SON'],
  TABASCO: ['Tabasco', 'TAB'], TAMAULIPAS: ['Tamaulipas', 'TAM'], TLAXCALA: ['Tlaxcala', 'TLAX'], 'VERACRUZ DE IGNACIO DE LA LLAVE': ['Veracruz', 'VER'],
  YUCATAN: ['Yucatán', 'YUC'], ZACATECAS: ['Zacatecas', 'ZAC'], 'BAJA CALIFORNIA': ['Baja California', 'BC'], 'BAJA CALIFORNIA SUR': ['Baja California Sur', 'BCS'],
};
export const stName = (k) => (ST[k] ? ST[k][0] : k || '—');
export const stAbbr = (k) => (ST[k] ? ST[k][1] : k || '—');
export const regName = (k) => RN[k] || k || '—';

/** The two deck 12-month windows plus the variants the analysis publishes. */
export const WIN = {
  Y1: { key: 'deck_2024_25', label: 'Aug 2024 – Jul 2025', short: '2024–25', desde: '2024-08', hasta: '2025-07' },
  Y2: { key: 'deck_2025_26', label: 'Aug 2025 – Jul 2026', short: '2025–26', desde: '2025-08', hasta: '2026-07' },
};
export const WIN_J = {
  Y1: { key: 'deck_2024_25_ago_jun', label: 'Aug 2024 – Jun 2025', short: '2024–25 (Aug–Jun)' },
  Y2: { key: 'deck_2025_26_ago_jun', label: 'Aug 2025 – Jun 2026', short: '2025–26 (Aug–Jun)' },
};

export const TANK_LANGUAGES = Object.freeze([
  { id: 'javascript', name: 'JavaScript', badge: 'JS', available: true },
  { id: 'typescript', name: 'TypeScript', badge: 'TS', available: true },
  { id: 'python', name: 'Python', available: false },
  { id: 'java', name: 'Java', available: false },
]);

export function isSupportedTankLanguage(language) {
  return TANK_LANGUAGES.some((entry) => entry.id === language && entry.available);
}

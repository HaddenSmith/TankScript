export const TANK_LANGUAGES = Object.freeze([
  { id: 'javascript', name: 'JavaScript', logo: '/language-logos/javascript.svg', extension: 'js', available: true },
  { id: 'typescript', name: 'TypeScript', logo: '/language-logos/typescript.svg', extension: 'ts', available: true },
  { id: 'python', name: 'Python', logo: '/language-logos/python.svg', extension: 'py', available: true },
  { id: 'java', name: 'Java', logo: '/language-logos/java.svg', available: false },
]);

export function isSupportedTankLanguage(language) {
  return TANK_LANGUAGES.some((entry) => entry.id === language && entry.available);
}

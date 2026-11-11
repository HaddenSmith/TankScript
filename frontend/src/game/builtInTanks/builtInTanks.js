// Vite loads each shared *Tank.js module into the official tank catalog.
const tankModules = import.meta.glob('../../../../shared/game/builtInTanks/*Tank.js', {
  eager: true,
  import: 'default',
});

export const builtInTanks = Object.freeze(
  Object.values(tankModules).sort((first, second) => first.name.localeCompare(second.name)),
);

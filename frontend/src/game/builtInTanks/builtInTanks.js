// Vite loads each *Tank.js module in this directory into the official tank catalog.
const tankModules = import.meta.glob('./*Tank.js', {
  eager: true,
  import: 'default',
});

export const builtInTanks = Object.freeze(
  Object.values(tankModules).sort((first, second) => first.name.localeCompare(second.name)),
);

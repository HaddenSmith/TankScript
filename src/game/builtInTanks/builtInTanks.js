// Vite looks through the matching files in this folder and imports each tank
// module, so a new built-in tank is added by creating another *Tank.js file.
const tankModules = import.meta.glob('./*Tank.js', {
  eager: true,
  import: 'default',
});

export const builtInTanks = Object.freeze(
  Object.values(tankModules).sort((first, second) => first.name.localeCompare(second.name)),
);

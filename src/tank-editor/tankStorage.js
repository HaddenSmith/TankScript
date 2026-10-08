function getStorageKey(username) {
  return `tanks:${username}`;
}

export function loadTanks(username) {
  const storedTanks = window.localStorage.getItem(getStorageKey(username));
  if (storedTanks === null) {
    return [];
  }

  const tanks = JSON.parse(storedTanks);
  if (!Array.isArray(tanks)) {
    throw new Error('Saved tank data is not a list.');
  }

  return tanks;
}

export function saveTank(username, tank) {
  const tanks = loadTanks(username);
  const updatedTanks = [...tanks, tank];

  // Replace localStorage with service/database calls when those are implemented.
  window.localStorage.setItem(getStorageKey(username), JSON.stringify(updatedTanks));
  return updatedTanks;
}

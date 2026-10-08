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

export function updateTank(username, tankId, changes) {
  const tanks = loadTanks(username);
  const tankExists = tanks.some((tank) => tank.id === tankId);
  if (!tankExists) {
    throw new Error('The selected tank could not be found.');
  }

  const updatedTanks = tanks.map((tank) =>
    tank.id === tankId ? { ...tank, ...changes, id: tank.id } : tank,
  );

  window.localStorage.setItem(getStorageKey(username), JSON.stringify(updatedTanks));
  return updatedTanks;
}

export function deleteTank(username, tankId) {
  const tanks = loadTanks(username);
  const tankExists = tanks.some((tank) => tank.id === tankId);
  if (!tankExists) {
    throw new Error('The selected tank could not be found.');
  }

  const updatedTanks = tanks.filter((tank) => tank.id !== tankId);
  window.localStorage.setItem(getStorageKey(username), JSON.stringify(updatedTanks));
  return updatedTanks;
}

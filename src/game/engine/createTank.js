export function createTank(id, name, x, y) {
  return {
    id,
    name,
    x,
    y,
    rotation: 0,
    health: 3,
  };
}
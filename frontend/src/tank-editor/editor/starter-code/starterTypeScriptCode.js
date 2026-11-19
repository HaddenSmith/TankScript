export default [
  "// TankScript runs once every battle tick.",
  "// Choose one action using the same API as JavaScript.",
  "",
  "const enemy: Readonly<TankScriptArenaTank> | undefined = allTanks.find(",
  "  (tank) => tank.id !== tankId && tank.health > 0",
  ");",
  "",
  "if (enemy) {",
  "  shoot();",
  "}",
  ""
].join("\r\n");

export default [
  "# TankScript runs once every battle tick.",
  "# Choose one action using Python's TankScript API.",
  "",
  "enemy = next(",
  "    (tank for tank in all_tanks if tank.id != tank_id and tank.health > 0),",
  "    None,",
  ")",
  "",
  "if enemy is not None:",
  "    shoot()",
  ""
].join("\n");

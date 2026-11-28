# Official tanks

The five official tanks are JavaScript source programs using the same read-only
snapshots, seven actions and execution limits as player tanks. **Checkmate is the
Overkill entry**, not a sixth tank. Names, IDs and colors remain unchanged.

| Tank | Intended difficulty and personality |
| --- | --- |
| Firefly (Easy) | Predictable pursuit and a scanning, single-shot turret. Avoids known obstacles but ignores bullets and pickups. No pathfinding. |
| Bloodhound (Medium) | Nearest-enemy aiming, direct pursuit, local wall avoidance and short-range bullet dodges. Still makes noisy movement and aiming decisions. |
| Sidewinder (Hard) | Reactive duelist. Finds reachable firing lanes, compares walking around cover with breaking weak walls, and pursues nearby useful pickups. |
| Prism (Expert) | Survival tactician. Scores all seven actions against bullet paths, enemy guns, turret preparation, cover, escape space and healing. |
| Checkmate (Overkill) | Predictive attacker. Weighs likely opponent actions, sets close-range traps, prioritizes accessible wounded enemies and searches two further escape decisions. |

Hard, Expert and Checkmate share ordinary editable functions from `tacticalCode.js`;
their decision policies remain separate. Navigation visits at most the arena's
cells. Bullet forecasts cover three ticks, including swept fast-bullet paths,
walls and the engine's original-occupant priority. They are conservative estimates:
they do not reproduce every future bullet cancellation, wall destruction or enemy
move. Expert and Checkmate also account for an opponent's current bullet speed
when judging a ready gun. Existing bullets always use their own captured `speed`,
even after their owner gains or loses Lightning.

Advanced tanks consider hearts only below `tankMaxHealth`. They pursue Lightning
when inactive or nearing expiration, allowing a useful refresh without treating
it as a stacking bonus. They reconsider `allPowerups` on every tick: no first-tick
assumption, remembered spawn location or hardcoded respawn interval is needed.
This works with replenishment every 75 game ticks and the 30-tick Lightning
duration. Their strategies do not depend on a particular spawning interval.

## Updating the website

Each `*Tank.js` file is canonical. `builtInTanks.js` imports them through Vite's
source glob; the Battle page adds this catalog separately from community tanks.
A normal reviewed production build and deployment delivers the updated programs
on the next page load. There is no official-tank MongoDB seeding or migration to
run, and no database records were updated. Player-saved copies keep their source.

See the [evaluation report](../../../../benchmarks/OFFICIAL-TANKS.md) for results,
runtime checks, reproducible commands and the remaining difficulty limitations.

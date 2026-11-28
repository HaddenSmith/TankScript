# Walls and power-ups: official tank review

Reviewed November 27, 2026. Strategies and evaluation tools only; no engine,
API, runner, database or public Java changes. No commit or deployment.
See the [roster and maintenance guide](../frontend/src/game/builtInTanks/README.md).

## Method

The development benchmark runs the real BattleEngine and synchronous trusted
fixture executor. Every tank has three health and the same seven actions.
Runtime errors fail the benchmark. Separate real QuickJS tests enforce the normal
100 ms call budget; host-executor simulations alone do not establish worker safety.

We ran **6,640 battles / 410,101 ticks**:

- 1,680 with the original source from Git revision `65a3fa55639c1de6e278e9bc71f085627d06f935`.
- 1,680 with the final programs, seed 7193.
- 1,680 independent validation battles, seed 20261127; no subsequent strategy tuning.
- 1,600 against two test-only controls: a stationary shooting turret and a greedy
  pursuing tank. These controls are not new official or community entries.

Each phase covers open arenas, walls only, pickups only and both. Each official
pair plays 40 duels per configuration: 20 setups replayed with positions and
rotations swapped. Sizes are 8, 12, 16 and 20, with aligned, diagonal, close,
corner and seeded random starts. Twenty five-tank free-for-alls per configuration
rotate identities through starting slots. Control phases use 40 duels against
each control and no free-for-alls.

Wall layouts are generated after tank placement. Pickup generation uses a separate
seeded random stream so strategy random draws cannot change the pickup layout.
The native spawn method still runs at the engine's normal time. No gameplay
rules, deadlines, tick limits or stalemate limits are changed.

## Difficulty results

Combined final and validation duels: **80 per row**. Cells show
lower-tier wins / higher-tier wins / ties; ties include mutual destruction and
stalemates. Draws are retained rather than discarded from win percentages.

| Configuration | Easy / Medium | Medium / Hard | Hard / Expert | Expert / Checkmate |
| --- | --- | --- | --- | --- |
| Open | 0 / 75 / 5 | 1 / 69 / 10 | 9 / 31 / 40 | 0 / 9 / 71 |
| Walls | 0 / 67 / 13 | 1 / 73 / 6 | 9 / 14 / 57 | 2 / 8 / 70 |
| Pickups | 0 / 75 / 5 | 1 / 68 / 11 | 6 / 11 / 63 | 1 / 10 / 69 |
| Both | 0 / 67 / 13 | 2 / 75 / 3 | 11 / 15 / 54 | 2 / 9 / 69 |

The intended ordering holds among decisive adjacent-tier duels in each tested
configuration, but the small advanced gaps and many draws do not establish a
strict ranking for all opponents. Easy/Medium/Hard have fairly steep gaps.

At seed 7193, before versus after across all configurations (160 duels per pair):

| Pair | Before, lower / higher / ties | After, lower / higher / ties |
| --- | --- | --- |
| Easy / Medium | 18 / 124 / 18 | 0 / 142 / 18 |
| Medium / Hard | 16 / 105 / 39 | 4 / 138 / 18 |
| Hard / Expert | 25 / 30 / 105 | 21 / 34 / 105 |
| Expert / Checkmate | 12 / 30 / 118 | 1 / 18 / 141 |

These compare complete rosters on the current engine, not an individual new
program against its old version. More advanced draws are a remaining limitation.
There were **no full 1,000-tick battle timeouts** in the 6,640 evaluations. The
3,360 final/validation battles included 513 no-damage stalemates; a short engine
stalemate is different from a script exceeding its execution budget.

Combined five-tank free-for-alls: **40 per configuration**:

| Configuration | Firefly | Bloodhound | Sidewinder | Prism | Checkmate | Ties |
| --- | --- | --- | --- | --- | --- | --- |
| Open | 0 | 0 | 10 | 11 | 12 | 7 |
| Walls | 0 | 0 | 14 | 12 | 10 | 4 |
| Pickups | 0 | 1 | 9 | 10 | 11 | 9 |
| Both | 0 | 0 | 13 | 12 | 5 | 10 |

Checkmate remains the predictive, aggressive top-tier duelist; **it is not the
best free-for-all tank in every configuration**. Its close-range trades are less
effective in crowded wall battles. At seed 7193 its free-for-all wins fell from
44/80 to 22/80 while Sidewinder/Prism improved. This is not evidence of a universal
strength improvement for Checkmate, and further tuning should use new seeds and
opponents rather than fit these results.

Across 160 duels against each control (official wins / control wins / ties):

| Official tank | Stationary turret | Greedy pursuer |
| --- | --- | --- |
| Firefly | 104 / 48 / 8 | 0 / 74 / 86 |
| Bloodhound | 110 / 24 / 26 | 46 / 95 / 19 |
| Sidewinder | 146 / 6 / 8 | 69 / 10 / 81 |
| Prism | 134 / 1 / 25 | 83 / 0 / 77 |
| Checkmate | 141 / 0 / 19 | 70 / 1 / 89 |

These results also show that a more complicated policy does not guarantee more
wins against every simple opponent. Pickups were actually used:
final/validation battles collected **401 hearts and 922 Lightning pickups** and
destroyed ten walls. Dedicated scenarios additionally verify walking around
strong cover, breaking weak cover and opening sealed rooms.

## Verification and limits

Focused tests cover legal moves, wall health and cover, maximum-health-aware
healing, useful Lightning refreshes, newly appearing pickup batches, enemy
Lightning, captured bullet speed and original-occupant collision priority.
They do not assume a future respawn interval. Current spawning is unchanged.

The seeded seven-Easy regression still requires Checkmate to win at least four
of five matches and at least as often as Expert. Its old requirement to finish
faster than Expert was replaced with remaining-health comparison: elapsed battle
time is not a reliable difficulty ranking for a defensive opponent. Duration
remains reported by the benchmark; no collision or runtime tests were removed.

Verification completed on Windows, Node 24.21.0, Intel Core Ultra 7 155H
(22 logical processors, approximately 16 GiB RAM):

- **590 Jest tests passed**, 39 suites, including the engine, API, React and
  50 focused official-strategy/geometry checks.
- **78 runtime tests passed**, including nine new real QuickJS checks, existing
  JavaScript/TypeScript execution and compilation, Python, cancellation and
  security regressions. The eight QuickJS battles completed 941 ticks and 3,148
  tank calls. Per-battle call p95 ranged from 2.46–12.10 ms; the highest observed
  call was 17.18 ms. The 12-tank/200-bullet Checkmate probe made another 80 calls:
  p95 22.97 ms, maximum 26.28 ms, without changing the 100 ms limit.
- The largest reported QuickJS heap after those calls was 169,104 bytes per
  runtime. This is not a peak-allocation or whole-browser memory measurement.
- **Chrome 158.0.8127.36** passed eight production Battle page smoke tests:
  all configurations at 8/20 cells, six/twelve participants, 25 ticks each,
  real Python/TypeScript opponents, resets, frame cleanup and 1280/390-pixel
  layouts. No unexpected browser exceptions, console errors or failed responses.
  The local fixture proxy logged connection resets on some full-page WebSocket
  navigations; the browser reconnected and the checks passed.
- Production build and `git diff --check` passed. No database checks were needed
  for this source-only catalog update; other browsers and physical phones were
  not tested. Generated build/test output was removed after verification.

Timings are local observations, not guarantees for slower student devices. The
strategies cannot predict another player's actual decision. The advanced threat
and navigation helpers add code compared with Easy/Medium, but use bounded
arena-sized arrays and a small search instead of an unrestricted planner.

## Reproduce

From the repository root (Node 24; no added dependencies):

```sh
node scripts/benchmark-tanks.js --samples 40 --ffa 20 --out coverage/open.json
node scripts/benchmark-tanks.js --samples 40 --ffa 20 --walls --out coverage/walls.json
node scripts/benchmark-tanks.js --samples 40 --ffa 20 --powerups --out coverage/pickups.json
node scripts/benchmark-tanks.js --samples 40 --ffa 20 --walls --powerups --out coverage/both.json
```

Repeat with `--seed 20261127`. For control matches add `--baselines --ffa 0`.
Use `--pair hard,expert --ffa 0` to inspect one pairing; `--trace hard,expert,0`
prints its first layout. `--save-codes coverage/original.json` captures source
and `--codes coverage/original.json` replays it. The default script name is kept:
`benchmark-tanks.js` describes its purpose and matches the scripts directory.
To repeat the historical comparison, capture the five programs at the recorded
Git revision, then supply that source file to the current benchmark with `--codes`.

```sh
npm test -- --runInBand
node --test tests/unit/tanks/officialTankRuntime.test.mjs
npm run test:runner
npm run build
node tests/browser/officialTanks.mjs
git diff --check
```

The browser tool uses temporary local account/storage fixtures, real production
assets and real QuickJS/Python/TypeScript workers. It does not access MongoDB or
the deployed website. Generated reports go under ignored `coverage/` and can be
removed after review.

# Official tank review and collision verification

Completed November 6, 2026. No commits or deployment. Existing uncommitted changes were the starting point.

The final algorithms support the requested ordering in these head-to-head simulations. They do **not** establish an ideal overall balance: lower gaps are steeper than the 65–80% target, and the advanced matchups still draw frequently. Checkmate is the strongest free-for-all contestant, while Prism and Sidewinder have the same combined free-for-all win count.

## Method and reproducibility

- Run the real BattleEngine and TankScript executor, with the same seven actions and three health for every participant. No model gets extra speed, actions, health, hidden state, opponent commands, or code access.
- Final and independent validation runs each contain 200 matches for **every** pair (2,000 per run), plus 100 five-tank free-for-alls. Combined: 4,200 battles, including 400 for each adjacent pair.
- Seeds: 7193 and 20261106. Arena sizes: 8, 12, 16, 20. Duel layouts cover aligned starts, diagonals, close encounters, opposite corners, and seeded random positions. Each layout is replayed with positions and rotations swapped between participants. Free-for-alls rotate every identity through all five starting slots.
- Mulberry32 mixes consecutive seeds before the first random draw; the early diagnostic used an LCG with correlated opening rotations, so it is retained but is not the basis for final comparisons.
- Baseline control uses the exact saved pre-task algorithms on the **same corrected engine and final benchmark design** as the final run. This isolates strategy changes from collision changes. The initial pre-fix diagnostic is also preserved separately.
- MAX_TICKS remains 1,000; no-damage stalemate remains 125. No full-duration timeouts occurred in the final 4,200 matches; many battles ended at the shorter stalemate limit.
- Runtime script errors cause the development benchmark to fail. The final instrumented rerun had none. Survival is measured until death or battle termination, so living survivors' durations are censored, not predictions of their eventual lifetime. In duels, both durations usually equal the battle length.

Commands (Node 24, no added packages):

```sh
node scripts/benchmark-tanks.js --samples 200 --ffa 100 --out benchmarks/final.json
node scripts/benchmark-tanks.js --samples 200 --ffa 100 --seed 20261106 --out benchmarks/validation.json
node scripts/benchmark-tanks.js --samples 200 --ffa 100 --codes benchmarks/baseline-tanks.json --out benchmarks/baseline-control.json
node scripts/benchmark-tanks.js --pair expert,overkill --samples 100 --ffa 0
node scripts/benchmark-tanks.js --trace expert,overkill,0
```

## Original performance

This is the controlled baseline: 200 duels per row. Columns list the lower-tier wins, higher-tier wins, and ties separately.

| Matchup (lower vs higher) | Lower wins | Higher wins | Ties | Stalemates | Timeouts |
| --- | --- | --- | --- | --- | --- |
| Firefly vs Bloodhound | 1 | 188 | 11 | 11 | 0 |
| Firefly vs Sidewinder | 0 | 174 | 26 | 26 | 0 |
| Firefly vs Prism | 0 | 191 | 9 | 6 | 0 |
| Firefly vs Checkmate | 0 | 200 | 0 | 0 | 0 |
| Bloodhound vs Sidewinder | 1 | 78 | 121 | 121 | 0 |
| Bloodhound vs Prism | 0 | 27 | 173 | 160 | 0 |
| Bloodhound vs Checkmate | 0 | 97 | 103 | 34 | 0 |
| Sidewinder vs Prism | 0 | 6 | 194 | 194 | 0 |
| Sidewinder vs Checkmate | 0 | 61 | 139 | 139 | 0 |
| Prism vs Checkmate | 1 | 1 | 198 | 97 | 0 |

Weaknesses found:

- Firefly intentionally follows the first opponent, turns slowly, and ignores bullets. This remains an appropriate beginner example.
- Bloodhound's long-range firing lanes produced avoidable stalemates. It had useful immediate dodging but little initiative once aligned.
- Sidewinder and Prism often held safe but ineffective positions. Their old risk weights also treated a path hit during a move differently from the same unavoidable hit while staying still.
- Optional movement branches in advanced scripts could bypass the path-safety condition used in normal scoring.
- The old Checkmate combined heavy close-range penalties and a longer defensive search without enough offensive follow-through. It could survive or trade to a draw without outperforming Prism. In the controlled baseline they won one match each and tied 198.
- Diagonal pursuers could repeatedly contest the same cell. A safe destination by itself does not mean the simultaneous move will succeed.

## Changes and personalities

- **Firefly / Easy:** reviewed and retained unchanged. Simple one-axis pursuit, slow scanning, occasional shooting, no bullet awareness.
- **Bloodhound / Medium:** retains its independent nearest-enemy pursuit and two-tick immediate bullet check. Now closes to within three cells before settling into aligned combat, rather than spending the fight firing easily evaded distant streams.
- **Sidewinder / Hard:** reactive duelist with two-tick bullet evaluation, full movement-path checks, firing-lane screening, and safe flanking. It reacts to actual bullets rather than using Prism's or Checkmate's more speculative enemy-gun assessment. Movement and staying now charge immediate collisions consistently. Random flanks must satisfy path and near-term safety checks.
- **Prism / Expert:** scores shooting, both turns, and every legal move against three bullet forecasts, target positioning, and enemy muzzle exposure. Applies the same immediate path-hit cost to every action. It becomes more cautious when damaged and only varies movement through path-safe alternatives. It still takes risky close-range trades; that is a remaining weakness, not an invulnerability workaround.
- **Checkmate / Overkill:** rewritten around a compact public-state opponent forecast and a bounded escape search. Models all seven plausible opponent actions using pursuit, turret alignment, bullets and suppression; uses their probabilities for interception and positioning. Anticipates adjacent enemy shots, adjusts trade risk using both health totals, avoids contested destinations, prepares its turret before approach, and varies safe flanks. It does not inspect names to choose an opponent-specific counter, evaluate enemy code, predict their random draws, retain global memory, or issue multiple actions.
- **Shared helpers:** retained ordinary readable functions embedded in editable tank source. Added approach-turn estimation, retained full-path bullet prediction (including own bullets), corrected the shot-screening timing comment, and encouraged useful engagement distance. Checkmate's escape search now spans two future decisions instead of three; the opponent model replaces much of the old crowd/pressure scoring. There are no new dependencies or strategy classes.
- Names, IDs, difficulties, colors, official ordering, registration, selection UI, editor interface and executor remain intact. No authentication, service, saved-community-tank, database or deployment changes.

The preserved iteration summaries show discarded approaches as well as improvements. Removing close-range caution alone made Checkmate weaker; excessive caution produced more draws. Closing Sidewinder's firing distance too aggressively worsened its outcomes, so that trial was discarded. The final settings were frozen before the second seed set; validation was not used for another tuning pass.

## Final head-to-head results

Each row aggregates both seeds (400 matches). Win rate excludes ties and belongs to the higher tier.

| Matchup | Lower wins | Higher wins | Ties | Higher decisive win rate | Stalemates | Timeouts |
| --- | --- | --- | --- | --- | --- | --- |
| Firefly vs Bloodhound | 33 | 348 | 19 | 91.3% | 17 | 0 |
| Firefly vs Sidewinder | 5 | 325 | 70 | 98.5% | 66 | 0 |
| Firefly vs Prism | 5 | 353 | 42 | 98.6% | 24 | 0 |
| Firefly vs Checkmate | 0 | 400 | 0 | 100.0% | 0 | 0 |
| Bloodhound vs Sidewinder | 36 | 271 | 93 | 88.3% | 7 | 0 |
| Bloodhound vs Prism | 18 | 219 | 163 | 92.4% | 61 | 0 |
| Bloodhound vs Checkmate | 0 | 377 | 23 | 100.0% | 13 | 0 |
| Sidewinder vs Prism | 48 | 93 | 259 | 66.0% | 60 | 0 |
| Sidewinder vs Checkmate | 0 | 384 | 16 | 100.0% | 10 | 0 |
| Prism vs Checkmate | 3 | 82 | 315 | 96.5% | 304 | 0 |

Adjacent progression:

| Higher tier | Wins / losses / ties | Decisive win rate | Wins as share of all matches |
| --- | --- | --- | --- |
| Bloodhound | 348 / 33 / 19 | 91.3% | 87.0% |
| Sidewinder | 271 / 36 / 93 | 88.3% | 67.8% |
| Prism | 93 / 48 / 259 | 66.0% | 23.3% |
| Checkmate | 82 / 3 / 315 | 96.5% | 20.5% |

Prism's combined 66.0% is within the preliminary target, but its two seed sets differ: 61.3% and 69.6%. The others exceed the target among decisive matches. Checkmate vs Prism still ties **315/400** times (304 stalemates, 11 mutual destructions); its decisive rate must not be mistaken for winning nearly every battle. Prism vs Sidewinder has 259 ties, including 199 mutual destructions and 60 stalemates. This is evidence of risky exchanges as well as defensive deadlocks. No attempt was made to change engine termination or force a particular benchmark percentage.

Average survival and kills for the adjacent matchups (ticks, kills per match):

| Matchup | Lower survival | Higher survival | Lower kills | Higher kills |
| --- | --- | --- | --- | --- |
| Firefly vs Bloodhound | 48.35 | 48.35 | 0.09 | 0.88 |
| Bloodhound vs Sidewinder | 45.35 | 45.35 | 0.30 | 0.89 |
| Sidewinder vs Prism | 59.74 | 59.74 | 0.62 | 0.73 |
| Prism vs Checkmate | 129.02 | 129.02 | 0.04 | 0.23 |

## Free-for-all results

One copy of every tier. Baseline is 100 matches; final combines 200. Counts are not directly comparable without their denominators.

| Tank | Baseline wins / 100 | Final wins / 200 | Baseline survival | Final survival | Baseline kills | Final kills |
| --- | --- | --- | --- | --- | --- | --- |
| Firefly | 0 | 3 | 35.89 | 28.84 | 0.15 | 0.07 |
| Bloodhound | 3 | 3 | 91.49 | 52.83 | 0.55 | 0.67 |
| Sidewinder | 40 | 23 | 181.41 | 105.14 | 0.75 | 0.93 |
| Prism | 8 | 23 | 162.36 | 115.66 | 0.66 | 0.91 |
| Checkmate | 20 | 113 | 149.15 | 131.88 | 1.03 | 1.11 |

Baseline: 29 ties, 71 stalemates, 0 timeouts, mean 197.68 ticks. Final: 35 ties, 68 stalemates, 0 timeouts, mean 138.46 ticks. Stalemates can award a unique surviving kill leader, so stalemates are not a subset of ties in free-for-alls. Checkmate won 113/200 (56.5% of all matches). Prism and Sidewinder each won 23; this does not demonstrate a strict ranking between them in multi-opponent play. The existing five-seed test with one advanced tank and seven Fireflies also passes unchanged.

## Collision investigation and fixes

The arena has boundary walls, tanks and bullets; it has **no internal-wall objects or wall map**. No obstacle API or new wall system was introduced.

1. **Boundary damage was missing.** Out-of-bounds movement was already blocked, but caused no damage. Per the additional request, the resolver now also applies one normal damage hit for each attempted boundary move. The tank stays in bounds; wall damage resets the progress counter; lethal impacts emit one destruction event and award no kill. Tanks blocked by other tanks, swaps, contested cells or wrecks retain their existing non-damaging blocking behavior. A chain behind a wall-blocked tank stays separated, and only the direct wall attempt receives wall damage.
2. **Simultaneous following could send a bullet to the wrong victim.** Example: A at (2,2) moves right; B at (1,2) follows right; a downward bullet at (2,1.5) reaches (2,2). The existing engine could hit A or B solely according to their array order. The resolver now prioritizes the living original occupant of the bullet's arrival cell before checking swept movement paths. Both insertion orders reproduce the same expected hit on A. This follows the existing bullet-first timing and previous-cell hit rule.
3. **The existing swept-path fix was preserved.** Bullets advance by half a cell, then legal one-cell tank movement is checked across its full segment against those advanced positions. Thus crossing a half-cell bullet hurts, and a bullet that reaches a departing tank's old cell still hurts that tank. Own bullets have no immunity. A perpendicular move made before arrival can correctly evade a bullet; its earlier position alone does not imply a collision under this discrete phase order.
4. Simultaneous bullet damage, distinct-owner shared kill credit, tank-impact priority over bullet impacts, bullet speed, new-shot muzzle timing, wreck blocking, maximum ticks and stalemate rules were retained. A new shot starts half a cell from the muzzle and first moves on the following tick; it does not get an extra movement step on creation.

Focused tests cover all four boundaries, corners, a one-cell arena, repeated and simultaneous lethal wall hits, progress reset, blocked chains/wrecks, wall-plus-bullet damage, blocked evasions, all four half-cell path directions including self-owned bullets, valid perpendicular dodges, both follower insertion orders, simultaneous lethal bullet hits and kill credit. The new regression tests first failed for missing wall damage and the insertion-order bug, then passed after the small resolver fixes. No broader collision rewrite or continuous-physics model was introduced.

## Verification and remaining limits

- npm test -- --runInBand: **14 suites, 131 tests passed**. Existing test expectations were not weakened. New script tests use frozen supported state, all rotations and health values, deterministic random branches, exactly one action call, no live opponents, and checks for newly leaked global properties. Geometry tests compare predicted half-cell hits with actual engine damage.
- npm run build: passed. Vite reports React Router dependency warnings about its use-client directive; they do not fail the build.
- git diff --check: passed.
- All final simulations terminated normally with no script runtime errors and no arena escapes.
- Remaining design weaknesses are measurable: advanced defensive stalemates, close-range mutual destruction, imperfect motion predictions, and no proven strict Prism/Sidewinder free-for-all ordering. The results support improved progression, not a claim that every balance goal is solved. Future gains should focus on offensive initiative and multi-opponent positioning while retaining the verified collision rules.

## Saved artifacts

- [Reusable benchmark](../scripts/benchmark-tanks.js)
- [Pre-task algorithm snapshot](baseline-tanks.json)
- [Initial diagnostic before engine fixes](baseline.json)
- [Controlled baseline on corrected engine](baseline-control.json)
- [Final primary results](final.json)
- [Independent validation](validation.json)
- [Exploratory iteration summaries](iterations.json)

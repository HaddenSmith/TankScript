import { pythonApiName } from '../editor/pythonTankApi.js';

export function TankScriptReference({ language = 'javascript' }) {
  const pickupExample = language === 'python'
    ? 'heart = next((p for p in all_powerups if p.type == "heart"), None)\nblocked = any(w.x == tank_position.x + 1 and w.y == tank_position.y for w in all_walls)\nif heart and tank_health < tank_max_health and heart.x > tank_position.x and not blocked:\n    move_right()'
    : `${language === 'typescript' ? 'const heart: TankScriptPowerup | undefined' : 'const heart'} = allPowerups.find(p => p.type === 'heart');\nconst blocked = allWalls.some(w => w.x === tankPosition.x + 1 && w.y === tankPosition.y);\nif (heart && tankHealth < tankMaxHealth && heart.x > tankPosition.x && !blocked) moveRight();`;
  const apiName = name => {
    if (language === 'python') return pythonApiName(name);
    if (language === 'java') {
      if (name.endsWith('()')) return 'api.' + name;
      if (name === 'ownerId') return 'ownerId()';
      return 'state.' + name + '()';
    }
    return name;
  };
  return (
    <aside className="tank-command-reference" aria-labelledby="commands-heading">
      <div className="tank-reference-header">
        <div>
          <p className="tank-reference-label">API REFERENCE</p>
          <h2 id="commands-heading">TankScript reference</h2>
        </div>
      </div>

      {language === 'python' && (
        <p>Use Python names such as <code>move_up()</code> and <code>tank_position.x</code>.
          Arena lists are read-only tuples containing records with dot-access fields.
          The first Python run may take longer to start while its runtime loads.</p>
      )}
      {language === 'java' && (
        <p>Experimental Java implements <code>MyTank.tick(Snapshot state, TankScript api)</code>.
          Read records with accessors such as <code>state.tankPosition().x()</code> and call
          actions such as <code>api.shoot()</code>. Lists and records are read-only.
          Use <code>public class MyTank</code> with a <code>public void tick</code> method.
          Fields on your class persist between ticks. Saving keeps your source;
          Generate Command compiles it and reports errors. Development battles allow four Java tanks.</p>
      )}
      {language === 'java' && (
        <p>Experimental Java retains the older snapshot API. Wall, pickup, maximum-health,
          bullet-speed and Lightning-duration information is currently available only in JavaScript, TypeScript and Python.</p>
      )}
      <div className="tank-reference-content">
        <section aria-labelledby="tick-model-heading">
          <h3 id="tick-model-heading">Game tick</h3>
          <ol>
            <li>Every tank's code runs once per tick.</li>
            <li>The first action called is that tank's action; each tank submits one.</li>
            <li>After all tanks choose, their actions happen simultaneously.</li>
            <li>The arena updates and the next tick begins.</li>
          </ol>
        </section>

        <section aria-labelledby="actions-heading">
          <h3 id="actions-heading">Actions</h3>
          <dl>
            <div><dt><code>{apiName('moveUp()')}</code></dt><dd>Move up one step.</dd></div>
            <div><dt><code>{apiName('moveDown()')}</code></dt><dd>Move down one step.</dd></div>
            <div><dt><code>{apiName('moveLeft()')}</code></dt><dd>Move left one step.</dd></div>
            <div><dt><code>{apiName('moveRight()')}</code></dt><dd>Move right one step.</dd></div>
            <div><dt><code>{apiName('rotateLeft()')}</code></dt><dd>Rotate left.</dd></div>
            <div><dt><code>{apiName('rotateRight()')}</code></dt><dd>Rotate right.</dd></div>
            <div><dt><code>{apiName('shoot()')}</code></dt><dd>Shoot a bullet.</dd></div>
          </dl>
        </section>

        <section className="tank-reference-state" aria-labelledby="state-heading">
          <h3 id="state-heading">Read-only state</h3>
          <h4>Tank state</h4>
          <dl>
            <div><dt><code>{apiName('tankId')}</code></dt><dd>Your tank's unique identifier.</dd></div>
            <div><dt><code>{apiName('tankPosition')}</code></dt><dd>Your tank's <code>x</code> and <code>y</code> position.</dd></div>
            <div><dt><code>{apiName('tankRotation')}</code></dt><dd>Your tank's current direction.</dd></div>
            <div><dt><code>{apiName('tankHealth')}</code></dt><dd>Your tank's current health.</dd></div>
            {language !== 'java' && <>
              <div><dt><code>{apiName('tankMaxHealth')}</code></dt>
                <dd>Your tank's starting maximum health. Hearts restore 1 HP up to this cap.</dd></div>
              <div><dt><code>{apiName('tankBulletSpeed')}</code></dt>
                <dd>Speed of your next shot: 0.5 cells per tick normally, or 1 while Lightning is active.</dd></div>
              <div><dt><code>{apiName('tankLightningTicksRemaining')}</code></dt>
                <dd>Boosted game ticks remaining, or 0 when inactive.</dd></div>
            </>}
          </dl>
          {language !== 'java' && <p className="tank-reference-note">Lightning collected on tick N boosts ticks N+1 through N+50.
            Recollection resets to 50; pausing consumes no ticks. Existing bullets keep their fired speed.</p>}

          <h4>Arena objects</h4>
          <dl>
            <div><dt><code>{apiName('allTanks')}</code></dt><dd>
              All arena tanks, each with <code>id</code>, <code>name</code>, <code>x</code>,
              <code>y</code>, <code>rotation</code>, and <code>health</code>.
              {language !== 'java' && <> Also <code>{apiName('maxHealth')}</code>, <code>{apiName('bulletSpeed')}</code>,
                and <code>{apiName('lightningTicksRemaining')}</code>.</>}
            </dd></div>
            <div><dt><code>{apiName('allBullets')}</code></dt><dd>
              Read-only bullet snapshots with <code>id</code>, <code>{apiName('ownerId')}</code>,
              <code>x</code>, <code>y</code>, and <code>rotation</code>.
              {language !== 'java' && <> Each bullet's <code>speed</code> is captured when fired.</>}
            </dd></div>
            {language !== 'java' && <>
              <div><dt><code>{apiName('allWalls')}</code></dt>
                <dd>Living walls with <code>x</code>, <code>y</code>, <code>health</code>, and <code>{apiName('maxHealth')}</code>.
                  Destroyed walls are excluded.</dd></div>
              <div><dt><code>{apiName('allPowerups')}</code></dt>
                <dd>Uncollected pickups with <code>type</code> (<code>"heart"</code> or <code>"lightning"</code>), <code>x</code>, and <code>y</code>.</dd></div>
            </>}
          </dl>
          {language !== 'java' && <p className="tank-reference-note">Enable Walls and Enable Power-Ups in Battle Setup control which objects appear in a battle.</p>}

          <h4>Arena dimensions</h4>
          <dl>
            <div><dt><code>{apiName('arenaWidth')}</code></dt><dd>Current arena width in grid cells.</dd></div>
            <div><dt><code>{apiName('arenaHeight')}</code></dt><dd>Current arena height in grid cells.</dd></div>
          </dl>
        </section>
        {language !== 'java' && (
          <section className="tank-reference-strategy" aria-labelledby="arena-strategy-heading">
            <h3 id="arena-strategy-heading">Using arena information</h3>
            <p>Snapshots describe the arena before simultaneous actions resolve. Choose routes yourself;
              this example takes one step toward a heart if the next square has no living wall.</p>
            <pre className="tank-reference-example"><code>{pickupExample}</code></pre>
            <p>The Debugger supplies its placed objects using the same API. Generate Command remains static:
              it does not move objects, collect pickups, deal damage, or consume Lightning ticks.</p>
          </section>
        )}
      </div>
    </aside>
  );
}

import { pythonApiName } from '../editor/pythonTankApi.js';

export function TankScriptReference({ language = 'javascript' }) {
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
          Tank and bullet lists are read-only tuples containing records with dot-access fields.
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
            <dt><code>{apiName('moveUp()')}</code></dt>
            <dd>Move up one step.</dd>
            <dt><code>{apiName('moveDown()')}</code></dt>
            <dd>Move down one step.</dd>
            <dt><code>{apiName('moveLeft()')}</code></dt>
            <dd>Move left one step.</dd>
            <dt><code>{apiName('moveRight()')}</code></dt>
            <dd>Move right one step.</dd>
            <dt><code>{apiName('rotateLeft()')}</code></dt>
            <dd>Rotate left.</dd>
            <dt><code>{apiName('rotateRight()')}</code></dt>
            <dd>Rotate right.</dd>
            <dt><code>{apiName('shoot()')}</code></dt>
            <dd>Shoot a bullet.</dd>
          </dl>
        </section>

        <section aria-labelledby="state-heading">
          <h3 id="state-heading">Read-only state</h3>
          <dl>
            <dt><code>{apiName('tankId')}</code></dt>
            <dd>Your tank's unique identifier.</dd>
            <dt><code>{apiName('tankPosition')}</code></dt>
            <dd>Your tank's <code>x</code> and <code>y</code> position.</dd>
            <dt><code>{apiName('tankRotation')}</code></dt>
            <dd>Your tank's current direction.</dd>
            <dt><code>{apiName('tankHealth')}</code></dt>
            <dd>Your tank's current health.</dd>
            <dt><code>{apiName('allTanks')}</code></dt>
            <dd>
              All arena tanks, each with <code>id</code>, <code>name</code>, <code>x</code>,
              <code>y</code>, <code>rotation</code>, and <code>health</code>.
            </dd>
            <dt><code>{apiName('allBullets')}</code></dt>
            <dd>
              Read-only bullet snapshots with <code>id</code>, <code>{apiName('ownerId')}</code>,
              <code>x</code>, <code>y</code>, and <code>rotation</code>.
            </dd>
            <dt><code>{apiName('arenaWidth')}</code></dt>
            <dd>Current arena width in grid cells.</dd>
            <dt><code>{apiName('arenaHeight')}</code></dt>
            <dd>Current arena height in grid cells.</dd>
          </dl>
        </section>
      </div>
    </aside>
  );
}

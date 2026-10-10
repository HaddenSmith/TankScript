export function TankScriptReference() {
  return (
    <aside className="tank-command-reference" aria-labelledby="commands-heading">
      <p className="tank-reference-label">API REFERENCE</p>
      <h2 id="commands-heading">TankScript reference</h2>

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
          <dt><code>moveUp()</code></dt>
          <dd>Move up one step.</dd>
          <dt><code>moveDown()</code></dt>
          <dd>Move down one step.</dd>
          <dt><code>moveLeft()</code></dt>
          <dd>Move left one step.</dd>
          <dt><code>moveRight()</code></dt>
          <dd>Move right one step.</dd>
          <dt><code>rotateLeft()</code></dt>
          <dd>Rotate left.</dd>
          <dt><code>rotateRight()</code></dt>
          <dd>Rotate right.</dd>
          <dt><code>shoot()</code></dt>
          <dd>Shoot a bullet.</dd>
        </dl>
      </section>

      <section aria-labelledby="state-heading">
        <h3 id="state-heading">Read-only state</h3>
        <dl>
          <dt><code>tankId</code></dt>
          <dd>Your tank's unique identifier.</dd>
          <dt><code>tankPosition</code></dt>
          <dd>Your tank's <code>x</code> and <code>y</code> position.</dd>
          <dt><code>tankRotation</code></dt>
          <dd>Your tank's current direction.</dd>
          <dt><code>tankHealth</code></dt>
          <dd>Your tank's current health.</dd>
          <dt><code>allTanks</code></dt>
          <dd>
            All arena tanks, each with <code>id</code>, <code>name</code>, <code>x</code>,
            <code>y</code>, <code>rotation</code>, and <code>health</code>.
          </dd>
          <dt><code>allBullets</code></dt>
          <dd>
            Read-only bullet snapshots with <code>id</code>, <code>ownerId</code>,
            <code>x</code>, <code>y</code>, and <code>rotation</code>.
          </dd>
          <dt><code>arenaWidth</code></dt>
          <dd>Current arena width in grid cells.</dd>
          <dt><code>arenaHeight</code></dt>
          <dd>Current arena height in grid cells.</dd>
        </dl>
      </section>
    </aside>
  );
}

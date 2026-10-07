import React from 'react';
import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { registerTankScriptDefinitions } from './tankScriptMonaco';
import starterTankCode from './starterTankScriptCode.js?raw';

function handleEditorMount(_editor, monaco) {
  registerTankScriptDefinitions(monaco);
}

export function TankEditor() {
  const [tankCode, setTankCode] = useState(starterTankCode);

  return (
    <main className="tank-editor-page">
      <h1>Tank Editor</h1>
      {/*Future Authentication will restrict tank editing to the logged-in user.*/}
      <form className="tank-editor-form" action="#" method="post">
        <section className="tank-config" aria-labelledby="tank-information-heading">
          <h2 id="tank-information-heading">Tank Configuration</h2>
          <div className="tank-name-row">
            <label htmlFor="tank-name">Tank name</label>
            <input className="form-control" type="text" id="tank-name" name="tank-name" placeholder="Enter a name for your tank" required />
            {/*Future third-party service/API integration will provide a generated name suggestion.*/}
            <button className="btn btn-secondary" type="button">Suggest Name</button>
          </div>
        </section>

        <div className="tank-workspace">
          <section className="tank-code-panel" aria-labelledby="editor-heading">
            <h3 id="editor-heading">Tank code editor</h3>
            <p>Write the JavaScript that will control your tank.</p>
            <div id="tank-code" className="tank-code-editor">
              <Editor
                height="24rem"
                defaultLanguage="javascript"
                theme="vs-dark"
                onMount={handleEditorMount}
                value={tankCode}
                onChange={(value) => setTankCode(value ?? '')}
                options={{
                  automaticLayout: true,
                  fontSize: 14,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                }}
              />
            </div>
            <input type="hidden" name="tank-code" value={tankCode} />
            <button className="btn btn-primary tank-save-button" type="submit">Save Tank</button>
          </section>

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
                <dt><code>move()</code></dt>
                <dd>Move forward one step.</dd>
                <dt><code>moveBackward()</code></dt>
                <dd>Move backward one step.</dd>
                <dt><code>rotateLeft()</code></dt>
                <dd>Rotate left one step.</dd>
                <dt><code>rotateRight()</code></dt>
                <dd>Rotate right one step.</dd>
                <dt><code>shoot()</code></dt>
                <dd>Fire the tank's weapon.</dd>
              </dl>
            </section>

            <section aria-labelledby="state-heading">
              <h3 id="state-heading">Read-only state</h3>
              <dl>
                <dt><code>tankPosition</code></dt>
                <dd>Your tank's <code>x</code> and <code>y</code> position.</dd>
                <dt><code>tankRotation</code></dt>
                <dd>Your tank's current direction.</dd>
                <dt><code>tankHealth</code></dt>
                <dd>Your tank's current health.</dd>
                <dt><code>tankPositions</code></dt>
                <dd>
                  All arena tanks, each with <code>id</code>, <code>name</code>, <code>x</code>,
                  <code> y</code>, <code>rotation</code>, <code>health</code>, and <code>isEnemy</code>.
                  <code>isEnemy</code> supports free-for-all now and teams in the future.
                </dd>
              </dl>
            </section>
          </aside>
        </div>
      </form>

      <section className="tank-saved-info" aria-labelledby="tank-data-heading">
        <h2 id="tank-data-heading">Saved tank information</h2>
        {/*Future Database persistence will load and save the current tank and its statistics.*/}
        <dl className="tank-data-list">
          <dt>Tank name</dt>
          <dd>[database tank name placeholder]</dd>
          <dt>Tank code</dt>
          <dd>[database tank code placeholder]</dd>
          <dt>Statistics</dt>
          <dd>[wins placeholder] wins, [losses placeholder] losses</dd>
          <dt>Saved tanks</dt>
          <dd>[saved tank list placeholder]</dd>
        </dl>
      </section>
    </main>
  );
}
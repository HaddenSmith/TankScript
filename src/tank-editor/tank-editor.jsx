import React, { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import './tank-editor.css';
import { registerTankScriptDefinitions } from './editor/tankScriptMonaco';
import starterTankCode from './editor/starterTankScriptCode.js?raw';
import { loadTanks, saveTank } from './tankStorage';

function handleEditorMount(_editor, monaco) {
  registerTankScriptDefinitions(monaco);
}

export function TankEditor({ username }) {
  const [tankName, setTankName] = useState('');
  const [tankCode, setTankCode] = useState(starterTankCode);
  const [savedTanks, setSavedTanks] = useState([]);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    try {
      setSavedTanks(loadTanks(username));
    } catch (error) {
      setMessage({
        type: 'danger',
        text: `Could not load saved tanks: ${error.message}`,
      });
    }
  }, [username]);

  function handleSave(e) {
    e.preventDefault();

    const trimmedName = tankName.trim();
    if (!trimmedName) {
      setMessage({ type: 'danger', text: 'Please enter a tank name before saving.' });
      return;
    }

    const tank = {
      id: `tank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      code: tankCode,
      wins: 0,
      losses: 0,
    };

    try {
      setSavedTanks(saveTank(username, tank));
      setTankName(trimmedName);
      setMessage({ type: 'success', text: `${trimmedName} was saved.` });
    } catch (error) {
      setMessage({
        type: 'danger',
        text: `Could not save tank: ${error.message}`,
      });
    }
  }

  return (
    <main className="tank-editor-page">
      <h1>Tank Editor</h1>
      <form className="tank-editor-form" onSubmit={handleSave}>
        {message && (
          <div className={`alert alert-${message.type}`} role="status" aria-live="polite">
            {message.text}
          </div>
        )}
        <section className="tank-config" aria-labelledby="tank-information-heading">
          <h2 id="tank-information-heading">Tank Configuration</h2>
          <div className="tank-name-row">
            <label htmlFor="tank-name">Tank name</label>
            <input
              className="form-control"
              type="text"
              id="tank-name"
              name="tank-name"
              placeholder="Enter a name for your tank"
              value={tankName}
              onChange={(e) => setTankName(e.target.value)}
            />
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
                <dt><code>rotateRight()</code></dt>
                <dd>Rotate right.</dd>
                <dt><code>rotateLeft()</code></dt>
                <dd>Rotate left.</dd>
                <dt><code>moveUp()</code></dt>
                <dd>Move up one step.</dd>
                <dt><code>moveDown()</code></dt>
                <dd>Move down one step.</dd>
                <dt><code>moveRight()</code></dt>
                <dd>Move right one step.</dd>
                <dt><code>moveLeft()</code></dt>
                <dd>Move left one step.</dd>
                <dt><code>shoot()</code></dt>
                <dd>Shoot a bullet.</dd>
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
                  <code>y</code>, <code>rotation</code>, <code>health</code>, and <code>isEnemy</code>.
                  <code>isEnemy</code> supports free-for-all now and teams in the future.
                </dd>
              </dl>
            </section>
          </aside>
        </div>
      </form>

      <section className="tank-saved-info" aria-labelledby="tank-data-heading">
        <h2 id="tank-data-heading">Saved tank information</h2>
        <dl className="tank-data-list">
          <dt>Tank name</dt>
          <dd>{savedTanks.at(-1)?.name ?? 'No tanks saved yet.'}</dd>
          <dt>Tank code</dt>
          <dd>{savedTanks.at(-1)?.code ?? 'No tank code saved.'}</dd>
          <dt>Statistics</dt>
          <dd>
            {savedTanks.at(-1)?.wins ?? 0} wins, {savedTanks.at(-1)?.losses ?? 0} losses
          </dd>
          <dt>Saved tanks</dt>
          <dd>
            {savedTanks.length > 0
              ? savedTanks.map((tank) => tank.name).join(', ')
              : 'No tanks saved yet.'}
          </dd>
        </dl>
      </section>
    </main>
  );
}
import React, { useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import './tank-editor.css';
import { registerTankScriptDefinitions } from './editor/tankScriptMonaco';
import starterTankCode from './editor/starterTankScriptCode.js?raw';
import { loadTanks, saveTank, updateTank } from './tankStorage';
import { StatusMessage } from '../components/status-message';

export function TankEditor({ username }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const [tankName, setTankName] = useState('');
  const [tankCode, setTankCode] = useState(starterTankCode);
  const [savedTanks, setSavedTanks] = useState([]);
  const [selectedTankId, setSelectedTankId] = useState('');
  const [message, setMessage] = useState(null);
  const selectedTank = savedTanks.find((tank) => tank.id === selectedTankId);

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

  function handleTankSelection(e) {
    const tankId = e.target.value;
    setSelectedTankId(tankId);

    const selectedTank = savedTanks.find((tank) => tank.id === tankId);
    if (selectedTank) {
      setTankName(selectedTank.name);
      setTankCode(selectedTank.code);
      setMessage(null);
    } else {
      handleNewTank();
    }
  }

  function handleNewTank() {
    setSelectedTankId('');
    setTankName('');
    setTankCode(starterTankCode);
    setMessage(null);
  }

  async function handleSave(e) {
    e.preventDefault();

    const trimmedName = tankName.trim();
    if (!trimmedName) {
      setMessage({ type: 'danger', text: 'Please enter a tank name before saving.' });
      return;
    }

    let syntaxErrorCount = null;
    try {
      const model = editorRef.current?.getModel();
      if (model && monacoRef.current) {
        const getWorker = await monacoRef.current.languages.typescript.getJavaScriptWorker();
        const worker = await getWorker(model.uri);
        const diagnostics = await worker.getSyntacticDiagnostics(model.uri.toString());
        syntaxErrorCount = diagnostics.filter((diagnostic) => diagnostic.category === 1).length;
      }
    } catch (error) {
      console.error('Could not check TankScript syntax with Monaco:', error);
    }

    try {
      let saveAction;
      if (selectedTankId) {
        setSavedTanks(updateTank(username, selectedTankId, {
          name: trimmedName,
          code: tankCode,
        }));
        saveAction = 'updated';
      } else {
        const tank = {
          id: `tank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: trimmedName,
          code: tankCode,
          wins: 0,
          losses: 0,
        };
        setSavedTanks(saveTank(username, tank));
        setSelectedTankId(tank.id);
        saveAction = 'saved';
      }
      setTankName(trimmedName);
      if (syntaxErrorCount === null) {
        setMessage({
          type: 'warning',
          text: `Tank ${saveAction}, but Monaco could not check the JavaScript syntax.`,
        });
      } else if (syntaxErrorCount > 0) {
        setMessage({
          type: 'warning',
          text: `Tank ${saveAction}, but the code currently contains ${syntaxErrorCount} JavaScript syntax error${syntaxErrorCount === 1 ? '' : 's'}.`,
        });
      } else {
        setMessage({ type: 'success', text: `${trimmedName} was ${saveAction}.` });
      }
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
          <StatusMessage type={message.type}>
            {message.text}
          </StatusMessage>
        )}
        <section className="tank-config" aria-labelledby="tank-information-heading">
          <h2 id="tank-information-heading">Tank Configuration</h2>
          <p className={`tank-edit-mode${selectedTank ? ' is-editing' : ''}`} aria-live="polite">
            {selectedTank
              ? `Editing: ${tankName.trim() || selectedTank.name}`
              : 'Creating a new tank'}
          </p>
          <div className="tank-config-options">
            <div className="tank-name-controls">
              <label htmlFor="tank-name">Tank name</label>
              <div className="tank-name-row">
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
            </div>
            <div className="tank-selection-controls">
              <label htmlFor="saved-tank">Select saved tank</label>
              <div className="tank-selection-row">
                <select
                  className="form-select"
                  id="saved-tank"
                  value={selectedTankId}
                  onChange={handleTankSelection}
                >
                  {savedTanks.length === 0 ? (
                    <option value="" disabled>No saved tanks</option>
                  ) : (
                    <>
                      <option value="">Choose a tank</option>
                      {savedTanks.map((tank) => (
                        <option key={tank.id} value={tank.id}>{tank.name}</option>
                      ))}
                    </>
                  )}
                </select>
                <button className="btn btn-secondary" type="button" onClick={handleNewTank}>
                  New Tank
                </button>
              </div>
            </div>
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
                onMount={(editor, monaco) => {
                  registerTankScriptDefinitions(monaco);
                  editorRef.current = editor;
                  monacoRef.current = monaco;
                }}
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
            <button className="btn btn-primary tank-save-button" type="submit">
              {selectedTankId ? 'Update Tank' : 'Save New Tank'}
            </button>
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

    </main>
  );
}
import { lazy, Suspense } from 'react';
import Dropdown from 'react-bootstrap/Dropdown';
import { TANK_LANGUAGES } from '../../game/tank-script/shared/tankLanguages.js';

const Editor = lazy(() => import('../editor/localMonacoEditor'));
const editorHeight = '24rem';

export function TankCodeEditor({ tankCode, tankLanguage = 'javascript', onLanguageChange, onEditorMount, onTankCodeChange }) {
  const language = TANK_LANGUAGES.find((entry) => entry.id === tankLanguage);
  return (
    <section className="tank-code-panel" aria-labelledby="editor-heading">
      <div className="tank-code-heading">
        <div>
          <h3 id="editor-heading">Tank code editor</h3>
          <p>Write the {language.name} that will control your tank.</p>
        </div>
        <div className="tank-language-control">
          <label id="tank-language-label" htmlFor="tank-language">Language</label>
          <Dropdown className="tank-language-select" onSelect={onLanguageChange} focusFirstItemOnShow="keyboard">
            <Dropdown.Toggle
              className="tank-language-toggle"
              id="tank-language"
              type="button"
              aria-haspopup="listbox"
              aria-controls="tank-language-menu"
              aria-labelledby="tank-language-label tank-language-selected"
              aria-describedby="tank-language-help"
            >
              <img className="tank-language-logo" src={language.logo} alt="" />
              <span id="tank-language-selected">{language.name}</span>
            </Dropdown.Toggle>
            <Dropdown.Menu id="tank-language-menu" role="listbox">
              {TANK_LANGUAGES.map((entry) => (
                <Dropdown.Item
                  as="button"
                  type="button"
                  role="option"
                  key={entry.id}
                  eventKey={entry.id}
                  active={entry.id === tankLanguage}
                  disabled={!entry.available}
                >
                  <img className="tank-language-logo" src={entry.logo} alt="" />
                  <span>{entry.name}{entry.available ? '' : ' — coming soon'}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>
      <p className="tank-language-help" id="tank-language-help">
        Each language keeps its own draft while you edit this tank. Save the selected language.
      </p>
      <div id="tank-code" className="tank-code-editor">
        <Suspense fallback={
          <div style={{ height: editorHeight, display: 'grid', placeItems: 'center', color: 'var(--paper)' }}>
            Loading editor…
          </div>
        }>
          <Editor
            height={editorHeight}
            language={tankLanguage}
            path={'tank.' + language.extension}
            theme="vs-dark"
            onMount={onEditorMount}
            value={tankCode}
            onChange={onTankCodeChange}
            options={{
              automaticLayout: true,
              fontSize: 14,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 2,
            }}
          />
        </Suspense>
      </div>
      <input type="hidden" name="tank-code" value={tankCode} />
    </section>
  );
}

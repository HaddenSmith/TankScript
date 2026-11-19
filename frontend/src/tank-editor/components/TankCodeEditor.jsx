import { lazy, Suspense } from 'react';
import { TANK_LANGUAGES } from '../../game/tank-script/tankLanguages.js';

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
          <label htmlFor="tank-language">Language</label>
          <div className="tank-language-select">
            <span className={`tank-language-badge tank-language-badge--${tankLanguage}`} aria-hidden="true">
              {language.badge}
            </span>
            <select
              className="form-select"
              id="tank-language"
              value={tankLanguage}
              onChange={(event) => onLanguageChange(event.target.value)}
              aria-describedby="tank-language-help"
            >
              {TANK_LANGUAGES.map((entry) => (
                <option key={entry.id} value={entry.id} disabled={!entry.available}>
                  {entry.name}{entry.available ? '' : ' — coming soon'}
                </option>
              ))}
            </select>
          </div>
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
            path={tankLanguage === 'typescript' ? 'tank.ts' : 'tank.js'}
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

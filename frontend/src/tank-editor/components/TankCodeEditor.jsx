import { lazy, Suspense } from 'react';
import Dropdown from 'react-bootstrap/Dropdown';
import { TANK_LANGUAGES } from '../../game/tank-script/shared/tankLanguages.js';
import { TankLanguageLogo } from '../../components/TankLanguageLogo.jsx';

const Editor = lazy(() => import('../editor/localMonacoEditor'));
const editorHeight = '24rem';

export function TankCodeEditor({ tankCode, tankLanguage, languageLocked = false, onLanguageChange, onEditorMount, onTankCodeChange }) {
  const language = TANK_LANGUAGES.find((entry) => entry.id === tankLanguage);
  return (
    <section className="tank-code-panel" aria-labelledby="editor-heading">
      <div className="tank-code-heading">
        <div>
          <h3 id="editor-heading">Tank code editor</h3>
          <p>{language ? `Write the ${language.name} that will control your tank.` : 'Choose a programming language to start your tank.'}</p>
        </div>
        <div className="tank-language-control">
          <label id="tank-language-label" htmlFor="tank-language">Language</label>
          <Dropdown className="tank-select tank-language-select" onSelect={onLanguageChange} focusFirstItemOnShow="keyboard">
            <Dropdown.Toggle
              className="tank-language-toggle"
              id="tank-language"
              type="button"
              disabled={languageLocked}
              aria-haspopup="listbox"
              aria-controls="tank-language-menu"
              aria-labelledby="tank-language-label tank-language-selected"
              aria-describedby={tankLanguage === 'python' ? 'tank-language-help tank-python-notice' : 'tank-language-help'}
            >
              {language && <TankLanguageLogo language={tankLanguage} decorative />}
              <span id="tank-language-selected">{language?.name ?? 'Choose a language'}{language?.experimental && language.available ? ' — experimental' : ''}</span>
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
                  <TankLanguageLogo language={entry.id} decorative />
                  <span>{entry.name}{entry.available ? (entry.experimental ? ' — experimental' : '') : ' — in development'}</span>
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>
      <p className="tank-language-help" id="tank-language-help">
        {languageLocked
          ? 'This tank’s language is permanent. Choose Start New Tank to use a different language.'
          : 'Choose a language before saving. Unsaved language drafts are preserved; the language becomes permanent when you save.'}
      </p>
      {tankLanguage === 'python' && (
        <p className="tank-language-notice" id="tank-python-notice" role="note">
          Your first Python run may take longer to start while its runtime loads.
          Later runs in this tab typically start faster.
        </p>
      )}
      <div id="tank-code" className="tank-code-editor">
        {language ? <Suspense fallback={
          <div style={{ height: editorHeight, display: 'grid', placeItems: 'center', color: 'var(--paper)' }}>
            Loading editor…
          </div>
        }>
          <Editor
            height={editorHeight}
            language={tankLanguage}
            path={tankLanguage === 'java' ? 'MyTank.java' : 'tank.' + language.extension}
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
        </Suspense> : (
          <div className="tank-code-placeholder" style={{ height: editorHeight }}>
            Choose JavaScript, TypeScript or Python above to load its starter code.
          </div>
        )}
      </div>
      <input type="hidden" name="tank-code" value={tankCode} />
    </section>
  );
}

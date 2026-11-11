import { lazy, Suspense } from 'react';

const Editor = lazy(() => import('../editor/localMonacoEditor'));
const editorHeight = '24rem';

export function TankCodeEditor({ tankCode, onEditorMount, onTankCodeChange }) {
  return (
    <section className="tank-code-panel" aria-labelledby="editor-heading">
      <h3 id="editor-heading">Tank code editor</h3>
      <p>Write the JavaScript that will control your tank.</p>
      <div id="tank-code" className="tank-code-editor">
        <Suspense fallback={
          <div style={{ height: editorHeight, display: 'grid', placeItems: 'center', color: 'var(--paper)' }}>
            Loading editor…
          </div>
        }>
          <Editor
            height={editorHeight}
            defaultLanguage="javascript"
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

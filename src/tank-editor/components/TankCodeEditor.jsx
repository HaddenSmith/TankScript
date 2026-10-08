import Editor from '@monaco-editor/react';

export function TankCodeEditor({ tankCode, isEditing, onEditorMount, onTankCodeChange }) {
  return (
    <section className="tank-code-panel" aria-labelledby="editor-heading">
      <h3 id="editor-heading">Tank code editor</h3>
      <p>Write the JavaScript that will control your tank.</p>
      <div id="tank-code" className="tank-code-editor">
        <Editor
          height="24rem"
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
      </div>
      <input type="hidden" name="tank-code" value={tankCode} />
      <button className="btn btn-primary tank-save-button" type="submit">
        {isEditing ? 'Update Tank' : 'Save New Tank'}
      </button>
    </section>
  );
}

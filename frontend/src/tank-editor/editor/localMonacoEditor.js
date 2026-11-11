import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker.js?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker.js?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker';
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker.js?worker';

globalThis.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    switch (label) {
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker();
      case 'json':
        return new JsonWorker();
      case 'javascript':
      case 'typescript':
        return new TypeScriptWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });

export default Editor;

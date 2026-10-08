import { useEffect, useRef, useState } from 'react';
import './tank-editor.css';
import { registerTankScriptDefinitions } from './editor/tankScriptMonaco';
import starterTankCode from './editor/starterTankScriptCode.js?raw';
import { deleteTank, loadTanks, saveTank, updateTank } from './tankStorage';
import { StatusMessage } from '../components/status-message';
import { TankConfiguration } from './components/TankConfiguration';
import { TankCodeEditor } from './components/TankCodeEditor';
import { TankScriptReference } from './components/TankScriptReference';

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

  function handleEditorMount(editor, monaco) {
    registerTankScriptDefinitions(monaco);
    editorRef.current = editor;
    monacoRef.current = monaco;
  }

  function handleDeleteTank() {
    if (!selectedTank) {
      setMessage({ type: 'danger', text: 'Select a saved tank before deleting.' });
      return;
    }

    if (!window.confirm(`Delete "${selectedTank.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      setSavedTanks(deleteTank(username, selectedTankId));
      setSelectedTankId('');
      setTankName('');
      setTankCode(starterTankCode);
      setMessage({ type: 'success', text: `${selectedTank.name} was deleted.` });
    } catch (error) {
      setMessage({
        type: 'danger',
        text: `Could not delete tank: ${error.message}`,
      });
    }
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
        <TankConfiguration
          tankName={tankName}
          selectedTank={selectedTank}
          selectedTankId={selectedTankId}
          savedTanks={savedTanks}
          onTankNameChange={setTankName}
          onTankSelection={handleTankSelection}
          onNewTank={handleNewTank}
          onDeleteTank={handleDeleteTank}
        />

        <div className="tank-workspace">
          <TankCodeEditor
            tankCode={tankCode}
            isEditing={Boolean(selectedTankId)}
            onEditorMount={handleEditorMount}
            onTankCodeChange={(value) => setTankCode(value ?? '')}
          />
          <TankScriptReference />
        </div>
      </form>

    </main>
  );
}
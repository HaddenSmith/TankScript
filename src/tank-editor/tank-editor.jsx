import { useEffect, useRef, useState } from 'react';
import './tank-editor.css';
import { registerTankScriptDefinitions } from './editor/tankScriptMonaco';
import starterTankCode from './editor/starterTankScriptCode.js?raw';
import {
  createTank,
  deleteTank,
  generateTankNames,
  getTanks,
  updateTank,
} from '../services/api';
import { StatusMessage } from '../components/status-message';
import { TankConfiguration } from './components/TankConfiguration';
import { TankCodeEditor } from './components/TankCodeEditor';
import { TankScriptReference } from './components/TankScriptReference';
import { DEFAULT_TANK_COLOR } from '../game/tankColors';

export function TankEditor({ username }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const [tankName, setTankName] = useState('');
  const [tankColor, setTankColor] = useState(DEFAULT_TANK_COLOR);
  const [tankCode, setTankCode] = useState(starterTankCode);
  const [savedTanks, setSavedTanks] = useState([]);
  const [selectedTankId, setSelectedTankId] = useState('');
  const [message, setMessage] = useState(null);
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [tankNameSuggestions, setTankNameSuggestions] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const selectedTank = savedTanks.find((tank) => tank.id === selectedTankId);

  useEffect(() => {
    let active = true;
    setSavedTanks([]);

    getTanks().then((result) => {
      if (!active) return;

      if (!result.ok) {
        setMessage({
          type: 'danger',
          text: result.error,
        });
        return;
      }

      setSavedTanks(result.data);
    });

    return () => {
      active = false;
    };
  }, [username]);

  function handleTankSelection(e) {
    const tankId = e.target.value;
    setSelectedTankId(tankId);

    const selectedTank = savedTanks.find((tank) => tank.id === tankId);
    if (selectedTank) {
      setTankName(selectedTank.name);
      setTankColor(selectedTank.color);
      setTankCode(selectedTank.code);
      setMessage(null);
    } else {
      handleNewTank();
    }
  }

  function handleNewTank() {
    setSelectedTankId('');
    setTankName('');
    setTankColor(DEFAULT_TANK_COLOR);
    setTankCode(starterTankCode);
    setMessage(null);
  }

  function handleEditorMount(editor, monaco) {
    registerTankScriptDefinitions(monaco);
    editorRef.current = editor;
    monacoRef.current = monaco;
  }

  function handleSuggestName() {
    if (isGeneratingName) return;

    setIsGeneratingName(true);
    setTankNameSuggestions([]);
    setMessage(null);
    generateTankNames().then((result) => {
      setIsGeneratingName(false);

      if (!result.ok) {
        setMessage({
          type: 'danger',
          text: result.error,
        });
        return;
      }

      setTankNameSuggestions(result.data.names);
    });
  }

  function handleDeleteTank() {
    if (!selectedTank) {
      setMessage({ type: 'danger', text: 'Select a saved tank before deleting.' });
      return;
    }

    if (!window.confirm(`Delete "${selectedTank.name}"? This cannot be undone.`)) {
      return;
    }

    deleteTank(selectedTankId).then((result) => {
      if (!result.ok) {
        setMessage({
          type: 'danger',
          text: result.error,
        });
        return;
      }

      setSavedTanks((currentTanks) => currentTanks.filter((tank) => tank.id !== selectedTankId));
      setSelectedTankId('');
      setTankName('');
      setTankColor(DEFAULT_TANK_COLOR);
      setTankCode(starterTankCode);
      setMessage({ type: 'success', text: `${selectedTank.name} was deleted.` });
    });
  }

  function handleSave(e) {
    e.preventDefault();

    const trimmedName = tankName.trim();
    if (!trimmedName) {
      setMessage({ type: 'danger', text: 'Please enter a tank name before saving.' });
      return;
    }

    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);

    const model = editorRef.current?.getModel();
    const syntaxCheck = model && monacoRef.current
      ? monacoRef.current.languages.typescript.getJavaScriptWorker()
        .then((getWorker) => getWorker(model.uri))
        .then((worker) => worker.getSyntacticDiagnostics(model.uri.toString()))
        .then((diagnostics) => diagnostics.filter((diagnostic) => diagnostic.category === 1).length)
        .catch((error) => {
          console.error('Could not check TankScript syntax with Monaco:', error);
          return null;
        })
      : Promise.resolve(null);

    syntaxCheck.then((syntaxErrorCount) => {
      const tank = {
        name: trimmedName,
        code: tankCode,
        color: tankColor,
      };
      const saveRequest = selectedTankId
        ? updateTank(selectedTankId, tank)
        : createTank(tank);

      saveRequest.then((result) => {
        isSavingRef.current = false;
        setIsSaving(false);

        if (!result.ok) {
          setMessage({
            type: 'danger',
            text: result.error,
          });
          return;
        }

        const saveAction = selectedTankId ? 'updated' : 'saved';
        if (selectedTankId) {
          setSavedTanks((currentTanks) => currentTanks.map((savedTank) => (
            savedTank.id === result.data.id ? result.data : savedTank
          )));
        } else {
          setSavedTanks((currentTanks) => [...currentTanks, result.data]);
          setSelectedTankId(result.data.id);
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
      });
    });
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
          tankColor={tankColor}
          selectedTank={selectedTank}
          selectedTankId={selectedTankId}
          isEditing={Boolean(selectedTankId)}
          savedTanks={savedTanks}
          onTankNameChange={setTankName}
          onTankColorChange={setTankColor}
          onTankSelection={handleTankSelection}
          isGeneratingName={isGeneratingName}
          tankNameSuggestions={tankNameSuggestions}
          onSuggestName={handleSuggestName}
          onTankNameSuggestionSelect={setTankName}
          onNewTank={handleNewTank}
          onDeleteTank={handleDeleteTank}
          isSaving={isSaving}
        />

        <div className="tank-workspace">
          <TankCodeEditor
            tankCode={tankCode}
            onEditorMount={handleEditorMount}
            onTankCodeChange={(value) => setTankCode(value ?? '')}
          />
          <TankScriptReference />
        </div>
      </form>

    </main>
  );
}
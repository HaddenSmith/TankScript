import { TANK_COLORS } from '../../game/tankColors';

export function TankConfiguration({
  tankName,
  tankColor,
  selectedTank,
  selectedTankId,
  isEditing,
  savedTanks,
  onTankNameChange,
  onTankColorChange,
  onTankSelection,
  isGeneratingName,
  tankNameSuggestions,
  onSuggestName,
  onTankNameSuggestionSelect,
  onNewTank,
  onDeleteTank,
}) {
  return (
    <section className="tank-config" aria-labelledby="tank-information-heading">
      <h2 id="tank-information-heading">Tank Configuration</h2>
      <p
        className={`tank-edit-mode${selectedTank ? ' is-editing' : ''}`}
        aria-live="polite"
        role="status"
      >
        {selectedTank
          ? `Editing: ${selectedTank.name}`
          : 'Creating New Tank'}
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
              onChange={(e) => onTankNameChange(e.target.value)}
            />
            <button
              className="btn btn-secondary"
              type="button"
              onClick={onSuggestName}
              disabled={isGeneratingName}
              aria-busy={isGeneratingName}
            >
              {isGeneratingName ? 'Suggesting...' : 'Suggest Names'}
            </button>
          </div>
          {isGeneratingName && (
            <p className="tank-name-suggestions-status" role="status" aria-live="polite">
              Generating name suggestions...
            </p>
          )}
          {tankNameSuggestions.length > 0 && (
            <div className="tank-name-suggestions" role="group" aria-labelledby="tank-name-suggestions-label">
              <p className="tank-name-suggestions-label" id="tank-name-suggestions-label">
                Tank name suggestions
              </p>
              <div className="tank-name-suggestion-list">
                {tankNameSuggestions.map((name) => (
                  <button
                    className="btn btn-outline-primary tank-name-suggestion"
                    key={name}
                    type="button"
                    onClick={() => onTankNameSuggestionSelect(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label htmlFor="tank-color">Tank color</label>
          <select
            className="form-select"
            id="tank-color"
            name="tank-color"
            value={tankColor}
            onChange={(event) => onTankColorChange(event.target.value)}
          >
            {TANK_COLORS.map((color) => (
              <option key={color.value} value={color.value}>{color.label}</option>
            ))}
          </select>
        </div>
        <div className="tank-selection-controls">
          <label htmlFor="saved-tank">Edit a saved tank</label>
          <div className="tank-selection-row">
            <select
              className="form-select"
              id="saved-tank"
              value={selectedTankId}
              onChange={onTankSelection}
            >
              {savedTanks.length === 0 ? (
                <option value="" disabled>No saved tanks</option>
              ) : (
                <>
                  <option value="">Choose a tank to edit</option>
                  {savedTanks.map((tank) => (
                    <option key={tank.id} value={tank.id}>{tank.name}</option>
                  ))}
                </>
              )}
            </select>
          </div>
          <div className="tank-config-actions">
            <button className="btn btn-primary tank-save-button" type="submit">
              {isEditing ? 'Update Tank' : 'Save New Tank'}
            </button>
            <div className="tank-selection-actions">
              <button className="btn btn-secondary" type="button" onClick={onNewTank}>
                Start New Tank
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={onDeleteTank}
                disabled={!selectedTankId}
              >
                Delete Tank
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

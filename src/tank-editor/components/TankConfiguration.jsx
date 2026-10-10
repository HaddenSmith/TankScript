export function TankConfiguration({
  tankName,
  selectedTank,
  selectedTankId,
  savedTanks,
  onTankNameChange,
  onTankSelection,
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
            <button className="btn btn-secondary" type="button">
              Suggest Name
            </button>
          </div>
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

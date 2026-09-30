import React from 'react';

export function Battle() {
  return (
    <main className="battle-page">
      <h1>Battle Arena</h1>

      <section className="battle-setup" aria-labelledby="setup-heading">
        <p className="battle-label">BATTLE CONTROL</p>
        <h2 id="setup-heading">Battle Setup</h2>
        <form action="#" method="get">
          <fieldset>
            {/*Future Database data will populate these tank selections.*/}
            <div className="battle-select-grid">
              <div className="battle-field mb-3">
                <label for="player-tank">Your Tank</label>
                <select className="form-select" id="player-tank" name="player-tank">
                  <option value="">[select one of your saved tanks]</option>
                </select>
              </div>
              <div className="battle-field mb-3">
                <label for="opponent-tank">Opponent</label>
                <select className="form-select" id="opponent-tank" name="opponent-tank">
                  <option value="">[select an opponent tank]</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" type="submit">Start Battle</button>
          </fieldset>
        </form>
      </section>

      <div className="battle-arena-layout">
        <section className="battle-arena-panel" aria-labelledby="arena-heading">
          <p className="battle-label">LIVE SIMULATION</p>
          <h2 id="arena-heading">Battle Arena</h2>
          <div className="battle-arena" role="img" aria-label="Placeholder for a 12 by 12 tank battle arena">
          </div>
        </section>

        <aside className="battle-info-panel" aria-labelledby="info-heading">
          <p className="battle-label">PARTICIPANT DATA</p>
          <h2 id="info-heading">Battle Info</h2>
          <section className="battle-participant" aria-labelledby="your-tank-heading">
            <h3 id="your-tank-heading">Your Tank</h3>
            <dl>
              <dt>Name</dt><dd>[tank name]</dd>
              <dt>Health</dt><dd>[health]</dd>
              <dt>Position</dt><dd>[x, y]</dd>
              <dt>Direction</dt><dd>[direction]</dd>
            </dl>
          </section>
          <section className="battle-participant" aria-labelledby="opponent-heading">
            <h3 id="opponent-heading">Opponent</h3>
            <dl>
              <dt>Name</dt><dd>[opponent name]</dd>
              <dt>Health</dt><dd>[health]</dd>
              <dt>Position</dt><dd>[x, y]</dd>
              <dt>Direction</dt><dd>[direction]</dd>
            </dl>
          </section>
        </aside>
      </div>

      <section className="battle-feed-panel" aria-labelledby="events-heading">
        <p className="battle-label">EVENT STREAM</p>
        <h2 id="events-heading">Live Battle Feed</h2>
        {/*Future WebSocket functionality will receive realtime server messages about movement, rotations, shots, hits, health changes, and battle completion.*/}
        <div id="realtime-battle-feed" aria-live="polite">
          <p>&gt; Tank Alpha moved right</p>
          <p>&gt; Tank Beta rotated left</p>
          <p>&gt; Tank Alpha fired</p>
          <p>&gt; Shot missed</p>
        </div>
      </section>

      <section className="battle-result-panel" aria-labelledby="results-heading">
        <p className="battle-label">OUTCOME</p>
        <h2 id="results-heading">Battle Result</h2>
        <dl className="battle-result-list">
          <dt>Winner</dt>
          <dd>[winner placeholder]</dd>
          <dt>Final status</dt>
          <dd>[battle status placeholder]</dd>
          <dt>Battle statistics</dt>
          <dd>[battle statistics placeholder]</dd>
        </dl>
      </section>

      <section className="battle-history-panel" aria-labelledby="history-heading">
        <h2 id="history-heading">Battle History</h2>
        {/*Future Database data will provide previous battles, wins, losses, and leaderboard information.*/}
        <table className="table table-striped table-hover battle-history-table">
          <caption>Previous battle records placeholder</caption>
          <thead>
            <tr>
              <th scope="col">Tank</th>
              <th scope="col">Wins</th>
              <th scope="col">Losses</th>
              <th scope="col">Recent result</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>[saved tank]</td>
              <td>[wins]</td>
              <td>[losses]</td>
              <td>[battle result]</td>
            </tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}
import React from 'react';
import { NavLink } from 'react-router-dom';

export function Home() {
  return (
    <main className="home-page">
      <section className="home-hero" aria-labelledby="welcome-heading">
        <h1 id="welcome-heading">
          Program Tanks
          <br />
          Battle Other Players
          <br />
          Improve Your Code
        </h1>

        <p className="home-tagline">
          Write JavaScript. Deploy your tank. See how your logic performs.
        </p>

        <div className="home-actions">
          <NavLink className="btn btn-primary" to="/login">
            Log In
          </NavLink>

          <NavLink className="btn btn-outline-primary" to="/register">
            Create Account
          </NavLink>
        </div>
      </section>

      <section className="home-preview" aria-labelledby="preview-heading">
        <div className="home-section-heading">
          <p className="home-label">CODE PREVIEW</p>
          <h2 id="preview-heading">Program your tank's next move.</h2>
        </div>

        <pre className="home-code-preview">
          <code>{`function decide(tank, arena) {
  if (tank.enemyInRange(arena)) {
    tank.aimAtEnemy();
    tank.fire();
  } else {
    tank.searchForTarget();
  }
}`}</code>
        </pre>
      </section>

      <section
        className="home-how-it-works"
        aria-labelledby="how-it-works-heading"
      >
        <div className="home-section-heading">
          <p className="home-label">THE LOOP</p>
          <h2 id="how-it-works-heading">How It Works</h2>
        </div>

        <div className="home-steps">
          <article className="home-step">
            <span className="home-step-number">01</span>
            <h3>Write Code</h3>
            <p>Build a JavaScript strategy for your tank.</p>
          </article>

          <article className="home-step">
            <span className="home-step-number">02</span>
            <h3>Enter Battle</h3>
            <p>Deploy your logic against another player.</p>
          </article>

          <article className="home-step">
            <span className="home-step-number">03</span>
            <h3>Improve Strategy</h3>
            <p>Study the result and make your next move smarter.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
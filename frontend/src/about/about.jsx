import React from 'react';

export function About() {
  return (
    <main className="about-page">
      <p className="about-label">ABOUT / PROJECT OVERVIEW</p>
      <h1>About TankScript</h1>
      <section aria-labelledby="what-heading">
        <h2 id="what-heading">What is TankScript?</h2>
        <p>TankScript is a programming game where your code drives the tank. Write a strategy in JavaScript, TypeScript, or Python, then watch it move, rotate, and shoot in a 2D arena.</p>
        <p>Build your own tank, try the five official opponents, or challenge tanks shared by the community. Each battle is a chance to spot a clever move, find a bug, and improve your next strategy.</p>
      </section>

      <p className="about-process">PROGRAM ⇒ BATTLE ⇒ ANALYZE ⇒ IMPROVE</p>

      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading">How to play</h2>
        <ol>
          <li>Create a tank and give it a name.</li>
          <li>Write a strategy in the Tank Editor, with syntax highlighting, autocomplete, and an API Reference.</li>
          <li>Use the Debugger to arrange a static scenario and see which command your code chooses.</li>
          <li>Save your tank, choose opponents and battle settings, then watch the match and refine your code.</li>
        </ol>
      </section>

      <section aria-labelledby="rules-heading">
        <h2 id="rules-heading">Battle concepts</h2>
        <ul>
          <li>Battles advance in game ticks. Every tank reads the same arena state, chooses its first action, and acts simultaneously.</li>
          <li>Optional destructible walls provide cover and block movement and bullets until destroyed.</li>
          <li>Optional hearts restore 1 health, up to a tank's maximum. Lightning doubles the speed of newly fired bullets for 50 game ticks.</li>
          <li>Choose the arena size, starting health, battle speed, walls, and power-ups. Pause, resume, or reset a match while testing.</li>
          <li>A battle ends with a surviving tank, a tick limit, or a stalemate. Results show a winner or a tie.</li>
        </ul>
      </section>

      <section aria-labelledby="learning-heading">
        <h2 id="learning-heading">Learn by programming</h2>
        <p>TankScript makes programming decisions visible and competitive. Players practice logic, iteration, and problem solving by writing strategies that respond to an opponent and the arena.</p>
        <p>It began as a BYU CS 260 startup project and continues as my personal hobby project. The goal is still simple: make learning to code something you can play with.</p>
        <p className="about-attribution">
          Tank name suggestions are powered by the CueName Fantasy Name Generator API.{' '}
          <a href="https://cuename.com/" target="_blank" rel="noreferrer">CueName</a>
        </p>
      </section>

    </main>
  );
}

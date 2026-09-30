import React from 'react';

export function About() {
  return (
    <main className="about-page">
      <p className="about-label">ABOUT / PROJECT OVERVIEW</p>
      <h1>About TankScript</h1>
      <section aria-labelledby="what-heading">
        <h2 id="what-heading">What is TankScript?</h2>
        <p>TankScript is a programming game about designing an algorithm that controls a tank. Players do not manually drive their tanks during a match. Instead, their JavaScript behavior makes decisions for them.</p>
        <p>Each tank can move, rotate, aim, and shoot in an automatic 2D arena against a tank created by another user.</p>
      </section>

      <p className="about-process">PROGRAM ⇒ BATTLE ⇒ ANALYZE ⇒ IMPROVE</p>

      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading">How to play</h2>
        <ol>
          <li>Create a tank and give it a name.</li>
          <li>Write JavaScript behavior using the available tank commands.</li>
          <li>Save the tank and select an opponent.</li>
          <li>Watch the automated battle.</li>
        </ol>
      </section>

      <section aria-labelledby="rules-heading">
        <h2 id="rules-heading">Battle concepts</h2>
        <ul>
          <li>Movement, rotation, aiming, and shooting are determined by each tank's program.</li>
          <li>A match ends when one tank is defeated or the time limit is reached.</li>
          <li>Players can study results and improve their algorithms between matches.</li>
        </ul>
      </section>

      <section aria-labelledby="learning-heading">
        <h2 id="learning-heading">Learn by programming</h2>
        <p>TankScript makes programming decisions visible and competitive. Players practice JavaScript logic, iteration, and problem solving by writing strategies that respond to an opponent and the arena.</p>
      </section>

    </main>
  );
}
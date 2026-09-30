import React from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './app.css';

export default function App() {
  return (
    <div className="body">
      <header>
        <div className="site-brand">
          <a href="home.html">
            <strong>TankScript</strong>
          </a>
          <span className="current-user">PLAYER: [username]</span>
        </div>

        <nav aria-label="Main navigation">
          <ul>
            <li>
              <a href="home.html">Home</a>
            </li>
            <li>
              <a href="login.html">Login</a>
            </li>
            <li>
              <a href="tank-editor.html">Tank Editor</a>
            </li>
            <li>
              <a href="battle.html">Battle</a>
            </li>
            <li>
              <a href="about.html">About</a>
            </li>
          </ul>
        </nav>
      </header>

      <main>
        <div>App components go here</div>
      </main>

      <footer className="site-footer">
        <div className="footer-content">
          <div className="footer-credit">
            <img src="/hs-logo.png" alt="HS logo" />
            <p>TankScript created by Hadden Smith.</p>
          </div>

          <a
            className="footer-repository"
            href="https://github.com/HaddenSmith/TankScript"
          >
            TankScript GitHub repository
          </a>
        </div>
      </footer>
    </div>
  );
}
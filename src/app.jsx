import React from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './app.css';

import { BrowserRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

import { Home } from './home/home';
import { Login } from './login/login';
import { Register } from './register/register';
import { TankEditor } from './tank-editor/tank-editor';
import { Battle } from './battle/battle';
import { About } from './about/about';

export default function App() {
  const [username, setUsername] = useState(
    () => window.localStorage.getItem('username') ?? 'null',
  );

  return (
    <BrowserRouter>
      <div className="body">
        <header>
          <div className="site-brand">
            <NavLink to="/">
              <strong>TankScript</strong>
            </NavLink>
            <span className="current-user">PLAYER: {username}</span>
          </div>

          <nav aria-label="Main navigation">
            <ul>
              <li>
                <NavLink to="/">Home</NavLink>
              </li>
              <li>
                <NavLink to="/login">Login</NavLink>
              </li>
              <li>
                <NavLink to="/tank-editor">Tank Editor</NavLink>
              </li>
              <li>
                <NavLink to="/battle">Battle</NavLink>
              </li>
              <li>
                <NavLink to="/about">About</NavLink>
              </li>
            </ul>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login onLogin={setUsername} />} />
          <Route path="/register" element={<Register />} />
          <Route path="/tank-editor" element={<TankEditor />} />
          <Route path="/battle" element={<Battle />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>

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
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.605-2.665-.3-5.466-1.334-5.466-5.93 0-1.31.468-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.435.375.81 1.096.81 2.22v3.285c0 .315.21.69.825.57A12.003 12.003 0 0 0 12 .297z"
                />
              </svg>
            </a>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}

function NotFound() {
  const navigate = useNavigate();

  useEffect(() => {
    const redirectTimer = window.setTimeout(() => navigate('/'), 3000); //Change '/' to -1 if you want to go back to the previous page instead of home.
    return () => window.clearTimeout(redirectTimer);
  }, [navigate]);

  return (
    <main>
      <div>404: Page not found. Returning home in 3 seconds.</div>
    </main>
  );
}
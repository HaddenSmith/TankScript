import React from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import './app.css';

import { BrowserRouter, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

import { Home } from './home/home';
import { Login } from './login/login';
import { Register } from './register/register';
import { TankEditor } from './tank-editor/tank-editor';
import { Battle } from './battle/battle';
import { About } from './about/about';

export default function App() {
  return (
    <BrowserRouter>
      <div className="body">
        <header>
          <div className="site-brand">
            <NavLink to="/">
              <strong>TankScript</strong>
            </NavLink>
            <span className="current-user">PLAYER: [username]</span>
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
          <Route path="/login" element={<Login />} />
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
    const redirectTimer = window.setTimeout(() => navigate('/'), 3000);
    return () => window.clearTimeout(redirectTimer);
  }, [navigate]);

  return (
    <main>
      <div>404: Page not found. Returning home in 3 seconds.</div>
    </main>
  );
}
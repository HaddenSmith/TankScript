import React from 'react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ScrambleText } from '../components/ScrambleText';
import { login } from '../services/api';

export function Login({ onLogin }) {
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const loginIdentifier = formData.get('username');
    const password = formData.get('password');

    if (typeof loginIdentifier !== 'string' || !loginIdentifier.trim() || !password) {
      setMessage({ type: 'danger', text: 'Please enter a username or email and password.' });
      return;
    }

    login(loginIdentifier.trim(), password)
      .then((response) => {
        if (response.ok) {
          setMessage({
            type: 'success',
            text: 'Login successful! Redirecting...',
          });

          onLogin(response.data.username);
          window.setTimeout(() => navigate('/tank-editor'), 2000);
        } else {
          setMessage({
            type: 'danger',
            text: response.data.msg,
          });
        }
      })
      .catch(() => {
        setMessage({
          type: 'danger',
          text: 'Unable to connect to the server.',
        });
      });
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <p className="login-label">
          <ScrambleText text="PLAYER AUTHENTICATION" />
        </p>
        <h1 id="login-heading">Log in to TankScript</h1>
        <p className="login-intro">Continue building strategies and reviewing your battle results.</p>
        <form noValidate onSubmit={handleSubmit} >
          {message && (
            <div className={`alert alert-${message.type}`} role="alert" aria-live="polite">
              {message.text}
            </div>
          )}
          <div className="login-field mb-3">
            <label htmlFor="username">Username or email</label>
            <input
              className="form-control"
              type="text"
              id="username"
              name="username"
              autoComplete="username"
              onChange={() => setMessage(null)}
              required
            />
          </div>
          <div className="login-field mb-3">
            <label htmlFor="password">Password</label>
            <input
              className="form-control"
              type="password"
              id="password"
              name="password"
              autoComplete="current-password"
              onChange={() => setMessage(null)}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit">Log in</button>
        </form>

        <section id="register" aria-labelledby="register-heading">
          <h2 id="register-heading">New to TankScript?</h2>
          <p>
            <NavLink to="/register">Create a new account</NavLink> to save tanks and track battle results.
          </p>
        </section>
      </section>

    </main>
  );
}
import React from 'react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

export function Login({ onLogin }) {
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const username = formData.get('username');
    const password = formData.get('password'); //Use later when we impliment authentication and database registration. For now, we just need to check that the user entered a password.

    if (typeof username !== 'string' || !username.trim() || !password) {
      setMessage({ type: 'danger', text: 'Please enter a username and password.' });
      return;
    }

    const trimmedUsername = username.trim();
    window.localStorage.setItem('username', trimmedUsername);
    onLogin(trimmedUsername);
    setMessage({ type: 'success', text: 'Login successful! Redirecting...' });
    window.setTimeout(() => navigate('/tank-editor'), 2000);
  }

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <p className="login-label">RETURNING PLAYER</p>
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
          {/*Future Authentication and database registration form will go here.*/}
        </section>
      </section>

    </main>
  );
}
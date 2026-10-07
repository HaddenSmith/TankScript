import React from 'react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

export function Register() {
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const username = formData.get('username');  //This value will be sent to the database when account creation is implemented.
    const email = formData.get('email'); //This value will be sent to the database when account creation is implemented.
    const password = formData.get('password'); //This value will be sent securely to the backend when account creation is implemented.
    const confirmPassword = formData.get('confirm-password');

    if (typeof username !== 'string' || !username.trim() ||
        typeof email !== 'string' || !email.trim() ||
        typeof password !== 'string' || !password ||
        typeof confirmPassword !== 'string' || !confirmPassword) {
          setMessage({ type: 'danger', text: 'Please fill out all fields.' });
          return;
    }

    if (password !== confirmPassword) {
      setMessage({ type: 'danger', text: 'Passwords do not match.' });
      return;
    }

    setMessage({ type: 'success', text: 'Registration successful! Redirecting to login...' });
    window.setTimeout(() => navigate('/login'), 2000);
  }

  return (
    <main className="register-page">
      <section className="register-panel" aria-labelledby="register-heading">
        <p className="register-label">NEW PLAYER SETUP</p>
        <h1 id="register-heading">Create your TankScript account</h1>
        <p className="register-intro">Set up your account and start building strategies for the arena.</p>

        <form noValidate onSubmit={handleSubmit}>
          {message && (
            <div className={`alert alert-${message.type}`} role="alert" aria-live="polite">
              {message.text}
            </div>
          )}
          <div className="register-field">
            <label htmlFor="username">Username</label>
            <input className="form-control" type="text" id="username" name="username" autoComplete="username" onChange={() => setMessage(null)} required />
          </div>
          <div className="register-field">
            <label htmlFor="email">Email</label>
            <input className="form-control" type="email" id="email" name="email" autoComplete="email" onChange={() => setMessage(null)} required />
          </div>
          <div className="register-field">
            <label htmlFor="password">Password</label>
            <input className="form-control" type="password" id="password" name="password" autoComplete="new-password" onChange={() => setMessage(null)} required />
          </div>
          <div className="register-field">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input className="form-control" type="password" id="confirm-password" name="confirm-password" autoComplete="new-password" onChange={() => setMessage(null)} required />
          </div>
          <button className="btn btn-primary register-submit" type="submit">Create Account</button>
        </form>

      <p className="register-login">
        Already have an account? <NavLink to="/login">Log in</NavLink>
      </p>
      </section>
    </main>
  );
}
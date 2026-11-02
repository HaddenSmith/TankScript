import React from 'react';
import { useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ScrambleText } from '../components/ScrambleText';
import { createAccount } from '../services/api';

export function Register({ onUsernameChange }) {
  const [message, setMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const navigate = useNavigate();

  function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email');
    const username = formData.get('username');
    const password = formData.get('password');
    const confirmPassword = formData.get('confirm-password');

    if (typeof email !== 'string' || !email.trim() ||
        typeof username !== 'string' || !username.trim() ||
        typeof password !== 'string' || !password ||
        typeof confirmPassword !== 'string' || !confirmPassword) {
      setMessage({ type: 'danger', text: 'Please fill out all fields.' });
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    if (trimmedUsername.length < 3 || trimmedUsername.length > 24) {
      setMessage({ type: 'danger', text: 'Username must be between 3 and 24 characters.' });
      return;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(trimmedUsername)) {
      setMessage({ type: 'danger', text: 'Username may only contain letters, numbers, underscores, and hyphens.' });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setMessage({ type: 'danger', text: 'Please enter a valid email address.' });
      return;
    }

    if (password.length < 8) {
      setMessage({ type: 'danger', text: 'Password must be at least 8 characters.' });
      return;
    }

    if (password.length > 128) {
      setMessage({ type: 'danger', text: 'Password must be no more than 128 characters.' });
      return;
    }

    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setMessage({ type: 'danger', text: 'Password must contain at least one letter and one number.' });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ type: 'danger', text: 'Passwords do not match.' });
      return;
    }

    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    createAccount(trimmedEmail, trimmedUsername, password)
      .then((result) => {
        if (!result.ok) {
          isSubmittingRef.current = false;
          setIsSubmitting(false);
          setMessage({
            type: 'danger',
            text: result.error,
          });
          return;
        }

        setMessage({
          type: 'success',
          text: 'Registration successful!',
        });

        onUsernameChange(result.data.username);
        window.setTimeout(() => navigate('/tank-editor'), 2000);
      });
  }

  return (
    <main className="register-page">
      <section className="register-panel" aria-labelledby="register-heading">
        <p className="register-label">
          <ScrambleText text="INITIALIZE PLAYER" />
        </p>
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
          <button className="btn btn-primary register-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

      <p className="register-login">
        Already have an account? <NavLink to="/login">Log in</NavLink>
      </p>
      </section>
    </main>
  );
}
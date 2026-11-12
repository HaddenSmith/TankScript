import React from 'react';
import { useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { ScrambleText } from '../components/ScrambleText';
import { createAccount } from '../services/api';

function checkPassword(password) {
  return {
    longEnough: password.length >= 8,
    withinLimit: password.length <= 128,
    hasLetter: /[A-Za-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };
}

export function Register({ onUsernameChange }) {
  const [message, setMessage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const isSubmittingRef = useRef(false);
  const navigate = useNavigate();

  const { longEnough, hasLetter, hasNumber } = checkPassword(password);
  const passwordRequirements = [
    { text: 'At least 8 characters', met: longEnough },
    { text: 'At least 1 letter (A–Z, a–z)', met: hasLetter },
    { text: 'At least one number (0–9)', met: hasNumber },
  ];

  const passwordsMatch = password !== '' && password === confirmPassword;
  let confirmationIcon = '○';
  let confirmationText = 'Re-enter your password';
  if (passwordsMatch) {
    confirmationIcon = '✓';
    confirmationText = 'Passwords match';
  } else if (confirmPassword) {
    confirmationIcon = '×';
    confirmationText = 'Passwords do not match';
  }

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

    const { longEnough, withinLimit, hasLetter, hasNumber } = checkPassword(password);
    if (!longEnough) {
      setMessage({ type: 'danger', text: 'Password must be at least 8 characters.' });
      return;
    }

    if (!withinLimit) {
      setMessage({ type: 'danger', text: 'Password must be no more than 128 characters.' });
      return;
    }

    if (!hasLetter || !hasNumber) {
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
          <div className="mb-3">
            <p id="password-requirements-heading" className="small fw-semibold mb-1">Password requirements</p>
            <ul
              id="password-requirements"
              className="form-text list-unstyled m-0"
              role="list"
              aria-labelledby="password-requirements-heading"
              aria-live="polite"
            >
              {passwordRequirements.map(({ text, met }) => (
                <li className="d-flex gap-2" key={text} aria-atomic="true">
                  <span className={met ? 'text-success' : undefined} aria-hidden="true">{met ? '✓' : '○'}</span>
                  <span>{text}<span className="visually-hidden">{met ? ', met' : ', incomplete'}</span></span>
                </li>
              ))}
            </ul>
          </div>
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
            <input
              className="form-control"
              type="password"
              id="password"
              name="password"
              autoComplete="new-password"
              aria-describedby="password-requirements"
              onChange={(event) => {
                setPassword(event.target.value);
                setMessage(null);
              }}
              required
            />
          </div>
          <div className="register-field">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              className="form-control"
              type="password"
              id="confirm-password"
              name="confirm-password"
              autoComplete="new-password"
              aria-describedby="password-confirmation"
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setMessage(null);
              }}
              required
            />
            <p id="password-confirmation" className="form-text d-flex gap-2 mb-0" role="status">
              <span className={passwordsMatch ? 'text-success' : undefined} aria-hidden="true">{confirmationIcon}</span>
              <span>{confirmationText}</span>
            </p>
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

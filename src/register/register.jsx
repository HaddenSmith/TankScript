import React from 'react';
import { NavLink } from 'react-router-dom';

export function Register() {
  return (
    <main className="register-page">
      <section className="register-panel" aria-labelledby="register-heading">
        <p className="register-label">NEW PLAYER SETUP</p>
        <h1 id="register-heading">Create your TankScript account</h1>
        <p className="register-intro">Set up your account and start building strategies for the arena.</p>

        <form action="#" method="post">
          <div className="register-field">
            <label for="username">Username</label>
            <input className="form-control" type="text" id="username" name="username" autocomplete="username" required />
          </div>
          <div className="register-field">
            <label for="email">Email</label>
            <input className="form-control" type="email" id="email" name="email" autocomplete="email" required />
          </div>
          <div className="register-field">
            <label for="password">Password</label>
            <input className="form-control" type="password" id="password" name="password" autocomplete="new-password" required />
          </div>
          <div className="register-field">
            <label for="confirm-password">Confirm Password</label>
            <input className="form-control" type="password" id="confirm-password" name="confirm-password" autocomplete="new-password" required />
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
import React from 'react';
import { NavLink } from 'react-router-dom';

export function Login() {
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <p className="login-label">RETURNING PLAYER</p>
        <h1 id="login-heading">Log in to TankScript</h1>
        <p className="login-intro">Continue building strategies and reviewing your battle results.</p>
        {/*Future Authentication service will validate these credentials.*/}
        <form action="#" method="post">
          <div className="login-field mb-3">
            <label htmlFor="username">Username or email</label>
            <input className="form-control" type="text" id="username" name="username" autoComplete="username" required />
          </div>
          <div className="login-field mb-3">
            <label htmlFor="password">Password</label>
            <input className="form-control" type="password" id="password" name="password" autoComplete="current-password" required />
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
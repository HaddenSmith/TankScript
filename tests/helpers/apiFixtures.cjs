const { randomUUID } = require('node:crypto');

function createAccountDetails() {
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  return {
    email: `pilot-${id}@example.test`,
    username: `Pilot_${id}`,
    password: 'securepass123',
  };
}

function getAuthCookie(response) {
  return response.headers['set-cookie'][0].split(';', 1)[0];
}

module.exports = { createAccountDetails, getAuthCookie };

function handleResponse(response) {
    if (response.status === 204) {
        return {
            ok: response.ok,
            status: response.status,
            data: null,
            error: null,
        };
    }

    return response.json()
        .then((data) => ({
            ok: response.ok,
            status: response.status,
            data: response.ok ? data : null,
            error: response.ok ? null : data.msg || data.message || 'An unexpected error occurred.',
        }));
}

function handleNetworkError() {
    return {
        ok: false,
        status: 0,
        data: null,
        error: 'Unable to connect to the server.',
    };
}

export function createAccount(email, username, password) {
    return fetch('/api/auth/create', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email,
            username,
            password,
        }),
    })
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function login(loginIdentifier, password) {
    return fetch('/api/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            loginIdentifier,
            password,
        }),
    })
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function logout() {
    return fetch('/api/auth/logout', {
        method: 'DELETE',
    })
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function getCurrentUser() {
    return fetch('/api/auth/me')
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function getTanks() {
    return fetch('/api/tanks')
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function createTank(tank) {
    return fetch('/api/tanks', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tank }),
    })
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function updateTank(id, tank) {
    return fetch(`/api/tanks/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tank }),
    })
        .then(handleResponse)
        .catch(handleNetworkError);
}

export function deleteTank(id) {
    return fetch(`/api/tanks/${id}`, {
        method: 'DELETE',
    })
        .then(handleResponse)
        .catch(handleNetworkError);
}
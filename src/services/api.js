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
            error: response.ok ? null : data.msg,
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
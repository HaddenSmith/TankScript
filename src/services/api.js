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
            error: response.ok ? null : data?.msg || data?.message || 'An unexpected error occurred.',
        }))
        .catch(() => ({
            ok: false,
            status: response.status,
            data: null,
            error: 'The server returned an unreadable response.',
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

function cueNameFailure(status, error = 'Unable to generate tank names right now. Please try again.') {
    return {
        ok: false,
        status,
        data: null,
        error,
    };
}

function handleCueNameResponse(response) {
    return response.json()
        .then((data) => {
            if (!response.ok) {
                const apiError = typeof data?.error === 'string' ? data.error.trim() : '';
                return cueNameFailure(response.status, apiError || undefined);
            }

            if (!Array.isArray(data?.names)) {
                return cueNameFailure(response.status);
            }

            const names = [];
            const seenNames = new Set();
            for (const entry of data.names) {
                const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
                const nameKey = name.toLocaleLowerCase();
                if (name && !seenNames.has(nameKey)) {
                    names.push(name);
                    seenNames.add(nameKey);
                }
            }

            if (names.length === 0) {
                return cueNameFailure(response.status, 'CueName did not return any valid tank names. Please try again.');
            }

            return {
                ok: true,
                status: response.status,
                data: { names },
                error: null,
            };
        })
        .catch(() => cueNameFailure(response.status));
}

function handleCueNameNetworkError() {
    return {
        ok: false,
        status: 0,
        data: null,
        error: 'Unable to connect to CueName. Please try again.',
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

export function getAllTanks() {
    return fetch('/api/tanks/all')
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

export function generateTankNames() {
    return fetch('https://cuename.com/api/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            generatorId: 'tank-names',
            count: 5,
        }),
    })
        .then(handleCueNameResponse)
        .catch(handleCueNameNetworkError);
}
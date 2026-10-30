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
    }).then((response) => {
        return response.json().then((data) => ({
            ok: response.ok,
            status: response.status,
            data,
        }));
    });
}

export function login(username, password) {
    return fetch('/api/auth/login',{
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username,
            password,
        }),
    }).then((response) => {
        return response.json().then((data) => ({
            ok: response.ok,
            status: response.status,
            data,
        }));
    });
}

export function logout() {
    return fetch('/api/auth/logout', {
        method: 'DELETE',
    }).then((response) => ({
        ok: response.ok,
        status: response.status,
    }));
}
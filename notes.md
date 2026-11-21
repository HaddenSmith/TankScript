# CS 260 Notes

This file represents what I have learned about web programming.

- [My startup](https://startup.haddensmith.com)
- [My Simon](https://simon.haddensmith.com)
- I love web programming

## Helpful links

- [Course instruction](https://github.com/webprogramming260)
- [Canvas](https://byu.instructure.com)
- [MDN](https://developer.mozilla.org)
- [Markdown files](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)

## Tank Editor

- The static HTML/CSS version used a placeholder `<textarea>`; the React app now uses the installed Monaco Editor.
- JavaScript, TypeScript and Python are public, with separate language drafts, highlighting and TankScript API suggestions. Java is preserved but publicly disabled.
- Monaco uses TankScript's dark editor theme, line numbers, bracket matching and automatic indentation. TypeScript has compiler diagnostics; Python syntax/runtime errors are checked when it runs.

## AWS

Interesting things I have learned about AWS:

- AWS can host a web application on a virtual server using EC2.
- An Elastic IP gives an EC2 instance a stable public IP address.
- Route 53 can connect a domain name to an AWS server.
- Caddy can serve website files and automatically provide HTTPS.
- SSH is used to remotely connect to a server.
- Deployment scripts can copy local project files to a production server.

## HTML

Interesting things I have learned about HTML:

- HTML defines the structure and content of a webpage.
- HTML elements use opening and closing tags such as `<p></p>`.
- Attributes provide additional information about an element.

Example:

```html
<a href="https://example.com">Example</a>
```

- Common structural elements include:
  - `<header>`
  - `<nav>`
  - `<main>`
  - `<section>`
  - `<footer>`

- Classes can be reused by multiple elements:

```html
<p class="notice">Hello</p>
```

- IDs should normally identify one unique element:

```html
<h1 id="main-title">TankScript</h1>
```

- CSS files are normally connected in the `<head>`:

```html
<link rel="stylesheet" href="styles.css">
```

## CSS

CSS controls the appearance and layout of HTML.

A basic CSS rule looks like:

```css
selector {
  property: value;
}
```

Example:

```css
p {
  color: blue;
}
```

### Selectors

```css
p              /* element selector */
.notice        /* class selector */
#main          /* ID selector */
section p      /* descendant */
section > p    /* direct child */
div + p        /* adjacent sibling */
div ~ p        /* general sibling */
input[type]    /* attribute selector */
button:hover   /* pseudo-class */
```

Important selector symbols:

- `.` means class
- `#` means ID
- `>` means direct child
- `+` means immediately adjacent sibling
- `~` means later sibling
- `:hover` applies while the mouse is over an element

### Specificity

When multiple rules apply to the same element, more specific rules usually win.

General order from strongest to weakest:

1. Inline style
2. ID selector
3. Class, attribute, and pseudo-class selector
4. Element selector
5. Inherited style

### Box Model

Every HTML element is treated like a box.

From inside to outside:

1. Content
2. Padding
3. Border
4. Margin

- Padding is space inside the border.
- Margin is space outside the border.
- `box-sizing: border-box;` makes declared width and height include padding and border.

### Common properties

```css
color: red;
background-color: blue;
width: 200px;
height: 100px;
padding: 10px;
margin: 20px;
border: 1px solid black;
text-align: center;
font-size: 24px;
border-radius: 10px;
```

- `color` changes text color.
- `background-color` changes the background.
- `padding` creates space inside an element.
- `margin` creates space outside an element.
- `border-radius` rounds corners.
- In `border: 2px solid black`, `2px` is thickness, `solid` is style, and `black` is color.

### Units

Common CSS units include:

```css
px
%
em
rem
vw
vh
```

- `px` = pixels
- `%` = percentage of the parent
- `em` = relative to the current/inherited font size
- `rem` = relative to the root font size
- `vw` = percentage of viewport width
- `vh` = percentage of viewport height

Example:

```css
width: 50%;
```

means half the width of the parent.

```css
width: 50vw;
```

means half the width of the browser viewport.

### Colors

CSS colors can be represented in several ways:

```css
color: red;
color: #ff0000;
color: rgb(255, 0, 0);
color: hsl(0, 100%, 50%);
```

### Fonts

Fonts are selected using `font-family`.

```css
font-family: Arial, sans-serif;
```

The browser tries fonts from left to right.

Custom fonts can be imported using `@font-face` or external font providers.

Other useful font properties:

```css
font-size: 20px;
font-weight: 700;
font-style: italic;
```

### Animations

CSS animations use animation properties and keyframes.

```css
p {
  animation-name: grow;
  animation-duration: 3s;
}

@keyframes grow {
  from {
    font-size: 10px;
  }

  to {
    font-size: 30px;
  }
}
```

Useful property:

```css
animation-iteration-count: infinite;
```

This causes an animation to repeat forever.

### Responsive Design

Responsive design allows a webpage to adapt to different screen sizes and devices.

Common display values:

```css
display: block;
display: inline;
display: none;
display: flex;
display: grid;
```

- `block` usually fills the available width.
- `inline` takes only as much width as its content.
- `none` hides an element.
- `flex` uses Flexbox layout.
- `grid` uses Grid layout.

Include this in responsive HTML pages:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

### Media Queries

Media queries apply CSS only under certain screen conditions.

```css
@media (max-width: 600px) {
  nav {
    display: none;
  }
}
```

This hides the navigation when the viewport is 600px wide or smaller.

Example using orientation:

```css
@media (orientation: portrait) {
  main {
    flex-direction: column;
  }
}
```

### Flexbox

Flexbox is useful for arranging child elements primarily in one direction.

```css
.container {
  display: flex;
  flex-direction: row;
}
```

Common directions:

```css
flex-direction: row;
flex-direction: column;
```

- `row` = side by side
- `column` = stacked vertically

Space can be divided using `flex`:

```css
.left {
  flex: 1;
}

.right {
  flex: 3;
}
```

This gives the left area one part and the right area three parts.

Other useful properties:

```css
justify-content: center;
align-items: center;
```

For a row layout:

- `justify-content` controls horizontal alignment.
- `align-items` controls vertical alignment.

### Grid

Grid is useful for layouts that use rows and columns.

```css
.container {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
```

This creates three equal columns.

`fr` means a fraction of the available space.

Example:

```css
grid-template-columns: 1fr 2fr;
```

The second column gets twice as much space as the first.

Responsive Grid example:

```css
grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
```

This creates as many columns as fit while keeping each column at least 300px wide.

### Flexbox vs Grid

A useful rule of thumb:

- Flexbox = one main direction, such as a navbar or sidebar/content layout
- Grid = rows and columns, such as a gallery of cards

Both can sometimes solve the same layout problem.

### CSS Frameworks

CSS frameworks provide existing styles and components that can be reused.

#### Bootstrap

Bootstrap provides prebuilt component classes.

Example:

```html
<button class="btn btn-primary">Save</button>
```

Bootstrap already defines `.btn` and `.btn-primary`. I do not need to create those CSS classes myself.

I can combine Bootstrap with my own classes:

```html
<button class="btn btn-primary custom-button">Save</button>
```

Bootstrap is component-based and is useful for quickly creating things such as:

- buttons
- navigation bars
- forms
- cards
- accordions

#### Tailwind

Tailwind is utility-first.

Example:

```html
<button class="bg-blue-400 text-white px-4 py-2 rounded">
  Save
</button>
```

Each Tailwind class performs a small styling task.

Examples:

- `bg-blue-400` = blue background
- `text-white` = white text
- `px-4` = horizontal padding
- `py-2` = vertical padding
- `rounded` = rounded corners

Simple comparison:

- Bootstrap = prebuilt components
- Tailwind = small utility classes used to build custom designs

## React and Vite

- `npm run dev` starts Vite's local development server. `npm run build` creates the production site in `dist/`, and `npm run preview` serves that build locally.
- The root `index.html` is Vite's document shell. It provides `<div id="root"></div>` and loads `index.jsx`; the TankScript home view is a React component, not the document entry point.
- `index.jsx` calls `createRoot(document.getElementById('root'))` and renders `<App />` into that root element.
- `App` owns the shared header, navigation, footer, and router. Page/view components such as `Home`, `Login`, and `Battle` return the content for an individual route.
- JSX uses `className` instead of `class` and `htmlFor` instead of `for`. HTML attributes such as `autocomplete` use React's camelCase spelling, `autoComplete`.
- `BrowserRouter` enables client-side routing. Put `<Route>` entries inside `<Routes>` and render a view with `element={<SomePage />}`. A catch-all route can render a not-found view.
- Use React Router's `<Link>` or `<NavLink>` with `to="/route"` for internal navigation instead of linking to `.html` files. `NavLink` can also expose which route is active.
- Files in `frontend/public/` are copied to the built site and referenced from the site root, for example `/hs-logo.png`.
- Import global CSS from JavaScript. TankScript imports Bootstrap's CSS and `app.css` from `frontend/src/app.jsx`, so Bootstrap and custom styles are loaded once for the app.
- To convert a static page, move its contents inside the component's returned JSX, preserve its semantic elements and CSS classes, update JSX attribute names, self-close void elements such as `<input />`, and replace internal `.html` anchors with router links.
- The deployment script builds the app and uploads the generated site. A production static server also needs to route direct requests to client-side paths, such as `/battle`, back to `index.html`.

### TankScript Service

- The Express service in `backend/index.js` runs on port 4000 and serves the built frontend in production. Vite proxies `/api` requests to it during local development.
- Authentication uses register, username-or-email login, logout, and `/api/auth/me` session restoration. Passwords are hashed with bcrypt; the session token is stored in an HTTP-only cookie.
- Authentication middleware protects tank endpoints. Tank CRUD assigns ownership from the authenticated user and only allows access to that user's tanks.
- Frontend service requests are centralized in `frontend/src/services/api.js` and return `{ ok, status, data, error }`. Authentication and tank persistence use the backend rather than `localStorage`.
- CueName's `tank-names` generator supplies five optional suggestions per request. Suggestions remain editable before saving.
- The MongoDB-backed integration test covers multiple accounts, protected routes, malformed requests, concurrent duplicate registration, tank ownership and CRUD, session restoration, and persistence across a service restart.
- The service test requires the local ignored database configuration and uses a uniquely named temporary database that is dropped after the run.

## Database deliverable

- MongoDB stores users and tanks in the `tankscript` database. `backend/database.js` connects when the service starts and exposes asynchronous lookup, insert, update, and delete operations to the Express API.
- User records contain bcrypt password hashes and authentication tokens. Tank records contain a generated ID, name, original source code, language, color, and owner username. Passwords are never stored as plain text.
- The MongoDB driver adds `_id` values to inserted documents. The `removeMongoId()` helper removes that internal field so API responses keep the frontend's existing `{ id, name, code, color, ownerUsername }` shape.
- Unique indexes protect email addresses, usernames, and tank IDs from duplicate inserts, including concurrent registrations. The service returns a conflict for a duplicate account and checks update/delete results.
- The connection settings stay in ignored `backend/dbConfig.json`. The service requires a successful database connection at startup.
- Integration tests now run with `npm run test:integration`. The tests cover registration and login by username/email, invalid credentials and inputs, duplicate and concurrent registrations, cookie sessions, protected routes, tank CRUD and ownership, community tank loading, `_id` removal, and persistence after restarting the service. Each run removes its own temporary database.
- I learned that MongoDB operations must be awaited, database uniqueness needs indexes rather than only application-side checks, and persisted records remain available after the service process restarts.

### TankScript Reactivity

- Use `const` when a variable binding will not be reassigned and `let` when it will. `const` does not make an object immutable.
- Spread syntax (`...`) copies enumerable properties into a new object or array. In React, it is useful for making a new state snapshot instead of reusing a mutated object.
- `useState` updates trigger React renders. `useRef` is for mutable values such as the live `BattleEngine` instance; changing `ref.current` alone does not render the page.
- `useEffect` runs side effects after rendering. Return a cleanup function to remove resources such as timers; pair `setInterval` with `clearInterval` and recreate the timer when its speed dependency changes.
- The engine is mutable and owns game rules. React receives fresh plain-data snapshots after ticks so the arena, tanks, bullets, and participant information rerender.
- Tank Editor and Battle load saved tanks through the backend service API. MongoDB persists accounts and saved community tanks; battle results and tank statistics are not persisted.
- Saved and built-in tanks use the same command and snapshot interface. JavaScript and TypeScript run in QuickJS workers with time and memory limits; Python runs in isolated Pyodide workers with execution watchdogs. Development tests and benchmarks use the legacy executor for trusted fixtures.
- Vite's `import.meta.glob()` discovers matching built-in tank modules at build time, so adding a matching module makes it available without maintaining a separate import list.
- MongoDB could also store battle history and statistics in the future. A server-side `BattleEngine` could own authoritative multiplayer battles and send updates through WebSockets. Current battles run in the browser, and WebSockets supply the online connection count.

## WebSockets

- A WebSocket connection starts with an HTTP upgrade request. After the server accepts it, the connection stays open so either side can send messages without a new HTTP request.
- `ws://` uses an unencrypted connection, and `wss://` uses TLS. TankScript chooses `wss` when the page uses HTTPS and connects to the same host at `/ws`.
- The Node.js `ws` package provides `WebSocketServer`. Attaching it to Express's HTTP server lets normal API requests and WebSocket upgrades use the same port.
- Broadcasting means sending a message to every open socket in `wss.clients`. TankScript broadcasts `{"type":"online-count","count":3}` when connections open or close. Each connected browser tab counts separately.
- In React, `socket.onmessage` receives an event. Parse `event.data` as JSON, check its type and count, then update state so React renders the new number.
- The server sends a ping every 10 seconds. Browsers automatically answer with pong frames. A missing pong lets the next heartbeat remove an unresponsive connection.
- Vite forwards `/ws` to `ws://localhost:4000` with `ws: true` to proxy the HTTP upgrade during development. The browser connects to Vite's host while Express handles the socket.
- A lost connection shows a disconnected status and triggers at most three retries after 1, 2, and 4 seconds. A successful connection resets the retry budget. The effect cleanup closes the socket and cancels pending retries.

## Python tank execution

- Pyodide runs CPython through WebAssembly. TankScript lazy-loads a pinned local runtime when Python executes, so JavaScript/TypeScript tanks do not download it.
- The Python editor notice explains first-run runtime loading. Selecting or saving Python does not start it; cached runtime bytes can make later starts faster. This is startup behavior, not a claim that Python algorithms are always slower.
- Python uses names such as `move_up()`, `tank_position.x`, and `all_bullets[0].owner_id`. Fresh tuple records protect snapshots; each tank has its own persistent Python variables. Compile the source once, then execute the compiled code for each tick.
- A worker keeps computation off the UI thread. An opaque-origin frame prevents access to the app's origin; its content security policy blocks networking and dynamic JavaScript. Restricting Python imports alone is not a secure sandbox.
- A trace hook checks the 100 ms budget. The parent terminates an unresponsive worker after 500 ms and disables that tank until restart. Canceling or resetting removes its frame, worker, and message ports.
- Each Python tank needs an interpreter, so startup and memory costs are higher. Pyodide has no enforced per-tank heap cap here; browser-side isolation cannot prevent every resource-exhaustion problem.
- The stdlib ZIP is inlined in a lazy JavaScript asset and WebAssembly is bundled by Vite. This keeps development and production self-contained without changing release file formats or using a runtime CDN.
- The bootstrap uses Pyodide's documented but experimental `createPyodideModule` hook. The package is pinned; rerun the browser lab before upgrading it. [Pyodide source and license](https://github.com/pyodide/pyodide) are available under MPL-2.0.

## Experimental Java tanks

- Java development is paused indefinitely. JavaScript, TypeScript and Python are the public languages; Java's logo remains visible as a disabled **in development** option. The [Java handoff](frontend/src/game/tank-script/java/DEVELOPMENT-STATUS.md) is the starting point if we deliberately revisit it.

- TeaVM compiles genuine Java to WebAssembly in the browser. Compile once per source revision, then reuse one `MyTank` object so its fields persist between ticks.
- A tank uses `public class MyTank` with `public void tick(TankScript.Snapshot state, TankScript api)`. Read records with methods such as `state.tankPosition().x()` and call actions such as `api.shoot()`; the first action wins.
- Monaco's basic Java mode supplies highlighting. Our small completion provider suggests TankScript methods; javac errors become editor markers when Generate Command compiles the source. This is not a full Java language server.
- Save the original `code` and `language: "java"`, not compiled bytes or worker objects. Saving incomplete source is useful for drafts; the Debugger checks compilation. Existing tanks without a language still default to JavaScript.
- A hidden frontend option is not API security. Both local servers must opt in with `VITE_EXPERIMENTAL_JAVA=true`; the backend also requires explicit `NODE_ENV=development`. Production rejects Java writes and hides Java records even if a request asks to enable it.
- Preserved development battles allow four Java tanks, within the existing total participant limit. Trusted worker startup has its own five-second bound; Java calls retain the 100 ms budget and separate 500 ms watchdog, opaque origin and restrictive CSP. A loader linear-memory limit does not cap ordinary Java arrays or the WasmGC heap; this browser limitation is why we paused rather than continuing allocation experiments.
- Each tab also permits one Java compiler and eight new compiler starts per rolling minute; failures and cancellations count. Cached code avoids compilation, with at most three entries and 8 MiB total backing-buffer memory. More tabs still mean more resources.
- A timeout can stop a loop but cannot prevent a sudden memory allocation. Rebuilding pinned source also does not guarantee identical compiler bytes; retain reviewed hashes and prepare the corresponding source and required license notices before public distribution.

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

## React

Interesting things I have learned about React

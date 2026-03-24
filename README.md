# Business Website Template

A modern, responsive business website starter built with **Next.js 16**, **TypeScript**, and **Tailwind CSS**.

## Features

- **App Router** — uses the Next.js `app/` directory for file-based routing and layouts
- **TypeScript** — fully typed codebase for safer, more maintainable development
- **Tailwind CSS** — utility-first styling for rapid, responsive UI development
- **ESLint** — pre-configured linting to keep code consistent
- **`src/` directory** — clean project structure with source code separated from config
- **`@/*` import alias** — short, absolute imports out of the box

## Getting Started

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the site.

## Project Structure

```
src/
  app/
    layout.tsx    # Root layout
    page.tsx      # Home page
    globals.css   # Global styles
public/           # Static assets
```

## Deployment

Deploy easily to [Vercel](https://vercel.com), Netlify, or any platform that supports Next.js.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # start development server
npm run build    # production build
npm run start    # start production server
npm run lint     # run ESLint
```

No test runner is configured yet.

## Project purpose

Social media crawler dashboard. Each platform has a dedicated crawler that fetches **criativos** (ad creatives / content) and pushes them to the user's own platform. TikTok is the first active crawler; Kwai, YouTube, Facebook, Twitter, and Instagram are locked (coming soon).

## Architecture

- **Framework**: Next.js 16 App Router (`src/app/`)
- **Styling**: Tailwind CSS v4 — configured via `@import "tailwindcss"` in `globals.css`, not a `tailwind.config.*` file
- **Language**: TypeScript (strict mode)
- **Path alias**: `@/*` → `./src/*`

### App Router conventions

Pages go in `src/app/<route>/page.tsx`, layouts in `src/app/<route>/layout.tsx`. The root layout at `src/app/layout.tsx` wraps the entire app with the `<html>` and `<body>` tags. Server Components are the default; add `"use client"` only when browser APIs or React hooks are needed.

### Tailwind v4 notes

There is no `tailwind.config.*` — theme customization and CSS variables live inside `globals.css` under `@theme inline { … }`. Utility classes work the same way in markup.

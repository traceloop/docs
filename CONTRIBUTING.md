# Contributing to Traceloop Docs

Thanks for considering a contribution! This guide covers everything you need to get the docs running locally.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- npm (comes with Node.js)
- Git

## Setup

1. **Fork and clone the repo**

```bash
   git clone https://github.com/YOUR_USERNAME/docs.git
   cd docs
```

2. **Install Mintlify CLI and run the dev server**

   This repo is powered by [Mintlify](https://mintlify.com). No separate install step is needed — just run:

```bash
   npx mintlify@latest dev
```

   This starts a local preview server, typically at `http://localhost:3000`.

3. **Preview your changes**

   Edit any `.mdx` file and the preview will hot-reload automatically.

## Adding a New Page

If you create a new documentation page, you **must** register it in `mint.json`, or it won't appear in the site navigation. Find the relevant section in `mint.json` and add your new page's path to the appropriate group.

## Submitting Changes

1. Create a branch: `git checkout -b docs/your-change-name`
2. Make your changes and verify them locally with `npx mintlify@latest dev`
3. Commit: `git commit -m "docs: describe your change"`
4. Push to your fork: `git push origin docs/your-change-name`
5. Open a pull request against `traceloop/docs` main branch

## Troubleshooting

- **Command not found / npx fails**: Ensure Node.js is installed and up to date (`node -v`).
- **Page not showing up**: Double check it's registered in `mint.json`.
- **Port already in use**: Mintlify will usually prompt to use an alternate port — accept it, or free up port 3000.
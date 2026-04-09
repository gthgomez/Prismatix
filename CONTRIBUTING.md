# Contributing to Prismatix

Prismatix is a minimal React + Vite + TypeScript starter for teams integrating their own backend. Contributions should keep it lean.

---

## Scope

Good fits:
- Bug fixes in the Vite config, TypeScript config, or environment setup
- Security patches (follow the pattern of the existing Rollup CVE patch)
- Improvements to the starter shell that apply broadly
- Documentation improvements

Out of scope:
- Backend implementation (this is a frontend starter — bring your own backend)
- Feature additions that require backend coupling
- Opinionated UI frameworks or component libraries

---

## Setup

### Requirements

- Node.js 20+

### Install

```bash
git clone https://github.com/gthgomez/Prismatix.git
cd Prismatix
cp .env.example .env   # fill in your own values
npm install
npm run dev
```

---

## Quality Checks

```bash
npm run build          # must succeed with no TypeScript errors
```

There is no test suite — this is an intentionally thin starter. If you add tests, include them in your PR.

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b fix/your-description`
2. Make your changes
3. Run `npm run build` and confirm it passes cleanly
4. Open a PR with a description of what changed and why

---

## Security

If you find a security vulnerability, do not open a public issue. Email the maintainer directly (see profile). For dependency CVEs, open a PR with the updated `package-lock.json` and a brief description of the vulnerability patched.

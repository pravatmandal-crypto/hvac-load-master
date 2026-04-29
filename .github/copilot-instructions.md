# Project Guidelines

## Code Style

- Use TypeScript with React function components and hooks.
- Preserve the existing import style and `@/` path alias defined in [vite.config.ts](../vite.config.ts).
- Reuse the shared UI primitives in [src/components/ui](../src/components/ui) before adding new bespoke controls.
- Keep calculation logic out of UI components when it can live in reusable modules under [src/lib/hvac](../src/lib/hvac) or [src/lib/electrical](../src/lib/electrical).

## Architecture

- Treat [src/components](../src/components) as the presentation layer and [src/pages](../src/pages) as page-level composition.
- Keep engineering calculations pure and reusable in [src/lib/hvac](../src/lib/hvac), [src/lib/electrical](../src/lib/electrical), and related helpers.
- The app is offline-first: local persistence in [src/lib/db](../src/lib/db) is the default, and cloud sync is secondary.
- Firebase code should use the shared helpers in [src/lib/firebase.ts](../src/lib/firebase.ts) for operation typing and error handling instead of ad hoc error messages.

## Build And Test

- Install dependencies with `npm install`.
- Start local development with `npm run dev`.
- Validate type safety with `npm run lint`.
- Build production output with `npm run build`.
- There is no automated unit test suite yet, so changes usually need targeted manual verification.

## Conventions

- Prefer extending the modular HVAC and electrical libraries instead of adding more logic to legacy catch-all files such as [src/lib/hvac-logic.ts](../src/lib/hvac-logic.ts).
- Follow the existing offline-first flow when changing data operations: save locally first, then integrate with sync behavior where needed.
- When editing Firestore-backed screens, preserve `onSnapshot` subscription cleanup and use the shared Firestore error helpers.
- Do not remove the HMR and popup-related server settings in [vite.config.ts](../vite.config.ts); they are intentional for AI Studio and Firebase popup auth.
- Treat `GEMINI_API_KEY` as an environment prerequisite for Gemini-powered features. See [README.md](../README.md) and [.env.example](../.env.example).

## Reference Docs

- Setup and local run instructions: [README.md](../README.md)
- Offline-first architecture and sync model: [OFFLINE_ARCHITECTURE.md](../OFFLINE_ARCHITECTURE.md)
- Offline deployment details: [OFFLINE_DEPLOYMENT_SUMMARY.md](../OFFLINE_DEPLOYMENT_SUMMARY.md)
- Migration examples for offline-first patterns: [CODE_MIGRATION_EXAMPLES.md](../CODE_MIGRATION_EXAMPLES.md)
- Electrical module details and standards: [src/lib/electrical/README.md](../src/lib/electrical/README.md)
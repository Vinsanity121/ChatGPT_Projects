# College & Career Planner

This is a small website prototype. The intake collects a student profile, then a connected AI service can interpret the answers and create a structured plan for grades 9–12.

## Public static preview

The top-level `index.html` can be hosted directly by GitHub Pages. It has no build step, and its service paths are relative so it works from a repository subfolder. GitHub Pages only hosts static files, so this public preview does not include the AI server and will explain that no plan can be generated there. The form does not send or save answers in that preview.

## Turn on AI planning

1. Create an OpenAI API key in your OpenAI Platform account.
2. Copy `.env.example` to `.env` in this folder.
3. Put the API key after `OPENAI_API_KEY=` in `.env`. Keep that file private; it is ignored by Git.
4. Run `node server.mjs` from this folder. On macOS, you can also run `zsh start.command`.
5. Open <http://127.0.0.1:4173>.

The API key stays on the server and is never included in the page. The planner sends answers only when the student requests a plan. The prototype does not save profiles between visits. It asks the API not to store the generated response, but students should still avoid entering names, contact details, or sensitive information.

## What the AI returns

The server asks for a short interpretation of the student's goals and context, a strategy, 2–4 actions for each high-school year, reasons those actions fit, progress measures, follow-up questions, and assumptions. The website displays one school year at a time.

This first AI version uses the student's answers and the model's general knowledge. It does not yet search current school catalogs, graduation rules, college admissions pages, or deadlines. Those need a verified-source layer before the planner should present school-specific requirements as fact.

## Local-only AI server

The server binds to `127.0.0.1`, so it is intended for use on this computer. Do not expose it publicly as-is. A public AI version needs secure hosting, account and access controls, abuse limits, and a student-data privacy plan.

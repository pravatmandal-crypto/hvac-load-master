
---
name: create-skill
description: 'Create and refine Copilot SKILL.md files. Use when authoring reusable workflows, converting ad-hoc chat methods into repeatable skills, choosing scope (workspace vs personal), and validating invocation/discovery quality.'
argument-hint: 'Describe the target workflow, scope, and depth (checklist or full).'
---

# Create Skill

## What This Skill Produces
- A complete SKILL.md in the correct folder with valid frontmatter.
- A reusable workflow with clear decision points and completion checks.
- A short iteration loop that resolves ambiguities before finalizing.

## When To Use
- You want to turn a repeated chat workflow into a reusable skill.
- You need to create a new skill from scratch.
- You need to improve a weak skill description so it is discoverable.

## Inputs To Collect
- Outcome: what the skill should reliably produce.
- Scope: workspace (`.github/skills/<name>/`) or personal (`~/.copilot/skills/<name>/`).
- Depth: quick checklist or full multi-step procedure.

If these inputs are missing, proceed with defaults:
- Scope: workspace
- Depth: full multi-step workflow

## Procedure
1. Extract workflow signals from conversation history.
- Capture repeated actions, step order, branching decisions, and quality checks.
- Convert specific examples into generalized, reusable steps.

2. Decide skill identity.
- Choose a lowercase kebab-case name (1-64 chars).
- Ensure folder name and frontmatter `name` match exactly.
- Write a keyword-rich `description` with trigger phrases and "Use when" language.

3. Choose location.
- Workspace scope: `.github/skills/<name>/SKILL.md`
- Personal scope: `~/.copilot/skills/<name>/SKILL.md`

4. Draft SKILL.md.
- Add YAML frontmatter.
- Add sections for outputs, use cases, required inputs, and procedure.
- Include explicit decision branches (for example: missing context, ambiguous scope, low-confidence defaults).
- Add completion checks that can be verified quickly.

5. Save first draft.
- Create folder structure if needed.
- Save SKILL.md first, then add references/scripts only if necessary.

6. Identify weak points and ask targeted follow-ups.
- Ask only about the most ambiguous areas (usually outcome specificity, scope, and depth).
- Apply answers to revise the skill.

7. Finalize and handoff.
- Summarize what the skill now produces.
- Provide 2-4 example prompts the user can run.
- Suggest one or two related customizations to create next.

## Decision Branches
- If no clear workflow exists in conversation:
  - Ask for outcome, scope, and depth.
  - If user skips answers, use defaults and label assumptions.
- If the request is one-off and not repeatable:
  - Recommend a prompt file instead of a skill.
- If behavior should be always-on across tasks:
  - Recommend instructions instead of a skill.

## Completion Checks
- Folder and file path are valid for selected scope.
- Frontmatter parses and includes `name` and `description`.
- `name` matches folder name.
- Description includes clear trigger keywords.
- Procedure is actionable, ordered, and reusable.
- At least one decision branch and one quality checklist is present.

## Example Prompts
- Create a skill that turns my code review process into a repeatable checklist plus fix workflow.
- Build a workspace skill for generating release notes from merged PR summaries.
- Convert my debugging routine into a full multi-step skill with branching by error type.
- Improve this skill description so Copilot triggers it more reliably.

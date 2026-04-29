---
name: "Code Review Findings"
description: "Review selected code and report actionable bugs, risks, and missing tests."
argument-hint: "Optional focus, e.g., auth flow, performance, security"
agent: "agent"
---
Review the currently selected code (or active file if no selection) and produce a code review report.
When needed, inspect directly related files (imports, callees, and immediate callers) to validate behavior.

Optional focus:
- If an argument is provided, prioritize that concern while still checking overall correctness.

Requirements:
1. Prioritize concrete defects and behavioral risks over style suggestions.
2. Include likely regressions and edge cases.
3. Note missing or weak tests that would catch each issue.
4. Keep findings actionable and specific.
5. Label confidence per finding as High Confidence or Probable.

Output format:
1. Findings (ordered by severity)
- [Severity: Critical|High|Medium|Low] Short title
- [Confidence: High Confidence|Probable]
- Location: file path and line reference when available
- Why it matters: brief impact statement
- Evidence: concise explanation tied to code behavior
- Fix direction: one practical remediation
- Test gap: what test is missing
2. Open questions / assumptions
- List blockers or uncertain areas that need confirmation.
3. Brief summary
- 2-4 lines summarizing overall risk and confidence.

Constraints:
- Do not rewrite large code sections unless asked.
- Avoid cosmetic-only feedback unless it affects reliability or maintainability.

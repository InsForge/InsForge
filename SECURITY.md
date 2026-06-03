# Security Policy

Contact: https://github.com/InsForge/InsForge/security/advisories/new
Contact: mailto:security@insforge.dev


At InsForge, we consider the security of our systems a top priority. But no matter how much effort we put into system security, there can still be vulnerabilities present.

If you discover a vulnerability, we would like to know about it so we can take steps to address it as quickly as possible. We ask you to help us better protect our users and our systems.

## Supported Versions

We provide security fixes for the latest minor release of the current major version.

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

If you are running an older release, please upgrade before reporting, or include the exact version and commit so we can determine whether the issue still affects `main`.

## Out of scope

Here is a brief list of some common out-of-scope vulnerabilities:

- Clickjacking on pages with no sensitive actions.
- Unauthenticated, logout, or login CSRF.
- Attacks requiring MITM or physical access to a user's device.
- Attacks requiring social engineering.
- Any activity that could lead to the disruption of our service (DoS).
- Content spoofing and text injection issues without a clear attack vector or the ability to modify HTML/CSS.
- Email spoofing.
- Missing DNSSEC, CAA, or CSP headers.
- Lack of Secure or HttpOnly flags on non-sensitive cookies.
- Dead links.
- User enumeration on public registration endpoints.

## Testing guidelines

- Do not run automated scanners against other customers' projects. Running automated scanners can run up costs for our users, may disrupt services, and our own security tooling cannot distinguish hostile reconnaissance from whitehat research. If you wish to run an automated scanner, notify us first at `security@insforge.dev` and only run it against your own InsForge project. Do NOT attack projects belonging to other customers.
- Do not take advantage of the vulnerability you discover, for example by downloading more data than necessary to demonstrate the issue, or by deleting or modifying other people's data.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

- File a private report through GitHub Security Advisories:
  https://github.com/InsForge/InsForge/security/advisories/new
- Or email `security@insforge.dev`. If you do not receive a reply within 5 business days, please follow up via GitHub Security Advisories so the report does not get lost.

Provide enough information to reproduce the problem so we can resolve it quickly. Helpful details include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a minimal proof-of-concept.
- The affected version, commit, or deployment (self-hosted vs. `insforge.dev`).
- Any logs, screenshots, or scripts that help us reproduce the issue.
- Your contact information so we can follow up.

## Disclosure guidelines

- In order to protect our users, please do not reveal the problem to others until we have researched, addressed, and informed any affected customers.
- If you want to publicly share your research about InsForge (at a conference, in a blog post, or any other public forum), please share a draft with us for review at least 30 days before publication. The following should not be included:
  - Data regarding any InsForge customer projects.
  - InsForge customers' data.
  - Information about InsForge employees, contractors, or partners.

## What we promise

- We will respond to your report within 5 business days with our evaluation of the report and an expected resolution date.
- If you have followed the instructions above, we will not take any legal action against you in regard to the report.
- We will handle your report with strict confidentiality, and not pass on your personal details to third parties without your permission.
- We will keep you informed of the progress towards resolving the problem.
- In the public information concerning the problem reported, we will give your name as the discoverer of the problem (unless you ask us not to).

We strive to resolve all reports as quickly as possible, and we want to play an active role in the ultimate publication of the issue once it is resolved.

## Safe harbor

We support good-faith security research. If you make a good-faith effort to comply with this policy during your research, we will:

- Consider your research authorized under this policy.
- Not pursue or support legal action against you for the research.
- Work with you to understand and resolve the issue quickly.

If at any point you are unsure whether a particular action is allowed, please ask us first via the reporting channels above.

---

*This policy is adapted from [Supabase's security policy](https://github.com/supabase/supabase/blob/master/SECURITY.md), with reporting channels and scope updated for InsForge.*

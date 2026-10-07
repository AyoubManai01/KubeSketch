# Security Policy

Security is important to Veltra. Veltra is a Kubernetes infrastructure tool:
the manifests it works with routinely contain sensitive material such as
Kubernetes resource definitions, Secret values, TLS configuration, cluster
topology, and other details about real infrastructure. We take reports about
vulnerabilities and accidental exposure seriously.

## What is a security vulnerability?

A security vulnerability is a weakness in Veltra that could compromise users,
their data, or their infrastructure. This includes (but is not limited to):

- Unsafe handling of untrusted YAML manifests or resource fields that could
  lead to code execution, injection, or other unintended behavior.
- Issues that could expose sensitive manifest content — for example, Secret
  values, tokens, or cluster configuration leaking into exported PNG/SVG
  images, logs, error messages, shared URLs, or any place outside the user's
  local browser.
- Issues that could allow tampering with, or unintended disclosure of, data
  Veltra persists locally.
- Vulnerabilities in how Veltra handles Kubernetes resources, cluster access,
  credentials, configuration, or infrastructure exposure.

> Veltra runs locally in the browser and does not connect to your cluster, so
> the most realistic risks usually involve handling of the manifests you paste
> into it and the artifacts you export from it.

If you are unsure whether something qualifies, please report it anyway — it is
better to share it privately than to guess wrong.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a suspected vulnerability.**
Instead, report it privately:

1. **Preferred:** use GitHub's private vulnerability reporting on the
   repository — open
   <https://github.com/AyoubManai01/Veltra/security/advisories/new> (or go to
   the repository's **Security** tab and choose **Report a vulnerability**).
   This keeps the report and the discussion confidential with the maintainers.
2. **If private vulnerability reporting is not enabled** on the repository,
   contact the project maintainer directly and privately (for example, through
   their GitHub profile), or open a minimal issue that describes the problem
   **without** including exploit details, and note that you would like to share
   more privately.

There is currently no dedicated security mailing list or bug bounty program
for Veltra.

## What to include in a report

The more context you can share, the faster a report can be triaged:

- A description of the vulnerability and its potential impact
- The affected version or commit (`git rev-parse HEAD`)
- Steps to reproduce, ideally with a minimal example (such as a small manifest
  that triggers the issue)
- Whether exploitation requires local access or crafted input, and whether you
  believe it could be triggered remotely
- Any relevant logs, screenshots, or exported artifacts
- A suggested fix, if you have one

Please redact any real credentials or infrastructure details from your report
wherever possible.

## Disclosure expectations

- Please give maintainers reasonable time to investigate and coordinate a fix
  **before publicly disclosing** an exploitable vulnerability. Do not publish
  exploit details, proof-of-concept code, or affected manifests publicly before
  the issue has been responsibly handled.
- Maintainers will acknowledge your report as soon as possible. Please allow a
  few days — Veltra is maintained by volunteers, not around the clock.
- After investigation, maintainers will work with you to confirm the issue,
  fix it, and coordinate disclosure. If a GitHub security advisory is used,
  disclosure happens through the advisory when a fix is ready.
- Reports are treated confidentially while a fix is being prepared.

## Acknowledgements

Security researchers who report valid vulnerabilities are welcome to be
credited (by name or handle) in the release notes or security advisory —
please say in your report whether and how you would like to be credited.

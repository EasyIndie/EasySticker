# Third-Party Notices

EasySticker is licensed under the Apache License 2.0. It depends on third-party
open-source software; each dependency retains its own license.

The authoritative dependency list and versions are in [`package-lock.json`](package-lock.json).
Each installed package ships its license file under `node_modules/<package>/`.

## Runtime dependencies

| Package | License |
|---------|---------|
| `@fastify/jwt` | MIT |
| `@fastify/multipart` | MIT |
| `@fastify/static` | MIT |
| `@fastify/swagger` | MIT |
| `@fastify/swagger-ui` | MIT |
| `archiver` | MIT |
| `fastify` | MIT |
| `http-errors` | MIT |
| `nanoid` | MIT |
| `nodemailer` | MIT-0 |
| `pino` | MIT |
| `sharp` | Apache-2.0 |
| `undici` | MIT |
| `zod` | MIT |

## sharp / libvips

`sharp` uses the native libvips library through the `@img/sharp-libvips-*`
packages, which are licensed under **LGPL-3.0-or-later**. The Docker image
includes the corresponding libvips binaries and their license files.

If you redistribute the Docker image or a modified build, retain the libvips
license notices and satisfy the LGPL-3.0 obligations, including making the
corresponding source available and preserving the ability to replace/relink the
library.

## Base image and system packages

The production Docker image is built from `node:20-bookworm-slim` and installs
`curl` plus CA certificates. Those components retain their own licenses.

---

This file is informational and is not legal advice. For the exact terms, read
the license text shipped with each dependency.

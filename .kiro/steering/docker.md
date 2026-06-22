---
inclusion: always
---

# Docker Build Requirements

Always build Docker images for `linux/amd64` platform. The developer is on Apple Silicon (ARM) but deploys to AWS which requires amd64.

Use the `--platform linux/amd64` flag on all `docker build` commands:

```bash
docker build --platform linux/amd64 -t <image> .
```

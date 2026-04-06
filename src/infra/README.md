# Infrastructure Scaffold

## Local

- `docker-compose.yml` spins up:
  - `postgres`
  - `brain` (FastAPI)
  - `portal` (Next.js dev server)

## Cloud

- `terraform/aws` contains baseline resources for Syzm Brain on EC2 + ASG.
- Extend with ALB, IAM, CloudWatch, and Spot mixed instances before production use.


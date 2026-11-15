# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## EC2 learning instance

The stack creates a small Amazon Linux 2023 EC2 instance in a one-AZ VPC with a
public subnet and internet gateway. By default, its security group has no
inbound rules; optional SSH and weather API rules are restricted to a configured
client CIDR. For real AWS, the instance role is configured for AWS Systems
Manager Session Manager access without opening SSH. The instance requires
IMDSv2 and has a public IP for outbound connectivity.

For Floci compatibility, CDK does not create its custom resource that removes
the default security group's rules. The EC2 instance uses a separate security
group, and no inbound rules are added to it.

The instance type is `t3.micro`. In real AWS, the instance and its networking
resources can incur charges while provisioned. The Floci deployment emulates
EC2 locally and does not create AWS-billed resources. Deploy the stack locally
from this directory with `eval "$(floci env)"` followed by
`npm exec -- cdklocal deploy`.

SSH is opt-in. Create a key pair in the target environment, then set
`EC2_SSH_KEY_PAIR_NAME` to its name and `EC2_SSH_CIDR` to your trusted client
IPv4 CIDR (for example, your public IP followed by `/32`) before deploying.
The instance gets TCP port 22 ingress only from that CIDR. In Floci, SSH is
forwarded to a host port in the range 2200–2299.

## Mock weather API

The EC2 user data installs a small Flask/Gunicorn API. It creates a
`weather_observations` table in the existing `practice` PostgreSQL database,
reading credentials from the `practice-postgres-credentials` Secrets Manager
secret through the EC2 instance role. User-data changes trigger instance
replacement so the setup script runs on a fresh instance.

- `GET /health` checks the API and database connection.
- `GET /weather` returns the latest 20 mock observations.
- `GET /weather?city=London` returns the latest observation for that city.
- `POST /weather` inserts an observation. Send JSON fields `city`,
  `temperature_c`, `description`, and optionally `feels_like_c` and
  `humidity_percent`.

The API does not fetch real weather; add sample observations with POST requests.
Port 8080 is opened only when `EC2_API_CIDR` (or `EC2_SSH_CIDR`) is set. Floci
publishes it on a host port in the 30000–30999 range.

The `weather-api-proxy` Lambda forwards GET requests to the EC2 API. Set
`WEATHER_API_URL` to an address reachable from the Lambda container before
deploying. With Floci, use the EC2 container's Docker-network IP and port 8080;
the logical `Ec2PublicIp` output is not the container address.

# AWS CDK Learning Lab

A hands-on AWS learning project built with TypeScript CDK and run locally with
[Floci](https://floci.io/aws/). It covers S3, Lambda, Secrets Manager,
PostgreSQL, VPC, EC2, and a small weather API.

> **Local environment:** The commands below target Floci, not AWS. Avoid running
> `cdk deploy` or configuring real AWS credentials unless you intentionally want
> to create AWS resources, which may incur charges.

## What the project creates

The CDK stack is defined in [`cdk-app/lib/cdk-app-stack.ts`](./cdk-app/lib/cdk-app-stack.ts).

| Resource | Purpose |
| --- | --- |
| S3 learning bucket | Encrypted, private bucket that invokes a Lambda when an object is created. |
| `cdk-s3-event-handler` Lambda | Handles S3 object-created notifications. |
| `httpbin-get` Lambda | Demonstrates an outbound HTTP GET request using a Lambda layer. |
| `practice-postgres-reader` Lambda | Reads data from the existing PostgreSQL database using credentials in Secrets Manager. |
| EC2 learning instance | Amazon Linux 2023 `t3.micro` in a one-AZ public VPC, with IMDSv2 required and an instance role for SSM and Secrets Manager access. |
| `weather-api-proxy` Lambda | Forwards a GET request to the weather API running on EC2. |

The stack expects an existing Floci PostgreSQL instance and the
`practice-postgres-credentials` Secrets Manager secret. The weather API creates
the `weather_observations` table in the configured `practice` database; the
database itself is not created by this CDK stack.

## Weather API

The EC2 instance user data installs a Flask/Gunicorn service from
[`cdk-app/ec2/weather_api.py`](./cdk-app/ec2/weather_api.py). It serves mock
observations; it does not fetch live weather data.

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/health` | Checks the API and database connection. |
| `GET` | `/weather` | Returns the latest 20 observations. |
| `GET` | `/weather?city=Seattle` | Returns the latest observation for that city. |
| `POST` | `/weather` | Inserts a weather observation from a JSON body. |

Required POST fields are `city`, `temperature_c`, and `description`.
`feels_like_c` and `humidity_percent` are optional. Example:

```json
{
  "city": "Seattle",
  "temperature_c": 12.5,
  "feels_like_c": 11.8,
  "humidity_percent": 72,
  "description": "Light rain"
}
```

## Prerequisites

- Docker and a running Floci environment
- Node.js and npm
- AWS CLI
- The Floci PostgreSQL database and Secrets Manager secret described above

Install the CDK app dependencies once:

```bash
cd cdk-app
npm install
```

## Deploy to Floci

Run these commands from `cdk-app`:

```bash
eval "$(floci env)"
export AWS_ENDPOINT_URL_S3="$AWS_ENDPOINT_URL"

npm run build
npm test
npm exec -- cdklocal synth
npm exec -- cdklocal deploy
```

The stack outputs include the S3 bucket name, Lambda names, EC2 instance ID,
security group ID, and the weather API port.

### Optional SSH and API ingress

SSH access is opt-in. To enable it, configure a Floci key pair and restrict
access to your client IP using a `/32` CIDR:

```bash
export EC2_SSH_KEY_PAIR_NAME=cdk-ec2-learning
export EC2_SSH_CIDR="YOUR_CLIENT_IP/32" # Replace with your trusted client IPv4 address.
export EC2_API_CIDR="$EC2_SSH_CIDR"
npm exec -- cdklocal deploy
```

The API security-group rule uses `EC2_API_CIDR`, or `EC2_SSH_CIDR` if the API
CIDR is not separately set. Do not use a wide-open CIDR for SSH.

## Test the weather API

In the Floci Docker environment, find the EC2 container and its Docker bridge IP:

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
EC2_CONTAINER=$(docker ps --filter 'name=floci-aws-ec2-' --format '{{.Names}}' | head -n 1)
EC2_CONTAINER_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "bridge").IPAddress}}' "$EC2_CONTAINER")
echo "$EC2_CONTAINER"
echo "$EC2_CONTAINER_IP"
```

If you have more than one EC2 container, set `EC2_CONTAINER` to the intended
container name from the `docker ps` output.

From WSL, the API can be tested directly using that bridge IP:

```bash
curl "http://${EC2_CONTAINER_IP}:8080/health"

curl -X POST "http://${EC2_CONTAINER_IP}:8080/weather" \
  -H 'Content-Type: application/json' \
  -d '{"city":"Seattle","temperature_c":12.5,"description":"Light rain","humidity_percent":72}'

curl "http://${EC2_CONTAINER_IP}:8080/weather?city=Seattle"
```

### Postman from Windows

The Docker bridge IP is reachable from WSL, but a Windows Postman request to
that IP may time out. One option is to forward a WSL localhost port to the EC2
container. Install `socat` in WSL if necessary, then run this in a WSL terminal
and leave it running:

```bash
sudo apt install socat
EC2_CONTAINER=$(docker ps --filter 'name=floci-aws-ec2-' --format '{{.Names}}' | head -n 1)
EC2_CONTAINER_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "bridge").IPAddress}}' "$EC2_CONTAINER")
socat TCP-LISTEN:8080,bind=127.0.0.1,reuseaddr,fork TCP:"$EC2_CONTAINER_IP":8080
```

In Postman, use `http://localhost:8080/weather?city=Seattle` with method `GET`.
For a POST, use `http://localhost:8080/weather`, select **Body → raw → JSON**,
and send the example JSON shown above. Keep the forwarding terminal open while
using Postman.

## Test the weather proxy Lambda

Set `WEATHER_API_URL` to the current EC2 container's Docker bridge IP, then
redeploy so CDK sets the Lambda environment variable:

```bash
export WEATHER_API_URL="http://${EC2_CONTAINER_IP}:8080"
export AWS_ENDPOINT_URL_S3="$AWS_ENDPOINT_URL"
npm exec -- cdklocal deploy
```

Invoke the Lambda with a city query:

```bash
aws --endpoint-url "$AWS_ENDPOINT_URL" --region us-east-1 lambda invoke \
  --function-name weather-api-proxy \
  --payload '{"city":"Seattle"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/weather-proxy-response.json

cat /tmp/weather-proxy-response.json
```

The Docker bridge IP can change when Floci recreates the EC2 container. Recheck
the IP and update `WEATHER_API_URL` before redeploying if that happens.

## Project commands

From `cdk-app`:

```bash
npm run build                 # TypeScript build
npm test                      # CDK unit tests
npm exec -- cdklocal synth    # Synthesize the Floci deployment template
npm exec -- cdklocal deploy   # Deploy to Floci
```

See [`cdk-app/README.md`](./cdk-app/README.md) for additional EC2 and API notes.

# SAP BTP Integration Test Collector

Collector service running on SAP BTP to receive messages from the SAP BTP Integration and support the SAP BTP integration testing framework.

## Quick Start

```bash
npm install
npm start
```

Server runs on `http://localhost:8080` by default.

## Configuration

| Variable              | Default    | Description                            |
|-----------------------|------------|----------------------------------------|
| `PORT`                | `8080`     | HTTP port                              |
| `HOST`                | `0.0.0.0`  | Bind address                           |
| `COLLECTOR_DATA_DIR`  | `./data`   | Base directory for stored data         |
| `COLLECTOR_TTL_HOURS` | `2`        | TTL for runs in hours                  |

## API

See [`api-contract/openapi.yaml`](./api-contract/openapi.yaml) for the full contract.

### Key endpoints

| Method   | Path                                              | Description                        |
|----------|---------------------------------------------------|------------------------------------|
| GET      | `/health`                                         | Health check                       |
| POST     | `/collect`                                        | Store a document                   |
| GET      | `/runs`                                           | List all runs                      |
| DELETE   | `/runs/:runId`                                    | Delete a run                       |
| GET      | `/runs/:runId/messages`                           | List messages in a run             |
| GET      | `/runs/:runId/messages/:messageId/payload`        | Get raw payload (latest seq)       |
| GET      | `/runs/:runId/messages/:messageId/header`         | Get headers as JSON (latest seq)   |
| DELETE   | `/runs/:runId/messages/:messageId/release`        | Release a message group            |
| GET      | `/runs/:runId/residual`                           | Get residual items                 |

### Ingest headers

| Header            | Required | Description                          |
|-------------------|----------|--------------------------------------|
| `X-Message-Id`    | Yes      | Message identifier                   |
| `X-Test-Run-Id`   | No       | Run identifier (default: `default`)  |

## Cloud Foundry Deployment

### Prerequisites

- [CF CLI](https://docs.cloudfoundry.org/cf-cli/install-go-cli.html) installed
- Logged in to your SAP BTP CF environment:

```bash
cf login -a <API_ENDPOINT> -u <USER> -o <ORG> -s <SPACE>
```

### Push the application

From the `sapbtp-integration-test-collector` directory, run:

```bash
cf push
```

CF will pick up `manifest.yaml` automatically and deploy the app using the Node.js buildpack.

### Override environment variables

You can override any environment variable after deployment:

```bash
cf set-env sapbtp-integration-test-collector COLLECTOR_TTL_HOURS 4
cf set-env sapbtp-integration-test-collector COLLECTOR_DATA_DIR /tmp/data
cf restage sapbtp-integration-test-collector
```

### Check the app

```bash
cf app sapbtp-integration-test-collector          # status, URLs, memory
cf logs sapbtp-integration-test-collector --recent  # recent log output
```

The app will be reachable at the route CF assigns, e.g. `https://sapbtp-integration-test-collector.<cf-domain>/health`.

---

## Tests

```bash
npm test
```

## Storage Structure

```
data/
  {testRunId}/
    manifest.json
    {messageId}/
      1.payload
      1.headers.json
      2.payload
      2.headers.json
```

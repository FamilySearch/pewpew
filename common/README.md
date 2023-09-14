# ppaas-common
Common Code for the PewPew as a Service ([ppaas-agent](https://github.com/FamilySearch/pewpew/agent) and [ppaas-controller](https://github.com/FamilySearch/pewpew/controller))

## Purpose
This allows us to run load tests using [pewpew](https://github.com/FamilySearch/pewpew) via a AWS without having to manually create an ec2 instance. By putting the test files in s3 and putting a message on an SQS queue, an EC2 instance will be spun up to run the test, then shutdown when complete.

## Installation 
```sh
npm install https://github.com/FamilySearch/pewpew/common --save
yarn add https://github.com/FamilySearch/pewpew/common
```

## Usage
### Javascript
```javascript
var ppaas-common = require("ppaas-common");
ppaas-common.log.log("Log to console", ppaas-common.log.LogLevel.ERROR);
```

### TypeScript
```typescript
import { log as logger } from "ppaas-common";
logger.log("Log to console", logger.LogLevel.ERROR);
```

## Environment Config
For your full deployment you should have environment variables injected into CloudFormation to set up the S3 bucket and SQS queues. For local development, copy the `.sample-env` file to `.env.local` (or run `node setup.js`). Then modify the .env.local file to point to your S3 bucket and your SQS queues. You can also override the default AWS profile for your local testing via the `AWS_PROFILE` variable if you are not using `default`.

## Build
```bash
$ npm i && npm run build
```

## Test
```bash
# This will automatically get called when you try to commit
$ npm test
```

## npm run commands
```bash
# start server
$ npm start

# build the TypeScript code (output dir: build/)
$ npm run build

# test
$ npm test

# Run the integration tests that access AWS
# You must set your aws credentials
# For the EC2 instanceId test you must create the file "/var/lib/cloud/data/instance-id"
# on your local box with only an instanceId in the file. It should be i-<name>. Ex. i-localdevelopment
$ npm run integration

# Run the code coverage tests (test + integration)
# You must set your aws credentials
# For the EC2 instanceId test you must create the file "/var/lib/cloud/data/instance-id"
# on your local box with only an instanceId in the file. It should be i-<name>. Ex. i-localdevelopment
$ npm run coverage

# style check TypeScript
$ npm run lint

# delete the build dir
$ npm run clean
```


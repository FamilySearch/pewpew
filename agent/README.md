# ppaas-agent
PewPew as a Service Agent Machine that runs PewPew Tests using Node.js + Typescript

## Purpose
This allows us to run load tests using [pewpew](https://github.com/FamilySearch/pewpew) in AWS without having to manually create an ec2 instance. By putting the test files in s3 and putting a message on an SQS queue, an EC2 instance will be spun up to run the test, then shutdown when complete.

### Shared code
Shared code for the agent and the controller are found in [ppaas-common](https://github.com/FamilySearch/pewpew/common)

## Build

```bash

$ npm i && npm run build

```

## Test

```bash
# This will automatically get called when you try to commit
$ npm test

```

## Integration Tests

```bash
# You must set your aws credentials and have run the Run the local server below
$ npm run integration

```

## Execute PewPew Local Tests

```bash

# You must set your aws credentials
$ npm run createtest

```

## Run the local server

To start the server, run one of the following commands:

 ```bash

 # You must set your aws credentials to start or run tests
 $ npm start
 
 ```

## npm run commands

```bash

# You must set your aws credentials to start
# start server
$ npm start

# build the TypeScript code (output dir: build/)
$ npm run build

# test
$ npm test

# Run the coverage tests (unittests + createtest)
# You must set your aws credentials and have run the Run the local server below
$ npm run coverage

# Run the create and launch tests
# You must set your aws credentials
$ npm run createtest

# style check TypeScript
$ npm run lint

# delete the build dir
$ npm run clean
```

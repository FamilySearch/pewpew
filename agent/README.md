# ppaas-agent
PewPew as a Service Agent Machine that runs PewPew Tests using Node.js + Typescript

## Purpose
This allows us to run load tests using [pewpew](https://github.com/FamilySearch/pewpew) in AWS without having to manually create an ec2 instance. By putting the test files in s3 and putting a message on an SQS queue, an EC2 instance will be spun up to run the test, then shutdown when complete.

### Shared code
Shared code for the agent and the controller are found in [ppaas-common](https://github.com/FamilySearch/pewpew/tree/master/common)

## Environment Config
For your full deployment you should have environment variables injected into CloudFormation to set up the S3 bucket and SQS queues. For local development, copy the `.sample-env` file to `.env.local` (or run `cp -i .sample-env .env.local`). Then modify the .env.local file to point to your S3 bucket and your SQS queues. You can also override the default AWS profile for your local testing via the `AWS_PROFILE` variable if you are not using `default`.

## Build
```bash
$ npm i && npm run build
```

## Mac and Windows Testing
The unit tests, integration, and acceptance tests are designed to run on Linux. As such, the pewpew executable files required for running on Linux are checked into the tree in the test server so that the files are available for our Github Actions (`test/pewpew`).

To override these tests for mac or windows, the pewpew exectuable must be named `pewpew.exe` for Windows and `pewpew.mac` for Mac. These files should then be dropped in the `test/` folder.

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

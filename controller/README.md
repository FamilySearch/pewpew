# ppaas-controller
PewPew as a Service (PPaaS) Controller Machine that runs PewPew Tests using Node.js + Typescript

## Purpose
This allows us to run load tests using [pewpew](https://github.com/FamilySearch/pewpew) in AWS without having to manually create an ec2 instance. By putting the test files in s3 and putting a message on an SQS queue, an EC2 instance will be spun up to run the test, then shutdown when complete.

### Shared code
Shared code for the agent and the controller are found in [ppaas-common](https://github.com/FamilySearch/pewpew/common)

## Environment Config
For your full deployment you should have environment variables injected into CloudFormation to set up the S3 bucket and SQS queues. For local development, copy the `.sample-env` file to `.env.local`. Then modify the .env.local file to point to your S3 bucket and your SQS queues. You can also override the default AWS profile for your local testing via the `AWS_PROFILE` variable if you are not using `default`.

## Build
```bash
$ npm i && npm run build
```

## Mac and Windows Testing
The unit tests, integration, and acceptance tests are designed to run on Linux. As such, the pewpew executable files required for running on Linux are checked into the tree in the test server so that the files are available for our Github Actions (`test/pewpew.zip`).

To override these tests for mac or windows, the pewpew exectuable must be named `pewpew.exe` for Windows and `pewpew.mac` for Mac. These files should then be zipped up as `pewpew.exe.zip` or `pewpew.mac.zip` correspondingly. Then either override the `PEWPEW_ZIP_FILEPATH` environment variable to point to the full path to your zip file, or drop the zipped file in the `test/` folder.

## Test
```bash
# You must set your aws credentials to start or run tests
# This will automatically get called when you try to commit
$ npm test
```

## Acceptance Tests
```bash
# You must set your aws credentials and have run the Run the local server and load the healthcheck `curl http://localhost:3000/api/healthcheck`
$ npm run acceptance
# OR `curl http://localhost:8081/api/healthcheck`
$ PORT=8081 npm run acceptance
```

## Setting your secrets-manager overrides for Integration Tests or Running the local server
You also need to configure your Secrets Overrides. You have two options, get the real key from someone who has it, or generate your own key for testing/development but any files stored encrypted in s3 will only be accessible by you. For the OpenId secret, you will need the real one.

### Generate your own encryption key for testing
1. If you haven't created a `.env.local` run `cp -i .sample.env .env.local`
2. Uncomment the `PEWPEW_ENCRYPT_KEY_OVERRIDE` from `.env.local`
3. Run `openssl rand -hex 16` and copy the value into the quotes for `PEWPEW_ENCRYPT_KEY_OVERRIDE`. Should be something like `a5158c830ac558b21baddb79803105fb`.

### Add your own OpenId Secret
1. If you haven't created a `.env.local` run `cp -i .sample.env .env.local`
2. Uncomment the `PEWPEW_OPENID_SECRET_OVERRIDE` from `.env.local`
3. Enter the value for your secret into the quotes for `PEWPEW_OPENID_SECRET_OVERRIDE`.

## Integration Tests
```bash
# You must set your aws credentials, configure your Secrets overrides, and create a password.txt file as described above
$ npm run integration
```

Alternatively you can generate your own key which will work with encrypt/decrypt

## Run the local server
To start the server, run one of the following commands:
 ```bash
# You must set your aws credentials and configure your Secrets overrides as described above

 # debug mode where it watches your changes. http://localhost:3000
 $ npm run dev

 # production start, must be built first with npm run build http://localhost:8081
 $ npm start
 ```
 Use http://localhost:8081/healthcheck/ after running the above command.

## Run the local server with authentication
Running locally, only dev/integ/okta-np will let you redict back to localhost.

To start the server, run one of the following commands:
 ```bash
 # You must set your aws credentials to start or run tests
 # set AUTH_MODE to any truthy value except the string "false". Example `AUTH_MODE=true`

 # OpenId login. http://localhost:8081
 $ AUTH_MODE=true npm run dev

 # production start, must be built first with npm run build http://localhost:8081
 $ AUTH_MODE=true npm start

 OR

 $ AUTH_MODE=openid npm start
 ```
 Use http://localhost:8081/api/healthcheck/ after running the above command.

 ### Testing the redirect for logging in
 ```bash
 # Run these in separate console after running npm run build
 $ ./startauth.sh
 ```

## npm run commands
```bash
# start server http://localhost:8081
$ npm start

# build the TypeScript code (output dir: dist/)
$ npm run build

# build the Server/Client TypeScript code only (output dir: dist/)
$ npm run build:react

# build the Test/CLR TypeScript code only (output dir: dist/)
$ npm run build:test

 # storybook mode where it watches your changes.
 $ npm run storybook

# test
$ npm test

# Run the acceptance tests
$ npm run acceptance
# OR
$ PORT=8081 npm run acceptance

# Run the integration tests
$ npm run integration

# Run the unittests and integration tests with code coverage
$ npm run coverage

# Clean-up the acceptance tests after they're run locally
# You must set your aws credentials
$ npm run testcleanup

# Clean-up the node_modules because there's a conflict between typescript and @types/react-native
$ npm run fix:install

# style check TypeScript
$ npm run lint

# delete the dist dir and node_modules dir
$ npm run clean
```

### Testing the routing for a public route as a sub-path
See [ServerFalt](https://serverfault.com/questions/536576/nginx-how-do-i-forward-an-http-request-to-another-port) for basis. In general, after this you'll be able to go to `http://localhost/pewpew/load-test/` and load the site as if you were on another domain as a sub-path. You can use the new `./startrouting.sh` to test out routing. In additional `./startauthrouting.sh` is a combination of `startauth.sh` and `startrouting.sh`. `./devrouting.sh` starts up a dev instance with routing turned on at `http://localhost/pewpew/load-test-dev/`

```bash
# Install nginx
$ sudo apt update
$ sudo apt install nginx
$ sudo vi /etc/nginx/sites-available/default
```

At the very top of the file (before the `server {}` section) add these lines:
```conf
upstream nodejs {
        server 127.0.0.1:8081;
        keepalive 256;
}

upstream nodejs2 {
        server 127.0.0.1:8082;
        keepalive 256;
}

upstream nodejs-dev {
        server 127.0.0.1:3000;
        keepalive 256;
}
```

Find the section with `location / {}` and add these sections below it

```conf
location /pewpew/load-test/ {
  proxy_pass      http://nodejs/;
  proxy_set_header   Connection "";
  proxy_http_version 1.1;
  proxy_set_header        Host            $host:$server_port;
  proxy_set_header        X-Real-IP       $remote_addr;
  proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /pewpew/performance-test2/ {
  proxy_pass      http://nodejs2/;
  proxy_set_header   Connection "";
  proxy_http_version 1.1;
  proxy_set_header        Host            $host:$server_port;
  proxy_set_header        X-Real-IP       $remote_addr;
  proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /pewpew/load-test-dev/ {
  proxy_pass      http://nodejs-dev/;
  proxy_set_header   Connection "";
  proxy_http_version 1.1;
  proxy_set_header        Host            $host:$server_port;
  proxy_set_header        X-Real-IP       $remote_addr;
  proxy_set_header        X-Forwarded-For $proxy_add_x_forwarded_for;
}

##### OPTIONAL ######
# Change the default port from 80 to 8088
# Find the lines similar to below but with port 80 and change them to:
listen 8088 default_server;
listen [::]:8088 default_server;
```

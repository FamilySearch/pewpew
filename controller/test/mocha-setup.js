// This file configures ts-node to bypass TypeScript checks
process.env.TS_NODE_TRANSPILE_ONLY = "true"; 
process.env.TS_NODE_COMPILER_OPTIONS = '{"module":"CommonJS"}';
// process.env.TS_NODE_COMPILER_OPTIONS = '{"module":"ESNext"}';

require('dotenv-flow/config');
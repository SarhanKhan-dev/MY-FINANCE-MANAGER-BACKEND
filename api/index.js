// The Nest app must be compiled by tsc (nest build) so decorator metadata survives —
// Vercel's esbuild TS pipeline would strip it and break dependency injection.
module.exports = require('../dist/serverless').default;

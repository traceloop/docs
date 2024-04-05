# Traceloop Documentation

This repository powers the documentation at [https://traceloop.com/docs](https://traceloop.com/docs). 

## What is in this repository?

This repository contains:

- Traceloop's Fern API Definition which lives in the [definition](./fern/definition/) folder.
- MDX files which live in the [pages](./fern/pages) folder.

## What is in the API Definition?

- **API Documentation:** Explore detailed documentation for each of our APIs. Learn about endpoints, request and response formats, authentication methods, and best practices for integration.

- **Getting an API Key:** Follow step-by-step instructions on obtaining your API key. Understand the authentication process and ensure a secure and seamless interaction with our services.

## Definition Validation

To make sure that the definition is valid, you can use the Fern CLI.

```bash
npm install -g fern-api # Installs CLI
fern check # Checks if the definition is valid
```

## Debugging

Encountering errors while generating docs? Run the following command to identify where these errors are occurring:

```bash
fern generate --docs --log-level debug
```

## Static Assets

Static assets should be stored in your [assets](./fern/assets) subdirectory.

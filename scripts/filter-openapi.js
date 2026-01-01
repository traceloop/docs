#!/usr/bin/env node

/**
 * OpenAPI Spec Filter Script
 *
 * Filters an OpenAPI specification to only include paths matching
 * the whitelist patterns defined in openapi-whitelist.yaml
 *
 * Usage: node filter-openapi.js <input-spec> <whitelist-config> <output-spec>
 */

const fs = require("fs");
const yaml = require("js-yaml");
const converter = require("swagger2openapi");

/**
 * Convert a glob pattern to a RegExp
 */
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLE_STAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{DOUBLE_STAR}}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a path matches any of the patterns
 */
function matchesPatterns(apiPath, patterns) {
  return patterns.some((pattern) => globToRegex(pattern).test(apiPath));
}

/**
 * Find all $ref references in an object
 */
function findRefs(obj, refs = new Set()) {
  if (!obj || typeof obj !== "object") return refs;
  if (obj.$ref && typeof obj.$ref === "string") {
    const match = obj.$ref.match(/#\/(components\/schemas|definitions)\/(.+)/);
    if (match) refs.add(match[2]);
  }
  for (const value of Object.values(obj)) {
    findRefs(value, refs);
  }
  return refs;
}

/**
 * Recursively find all schemas referenced by a set of schemas
 */
function findAllReferencedSchemas(schemas, initialRefs) {
  const allRefs = new Set(initialRefs);
  let prevSize = 0;
  while (allRefs.size > prevSize) {
    prevSize = allRefs.size;
    for (const schemaName of [...allRefs]) {
      if (schemas[schemaName]) findRefs(schemas[schemaName], allRefs);
    }
  }
  return allRefs;
}

/**
 * Filter schemas to only include referenced ones
 */
function filterSchemas(schemas, paths) {
  if (!schemas) return undefined;
  const allRefs = findAllReferencedSchemas(schemas, findRefs(paths));
  if (allRefs.size === 0) return undefined;
  const filtered = {};
  for (const [name, schema] of Object.entries(schemas)) {
    if (allRefs.has(name)) filtered[name] = schema;
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/**
 * Filter OpenAPI spec paths based on whitelist
 */
function filterSpec(spec, config) {
  const includePatterns = config.include_paths || [];
  const excludePatterns = config.exclude_paths || [];
  const filteredPaths = {};
  const includedTags = new Set();

  for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
    if (!matchesPatterns(apiPath, includePatterns)) continue;
    if (excludePatterns.length > 0 && matchesPatterns(apiPath, excludePatterns)) continue;

    console.log(`  Including: ${apiPath}`);
    filteredPaths[apiPath] = pathItem;

    for (const method of Object.values(pathItem)) {
      if (method?.tags) method.tags.forEach((tag) => includedTags.add(tag));
    }
  }

  const result = {
    ...spec,
    paths: filteredPaths,
    info: {
      title: "Traceloop API",
      version: "1.0.0",
      ...spec.info,
    },
  };

  // Filter tags
  if (spec.tags && includedTags.size > 0) {
    result.tags = spec.tags.filter((tag) => includedTags.has(tag.name));
  }

  // Filter components/schemas (OpenAPI 3.0)
  if (spec.components?.schemas) {
    const schemas = filterSchemas(spec.components.schemas, filteredPaths);
    result.components = schemas ? { ...spec.components, schemas } : { ...spec.components };
    delete result.components.schemas;
    if (schemas) result.components.schemas = schemas;
  }

  // Filter definitions (Swagger 2.0)
  if (spec.definitions) {
    result.definitions = filterSchemas(spec.definitions, filteredPaths);
    if (!result.definitions) delete result.definitions;
  }

  return result;
}

/**
 * Load a file as JSON or YAML
 */
function loadFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  return filePath.endsWith(".yaml") || filePath.endsWith(".yml")
    ? yaml.load(content)
    : JSON.parse(content);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Usage: node filter-openapi.js <input-spec> <whitelist-config> <output-spec>");
    process.exit(1);
  }

  const [inputPath, configPath, outputPath] = args;
  console.log("OpenAPI Spec Filter");
  console.log("==================");
  console.log(`Input:  ${inputPath}`);
  console.log(`Config: ${configPath}`);
  console.log(`Output: ${outputPath}\n`);

  const spec = loadFile(inputPath);
  const config = loadFile(configPath);

  console.log(`Found ${Object.keys(spec.paths || {}).length} paths in source spec`);
  console.log(`Filtering with ${config.include_paths?.length || 0} include patterns\n`);

  const filteredSpec = filterSpec(spec, config);
  console.log(`\nResult: ${Object.keys(filteredSpec.paths || {}).length} paths included`);

  // Convert Swagger 2.0 to OpenAPI 3.0
  let outputSpec = filteredSpec;
  if (filteredSpec.swagger?.startsWith("2.")) {
    console.log("\nConverting Swagger 2.0 to OpenAPI 3.0...");
    const result = await converter.convertObj(filteredSpec, { patch: true, warnOnly: true });
    outputSpec = result.openapi;
  }

  fs.writeFileSync(outputPath, JSON.stringify(outputSpec, null, 2));
  console.log(`Written to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

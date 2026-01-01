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
const path = require("path");
const yaml = require("js-yaml");

/**
 * Convert Swagger 2.0 to OpenAPI 3.0
 */
function convertSwagger2ToOpenAPI3(swagger) {
  if (!swagger.swagger || !swagger.swagger.startsWith("2.")) {
    // Already OpenAPI 3.x or not Swagger
    return swagger;
  }

  const openapi = {
    openapi: "3.0.3",
    info: swagger.info || { title: "API", version: "1.0.0" },
    paths: {},
  };

  // Convert host/basePath/schemes to servers
  if (swagger.host || swagger.basePath) {
    const scheme = swagger.schemes?.[0] || "https";
    const host = swagger.host || "api.example.com";
    const basePath = swagger.basePath || "";
    openapi.servers = [{ url: `${scheme}://${host}${basePath}` }];
  }

  // Convert paths
  for (const [pathKey, pathItem] of Object.entries(swagger.paths || {})) {
    openapi.paths[pathKey] = {};

    for (const [method, operation] of Object.entries(pathItem)) {
      if (["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) {
        const newOp = { ...operation };

        // Convert parameters
        if (newOp.parameters) {
          newOp.parameters = newOp.parameters.filter((p) => p.in !== "body").map((p) => {
            if (p.type) {
              return {
                name: p.name,
                in: p.in,
                description: p.description,
                required: p.required,
                schema: { type: p.type, format: p.format, enum: p.enum },
              };
            }
            return p;
          });

          // Convert body parameter to requestBody
          const bodyParam = operation.parameters?.find((p) => p.in === "body");
          if (bodyParam) {
            newOp.requestBody = {
              description: bodyParam.description,
              required: bodyParam.required,
              content: {
                "application/json": {
                  schema: convertSchemaRef(bodyParam.schema),
                },
              },
            };
          }
        }

        // Convert responses
        if (newOp.responses) {
          for (const [code, response] of Object.entries(newOp.responses)) {
            if (response.schema) {
              newOp.responses[code] = {
                description: response.description || "",
                content: {
                  "application/json": {
                    schema: convertSchemaRef(response.schema),
                  },
                },
              };
            }
          }
        }

        // Remove Swagger 2.0 specific fields
        delete newOp.consumes;
        delete newOp.produces;

        openapi.paths[pathKey][method] = newOp;
      } else {
        openapi.paths[pathKey][method] = pathItem[method];
      }
    }
  }

  // Convert definitions to components/schemas
  if (swagger.definitions) {
    openapi.components = openapi.components || {};
    openapi.components.schemas = {};
    for (const [name, schema] of Object.entries(swagger.definitions)) {
      openapi.components.schemas[name] = convertSchemaRefs(schema);
    }
  }

  // Convert securityDefinitions to components/securitySchemes
  if (swagger.securityDefinitions) {
    openapi.components = openapi.components || {};
    openapi.components.securitySchemes = {};
    for (const [name, def] of Object.entries(swagger.securityDefinitions)) {
      if (def.type === "apiKey") {
        openapi.components.securitySchemes[name] = {
          type: "apiKey",
          in: def.in,
          name: def.name,
          description: def.description,
        };
      } else if (def.type === "oauth2") {
        openapi.components.securitySchemes[name] = {
          type: "oauth2",
          flows: {
            implicit: {
              authorizationUrl: def.authorizationUrl,
              scopes: def.scopes || {},
            },
          },
        };
      } else if (def.type === "basic") {
        openapi.components.securitySchemes[name] = {
          type: "http",
          scheme: "basic",
        };
      }
    }
  }

  // Copy tags
  if (swagger.tags) {
    openapi.tags = swagger.tags;
  }

  return openapi;
}

/**
 * Convert $ref from #/definitions/ to #/components/schemas/
 */
function convertSchemaRef(schema) {
  if (!schema) return schema;
  if (schema.$ref) {
    return { $ref: schema.$ref.replace("#/definitions/", "#/components/schemas/") };
  }
  return convertSchemaRefs(schema);
}

/**
 * Recursively convert all $refs in a schema
 */
function convertSchemaRefs(obj) {
  if (!obj || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(convertSchemaRefs);
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "$ref" && typeof value === "string") {
      result[key] = value.replace("#/definitions/", "#/components/schemas/");
    } else {
      result[key] = convertSchemaRefs(value);
    }
  }
  return result;
}

/**
 * Convert a glob pattern to a RegExp
 * Supports * as a wildcard for path segments
 */
function globToRegex(pattern) {
  // Escape special regex characters except *
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
  return patterns.some((pattern) => {
    const regex = globToRegex(pattern);
    return regex.test(apiPath);
  });
}

/**
 * Find all $ref references in an object
 * Supports both OpenAPI 3.0 (#/components/schemas/) and Swagger 2.0 (#/definitions/)
 */
function findRefs(obj, refs = new Set()) {
  if (!obj || typeof obj !== "object") return refs;

  if (obj.$ref && typeof obj.$ref === "string") {
    // OpenAPI 3.0 format
    let match = obj.$ref.match(/#\/components\/schemas\/(.+)/);
    if (match) {
      refs.add(match[1]);
    }
    // Swagger 2.0 format
    match = obj.$ref.match(/#\/definitions\/(.+)/);
    if (match) {
      refs.add(match[1]);
    }
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
      if (schemas[schemaName]) {
        findRefs(schemas[schemaName], allRefs);
      }
    }
  }

  return allRefs;
}

/**
 * Filter definitions/components to only include schemas referenced by included paths
 * Supports both Swagger 2.0 (definitions) and OpenAPI 3.0 (components/schemas)
 */
function filterDefinitions(definitions, paths) {
  if (!definitions) return undefined;

  const referencedSchemas = findRefs(paths);
  const allReferencedSchemas = findAllReferencedSchemas(definitions, referencedSchemas);

  if (allReferencedSchemas.size === 0) return undefined;

  const filteredDefinitions = {};
  for (const [name, schema] of Object.entries(definitions)) {
    if (allReferencedSchemas.has(name)) {
      filteredDefinitions[name] = schema;
    }
  }

  return Object.keys(filteredDefinitions).length > 0 ? filteredDefinitions : undefined;
}

/**
 * Filter components to only include schemas referenced by included paths (OpenAPI 3.0)
 */
function filterComponents(components, paths) {
  if (!components) return undefined;

  const referencedSchemas = findRefs(paths);
  const allReferencedSchemas = components.schemas
    ? findAllReferencedSchemas(components.schemas, referencedSchemas)
    : new Set();

  const filteredComponents = {};

  // Filter schemas
  if (components.schemas && allReferencedSchemas.size > 0) {
    filteredComponents.schemas = {};
    for (const [name, schema] of Object.entries(components.schemas)) {
      if (allReferencedSchemas.has(name)) {
        filteredComponents.schemas[name] = schema;
      }
    }
  }

  // Copy other component types that are referenced
  const otherComponentTypes = [
    "responses",
    "parameters",
    "requestBodies",
    "headers",
    "securitySchemes",
  ];
  for (const type of otherComponentTypes) {
    if (components[type]) {
      filteredComponents[type] = components[type];
    }
  }

  return Object.keys(filteredComponents).length > 0
    ? filteredComponents
    : undefined;
}

/**
 * Filter OpenAPI spec paths based on whitelist
 */
function filterOpenAPISpec(spec, config) {
  const includePatterns = config.include_paths || [];
  const excludePatterns = config.exclude_paths || [];

  const filteredPaths = {};
  const includedTags = new Set();

  for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
    // Check if path matches include patterns
    if (!matchesPatterns(apiPath, includePatterns)) {
      continue;
    }

    // Check if path matches exclude patterns
    if (
      excludePatterns.length > 0 &&
      matchesPatterns(apiPath, excludePatterns)
    ) {
      continue;
    }

    console.log(`  Including: ${apiPath}`);
    filteredPaths[apiPath] = pathItem;

    // Collect tags used by included paths
    for (const method of Object.values(pathItem)) {
      if (method && typeof method === "object" && method.tags) {
        method.tags.forEach((tag) => includedTags.add(tag));
      }
    }
  }

  // Build filtered spec
  const filteredSpec = {
    ...spec,
    paths: filteredPaths,
  };

  // Ensure required info fields exist (Swagger 2.0 / OpenAPI 3.0)
  if (!filteredSpec.info) {
    filteredSpec.info = {};
  }
  if (!filteredSpec.info.title) {
    filteredSpec.info.title = "Traceloop API";
  }
  if (!filteredSpec.info.version) {
    filteredSpec.info.version = "1.0.0";
  }

  // Filter tags to only include those used by included paths
  if (spec.tags && includedTags.size > 0) {
    filteredSpec.tags = spec.tags.filter((tag) => includedTags.has(tag.name));
  }

  // Filter components/definitions to only include referenced schemas
  // OpenAPI 3.0 uses components.schemas, Swagger 2.0 uses definitions
  if (spec.components) {
    const filteredComponents = filterComponents(spec.components, filteredPaths);
    if (filteredComponents) {
      filteredSpec.components = filteredComponents;
    } else {
      delete filteredSpec.components;
    }
  }

  if (spec.definitions) {
    const filteredDefs = filterDefinitions(spec.definitions, filteredPaths);
    if (filteredDefs) {
      filteredSpec.definitions = filteredDefs;
    } else {
      delete filteredSpec.definitions;
    }
  }

  return filteredSpec;
}

/**
 * Convert a path like /v2/organizations to a slug like organizations
 */
function pathToSlug(apiPath) {
  // Remove leading slash, split by /, take last meaningful segment
  const parts = apiPath.split("/").filter(Boolean);
  // Use last part, replace {param} with param
  return parts[parts.length - 1].replace(/[{}]/g, "");
}

/**
 * Convert a path like /v2/organizations to a group name like Organizations
 */
function pathToGroupName(apiPath) {
  const slug = pathToSlug(apiPath);
  // Capitalize first letter, replace underscores with spaces
  return slug
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Generate MDX files for each endpoint in the filtered spec
 */
function generateMdxFiles(filteredSpec, outputDir) {
  const apiRefDir = path.join(outputDir, "api-reference");
  const generatedPages = [];

  for (const [apiPath, pathItem] of Object.entries(filteredSpec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      // Skip non-HTTP methods (like parameters, summary, etc.)
      if (!["get", "post", "put", "patch", "delete"].includes(method)) {
        continue;
      }

      const slug = pathToSlug(apiPath);
      const groupDir = path.join(apiRefDir, slug);

      // Create directory if it doesn't exist
      if (!fs.existsSync(groupDir)) {
        fs.mkdirSync(groupDir, { recursive: true });
      }

      // Generate filename from operationId or method + path
      const operationId = operation.operationId || `${method}_${slug}`;
      const filename = operationId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

      const mdxPath = path.join(groupDir, `${filename}.mdx`);
      const title = operation.summary || `${method.toUpperCase()} ${apiPath}`;

      const mdxContent = `---
title: "${title}"
api: "${method.toUpperCase()} ${apiPath}"
---
`;

      fs.writeFileSync(mdxPath, mdxContent);
      console.log(`  Generated: api-reference/${slug}/${filename}.mdx`);

      generatedPages.push({
        group: pathToGroupName(apiPath),
        page: `api-reference/${slug}/${filename}`,
      });
    }
  }

  return generatedPages;
}

/**
 * Load a file as JSON or YAML based on extension
 */
function loadFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return yaml.load(content);
  }
  return JSON.parse(content);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(
      "Usage: node filter-openapi.js <input-spec> <whitelist-config> <output-spec>"
    );
    process.exit(1);
  }

  const [inputPath, configPath, outputPath] = args;

  console.log("OpenAPI Spec Filter");
  console.log("==================");
  console.log(`Input:  ${inputPath}`);
  console.log(`Config: ${configPath}`);
  console.log(`Output: ${outputPath}`);
  console.log("");

  // Load input spec
  const spec = loadFile(inputPath);

  // Load whitelist config
  const config = loadFile(configPath);

  const pathCount = Object.keys(spec.paths || {}).length;
  console.log(`Found ${pathCount} paths in source spec`);
  console.log(`Filtering with ${config.include_paths?.length || 0} include patterns`);
  console.log("");

  // Filter the spec
  const filteredSpec = filterOpenAPISpec(spec, config);

  const filteredPathCount = Object.keys(filteredSpec.paths || {}).length;
  console.log("");
  console.log(`Result: ${filteredPathCount} paths included`);

  // Convert Swagger 2.0 to OpenAPI 3.0 (required by Mintlify)
  let outputSpec = filteredSpec;
  if (filteredSpec.swagger && filteredSpec.swagger.startsWith("2.")) {
    console.log("");
    console.log("Converting Swagger 2.0 to OpenAPI 3.0...");
    outputSpec = convertSwagger2ToOpenAPI3(filteredSpec);
  }

  // Write output as JSON
  fs.writeFileSync(outputPath, JSON.stringify(outputSpec, null, 2));
  console.log(`Written to: ${outputPath}`);

  // Generate MDX files for each endpoint
  console.log("");
  console.log("Generating MDX files...");
  const outputDir = path.dirname(outputPath);
  const generatedPages = generateMdxFiles(filteredSpec, outputDir);

  // Output navigation config hint
  if (generatedPages.length > 0) {
    console.log("");
    console.log("Add the following to your mint.json navigation:");
    const groups = {};
    for (const { group, page } of generatedPages) {
      if (!groups[group]) groups[group] = [];
      groups[group].push(page);
    }
    for (const [group, pages] of Object.entries(groups)) {
      console.log(JSON.stringify({ group, pages }, null, 2));
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

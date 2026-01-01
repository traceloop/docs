#!/usr/bin/env node

/**
 * Updates mint.json navigation with generated API reference pages
 *
 * Usage: node update-mint-navigation.js <openapi-spec>
 */

const fs = require("fs");
const path = require("path");

/**
 * Group endpoints by tag from OpenAPI spec
 */
function getGroupsFromSpec(spec) {
  const groups = {};

  for (const [apiPath, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;

      const tag = operation.tags?.[0] || "API";
      const groupName = tag.charAt(0).toUpperCase() + tag.slice(1);

      if (!groups[groupName]) groups[groupName] = [];

      // Generate the page path (matching @mintlify/scraping output)
      const summary = operation.summary || `${method} ${apiPath}`;
      const pageName = summary
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const pagePath = `api-reference/${tag}/${pageName}`;

      if (!groups[groupName].includes(pagePath)) {
        groups[groupName].push(pagePath);
      }
    }
  }

  return groups;
}

/**
 * Update mint.json with new API reference navigation
 * Only manages groups AFTER the "API Reference" intro group
 * Groups before it are preserved untouched
 */
function updateMintJson(mintPath, groups) {
  const mint = JSON.parse(fs.readFileSync(mintPath, "utf8"));

  // Find the "API Reference" intro group - this marks where API endpoint groups start
  const apiRefIntroIndex = mint.navigation.findIndex(
    (g) => g.group === "API Reference" && g.pages?.some((p) => p === "api-reference/introduction")
  );

  if (apiRefIntroIndex === -1) {
    console.error("Error: Could not find 'API Reference' intro group in mint.json");
    process.exit(1);
  }

  // Remove all groups after "API Reference" intro (these are the API endpoint groups)
  const removedGroups = mint.navigation.splice(apiRefIntroIndex + 1);
  console.log(`  Removed ${removedGroups.length} existing API groups`);

  // Add new groups from the spec
  const newGroups = Object.entries(groups).map(([groupName, pages]) => ({
    group: groupName,
    pages: pages.sort(),
  }));

  mint.navigation.push(...newGroups);
  console.log(`  Added ${newGroups.length} API groups from spec`);

  fs.writeFileSync(mintPath, JSON.stringify(mint, null, 2) + "\n");
  console.log(`\nUpdated mint.json navigation`);

  return groups;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: node update-mint-navigation.js <openapi-spec>");
    process.exit(1);
  }

  const [specPath] = args;
  const mintPath = path.join(process.cwd(), "mint.json");

  console.log("Updating mint.json navigation...");
  console.log(`OpenAPI spec: ${specPath}`);
  console.log(`mint.json: ${mintPath}`);

  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const groups = getGroupsFromSpec(spec);

  console.log(`\nFound ${Object.keys(groups).length} groups:`);
  for (const [group, pages] of Object.entries(groups)) {
    console.log(`  ${group}: ${pages.length} pages`);
  }

  updateMintJson(mintPath, groups);
  console.log("\nNavigation updated successfully!");
}

main();

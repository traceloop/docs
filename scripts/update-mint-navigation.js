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
 */
function updateMintJson(mintPath, groups) {
  const mint = JSON.parse(fs.readFileSync(mintPath, "utf8"));

  // Find the "API Reference" intro group index
  const apiRefIntroIndex = mint.navigation.findIndex(
    (g) => g.group === "API Reference" && g.pages?.includes("api-reference/introduction")
  );

  // Remove all existing API reference groups (except intro)
  const apiGroupNames = Object.keys(groups);
  mint.navigation = mint.navigation.filter((g) => {
    // Keep non-API groups
    if (!apiGroupNames.includes(g.group) && g.group !== "API Reference") return true;
    // Keep the API Reference intro group
    if (g.group === "API Reference" && g.pages?.includes("api-reference/introduction")) return true;
    return false;
  });

  // Find where to insert (after API Reference intro)
  let insertIndex = mint.navigation.findIndex(
    (g) => g.group === "API Reference"
  );
  if (insertIndex === -1) insertIndex = mint.navigation.length;
  else insertIndex += 1;

  // Add new groups
  const newGroups = Object.entries(groups).map(([group, pages]) => ({
    group,
    pages: pages.sort(),
  }));

  mint.navigation.splice(insertIndex, 0, ...newGroups);

  fs.writeFileSync(mintPath, JSON.stringify(mint, null, 2) + "\n");
  console.log(`Updated mint.json with ${newGroups.length} API groups`);

  return newGroups;
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

  const updated = updateMintJson(mintPath, groups);
  console.log("\nNavigation updated successfully!");
}

main();

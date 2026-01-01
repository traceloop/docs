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
 * Only manages api-reference/* pages, preserving other pages in groups
 */
function updateMintJson(mintPath, groups) {
  const mint = JSON.parse(fs.readFileSync(mintPath, "utf8"));

  let updatedCount = 0;
  let addedCount = 0;
  let removedCount = 0;

  // Get all group names from the spec
  const specGroupNames = new Set(Object.keys(groups));

  // Process existing navigation groups
  for (let i = mint.navigation.length - 1; i >= 0; i--) {
    const navGroup = mint.navigation[i];
    const existingPages = navGroup.pages || [];

    // Check if this group has any api-reference pages
    const hasApiRefPages = existingPages.some(
      (p) => typeof p === "string" && p.startsWith("api-reference/")
    );

    if (!hasApiRefPages) continue; // Skip groups without api-reference pages

    // Separate api-reference pages from other pages
    const nonApiRefPages = existingPages.filter(
      (p) => typeof p !== "string" || !p.startsWith("api-reference/")
    );

    if (specGroupNames.has(navGroup.group)) {
      // Group exists in spec - replace api-reference pages with new ones
      const newApiRefPages = groups[navGroup.group] || [];
      const mergedPages = [...nonApiRefPages, ...newApiRefPages].sort();

      if (mergedPages.length > 0) {
        mint.navigation[i].pages = mergedPages;
        console.log(`  Updated: ${navGroup.group} (${newApiRefPages.length} api-ref pages)`);
        updatedCount++;
      } else {
        // No pages left - remove group
        mint.navigation.splice(i, 1);
        console.log(`  Removed: ${navGroup.group} (empty)`);
        removedCount++;
      }

      // Mark as processed
      specGroupNames.delete(navGroup.group);
    } else {
      // Group not in spec - remove only api-reference pages
      if (nonApiRefPages.length > 0) {
        mint.navigation[i].pages = nonApiRefPages;
        console.log(`  Cleaned: ${navGroup.group} (removed api-ref pages)`);
      } else {
        // Only had api-reference pages - remove entire group
        mint.navigation.splice(i, 1);
        console.log(`  Removed: ${navGroup.group} (only had api-ref pages)`);
        removedCount++;
      }
    }
  }

  // Add new groups that don't exist yet
  for (const groupName of specGroupNames) {
    const pages = groups[groupName];
    if (pages.length === 0) continue;

    // Find where to insert (after API Reference intro)
    const apiRefIndex = mint.navigation.findIndex(
      (g) => g.group === "API Reference" && g.pages?.includes("api-reference/introduction")
    );
    const insertIndex = apiRefIndex !== -1 ? apiRefIndex + 1 : mint.navigation.length;

    mint.navigation.splice(insertIndex, 0, {
      group: groupName,
      pages: pages.sort(),
    });
    console.log(`  Added: ${groupName} (${pages.length} pages)`);
    addedCount++;
  }

  fs.writeFileSync(mintPath, JSON.stringify(mint, null, 2) + "\n");
  console.log(`\nUpdated mint.json: ${updatedCount} updated, ${addedCount} added, ${removedCount} removed`);

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

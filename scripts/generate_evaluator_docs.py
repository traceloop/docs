#!/usr/bin/env python3
"""
Generate MDX documentation for evaluator API routes from swagger.json.

Usage:
    python generate_evaluator_docs.py --swagger /path/to/swagger.json
    python generate_evaluator_docs.py  # Uses default paths
"""

import argparse
import json
import os
import re
from pathlib import Path
from typing import Any


DEFAULT_SWAGGER_PATH = "/Users/ninakollman/Traceloop/api-service/docs/swagger.json" #You can also change it to your local swagger.json path
DEFAULT_DOCS_PATH = "/Users/ninakollman/Traceloop/docs" #You can also change it to your local docs path
API_BASE_URL = "https://api.traceloop.com"
EVALUATOR_PATH_PREFIX = "/v2/evaluators/execute/"


def load_swagger(swagger_path: str) -> dict:
    """Load and parse the swagger.json file."""
    with open(swagger_path, "r") as f:
        return json.load(f)


def resolve_ref(swagger: dict, ref: str) -> dict:
    """Resolve a $ref pointer to its definition."""
    if not ref.startswith("#/definitions/"):
        return {}
    def_name = ref.replace("#/definitions/", "")
    return swagger.get("definitions", {}).get(def_name, {})


def resolve_schema(swagger: dict, schema: dict, depth: int = 0) -> dict:
    """Recursively resolve a schema, following $ref pointers."""
    if depth > 10:  # Prevent infinite recursion
        return schema

    if "$ref" in schema:
        resolved = resolve_ref(swagger, schema["$ref"])
        return resolve_schema(swagger, resolved, depth + 1)

    result = schema.copy()

    # Resolve nested properties
    if "properties" in result:
        resolved_props = {}
        for prop_name, prop_schema in result["properties"].items():
            resolved_props[prop_name] = resolve_schema(swagger, prop_schema, depth + 1)
        result["properties"] = resolved_props

    # Resolve items in arrays
    if "items" in result:
        result["items"] = resolve_schema(swagger, result["items"], depth + 1)

    return result


def get_evaluator_routes(swagger: dict) -> list[dict]:
    """Extract all evaluator execute routes from swagger."""
    routes = []
    paths = swagger.get("paths", {})

    for path, methods in paths.items():
        if not path.startswith(EVALUATOR_PATH_PREFIX):
            continue

        slug = path.replace(EVALUATOR_PATH_PREFIX, "")
        post_method = methods.get("post", {})

        if not post_method:
            continue

        # Get request schema
        request_schema = {}
        for param in post_method.get("parameters", []):
            if param.get("in") == "body" and "schema" in param:
                request_schema = resolve_schema(swagger, param["schema"])
                break

        # Get response schema
        response_schema = {}
        responses = post_method.get("responses", {})
        if "200" in responses and "schema" in responses["200"]:
            response_schema = resolve_schema(swagger, responses["200"]["schema"])

        routes.append({
            "slug": slug,
            "path": path,
            "summary": post_method.get("summary", ""),
            "description": post_method.get("description", ""),
            "request_schema": request_schema,
            "response_schema": response_schema,
        })

    # Sort by slug for consistent ordering
    routes.sort(key=lambda r: r["slug"])
    return routes


def slug_to_title(slug: str) -> str:
    """Convert a slug to a title (e.g., 'char-count' -> 'Char Count')."""
    return " ".join(word.capitalize() for word in slug.split("-"))


def get_type_string(schema: dict) -> str:
    """Get a human-readable type string from a schema."""
    if "type" in schema:
        base_type = schema["type"]
        if base_type == "array" and "items" in schema:
            item_type = get_type_string(schema["items"])
            return f"{item_type}[]"
        return base_type
    if "$ref" in schema:
        return schema["$ref"].split("/")[-1]
    return "object"


def generate_param_fields(
    schema: dict, field_type: str = "body", indent: int = 0
) -> str:
    """Generate ParamField or ResponseField components from a schema."""
    if not schema.get("properties"):
        return ""

    lines = []
    required_fields = set(schema.get("required", []))
    properties = schema.get("properties", {})

    for prop_name, prop_schema in properties.items():
        is_required = prop_name in required_fields
        prop_type = get_type_string(prop_schema)
        example = prop_schema.get("example", "")
        description = prop_schema.get("description", "")

        # Build the field tag
        required_attr = " required" if is_required else ""

        if field_type == "body":
            tag = f'<ParamField body="{prop_name}" type="{prop_type}"{required_attr}>'
        else:
            tag = f'<ResponseField name="{prop_name}" type="{prop_type}">'

        # Add description/example
        content = ""
        if description:
            content = description
        elif example:
            content = f"Example: `{example}`"

        # Handle nested objects
        nested_content = ""
        if prop_schema.get("properties"):
            nested_fields = generate_param_fields(
                prop_schema, field_type, indent + 2
            )
            if nested_fields:
                nested_content = f'\n  <Expandable title="{prop_name} object">\n{nested_fields}\n  </Expandable>\n'

        close_tag = "</ParamField>" if field_type == "body" else "</ResponseField>"

        if nested_content:
            lines.append(f"{tag}{nested_content}{close_tag}")
        elif content:
            lines.append(f"{tag}\n  {content}\n{close_tag}")
        else:
            lines.append(f"{tag}{close_tag}")

    return "\n\n".join(lines)


def parse_description_for_params(description: str) -> dict[str, str]:
    """Parse the description to extract parameter info."""
    params = {}
    # Match patterns like: `input.text` (string, required): description
    pattern = r"`([^`]+)`\s*\(([^)]+)\):\s*(.+?)(?=\n-|\n\n|$)"
    matches = re.findall(pattern, description, re.DOTALL)
    for match in matches:
        field_path = match[0]  # e.g., "input.text"
        type_info = match[1]   # e.g., "string, required"
        desc = match[2].strip()
        params[field_path] = {"type_info": type_info, "description": desc}
    return params


def generate_mdx(route: dict) -> str:
    """Generate MDX content for an evaluator route."""
    slug = route["slug"]
    title = slug_to_title(slug)
    api_path = f"{API_BASE_URL}{route['path']}"

    # Parse description for better param info
    raw_description = route.get("description", "")
    # Extract the main description (before the **Request Body:** section)
    main_desc = raw_description.split("**Request Body:**")[0].strip()
    if not main_desc:
        main_desc = route.get("summary", f"Execute the {title} evaluator.")

    # Generate request body fields
    request_schema = route.get("request_schema", {})
    request_fields = generate_param_fields(request_schema, "body")

    # Generate response fields
    response_schema = route.get("response_schema", {})
    response_fields = generate_param_fields(response_schema, "response")

    # Build example request
    example_request = build_example_request(request_schema)

    # Build example response
    example_response = build_example_response(response_schema)

    # Build the MDX content
    mdx = f'''---
title: "{title}"
api: "POST {api_path}"
---

{main_desc}

## Request Body

{request_fields if request_fields else "No request body parameters."}

## Response

{response_fields if response_fields else "Returns an empty response on success."}
'''

    # Add example section if we have examples
    if example_request or example_response:
        mdx += "\n## Example\n"
        if example_request:
            mdx += f"\n### Request\n\n```json\n{json.dumps(example_request, indent=2)}\n```\n"
        if example_response:
            mdx += f"\n### Response\n\n```json\n{json.dumps(example_response, indent=2)}\n```\n"

    return mdx


def build_example_request(schema: dict) -> dict:
    """Build an example request object from schema."""
    return build_example_object(schema)


def build_example_response(schema: dict) -> dict:
    """Build an example response object from schema."""
    return build_example_object(schema)


def build_example_object(schema: dict, depth: int = 0) -> Any:
    """Recursively build an example object from a schema."""
    if depth > 5:
        return None

    if "example" in schema:
        return schema["example"]

    schema_type = schema.get("type", "object")

    if schema_type == "string":
        return schema.get("example", "string")
    if schema_type == "integer":
        return schema.get("example", 0)
    if schema_type == "number":
        return schema.get("example", 0.0)
    if schema_type == "boolean":
        return schema.get("example", True)
    if schema_type == "array":
        items = schema.get("items", {})
        item_example = build_example_object(items, depth + 1)
        return [item_example] if item_example is not None else []

    if schema_type == "object" or "properties" in schema:
        result = {}
        for prop_name, prop_schema in schema.get("properties", {}).items():
            prop_example = build_example_object(prop_schema, depth + 1)
            if prop_example is not None:
                result[prop_name] = prop_example
        return result if result else None

    return None


def update_mint_json(mint_path: str, evaluator_slugs: list[str]) -> None:
    """Update mint.json to include evaluator pages in navigation."""
    with open(mint_path, "r") as f:
        mint = json.load(f)

    # Build the evaluator pages list
    evaluator_pages = [f"api-reference/evaluators/{slug}" for slug in evaluator_slugs]

    # Find if Evaluators group already exists in navigation
    navigation = mint.get("navigation", [])
    evaluators_group = None
    evaluators_index = None

    for i, group in enumerate(navigation):
        if isinstance(group, dict) and group.get("group") == "Evaluators":
            evaluators_group = group
            evaluators_index = i
            break

    if evaluators_group:
        # Update existing group
        evaluators_group["pages"] = evaluator_pages
    else:
        # Add new group after "Warehouse" group
        new_group = {"group": "Evaluators", "pages": evaluator_pages}

        # Find the Warehouse group to insert after it
        warehouse_index = None
        for i, group in enumerate(navigation):
            if isinstance(group, dict) and group.get("group") == "Warehouse":
                warehouse_index = i
                break

        if warehouse_index is not None:
            navigation.insert(warehouse_index + 1, new_group)
        else:
            # Just append at the end
            navigation.append(new_group)

    mint["navigation"] = navigation

    with open(mint_path, "w") as f:
        json.dump(mint, f, indent=2)
        f.write("\n")


def main():
    parser = argparse.ArgumentParser(
        description="Generate MDX documentation for evaluator API routes."
    )
    parser.add_argument(
        "--swagger",
        default=DEFAULT_SWAGGER_PATH,
        help=f"Path to swagger.json (default: {DEFAULT_SWAGGER_PATH})",
    )
    parser.add_argument(
        "--docs-path",
        default=DEFAULT_DOCS_PATH,
        help=f"Path to docs directory (default: {DEFAULT_DOCS_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print generated content without writing files",
    )
    args = parser.parse_args()

    # Load swagger
    print(f"Loading swagger from: {args.swagger}")
    swagger = load_swagger(args.swagger)

    # Get evaluator routes
    routes = get_evaluator_routes(swagger)
    print(f"Found {len(routes)} evaluator routes")

    # Create output directory
    output_dir = Path(args.docs_path) / "api-reference" / "evaluators"
    if not args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)

    # Generate MDX for each route
    evaluator_slugs = []
    for route in routes:
        slug = route["slug"]
        evaluator_slugs.append(slug)
        mdx_content = generate_mdx(route)

        if args.dry_run:
            print(f"\n{'='*60}")
            print(f"File: {slug}.mdx")
            print("="*60)
            print(mdx_content[:500] + "..." if len(mdx_content) > 500 else mdx_content)
        else:
            output_file = output_dir / f"{slug}.mdx"
            with open(output_file, "w") as f:
                f.write(mdx_content)
            print(f"Generated: {output_file}")

    # Update mint.json
    if not args.dry_run:
        mint_path = Path(args.docs_path) / "mint.json"
        update_mint_json(str(mint_path), evaluator_slugs)
        print(f"\nUpdated: {mint_path}")

    print(f"\nDone! Generated {len(routes)} evaluator documentation files.")


if __name__ == "__main__":
    main()

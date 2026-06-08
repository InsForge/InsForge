#!/bin/bash

print_setup_help() {
    echo ""
    echo -e "${BLUE}Local setup:${NC}"
    echo "  cp .env.example .env"
    echo "  docker compose -f docker-compose.prod.yml up"
    echo ""
    echo "Then rerun:"
    echo "  npm run test:e2e"
    echo ""
    echo "If your backend runs elsewhere, set:"
    echo "  export TEST_API_BASE=http://localhost:7130/api"
    echo "  export ROOT_ADMIN_USERNAME=admin"
    echo "  export ROOT_ADMIN_PASSWORD=change-this-password"
    echo "  export ACCESS_API_KEY=ik_..."
}

extract_json_value() {
    local json="$1"
    local key="$2"

    if command -v jq >/dev/null 2>&1; then
        echo "$json" | jq -r --arg key "$key" '.[$key] // empty' 2>/dev/null
        return
    fi

    echo "$json" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

json_escape() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/\\n}"
    value="${value//$'\r'/\\r}"
    value="${value//$'\t'/\\t}"
    echo "$value"
}

build_admin_login_body() {
    if command -v jq >/dev/null 2>&1; then
        jq -n --arg username "$TEST_ADMIN_USERNAME" --arg password "$TEST_ADMIN_PASSWORD" \
            '{username: $username, password: $password}'
        return
    fi

    local escaped_username
    local escaped_password
    escaped_username=$(json_escape "$TEST_ADMIN_USERNAME")
    escaped_password=$(json_escape "$TEST_ADMIN_PASSWORD")
    printf '{"username":"%s","password":"%s"}' "$escaped_username" "$escaped_password"
}

preflight_curl() {
    curl -sS --connect-timeout "${PREFLIGHT_CONNECT_TIMEOUT:-5}" --max-time "${PREFLIGHT_MAX_TIME:-10}" "$@"
}

get_admin_token() {
    local body
    local response
    body=$(build_admin_login_body)
    response=$(preflight_curl -X POST "$TEST_API_BASE/auth/admin/sessions" \
        -H "Content-Type: application/json" \
        -d "$body" 2>/dev/null)

    extract_json_value "$response" "accessToken"
}

get_api_key_from_metadata() {
    local admin_token="$1"
    local response
    response=$(preflight_curl "$TEST_API_BASE/metadata/api-key" \
        -H "Authorization: Bearer $admin_token" 2>/dev/null)

    extract_json_value "$response" "apiKey"
}

run_preflight() {
    echo -e "${YELLOW}=== Running E2E Preflight ===${NC}"

    if ! command -v curl >/dev/null 2>&1; then
        echo -e "${RED}Preflight failed: curl is required but was not found.${NC}"
        return 1
    fi

    local health_response
    local health_status
    health_response=$(preflight_curl -w "\n%{http_code}" "$TEST_API_BASE/health" 2>/dev/null)
    health_status=$(echo "$health_response" | tail -n 1)

    if [ "$health_status" != "200" ]; then
        echo -e "${RED}Preflight failed: backend health check did not return 200.${NC}"
        echo "Checked: $TEST_API_BASE/health"
        echo "Status: ${health_status:-unreachable}"
        print_setup_help
        return 1
    fi

    echo -e "${GREEN}✓ Backend health check passed${NC}"

    local admin_token
    admin_token=$(get_admin_token)

    if [ -z "$admin_token" ]; then
        echo -e "${RED}Preflight failed: admin login did not return an access token.${NC}"
        echo "Checked: $TEST_API_BASE/auth/admin/sessions"
        echo "Admin username: $TEST_ADMIN_USERNAME"
        print_setup_help
        return 1
    fi

    echo -e "${GREEN}✓ Admin login passed${NC}"

    local resolved_api_key="${TEST_API_KEY:-${ACCESS_API_KEY:-}}"

    if [ -z "$resolved_api_key" ]; then
        resolved_api_key=$(get_api_key_from_metadata "$admin_token")
    fi

    if [ -z "$resolved_api_key" ]; then
        echo -e "${RED}Preflight failed: no API key was available.${NC}"
        echo "Set TEST_API_KEY or ACCESS_API_KEY, or ensure /metadata/api-key works for the admin session."
        print_setup_help
        return 1
    fi

    export ACCESS_API_KEY="$resolved_api_key"
    echo -e "${GREEN}✓ API key is available${NC}"

    echo -e "${GREEN}Preflight passed.${NC}"
    echo ""
    return 0
}

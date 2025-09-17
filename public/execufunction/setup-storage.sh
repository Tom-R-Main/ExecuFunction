#!/bin/bash

# Azure Storage setup for Executive Function waitlist/contact system
# Run this after deploying the Static Web App

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Configuration
RG="rg-exf-prod"
LOC="eastus2"  # Changed to match your SWA location
APP_NAME="exf-web"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function for colored output
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if Azure CLI is installed and logged in
if ! command -v az &> /dev/null; then
    log_error "Azure CLI is not installed. Please install it first."
    exit 1
fi

if ! az account show &> /dev/null; then
    log_error "Not logged into Azure. Please run 'az login' first."
    exit 1
fi

# Check if resource group exists
if ! az group show -n "$RG" &> /dev/null; then
    log_error "Resource group '$RG' not found. Please create it first or update the script."
    exit 1
fi

# Check if Static Web App exists
if ! az staticwebapp show -n "$APP_NAME" -g "$RG" &> /dev/null; then
    log_error "Static Web App '$APP_NAME' not found in resource group '$RG'."
    exit 1
fi

# Check if storage account already exists (avoid duplicates)
EXISTING_STORAGE=$(az storage account list -g "$RG" --query "[?starts_with(name, 'stexecufunction')].name" -o tsv | head -1)

if [ -n "$EXISTING_STORAGE" ]; then
    log_warn "Found existing storage account: $EXISTING_STORAGE"
    read -p "Use existing storage account? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ST="$EXISTING_STORAGE"
        log_info "Using existing storage account: $ST"
    else
        # Generate new unique name
        TIMESTAMP=$(date +%s)
        RANDOM_SUFFIX=$((TIMESTAMP % 9999))
        ST="stexfn${RANDOM_SUFFIX}"
        log_info "Creating new storage account: $ST"
    fi
else
    # Generate unique storage account name (must be globally unique, max 24 chars)
    TIMESTAMP=$(date +%s)
    RANDOM_SUFFIX=$((TIMESTAMP % 9999))
    ST="stexfn${RANDOM_SUFFIX}"  # Shortened to ensure under 24 chars
fi

echo ""
log_info "Setting up Azure Storage for Executive Function..."
log_info "Resource Group: $RG"
log_info "Location: $LOC"
log_info "Storage Account: $ST"
log_info "Static Web App: $APP_NAME"
echo ""

# Create or skip storage account
if ! az storage account show -n "$ST" -g "$RG" &> /dev/null; then
    log_info "Creating storage account..."
    az storage account create \
      -g "$RG" \
      -n "$ST" \
      -l "$LOC" \
      --sku Standard_LRS \
      --kind StorageV2 \
      --access-tier Hot \
      --https-only true \
      --min-tls-version TLS1_2 \
      --allow-blob-public-access false \
      --output none
    
    # Wait for storage account to be ready
    log_info "Waiting for storage account to be ready..."
    az storage account show -n "$ST" -g "$RG" --query "provisioningState" -o tsv | grep -q "Succeeded"
else
    log_info "Storage account already exists, skipping creation..."
fi

# Get storage connection string
log_info "Retrieving storage connection string..."
CONN=$(az storage account show-connection-string -g "$RG" -n "$ST" --query connectionString -o tsv)

if [ -z "$CONN" ]; then
    log_error "Failed to retrieve storage connection string"
    exit 1
fi

# Create tables (idempotent - won't fail if they exist)
log_info "Creating tables..."
TABLES=("waitlist" "contact" "throttle" "suppression")

for TABLE in "${TABLES[@]}"; do
    if az storage table create --name "$TABLE" --connection-string "$CONN" &> /dev/null; then
        log_info "  ✓ Created table: $TABLE"
    else
        log_warn "  → Table '$TABLE' already exists or couldn't be created"
    fi
done

# Configure Static Web App settings
log_info "Configuring Static Web App settings..."

# Check current settings first
CURRENT_SETTINGS=$(az staticwebapp appsettings list -n "$APP_NAME" -g "$RG" -o json 2>/dev/null || echo "{}")

# Update settings
if az staticwebapp appsettings set \
  -n "$APP_NAME" \
  -g "$RG" \
  --setting-names \
    STORAGE_CONNECTION_STRING="$CONN" \
    CONTACT_TO="tom@winonaos.com" \
  --output none; then
    log_info "Static Web App settings updated successfully"
else
    log_error "Failed to update Static Web App settings"
    exit 1
fi

# Get the app URL
APP_URL=$(az staticwebapp show -n "$APP_NAME" -g "$RG" --query "defaultHostname" -o tsv)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log_info "✅ Storage setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
log_info "Storage Account: $ST"
log_info "Website URL: https://$APP_URL"
echo ""
echo "📊 Admin Export Endpoint:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To get your function key:"
echo "  1. Go to: https://portal.azure.com"
echo "  2. Navigate to: Resource Groups → $RG → $APP_NAME"
echo "  3. Go to: Functions → admin-export"
echo "  4. Click: 'Get Function URL' and copy the code parameter"
echo ""
echo "Export URL format:"
echo "  https://$APP_URL/api/admin/export?code=YOUR_FUNCTION_KEY"
echo ""
echo "Optional parameters:"
echo "  &table=waitlist    - Export waitlist (default)"
echo "  &table=contact     - Export contact messages"
echo "  &from=2025-09      - Start month (YYYY-MM)"
echo "  &to=2025-12        - End month (YYYY-MM)"
echo ""
echo "Example:"
echo "  https://$APP_URL/api/admin/export?code=KEY&table=waitlist&from=2025-09"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Optional: Test the waitlist endpoint
echo ""
read -p "Would you like to test the waitlist endpoint? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    TEST_EMAIL="test-$(date +%s)@example.com"
    log_info "Testing waitlist endpoint with $TEST_EMAIL..."
    
    RESPONSE=$(curl -s -X POST "https://$APP_URL/api/join-waitlist" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$TEST_EMAIL\"}" \
      -w "\nHTTP_CODE:%{http_code}")
    
    HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
    BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")
    
    if [ "$HTTP_CODE" = "201" ] || [ "$HTTP_CODE" = "200" ]; then
        log_info "✓ Test successful! Response: $BODY"
    else
        log_warn "Test returned HTTP $HTTP_CODE: $BODY"
    fi
fi